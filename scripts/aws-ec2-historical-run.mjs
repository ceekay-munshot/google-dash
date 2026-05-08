#!/usr/bin/env node
// Iterates /tmp/versions.json and, for each version, parses the
// historical CSV and POSTs through the multi-phase capture endpoint.
// Naturally idempotent: pre-flight check against
// /api/aws/ec2-pricing/history/status-by-date skips versions that
// were already successfully captured. No GitHub cache state.

import fs from 'node:fs';
import { spawn } from 'node:child_process';

const MODE          = process.env.MODE || 'dry_run';
const DASHBOARD_URL = process.env.DASHBOARD_URL;
const SECRET        = process.env.SECRET || '';

if (!DASHBOARD_URL) { console.error('DASHBOARD_URL env required'); process.exit(2); }

const versions = JSON.parse(fs.readFileSync('/tmp/versions.json', 'utf8'));
console.error(`Processing ${versions.length} versions in mode=${MODE}`);

let processed = 0;
let skipped = 0;
let failed = 0;

for (const v of versions) {
  const date = v.effective_begin;

  // Resume check (skip per spec — D1 is the source of truth).
  if (MODE !== 'dry_run') {
    const statusUrl = new URL('/api/aws/ec2-pricing/history/status-by-date', DASHBOARD_URL);
    statusUrl.searchParams.set('date', date);
    statusUrl.searchParams.set('source', 'aws_bulk_pricelist_historical');
    try {
      const r = await (await fetch(statusUrl.toString())).json();
      if (r?.exists) {
        console.error(`[skip] ${v.version_id} (${date}) — already captured (run_id=${r.run_id})`);
        skipped++;
        continue;
      }
    } catch (e) {
      console.error(`[warn] status-by-date check failed for ${date}: ${e.message} — proceeding anyway`);
    }
  }

  console.error(`[${MODE}] ${v.version_id} (${date}) — fetching + parsing CSV…`);
  const t0 = Date.now();
  const payloadFile = `/tmp/payload-${v.version_id}.json`;
  await runChild('node', ['scripts/fetch-aws-ec2-pricing.mjs', '--stdout', `--version=${v.version_id}`], { stdoutFile: payloadFile });
  const stat = fs.statSync(payloadFile);
  console.error(`  parsed in ${(Date.now() - t0) / 1000}s (${(stat.size / 1024).toFixed(1)} KB)`);

  if (MODE === 'dry_run') {
    console.error(`  [dry_run] skipping POST`);
    fs.unlinkSync(payloadFile);
    processed++;
    continue;
  }

  try {
    await runChild('node', ['scripts/aws-ec2-capture-multiphase.mjs'], {
      env: {
        ...process.env,
        DASHBOARD_URL, SECRET,
        PAYLOAD: payloadFile,
        FORCE: 'true',
        SNAPSHOT_DATE_OVERRIDE: date,
      },
    });
    processed++;
  } catch (e) {
    console.error(`[fail] ${v.version_id} (${date}): ${e.message}`);
    failed++;
  } finally {
    try { fs.unlinkSync(payloadFile); } catch (_) {}
  }
}

console.error(`\nSummary: processed=${processed} skipped=${skipped} failed=${failed} of ${versions.length}`);
if (failed > 0) process.exit(1);

function runChild(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const stdoutFile = opts.stdoutFile;
    const child = spawn(cmd, args, {
      env: opts.env || process.env,
      stdio: ['ignore', stdoutFile ? 'pipe' : 'inherit', 'inherit'],
    });
    let writeStream;
    if (stdoutFile) {
      writeStream = fs.createWriteStream(stdoutFile);
      child.stdout.pipe(writeStream);
    }
    child.on('exit', code => {
      if (writeStream) writeStream.end();
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

#!/usr/bin/env node
/**
 * One-shot build script — generates a small JSON snapshot of AWS EC2
 * on-demand pricing from the official AWS Price List bulk files.
 *
 * Why this script exists:
 *   The previous Pricing Trends tab was an iframe of aws.amazon.com/ec2/
 *   pricing/on-demand/. AWS's pricing widget calls a token-gated data API
 *   that returns 403 outside aws.amazon.com, so the iframe rendered
 *   "Something went wrong / Reload" inside the widget areas. This script
 *   replaces that broken live embed with source-backed pricing tables
 *   built from AWS's officially published Price List CSVs.
 *
 * Sources (official, public, no auth):
 *   - https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/region_index.json
 *     → resolves to https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/<ts>/us-east-1/index.csv
 *
 * Why a build script and not a runtime fetch:
 *   The us-east-1 EC2 CSV is ~295MB. Fetching + stream-parsing per
 *   request would blow the Cloudflare Pages Function CPU budget. The
 *   filtered output is ~80KB; pre-building it once and committing the
 *   result is the cheapest reliable path that still uses official data.
 *
 * Usage:
 *   node scripts/fetch-aws-ec2-pricing.mjs
 *
 *   Re-run this when AWS publishes price changes (typically quarterly).
 *   The output is committed at:
 *     functions/api/aws/ec2-pricing/_on-demand-data.js
 *
 * What this script DOES NOT do:
 *   - capture pricing history (per spec — no time-series),
 *   - run on a cron (per spec — no automation),
 *   - touch HISTORY_KV or any other storage backend.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import readline from 'node:readline';

const REGION_INDEX = 'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/region_index.json';
const TARGET_REGION = 'us-east-1';
const OUT_FILE = path.resolve('functions/api/aws/ec2-pricing/_on-demand-data.js');

// Filters — the canonical "default visible setting" the AWS marketing
// page shows to a user landing on N. Virginia / Linux without changes:
const F = {
  TermType: 'OnDemand',
  CurrentGeneration: null,                    // include both — UI will show all
  PreInstalled_SW: 'NA',                      // raw Linux, no bundled software
  Tenancy: 'Shared',                          // standard on-demand (no Dedicated/Host)
  OperatingSystem: 'Linux',
  CapacityStatus: 'Used',                     // billed running compute (not Reserved/Allocated/UnusedCapacityReservation)
  Unit: 'Hrs',                                // hourly rate (skip per-second / per-request rows)
  Location: 'US East (N. Virginia)',
  // EC2 instance pricing is split across two ProductFamily values in the
  // bulk CSV: 'Compute Instance' (regular VMs) and 'Compute Instance
  // (bare metal)' (the .metal* SKUs — c5.metal, m7i.metal-48xl, etc.).
  // Both are on-demand Linux Shared rows, both appear in AWS's marketing
  // pricing widget. The set of bare-metal types adds ~284 distinct
  // instance types in us-east-1.
  ProductFamilies: ['Compute Instance', 'Compute Instance (bare metal)'],
  // License Model 'No License required' (Linux default — Bring-your-own
  // and License-included rows are excluded).
  License_Model: 'No License required',
};

// Reference count from the AWS marketing pricing page widget for the same
// filter combination (US East / Linux / Shared / No license required, all
// instance types, all vCPU). Sourced manually from
// https://aws.amazon.com/ec2/pricing/on-demand/ — kept here so the
// dashboard can flag a count drift between the official bulk CSV (our
// source) and the widget. Update by hand if AWS changes the widget total.
const AWS_REFERENCE_COUNT_USEAST_LINUX_SHARED = 1256;
const AWS_REFERENCE_COUNT_DATE = '2026-05-08';

async function main() {
  console.log('— Resolving AWS Price List region index…');
  const idx = await (await fetch(REGION_INDEX)).json();
  const region = idx.regions[TARGET_REGION];
  if (!region) throw new Error('Region not in index: ' + TARGET_REGION);
  const csvUrl = 'https://pricing.us-east-1.amazonaws.com' + region.currentVersionUrl.replace(/\.json$/, '.csv');
  console.log('  CSV URL:', csvUrl);

  console.log('— Fetching CSV (this is ~295MB and may take 60-180s)…');
  const t0 = Date.now();
  const resp = await fetch(csvUrl);
  if (!resp.ok) throw new Error('Fetch failed: HTTP ' + resp.status);

  // The Price List CSV has 5 leading metadata rows BEFORE the column header
  // row. Skip those, parse columns from row 6, then read every data row.
  // We minimal-parse: the CSV uses RFC4180 with quoted fields containing
  // commas inside descriptions. parseCsvLine handles quoting.
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let lineNo = 0;
  let header = null;
  let columnIdx = null;
  const rows = [];
  let totalLines = 0;

  function processLine(line) {
    totalLines++;
    if (lineNo < 5) { lineNo++; return; }     // skip 5 metadata rows
    if (header === null) {
      header = parseCsvLine(line);
      columnIdx = Object.fromEntries(header.map((h, i) => [h, i]));
      lineNo++;
      console.log('  CSV columns parsed:', header.length);
      return;
    }
    const cells = parseCsvLine(line);
    // cheap pre-filter to skip the bulk of irrelevant rows fast
    const get = (name) => cells[columnIdx[name]] ?? '';
    if (get('TermType') !== F.TermType) return;
    if (get('Unit') !== F.Unit) return;
    if (get('Location') !== F.Location) return;
    if (get('Tenancy') !== F.Tenancy) return;
    if (get('Operating System') !== F.OperatingSystem) return;
    if (get('Pre Installed S/W') !== F.PreInstalled_SW) return;
    if (get('CapacityStatus') !== F.CapacityStatus) return;
    if (!F.ProductFamilies.includes(get('Product Family'))) return;
    if (get('License Model') !== F.License_Model) return;
    const instanceType = get('Instance Type');
    if (!instanceType) return;
    const priceUSD = parseFloat(get('PricePerUnit'));
    if (!Number.isFinite(priceUSD)) return;
    rows.push({
      instance_type: instanceType,
      price_per_hour_usd: priceUSD,
      vcpu: parseFloat(get('vCPU')) || null,
      memory: get('Memory') || null,           // e.g. "4 GiB"
      storage: get('Storage') || null,         // e.g. "EBS only" / "1 x 50 NVMe SSD"
      network_performance: get('Network Performance') || null,
      processor_architecture: get('Physical Processor') || null,
      current_generation: get('Current Generation') || null,
      bare_metal: get('Product Family') === 'Compute Instance (bare metal)',
    });
  }

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      processLine(line);
    }
  }
  if (buf.length > 0) processLine(buf);

  console.log('— Streamed', totalLines.toLocaleString(), 'CSV lines in', ((Date.now() - t0) / 1000).toFixed(1), 's');
  console.log('  Filtered down to', rows.length, 'on-demand Linux Shared rows');

  if (rows.length === 0) {
    throw new Error('No rows matched the filters — AWS may have changed CSV column names.');
  }

  // Dedupe: a single instance type can have multiple SKUs in the CSV
  // (e.g. different productFamily quirks). We keep the lowest non-zero
  // hourly price per instance_type — that's what AWS displays as the
  // "On-Demand hourly rate" on the marketing page.
  const byType = new Map();
  for (const r of rows) {
    if (!(r.price_per_hour_usd > 0)) continue;
    const prev = byType.get(r.instance_type);
    if (!prev || r.price_per_hour_usd < prev.price_per_hour_usd) {
      byType.set(r.instance_type, r);
    }
  }
  const compact = Array.from(byType.values()).sort((a, b) => a.price_per_hour_usd - b.price_per_hour_usd);
  console.log('  Deduped to', compact.length, 'unique instance types');
  const drift = compact.length - AWS_REFERENCE_COUNT_USEAST_LINUX_SHARED;
  if (drift !== 0) {
    console.log('  AWS marketing-widget reference (' + AWS_REFERENCE_COUNT_DATE + '):',
      AWS_REFERENCE_COUNT_USEAST_LINUX_SHARED,
      '— captured count drifts by', (drift > 0 ? '+' : '') + drift,
      '(this is expected: bulk CSV vs widget data sources are not always identical)');
  } else {
    console.log('  Captured count matches AWS marketing-widget reference exactly.');
  }

  const generatedAt = new Date().toISOString();
  const moduleSrc = `// AUTO-GENERATED — do not edit by hand.
// Source: AWS Price List bulk CSV — https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/us-east-1/index.csv
// Generated: ${generatedAt}
// Filters applied: TermType=OnDemand, OS=Linux, Tenancy=Shared, PreInstalled_SW=NA,
//                  CapacityStatus=Used, License=No License required, Location=US East (N. Virginia),
//                  ProductFamily ∈ {Compute Instance, Compute Instance (bare metal)}
// Regenerate with: node scripts/fetch-aws-ec2-pricing.mjs
export const generatedAt = ${JSON.stringify(generatedAt)};
export const region = ${JSON.stringify(TARGET_REGION)};
export const regionLabel = ${JSON.stringify(F.Location)};
export const operatingSystem = ${JSON.stringify(F.OperatingSystem)};
export const tenancy = ${JSON.stringify(F.Tenancy)};
// AWS marketing-page widget instance count for the same filter combo,
// captured manually on AWS_REFERENCE_COUNT_DATE. Used to flag drift
// between the official bulk CSV and the widget — the two data sources
// don't always match exactly.
export const awsReferenceCount = ${AWS_REFERENCE_COUNT_USEAST_LINUX_SHARED};
export const awsReferenceCountDate = ${JSON.stringify(AWS_REFERENCE_COUNT_DATE)};
export const onDemandRows = ${JSON.stringify(compact, null, 2)};
`;
  fs.writeFileSync(OUT_FILE, moduleSrc, 'utf8');
  console.log('— Wrote', OUT_FILE, '(' + (moduleSrc.length / 1024).toFixed(1) + 'KB)');
}

/**
 * Minimal RFC4180 CSV row parser — handles double-quoted cells with
 * embedded commas, double-quoted quotes ("" → "), and unquoted cells.
 * AWS's Price List CSV is well-formed so this is enough.
 */
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = false; }
      } else {
        cur += c;
      }
    } else {
      if (c === ',') { out.push(cur); cur = ''; }
      else if (c === '"') { inQuotes = true; }
      else { cur += c; }
    }
  }
  out.push(cur);
  return out;
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});

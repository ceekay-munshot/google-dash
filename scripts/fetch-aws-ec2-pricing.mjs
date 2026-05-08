#!/usr/bin/env node
/**
 * Builds an on-demand EC2 pricing snapshot from AWS's official Price
 * List bulk files. Two output modes (mutually exclusive):
 *
 *   (default) — writes the static module
 *               functions/api/aws/ec2-pricing/_on-demand-data.js used
 *               by /api/aws/ec2-pricing/on-demand. Same behavior the
 *               script has always had.
 *
 *   --stdout   — emits a single-line JSON document to stdout shaped
 *               for /api/aws/ec2-pricing/history/capture. Used by the
 *               GH Actions daily capture workflow. All log output is
 *               redirected to stderr so stdout stays clean.
 *
 * Optional flags:
 *
 *   --version=<TS>
 *               Fetches a historical snapshot from
 *               /offers/v1.0/aws/AmazonEC2/<TS>/us-east-1/index.csv
 *               instead of /current/.... <TS> is a 14-character
 *               version ID like "20260507192915" pulled from
 *               https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/index.json.
 *               Used by the historical-backfill workflow.
 *
 * Sources (official, public, no auth):
 *   - https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/region_index.json
 *   - https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/<TS>/us-east-1/index.csv
 *   - https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/index.json (historical version index)
 *
 * Why a build script and not a runtime fetch:
 *   The us-east-1 EC2 CSV is ~295MB. Fetching + stream-parsing per
 *   request would blow the Cloudflare Pages Function CPU budget. The
 *   filtered output is ~80KB; pre-building once is cheaper.
 */

import fs from 'node:fs';
import path from 'node:path';

// Mode flags
const ARGS = process.argv.slice(2);
const STDOUT_MODE  = ARGS.includes('--stdout');
const VERSION_FLAG = ARGS.find(a => a.startsWith('--version='));
const VERSION_ID   = VERSION_FLAG ? VERSION_FLAG.slice('--version='.length) : null;

// In stdout mode, route logs to stderr so they don't pollute the
// JSON payload that the GH Actions runner pipes downstream.
const log = STDOUT_MODE ? (...a) => console.error(...a) : (...a) => console.log(...a);

const REGION_INDEX  = 'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/region_index.json';
const VERSION_INDEX = 'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/index.json';
const TARGET_REGION = 'us-east-1';
const OUT_FILE      = path.resolve('functions/api/aws/ec2-pricing/_on-demand-data.js');

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

async function resolveCsvUrl() {
  if (VERSION_ID) {
    // Historical: derive both source_publication_date and source_url
    // from versionIndex (cheap; ~30KB) so callers can record metadata
    // without us inferring it.
    log('— Resolving historical version index…');
    const versionIndex = await (await fetch(VERSION_INDEX)).json();
    const v = versionIndex.versions?.[VERSION_ID];
    if (!v) throw new Error('Version not found in index: ' + VERSION_ID);
    const csvUrl = `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/${VERSION_ID}/${TARGET_REGION}/index.csv`;
    return {
      csvUrl,
      versionId: VERSION_ID,
      effectiveBegin: v.versionEffectiveBeginDate || null,
      effectiveEnd:   v.versionEffectiveEndDate   || null,
      // Historical versions don't expose publicationDate at the version-index level.
      publicationDate: null,
    };
  }

  log('— Resolving AWS Price List region index…');
  const idx = await (await fetch(REGION_INDEX)).json();
  const region = idx.regions[TARGET_REGION];
  if (!region) throw new Error('Region not in index: ' + TARGET_REGION);
  const csvUrl = 'https://pricing.us-east-1.amazonaws.com' + region.currentVersionUrl.replace(/\.json$/, '.csv');
  // The current version's publication date lives one level up in the
  // current/index.json — fetch the lightweight index to read it.
  const currentIdxUrl = 'https://pricing.us-east-1.amazonaws.com' + region.currentVersionUrl;
  let publicationDate = null;
  let versionId = 'current';
  try {
    const head = await fetch(currentIdxUrl, { method: 'HEAD' });
    // index.json is large; we instead derive versionId from the CSV URL's path segment.
    const m = csvUrl.match(/AmazonEC2\/(\d{14})\//);
    if (m) versionId = m[1];
  } catch (_) { /* ignore */ }
  return { csvUrl, versionId, publicationDate, effectiveBegin: null, effectiveEnd: null };
}

async function main() {
  const { csvUrl, versionId, publicationDate, effectiveBegin, effectiveEnd } = await resolveCsvUrl();
  log('  CSV URL:', csvUrl);

  log('— Fetching CSV (this is ~295MB and may take 60-180s)…');
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
      log('  CSV columns parsed:', header.length);
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

  log('— Streamed', totalLines.toLocaleString(), 'CSV lines in', ((Date.now() - t0) / 1000).toFixed(1), 's');
  log('  Filtered down to', rows.length, 'on-demand Linux Shared rows');

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
  log('  Deduped to', compact.length, 'unique instance types');
  const drift = compact.length - AWS_REFERENCE_COUNT_USEAST_LINUX_SHARED;
  if (drift !== 0) {
    log('  AWS marketing-widget reference (' + AWS_REFERENCE_COUNT_DATE + '):',
      AWS_REFERENCE_COUNT_USEAST_LINUX_SHARED,
      '— captured count drifts by', (drift > 0 ? '+' : '') + drift,
      '(this is expected: bulk CSV vs widget data sources are not always identical)');
  } else {
    log('  Captured count matches AWS marketing-widget reference exactly.');
  }

  if (STDOUT_MODE) {
    // Single-line JSON payload shaped for /api/aws/ec2-pricing/history/capture.
    // Keep field names aligned with the D1 schema in
    // migrations/0001_aws_ec2_pricing.sql so the capture endpoint can
    // map directly without renaming.
    const payload = {
      source: VERSION_ID ? 'aws_bulk_pricelist_historical' : 'aws_bulk_pricelist_current',
      source_url: csvUrl,
      source_publication_date: publicationDate || effectiveBegin || null,
      source_version_id: versionId,
      effective_begin_date: effectiveBegin,
      effective_end_date:   effectiveEnd,
      region_code: TARGET_REGION,
      region_label: F.Location,
      operating_system: F.OperatingSystem,
      tenancy: F.Tenancy,
      license_model: F.License_Model,
      aws_reference_count: AWS_REFERENCE_COUNT_USEAST_LINUX_SHARED,
      aws_reference_count_date: AWS_REFERENCE_COUNT_DATE,
      // Renamed for capture-endpoint clarity. memory → memory_label;
      // processor_architecture stays. bare_metal becomes 0/1 int.
      rows: compact.map(r => ({
        instance_type: r.instance_type,
        price_per_hour_usd: r.price_per_hour_usd,
        vcpu: r.vcpu,
        memory_label: r.memory,
        storage: r.storage,
        network_performance: r.network_performance,
        processor_architecture: r.processor_architecture,
        current_generation: r.current_generation,
        bare_metal: r.bare_metal ? 1 : 0,
        product_family: r.bare_metal ? 'Compute Instance (bare metal)' : 'Compute Instance',
      })),
    };
    process.stdout.write(JSON.stringify(payload));
    return;
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
  log('— Wrote', OUT_FILE, '(' + (moduleSrc.length / 1024).toFixed(1) + 'KB)');
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

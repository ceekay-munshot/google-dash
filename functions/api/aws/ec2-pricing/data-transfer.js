/**
 * Cloudflare Pages Function — EC2 Data Transfer Pricing (live)
 * Route: GET /api/aws/ec2-pricing/data-transfer
 *
 * Returns the data-transfer pricing rows AWS publishes on
 * aws.amazon.com/ec2/pricing/on-demand under "Data Transfer" — built
 * from the official AWS Price List bulk CSV for the AWSDataTransfer
 * service in us-east-1.
 *
 * Source:
 *   https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/us-east-1/index.csv
 *
 * The us-east-1 data-transfer CSV is small (~480KB), so we fetch and
 * parse on every request and lean on Cloudflare's edge cache to
 * deduplicate across users. Unlike the EC2 instance bulk file, this
 * one fits comfortably inside a Pages Functions CPU budget.
 *
 * Output shape:
 *   {
 *     success, region, region_label, generated_at,
 *     groups: [
 *       { title, currency, unit, rows: [{ label, price_per_unit, raw_meta }] },
 *       ...
 *     ],
 *     source
 *   }
 */

const REGION_INDEX_URL = 'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/region_index.json';
const REGION = 'us-east-1';
const REGION_LABEL = 'US East (N. Virginia)';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export async function onRequestGet() {
  let rows;
  try {
    rows = await fetchAndParse();
  } catch (err) {
    return jsonResp({
      success: false,
      error: 'AWS data-transfer pricing fetch failed',
      detail: err && err.message ? err.message : String(err),
    }, 502);
  }

  const groups = groupRows(rows);
  return jsonResp({
    success: true,
    region: REGION,
    region_label: REGION_LABEL,
    generated_at: new Date().toISOString(),
    groups,
    source: 'AWS Price List bulk CSV — pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/current/us-east-1/index.csv',
  }, 200, { 'Cache-Control': 'public, max-age=21600' }); // 6h edge cache
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

async function fetchAndParse() {
  const idx = await (await fetch(REGION_INDEX_URL, { cf: { cacheTtl: 21600, cacheEverything: true } })).json();
  const region = idx.regions[REGION];
  if (!region) throw new Error('Region not in index: ' + REGION);
  const csvUrl = 'https://pricing.us-east-1.amazonaws.com' + region.currentVersionUrl.replace(/\.json$/, '.csv');
  const resp = await fetch(csvUrl, { cf: { cacheTtl: 21600, cacheEverything: true } });
  if (!resp.ok) throw new Error('CSV fetch HTTP ' + resp.status);
  const text = await resp.text();
  return parseCsv(text);
}

/** Parse the AWS Price List CSV. The first 5 rows are metadata; row 6
 *  is the column header; data starts at row 7. */
function parseCsv(text) {
  const lines = text.split(/\r?\n/);
  if (lines.length < 7) return [];
  const header = parseCsvLine(lines[5]);
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const out = [];
  for (let i = 6; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cells = parseCsvLine(line);
    const get = (k) => cells[idx[k]] ?? '';
    if (get('TermType') !== 'OnDemand') continue;
    const price = parseFloat(get('PricePerUnit'));
    // Keep $0 rows — AWS lists "free" routes (e.g. EC2 → CloudFront,
    // intra-region) explicitly with PricePerUnit=0. Filtering them
    // would silently turn "$0.00 per GB" into a missing row.
    if (!Number.isFinite(price) || price < 0) continue;
    out.push({
      product_family: get('Product Family') || '',
      group: get('Group') || '',
      group_description: get('Group Description') || '',
      transfer_type: get('Transfer Type') || '',
      from_location: get('From Location') || '',
      to_location: get('To Location') || '',
      to_location_type: get('To Location Type') || '',
      from_location_type: get('From Location Type') || '',
      price: price,
      unit: get('Unit') || 'GB',
      currency: 'USD',
      start_range: get('StartingRange') || '',
      end_range: get('EndingRange') || '',
      sku: get('SKU') || '',
    });
  }
  return out;
}

/** Group the raw rows into the three sections the AWS marketing page
 *  shows: Inbound from internet, Outbound to internet (with bracket
 *  pricing), Outbound to specific destinations. Anything that doesn't
 *  fit cleanly is dropped — the dashboard prefers showing fewer
 *  honest rows over a sea of unfiltered SKUs. */
function groupRows(rows) {
  // Anything sourced from "External" (internet) is inbound; "Inter-Region
  // Outbound" rows define the per-destination outbound pricing AWS shows
  // as the "Data Transfer OUT From Amazon EC2 To <region>" table.
  const inbound = [];
  const outboundInternet = [];
  const outboundToRegions = [];

  for (const r of rows) {
    const fam = r.product_family;
    const tt = r.transfer_type;
    const desc = r.group_description.toLowerCase();
    const fromUSE1 = /us-east-1|n\. virginia|us east \(n. virginia\)/i.test(r.from_location);

    // Internet inbound: fromLocation = External, toLocation = us-east-1
    if (tt === 'AWS Inbound' && /external/i.test(r.from_location) && fromIsRegion(r.to_location)) {
      inbound.push({
        label: 'All data transfer in',
        price: r.price,
        unit: r.unit,
        meta: r.group_description || r.transfer_type,
      });
      continue;
    }

    // Internet outbound: fromLocation = us-east-1, toLocation = External
    if (tt === 'AWS Outbound' && fromUSE1 && /external|internet/i.test(r.to_location)) {
      const tier = bracketLabel(r.start_range, r.end_range, r.unit);
      outboundInternet.push({
        label: tier,
        price: r.price,
        unit: r.unit,
        meta: r.group_description || r.transfer_type,
        startGB: numOrNull(r.start_range),
        endGB: numOrNull(r.end_range),
      });
      continue;
    }

    // Outbound to other AWS regions / locations.
    // Filter to rows actually originating from us-east-1.
    if (tt === 'InterRegion Outbound' && fromUSE1 && r.to_location && !/external/i.test(r.to_location)) {
      outboundToRegions.push({
        label: r.to_location,
        price: r.price,
        unit: r.unit,
        meta: r.group_description || r.transfer_type,
      });
      continue;
    }
  }

  // Order outboundInternet by tier start so the bracket prices read
  // First 10 TB / Next 40 TB / Next 100 TB / Greater than 150 TB the
  // way AWS displays them.
  outboundInternet.sort((a, b) => (a.startGB ?? 0) - (b.startGB ?? 0));
  // Order regions alphabetically.
  outboundToRegions.sort((a, b) => a.label.localeCompare(b.label));
  // Dedupe regions (the CSV occasionally has multiple SKUs per pair —
  // keep the lowest non-zero price, matching what AWS shows).
  const dedupedRegions = [];
  const seen = new Map();
  for (const r of outboundToRegions) {
    const prev = seen.get(r.label);
    if (!prev || r.price < prev.price) seen.set(r.label, r);
  }
  for (const r of seen.values()) dedupedRegions.push(r);
  dedupedRegions.sort((a, b) => a.label.localeCompare(b.label));

  return [
    {
      title: 'Data Transfer IN to Amazon EC2 from Internet',
      currency: 'USD',
      unit: 'per GB',
      rows: inbound,
    },
    {
      title: 'Data Transfer OUT from Amazon EC2 to Internet',
      note: 'AWS customers receive 100GB of data transfer out to the internet free each month, aggregated across all AWS Services and Regions (except China and GovCloud).',
      currency: 'USD',
      unit: 'per GB',
      rows: outboundInternet,
    },
    {
      title: 'Data Transfer OUT from Amazon EC2 to other AWS destinations',
      currency: 'USD',
      unit: 'per GB',
      rows: dedupedRegions,
    },
  ];
}

function fromIsRegion(s) {
  return s && !/external/i.test(s);
}

function bracketLabel(start, end, unit) {
  const s = numOrNull(start);
  const e = numOrNull(end);
  if (s === 0 && e === null) return 'All data transfer out';
  if (s === 0 && e === Infinity) return 'All data transfer out';
  // Tier brackets from AWS: 0-10 TB, 10-50, 50-150, >150 (in GB).
  const fmtBound = (n) => {
    if (n === null || !Number.isFinite(n)) return '';
    if (n >= 1024) return (n / 1024).toFixed(0) + ' TB';
    return n + ' GB';
  };
  if (s === 0)            return 'First ' + fmtBound(e) + ' / Month';
  if (e === null)         return 'Greater than ' + fmtBound(s) + ' / Month';
  return 'Next ' + fmtBound(e - s) + ' / Month';
}

function numOrNull(v) {
  if (v === '' || v === 'Inf') return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function parseCsvLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else {
      if (c === ',') { out.push(cur); cur = ''; }
      else if (c === '"') inQ = true;
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function jsonResp(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS,
      ...extraHeaders,
    },
  });
}

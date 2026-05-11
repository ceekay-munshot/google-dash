#!/usr/bin/env node
/**
 * Fetches AWS EC2 Spot Price History via DescribeSpotPriceHistory.
 *
 * This is a different dataset from the on-demand fetcher
 * (fetch-aws-ec2-pricing.mjs):
 *   - On-demand: scraped from the AWS Price List Bulk CSV (~295MB), one
 *     daily snapshot per instance type.
 *   - Spot:      pulled live from the EC2 API, one row per observation,
 *     with availability zone + product description dimensions and a
 *     rolling 90-day source-history limit imposed by AWS.
 *
 * Output (default): single-line JSON to stdout, shaped for
 *   POST /api/aws/ec2-pricing/spot/capture (phase=begin then phase=rows).
 *
 * Flags:
 *   --region=us-east-1                   default us-east-1
 *   --product-description=Linux/UNIX     AWS product description
 *   --start-time=ISO_8601                inclusive lower bound (defaults to 24h ago)
 *   --end-time=ISO_8601                  inclusive upper bound (defaults to now)
 *   --instance-types=t1,t2,...           CSV; defaults to the v1 basket below
 *   --summary-only                       prints row counts + sample, NO full rows
 *
 * Credentials: AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY from env
 * (AWS_SESSION_TOKEN optional for STS). AWS_REGION env is ignored in
 * favor of --region so the script is reproducible.
 *
 * The script does NOT call any dashboard endpoint. It only fetches and
 * prints. Pairing with the capture endpoint is done by a separate runner.
 */

import { EC2Client, DescribeSpotPriceHistoryCommand } from '@aws-sdk/client-ec2';

// Representative institutional basket — v1 scope per product spec. Keep
// small until we've validated volume/quality on a sample. Once stable
// we expand to broader instance families.
const DEFAULT_BASKET = [
  'm7i.large', 'm7i.2xlarge',
  'c7i.large', 'c7i.2xlarge',
  'r7i.large', 'r7i.2xlarge',
  'g5.xlarge', 'g5.2xlarge',
  'p4d.24xlarge', 'p5.48xlarge',
  'i4i.large', 'i4i.2xlarge',
];

// Map AWS EC2 instance type → family classification. Kept in sync with
// functions/api/aws/ec2-pricing/_family.js. Pure JS — small enough that
// duplicating it here avoids requiring a build step on the runner.
const FAMILY_RULES = [
  { test: /\.metal/i,                  family_class: 'baremetal' },
  { test: /^(p|g|inf|dl|trn|f|vt)\d/i, family_class: 'gpu'       },
  { test: /^(r|x|z)\d/i,               family_class: 'memory'    },
  { test: /^(d|h|i|im|is)\d/i,         family_class: 'storage'   },
  { test: /^(c|hpc)\d/i,               family_class: 'compute'   },
  { test: /^(t|m|a|mac)\d/i,           family_class: 'general'   },
];

function classifyInstance(instanceType) {
  const dotIdx = instanceType.indexOf('.');
  const instance_family = dotIdx === -1 ? instanceType : instanceType.slice(0, dotIdx);
  const instance_size   = dotIdx === -1 ? null : instanceType.slice(dotIdx + 1);
  let family_class = 'other';
  for (const r of FAMILY_RULES) {
    if (r.test.test(instanceType)) { family_class = r.family_class; break; }
  }
  return { instance_family, instance_size, family_class };
}

function parseFlag(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find(a => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const REGION              = parseFlag('region') || 'us-east-1';
const PRODUCT_DESCRIPTION = parseFlag('product-description') || 'Linux/UNIX';
const END_TIME_RAW        = parseFlag('end-time');
const START_TIME_RAW      = parseFlag('start-time');
const INSTANCE_TYPES_RAW  = parseFlag('instance-types');
const SUMMARY_ONLY        = hasFlag('summary-only');

const END_TIME   = END_TIME_RAW   ? new Date(END_TIME_RAW)   : new Date();
const START_TIME = START_TIME_RAW ? new Date(START_TIME_RAW) : new Date(END_TIME.getTime() - 24 * 60 * 60 * 1000);
const INSTANCE_TYPES = INSTANCE_TYPES_RAW
  ? INSTANCE_TYPES_RAW.split(',').map(s => s.trim()).filter(Boolean)
  : DEFAULT_BASKET;

// Sanity checks. The AWS API will reject windows older than ~90 days
// with an empty result rather than an error, so we log a warning.
if (Number.isNaN(START_TIME.getTime()) || Number.isNaN(END_TIME.getTime())) {
  console.error('FAILED: invalid --start-time or --end-time (must be ISO 8601)');
  process.exit(2);
}
if (START_TIME >= END_TIME) {
  console.error('FAILED: --start-time must be before --end-time');
  process.exit(2);
}
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const ageMs = Date.now() - START_TIME.getTime();
if (ageMs > NINETY_DAYS_MS) {
  console.error(`WARN: --start-time ${START_TIME.toISOString()} is older than AWS's rolling 90-day Spot history window. Result will be truncated.`);
}

if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  console.error('FAILED: AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY must be set in the environment.');
  process.exit(2);
}

const client = new EC2Client({
  region: REGION,
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken:    process.env.AWS_SESSION_TOKEN || undefined,
  },
});

async function fetchAll() {
  const rows = [];
  let nextToken;
  let page = 0;
  do {
    page++;
    const cmd = new DescribeSpotPriceHistoryCommand({
      InstanceTypes: INSTANCE_TYPES,
      ProductDescriptions: [PRODUCT_DESCRIPTION],
      StartTime: START_TIME,
      EndTime:   END_TIME,
      NextToken: nextToken,
      // The API caps at 1000 per page; AWS ignores values >1000.
      MaxResults: 1000,
    });
    const t0 = Date.now();
    const resp = await client.send(cmd);
    const got = resp?.SpotPriceHistory?.length || 0;
    console.error(`  [page ${page}] +${got} rows in ${Date.now() - t0}ms`);
    for (const r of resp?.SpotPriceHistory || []) {
      const klass = classifyInstance(r.InstanceType || '');
      const price = parseFloat(r.SpotPrice);
      if (!Number.isFinite(price)) continue;
      rows.push({
        observed_timestamp_utc: (r.Timestamp instanceof Date ? r.Timestamp.toISOString() : new Date(r.Timestamp).toISOString()),
        region_code:            REGION,
        availability_zone:      r.AvailabilityZone || null,
        instance_type:          r.InstanceType,
        instance_family:        klass.instance_family,
        instance_size:          klass.instance_size,
        family_class:           klass.family_class,
        product_description:    r.ProductDescription,
        spot_price_usd:         price,
        row_hash:               `${r.Timestamp}:${r.AvailabilityZone}:${r.InstanceType}:${r.ProductDescription}:${price}`,
      });
    }
    nextToken = resp?.NextToken || undefined;
  } while (nextToken);
  return rows;
}

async function main() {
  console.error('— Fetching EC2 Spot Price History');
  console.error('  region:               ', REGION);
  console.error('  product_description:  ', PRODUCT_DESCRIPTION);
  console.error('  window:               ', START_TIME.toISOString(), '→', END_TIME.toISOString());
  console.error('  instance_types:       ', INSTANCE_TYPES.join(', '));
  console.error('  basket_size:          ', INSTANCE_TYPES.length);

  const rows = await fetchAll();
  rows.sort((a, b) => a.observed_timestamp_utc.localeCompare(b.observed_timestamp_utc));

  const uniqueTypes = new Set(rows.map(r => r.instance_type));
  const uniqueAzs   = new Set(rows.map(r => r.availability_zone).filter(Boolean));
  const minTs       = rows[0]?.observed_timestamp_utc || null;
  const maxTs       = rows[rows.length - 1]?.observed_timestamp_utc || null;

  console.error(`— Fetched ${rows.length} rows · ${uniqueTypes.size} instance types · ${uniqueAzs.size} AZs`);
  if (rows.length === 0) {
    console.error('  (zero rows is normal for a recently-launched basket or a tight window — try widening --start-time)');
  }
  const missing = INSTANCE_TYPES.filter(t => !uniqueTypes.has(t));
  if (missing.length > 0) {
    console.error(`  Instance types with no observations in this window: ${missing.join(', ')}`);
  }

  const payload = {
    region:                 REGION,
    productDescription:     PRODUCT_DESCRIPTION,
    startTime:              START_TIME.toISOString(),
    endTime:                END_TIME.toISOString(),
    instanceScope:          INSTANCE_TYPES_RAW ? 'custom_basket' : 'v1_institutional_basket',
    requestedInstanceTypes: INSTANCE_TYPES,
    missingInstanceTypes:   missing,
    rowCount:               rows.length,
    uniqueInstanceTypes:    [...uniqueTypes].sort(),
    uniqueAvailabilityZones:[...uniqueAzs].sort(),
    minTimestamp:           minTs,
    maxTimestamp:           maxTs,
    rows:                   SUMMARY_ONLY ? rows.slice(0, 5) : rows,
    summaryOnly:            SUMMARY_ONLY,
  };

  process.stdout.write(JSON.stringify(payload));
}

main().catch(err => {
  console.error('FAILED:', err.message || err);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});

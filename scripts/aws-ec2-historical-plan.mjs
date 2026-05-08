#!/usr/bin/env node
// Builds /tmp/versions.json from AWS's AmazonEC2 versionIndexUrl,
// filtered by mode + since/until window. Used as input to
// aws-ec2-historical-run.mjs.
//
// modes (mutually exclusive):
//   dry_run — same selection as `full`, but the runner won't POST
//   sample  — 3 versions: oldest, midpoint, newest in window
//   recent  — versions with versionEffectiveBeginDate within last 12 months
//   full    — every version with versionEffectiveBeginDate in [since, until]
//
// Output: /tmp/versions.json
//   [{ version_id, effective_begin, effective_end, source_url }, ...]

import fs from 'node:fs';

const ARGS = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)=(.*)$/);
  return m ? [m[1], m[2]] : [a, true];
}));

const MODE  = ARGS.mode;
const SINCE = ARGS.since || '2018-05-01';
const UNTIL = ARGS.until && ARGS.until.length ? ARGS.until : new Date().toISOString().slice(0, 10);

if (!['dry_run', 'sample', 'recent', 'full'].includes(MODE)) {
  console.error('--mode must be one of: dry_run | sample | recent | full');
  process.exit(2);
}

const VERSION_INDEX_URL = 'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/index.json';

const idx = await (await fetch(VERSION_INDEX_URL)).json();
const versions = Object.entries(idx.versions || {})
  .map(([version_id, v]) => ({
    version_id,
    effective_begin: (v.versionEffectiveBeginDate || '').slice(0, 10),
    effective_end:   (v.versionEffectiveEndDate   || '').slice(0, 10) || null,
    source_url: `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/${version_id}/us-east-1/index.csv`,
  }))
  .filter(v => v.effective_begin && v.effective_begin >= SINCE && v.effective_begin <= UNTIL)
  .sort((a, b) => a.effective_begin.localeCompare(b.effective_begin));

let selected = versions;
if (MODE === 'sample' && versions.length >= 3) {
  selected = [versions[0], versions[Math.floor(versions.length / 2)], versions[versions.length - 1]];
} else if (MODE === 'recent') {
  const oneYearAgo = new Date();
  oneYearAgo.setUTCFullYear(oneYearAgo.getUTCFullYear() - 1);
  const cutoff = oneYearAgo.toISOString().slice(0, 10);
  selected = versions.filter(v => v.effective_begin >= cutoff);
}

console.log(`Mode=${MODE} since=${SINCE} until=${UNTIL} → ${selected.length} versions selected (of ${versions.length} in window)`);
fs.writeFileSync('/tmp/versions.json', JSON.stringify(selected, null, 2));
console.log('Wrote /tmp/versions.json');

#!/usr/bin/env node
/**
 * Rebuild the dashboard bundle inside index.html.
 *
 * index.html is a committed single-file artifact: a hand-maintained head +
 * inline bootstrap scripts, followed by one esbuild IIFE bundle of
 * js/.dashboard-entry.jsx (which pulls in js/dashboard.jsx, react, recharts).
 * Cloudflare Pages serves the repo root with NO build step — `pages_build_output_dir
 * = "./"` in wrangler.toml — so editing js/dashboard.jsx alone changes nothing in
 * production. This script is the missing compile step; run it and commit
 * index.html alongside the .jsx change.
 *
 *   node scripts/build-dashboard.mjs
 *
 * The bundle region is everything from the esbuild IIFE opener to the final
 * </script>. Everything before it (styles, the localStorage history-cache
 * bootstrap) is preserved byte-for-byte.
 */
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = resolve(ROOT, 'index.html');

// esbuild's minified IIFE always opens with this exact prologue. Anchoring on
// it (rather than a byte offset) keeps the splice correct if the inline
// bootstrap scripts above it ever grow or shrink.
const BUNDLE_OPENER = '(()=>{var ';

const result = await build({
  entryPoints: [resolve(ROOT, 'js/.dashboard-entry.jsx')],
  bundle: true,
  minify: true,
  format: 'iife',
  jsx: 'automatic',
  loader: { '.jsx': 'jsx' },
  write: false,
  absWorkingDir: ROOT,
  logLevel: 'warning',
});

const bundle = result.outputFiles[0].text;

const html = readFileSync(HTML, 'utf8');
const start = html.indexOf(BUNDLE_OPENER);
const end = html.lastIndexOf('</script>');
if (start < 0) throw new Error('Could not find the esbuild bundle opener in index.html');
if (end < start) throw new Error('Could not find the closing </script> after the bundle');

const next = html.slice(0, start) + bundle + html.slice(end);
if (next === html) {
  console.log('index.html already up to date (bundle unchanged)');
} else {
  writeFileSync(HTML, next);
  console.log(
    'index.html rebuilt — bundle %d → %d bytes',
    end - start,
    bundle.length
  );
}

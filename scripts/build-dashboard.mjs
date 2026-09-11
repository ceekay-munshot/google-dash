#!/usr/bin/env node
/**
 * Rebuilds the inlined dashboard bundle inside index.html.
 *
 * index.html ships as a single self-contained file: a small runtime shim
 * script, then the esbuild output for js/.dashboard-entry.jsx inlined into
 * the same <script> element. There is no Pages build step (wrangler.toml
 * sets pages_build_output_dir = "./"), so whatever is committed in
 * index.html is exactly what production serves — editing js/dashboard.jsx
 * alone changes nothing until this script is run.
 *
 *   node scripts/build-dashboard.mjs          # rewrite index.html
 *   node scripts/build-dashboard.mjs --check  # verify it is up to date
 *
 * The bundle is deterministic, so --check is a reliable CI guard against
 * committing source edits without the rebuilt bundle.
 */
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = join(root, 'index.html');

// The bundle is the run of lines between the end of the shim IIFE and the
// closing </script>. Both markers are unique in the file.
const SHIM_END = '})();\n';
const SCRIPT_END = '</script>\n</body>\n</html>';

const result = await build({
  entryPoints: [join(root, 'js/.dashboard-entry.jsx')],
  bundle: true,
  minify: true,
  format: 'iife',
  jsx: 'automatic',
  loader: { '.jsx': 'jsx' },
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'eof',
  write: false,
  absWorkingDir: root,
});
const bundle = result.outputFiles[0].text;

const html = readFileSync(HTML, 'utf8');
const shimEnd = html.indexOf(SHIM_END);
const scriptEnd = html.lastIndexOf(SCRIPT_END);
if (shimEnd < 0 || scriptEnd < 0 || scriptEnd < shimEnd) {
  console.error('build-dashboard: could not locate the bundle region in index.html');
  process.exit(1);
}
const head = html.slice(0, shimEnd + SHIM_END.length);
const tail = html.slice(scriptEnd);
const next = head + bundle + tail;

if (process.argv.includes('--check')) {
  if (next === html) {
    console.log('build-dashboard: index.html is up to date');
    process.exit(0);
  }
  console.error('build-dashboard: index.html is STALE — run `npm run build` and commit the result');
  process.exit(1);
}

writeFileSync(HTML, next);
console.log('build-dashboard: index.html rebuilt (' + (bundle.length / 1024).toFixed(1) + ' KB bundle)');

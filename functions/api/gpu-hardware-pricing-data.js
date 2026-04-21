/**
 * Cloudflare Pages Function — GetDeploying GPU Pricing Parser
 * Route: /api/gpu-hardware-pricing-data
 * Method: GET
 *
 * Fetches https://getdeploying.com/gpus (same SSR Django page used by the
 * live iframe reverse-proxy embed) and parses the pre-rendered GPU table
 * rows into normalized JSON. Used by the GPU Hardware Pricing tab to
 * render KPI summary cards and the strategic comparison table above the
 * live embed.
 *
 * Parsing strategy — regex against each `<tr data-gpu …>` block:
 *   - data-* attributes give us name, vram (GB), minprice (USD/hr),
 *     providers (count), segment (HIGH_PERFORMANCE | MID_RANGE | BUDGET),
 *     default (original sort order).
 *   - Max price lives in the 3rd <td> as a second "$…" span; parsed by
 *     extracting all "$<number>" occurrences from that cell and taking the
 *     last one when different from the min.
 *   - VRAM cell text (e.g. "80GB HBM3", "40GB / 80GB HBM2e") is captured
 *     from the 2nd <td>.
 *   - Vendor slug comes from the row's /gpus/<slug> href, prefix before
 *     the first hyphen (nvidia-h100 → nvidia). Resilient to additions.
 *
 * Anchoring on `data-*` attributes (not class names or DOM position)
 * makes the parser resilient to presentation tweaks upstream.
 */

const SOURCE_URL = 'https://getdeploying.com/gpus';

export async function onRequestGet() {
  try {
    const resp = await fetch(SOURCE_URL, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    if (!resp.ok) {
      return json({ ok: false, error: 'upstream_' + resp.status }, 502);
    }

    const html = await resp.text();
    const rows = parseRows(html);
    const sourceUpdatedAt = parseUpdatedAt(html);

    return json(
      {
        ok: true,
        sourceUrl: SOURCE_URL,
        sourceUpdatedAt,
        fetchedAt: new Date().toISOString(),
        count: rows.length,
        rows,
      },
      200,
      'public, max-age=300, s-maxage=600'
    );
  } catch (err) {
    return json({ ok: false, error: err.message || 'parse_error' }, 502);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

function parseRows(html) {
  const rows = [];
  // Split on row openers. `<tr data-gpu` is a unique marker in this page.
  const pieces = html.split(/<tr\s+data-gpu\b/);
  // First piece is everything before the first row — skip.
  for (let i = 1; i < pieces.length; i++) {
    const end = pieces[i].indexOf('</tr>');
    if (end === -1) continue;
    const row = pieces[i].slice(0, end);
    const parsed = parseRow(row);
    if (parsed) rows.push(parsed);
  }
  return rows;
}

function parseRow(row) {
  const name = attr(row, 'data-name');
  if (!name) return null;

  const segment = attr(row, 'data-segment') || null;
  const vramNumRaw = attr(row, 'data-vram');
  const minPriceRaw = attr(row, 'data-minprice');
  const providersRaw = attr(row, 'data-providers');
  const defaultRaw = attr(row, 'data-default');

  // Vendor from /gpus/<slug>
  const slugMatch = row.match(/href="\/gpus\/([a-z0-9-]+)"/i);
  const slug = slugMatch ? slugMatch[1] : null;
  const vendor = slug ? slug.split('-')[0] : firstWord(name).toLowerCase();

  // Cell texts: take each top-level <td>…</td> in order.
  const tds = extractTds(row);
  const vramText = tds[1] ? stripTags(tds[1]) : null;   // e.g. "80GB HBM3"
  const priceText = tds[2] ? stripTags(tds[2]) : null;  // e.g. "$0.07 - $14.90"

  // Min + max price: prefer data-minprice; extract max from cell text.
  const minPrice = num(minPriceRaw);
  const maxPrice = extractMaxPrice(priceText, minPrice);

  return {
    gpuModel: name,
    vendor,
    slug,
    vram: vramText,                    // human-readable (with unit/type)
    vramGB: num(vramNumRaw),           // numeric GB (may be min spec for multi-spec SKUs)
    minPricePerHour: minPrice,
    maxPricePerHour: maxPrice,
    providerCount: int(providersRaw),
    category: normalizeSegment(segment),
    segmentRaw: segment,
    defaultRank: int(defaultRaw),
    detailUrl: slug ? 'https://getdeploying.com/gpus/' + slug : null,
  };
}

function normalizeSegment(seg) {
  if (!seg) return null;
  const map = {
    HIGH_PERFORMANCE: 'High Performance',
    MID_RANGE: 'Mid-Range',
    BUDGET: 'Budget',
  };
  return map[seg] || seg;
}

function attr(chunk, name) {
  // Match data-name="…" allowing extra whitespace; stop at the first ".
  const re = new RegExp(name + '\\s*=\\s*"([^"]*)"', 'i');
  const m = chunk.match(re);
  return m ? decodeEntities(m[1]) : null;
}

function extractTds(row) {
  const out = [];
  const re = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = re.exec(row)) !== null) {
    out.push(m[1]);
    if (out.length >= 6) break;
  }
  return out;
}

function extractMaxPrice(priceText, min) {
  if (!priceText) return null;
  // Matches $1.23 or $12 (optional decimals). Commas not expected for $/hr.
  const nums = [];
  const re = /\$\s*([0-9]+(?:\.[0-9]+)?)/g;
  let m;
  while ((m = re.exec(priceText)) !== null) nums.push(parseFloat(m[1]));
  if (!nums.length) return null;
  if (nums.length === 1) return nums[0]; // single-price case (= min)
  // Max is the largest. Also sanity: drop any value < min (shouldn't happen).
  const max = Math.max.apply(null, nums);
  return (min != null && max < min) ? null : max;
}

function parseUpdatedAt(html) {
  // Header markup:
  //   <p class="text-muted-foreground body-2">
  //     <span>Updated April 21, 2026</span>
  const m = html.match(/Updated\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/);
  if (!m) return null;
  const iso = toIsoDate(m[1]);
  return { text: m[1], iso };
}

function toIsoDate(str) {
  // "April 21, 2026" → "2026-04-21"
  const d = new Date(str + ' UTC');
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function stripTags(s) {
  return decodeEntities(s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function num(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(v);
  return isFinite(n) ? n : null;
}

function int(v) {
  if (v == null || v === '') return null;
  const n = parseInt(v, 10);
  return isFinite(n) ? n : null;
}

function firstWord(s) {
  return (s || '').trim().split(/\s+/)[0] || '';
}

function json(body, status = 200, cache = 'no-store') {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cache,
      'Access-Control-Allow-Origin': '*',
    },
  });
}

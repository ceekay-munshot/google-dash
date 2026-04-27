/**
 * Cloudflare Pages Function — Model Pricing Peer Matrix
 * Route: /api/model-pricing-peer-matrix
 * Method: GET
 *
 * Powers the "Model Pricing by Provider" finance-model table on the Model
 * Pricing tab. Returns per-(provider × tier) representative-model quarterly
 * input/output pricing using the SAME upstream that provider-pricing-matrix
 * uses, but filtered to specific peer-pair models so QoQ math reflects real
 * provider repricing on the same model rather than a drifting lineup average.
 *
 * Why a separate endpoint (not a new mode on /api/pricing-history):
 *   /api/pricing-history reads from the canonical HISTORY_KV daily snapshots,
 *   which have only existed for as long as the dashboard has been running.
 *   In dev / preview that's just a handful of days; the resulting table only
 *   has one column. This endpoint goes upstream to pricepertoken's own
 *   historical pricing API which has real coverage back to 2025-07-28, giving
 *   us 4+ real quarters of multi-period peer comparison the customer asked
 *   for.
 *
 * Upstream:
 *   https://api.pricepertoken.com/api/provider-pricing-history/?provider=<slug>
 *   Same source provider-pricing-matrix.js uses. Each row is one
 *   (model, day) observation with pricing_prompt + pricing_completion in
 *   $/token (we scale to $/1M for display).
 *
 * Peer-model selection — fixed deterministic mapping. Frontier picks the
 * production flagship the hyperscaler markets first; Fast / Cost-efficient
 * picks the cheap high-volume tier each provider sells. Reasoning specialty
 * (o3, Opus) intentionally NOT included — they're tracked elsewhere and
 * mixing them would muddy the apples-to-apples peer comparison.
 *
 * Model-name matching — upstream casing / punctuation varies. Normalize by
 * lowercasing and stripping [-\s_.] then test:
 *   - exact match against target normalized form
 *   - OR target as a prefix, with a suffix that is NOT a tier marker
 *     (mini / lite / flash / haiku / nano / micro). This catches dated /
 *     preview / exp variants of the same model class while rejecting
 *     same-family-different-tier names.
 *
 * Response shape:
 *   {
 *     success, source, earliestDateObserved,
 *     quarters: [{ id, start, end, partial }, ...],   // chronological
 *     reps: [
 *       {
 *         key, provider, tier, label, modelDisplay, chosenCandidateNorms,
 *         input, output, qoqInput, qoqOutput, yoyInput, yoyOutput,
 *         obsCount, matchedModels, hasData,
 *         repFreshness: {
 *           status: 'OK' | 'WATCH' | 'REVIEW' | 'STALE',
 *           reason: '...combined evidence sentence...',
 *           ppEvidence: { newerStable:[...], newerLimited:[...] },
 *           firecrawlEvidence: { enabled, possibleNewerModels:[...] },
 *         }
 *       }, ...
 *     ],
 *     frontierReference: [
 *       { providerSlug, providerLabel,
 *         cells: { '<qid>': { display, matchedVariants:[...] } | null, ... } },
 *     ],
 *     providerCatalog,
 *     externalCatalog: {
 *       source: 'firecrawl',
 *       enabled: bool,
 *       reason?: string,                               // when enabled=false
 *       generatedAt?: ISO,
 *       allowlist?: [{ slug, url }, ...],
 *       providers: { '<slug>': {
 *           providerLabel, scrapedUrl, ok, error?,
 *           observedModels: [...],                     // names from docs
 *           possibleNewerModels: [...],                // observed but NOT in pp catalog
 *       }, ... },
 *       notes: [...],
 *       degraded?: bool,                                // all scrapes failed
 *     },
 *     providerErrors,
 *   }
 *
 * Firecrawl is optional and used ONLY for model-discovery / freshness drift.
 * Pricing math (avg, QoQ, YoY) remains sourced exclusively from pricepertoken.
 * Reps are NOT auto-promoted from Firecrawl observations — that's a deliberate
 * human decision; this audit just tells the operator when their fixed reps
 * may be stale.
 */

const UPSTREAM_BASE = 'https://api.pricepertoken.com/api/provider-pricing-history/';
const CACHE_TTL = 86400; // 24 hours — Firecrawl + pricepertoken responses both
                         // change at most daily; longer cache reduces load on
                         // both upstreams and amortizes Firecrawl quota use.

/* Peer-pair representatives. Each rep declares an ordered list of `candidates`;
   the row uses the FIRST candidate with at least one matching upstream row.
   Each candidate may itself match a SET of model norms (`norms: [...]`) —
   when a provider's flagship transitions across closely-related sub-versions
   (e.g. Google's gemini-3-pro-preview → gemini-3.1-pro-preview successor)
   we aggregate them so the row reads as one continuous model-class series
   instead of either alone giving sparse QoQ coverage.

   Picks anchor to the latest model class with reasonable upstream history
   so QoQ reflects real provider repricing on a model the customer would
   recognize as current. The literal newest point version per quarter
   (Claude Opus 4.7, GPT-5.5 Pro, Gemini 3.1 Pro) is surfaced separately
   in the Frontier Reference table so the fixed-rep QoQ math doesn't
   drift with each new point release. */
const PEER_MODELS = [
  // Frontier — gen-3/4/5 production flagships
  { key:'google-frontier',    provider:'Google',    tier:'Frontier',              providerSlug:'google',
    label:'Google / Gemini — Frontier',
    candidates:[
      // Continuous gen-3 Pro lineage (3-pro-preview deprecated 2026-03-25,
      // succeeded by 3.1-pro-preview from 2026-02-20). Together: Q4-25 +
      // Q1-26 + Q2-26 coverage.
      {norms:['gemini3propreview','gemini31propreview'], display:'Gemini 3 Pro Preview'},
      // Defensive fallback if gen-3 ever vanishes from upstream
      {norms:['gemini25pro'], display:'Gemini 2.5 Pro'},
    ]},
  { key:'openai-frontier',    provider:'OpenAI',    tier:'Frontier',              providerSlug:'openai',
    label:'OpenAI — Frontier',
    candidates:[ {norms:['gpt5'], display:'GPT-5'} ] },
  { key:'anthropic-frontier', provider:'Anthropic', tier:'Frontier',              providerSlug:'anthropic',
    label:'Anthropic — Frontier',
    candidates:[ {norms:['claudeopus4'], display:'Claude Opus 4'} ] },

  // Fast / Cost-efficient — same generation as Frontier where possible
  { key:'google-fast',        provider:'Google',    tier:'Fast / Cost-efficient', providerSlug:'google',
    label:'Google / Gemini — Fast / Cost-efficient',
    candidates:[
      {norms:['gemini3flashpreview'], display:'Gemini 3 Flash Preview'},
      {norms:['gemini25flash'],       display:'Gemini 2.5 Flash'},
    ]},
  { key:'openai-fast',        provider:'OpenAI',    tier:'Fast / Cost-efficient', providerSlug:'openai',
    label:'OpenAI — Fast / Cost-efficient',
    candidates:[ {norms:['gpt5mini'], display:'GPT-5 mini'} ] },
  { key:'anthropic-fast',     provider:'Anthropic', tier:'Fast / Cost-efficient', providerSlug:'anthropic',
    label:'Anthropic — Fast / Cost-efficient',
    candidates:[
      {norms:['claudehaiku45'], display:'Claude Haiku 4.5'},
      {norms:['claude3haiku'],  display:'Claude 3 Haiku'},
    ]},

  // Legacy — first candidate with data wins (no merging — these are
  // distinct prior-generation classes the customer specified explicitly).
  { key:'google-legacy',    provider:'Google',    tier:'Legacy', providerSlug:'google',
    label:'Google / Gemini — Legacy',
    candidates:[
      {norms:['gemini15pro'],   display:'Gemini 1.5 Pro'},
      {norms:['gemini15flash'], display:'Gemini 1.5 Flash'},
    ]},
  { key:'openai-legacy',    provider:'OpenAI',    tier:'Legacy', providerSlug:'openai',
    label:'OpenAI — Legacy',
    candidates:[
      {norms:['gpt4turbo'],  display:'GPT-4 Turbo'},
      {norms:['gpt35turbo'], display:'GPT-3.5 Turbo'},
    ]},
  { key:'anthropic-legacy', provider:'Anthropic', tier:'Legacy', providerSlug:'anthropic',
    label:'Anthropic — Legacy',
    candidates:[
      {norms:['claude3opus'],   display:'Claude 3 Opus'},
      {norms:['claude3sonnet'], display:'Claude 3 Sonnet'},
    ]},
];

/* Frontier Reference priorities — informational only. Per provider, per
   quarter, walk this list and pick the first candidate with ≥1 matching
   upstream model in that quarter. Newest model classes come first so the
   reference shows the latest-generation flagship in each period — answers
   the customer's "the frontier 12 quarters ago is not the frontier today"
   point WITHOUT contaminating the fixed-rep QoQ math above. */
const FRONTIER_PRIORITIES = {
  google: [
    {norm:'gemini31propreview', display:'Gemini 3.1 Pro Preview'},
    {norm:'gemini3propreview',  display:'Gemini 3 Pro Preview'},
    {norm:'gemini25pro',        display:'Gemini 2.5 Pro'},
    {norm:'gemini15pro',        display:'Gemini 1.5 Pro'},
    {norm:'geminipro',          display:'Gemini Pro'},
    {norm:'gemini25flash',      display:'Gemini 2.5 Flash'},
  ],
  openai: [
    {norm:'gpt55pro',  display:'GPT-5.5 Pro'},
    {norm:'gpt55',     display:'GPT-5.5'},
    {norm:'gpt54',     display:'GPT-5.4'},
    {norm:'gpt53',     display:'GPT-5.3'},
    {norm:'gpt52',     display:'GPT-5.2'},
    {norm:'gpt51',     display:'GPT-5.1'},
    {norm:'gpt5pro',   display:'GPT-5 Pro'},
    {norm:'gpt5',      display:'GPT-5'},
    {norm:'gpt41',     display:'GPT-4.1'},
    {norm:'gpt4o',     display:'GPT-4o'},
    {norm:'gpt4turbo', display:'GPT-4 Turbo'},
    {norm:'gpt4',      display:'GPT-4'},
    {norm:'gpt35turbo',display:'GPT-3.5 Turbo'},
  ],
  anthropic: [
    {norm:'claudeopus47',   display:'Claude Opus 4.7'},
    {norm:'claudeopus46',   display:'Claude Opus 4.6'},
    {norm:'claudeopus45',   display:'Claude Opus 4.5'},
    {norm:'claudeopus41',   display:'Claude Opus 4.1'},
    {norm:'claudeopus4',    display:'Claude Opus 4'},
    {norm:'claudesonnet46', display:'Claude Sonnet 4.6'},
    {norm:'claudesonnet45', display:'Claude Sonnet 4.5'},
    {norm:'claudesonnet4',  display:'Claude Sonnet 4'},
    {norm:'claude37sonnet', display:'Claude 3.7 Sonnet'},
    {norm:'claude35sonnet', display:'Claude 3.5 Sonnet'},
    {norm:'claude3opus',    display:'Claude 3 Opus'},
    {norm:'claude3sonnet',  display:'Claude 3 Sonnet'},
    {norm:'claude3haiku',   display:'Claude 3 Haiku'},
  ],
};

const FRONTIER_REFERENCE_PROVIDERS = [
  { slug:'google',    label:'Google / Gemini' },
  { slug:'openai',    label:'OpenAI' },
  { slug:'anthropic', label:'Anthropic' },
];

/* External catalog (Firecrawl) — discovery / freshness only. Per provider:
   the docs URL we scrape, and a regex that pulls model names out of the
   markdown response. Each provider's regex anchors on the family token so
   we don't pick up unrelated text. The set of observed names is normalized
   the same way pricepertoken model strings are (lowercased, punctuation
   stripped) so drift comparison against providerCatalog is apples-to-apples. */
const FIRECRAWL_BASE = 'https://api.firecrawl.dev/v1';
const FIRECRAWL_TIMEOUT_MS = 25000;
const EXTERNAL_PROVIDERS = [
  {
    slug:'anthropic', label:'Anthropic',
    url:'https://docs.anthropic.com/en/docs/about-claude/models/overview',
    // Examples: claude-opus-4.7, claude-sonnet-4.6, claude-3-5-sonnet, claude-3.5-haiku
    pattern:/claude[-\.][a-z0-9][a-z0-9\-\.]{1,40}/gi,
  },
  {
    slug:'openai', label:'OpenAI',
    url:'https://platform.openai.com/docs/models',
    // Examples: gpt-5, gpt-5-mini, gpt-5.5-pro, gpt-4o, o1, o3
    pattern:/gpt[-\.][a-z0-9][a-z0-9\-\.]{0,40}/gi,
  },
  {
    slug:'google', label:'Google / Gemini',
    url:'https://ai.google.dev/gemini-api/docs/models',
    // Examples: gemini-3-pro-preview, gemini-2.5-pro, gemini-3.1-flash-lite-preview
    pattern:/gemini[-\.][a-z0-9][a-z0-9\-\.]{1,50}/gi,
  },
];

const TIER_REJECT_PREFIXES = /^(mini|lite|flash|haiku|nano|micro|image)/;
// Pure short-numeric suffixes mark a version bump, not a dated variant —
// e.g. "gpt5" target should match "gpt-5" and "gpt-5-2025-08-07" but NOT
// "gpt-5.1" or "gpt-5.5" (which are different model classes). After normalize
// the version-bump shows up as 1–3 digits followed by non-digit/end; date
// stamps show up as 4+ contiguous digits which fall through this rule.
const VERSION_BUMP_SUFFIX = /^\d{1,3}([^0-9]|$)/;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResp(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=' + CACHE_TTL + ', s-maxage=' + CACHE_TTL,
      ...CORS,
      ...extraHeaders,
    },
  });
}

function normalizeModel(s) {
  return String(s || '').toLowerCase().replace(/[-\s_.]+/g, '');
}

function modelMatches(modelStr, targetNorm) {
  const n = normalizeModel(modelStr);
  if (n === targetNorm) return true;
  if (!n.startsWith(targetNorm)) return false;
  const suffix = n.slice(targetNorm.length);
  if (TIER_REJECT_PREFIXES.test(suffix)) return false;
  if (VERSION_BUMP_SUFFIX.test(suffix)) return false;
  return true;
}

function quarterOf(dateStr) {
  const y = parseInt(dateStr.slice(0, 4), 10);
  const m = parseInt(dateStr.slice(5, 7), 10);
  return y + '-Q' + (Math.floor((m - 1) / 3) + 1);
}

function priorQuarter(key) {
  const m = key.match(/^(\d{4})-Q(\d)$/);
  if (!m) return null;
  const y = +m[1], q = +m[2];
  return q === 1 ? (y - 1) + '-Q4' : y + '-Q' + (q - 1);
}

function yearAgoQuarter(key) {
  const m = key.match(/^(\d{4})-Q(\d)$/);
  if (!m) return null;
  return (+m[1] - 1) + '-Q' + m[2];
}

function quarterRange(key) {
  const m = key.match(/^(\d{4})-Q(\d)$/);
  const y = +m[1], q = +m[2];
  const startMonth = (q - 1) * 3;
  const start = new Date(Date.UTC(y, startMonth, 1)).toISOString().slice(0, 10);
  const end   = new Date(Date.UTC(y, startMonth + 3, 0)).toISOString().slice(0, 10);
  return { start, end };
}

function currentQuarterKey() {
  const d = new Date();
  return d.getUTCFullYear() + '-Q' + (Math.floor(d.getUTCMonth() / 3) + 1);
}

function round3(n) { return Math.round(n * 1000) / 1000; }

async function fetchProvider(slug) {
  const url = UPSTREAM_BASE + '?provider=' + encodeURIComponent(slug);
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'gdash-model-pricing-peer/1.0',
        Accept: 'application/json',
      },
      cf: { cacheTtl: CACHE_TTL, cacheEverything: true },
    });
    if (!r.ok) return { slug, rows: [], error: 'HTTP ' + r.status };
    const j = await r.json();
    return { slug, rows: Array.isArray(j?.results) ? j.results : [] };
  } catch (e) {
    return { slug, rows: [], error: e.message };
  }
}

/* Firecrawl markdown scrape. The API key is read ONLY from env — never logged,
   never returned, never embedded in the response. If the key is missing this
   helper returns null synchronously so callers can degrade to enabled=false
   without making any network call. */
async function fetchFirecrawlMarkdown(env, url) {
  const key = env?.FIRECRAWL_API_KEY;
  if (!key) return { ok: false, error: 'no-key' };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FIRECRAWL_TIMEOUT_MS);
  try {
    const resp = await fetch(FIRECRAWL_BASE + '/scrape', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + key,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent: true,
      }),
      signal: ctrl.signal,
    });
    if (!resp.ok) return { ok: false, error: 'HTTP ' + resp.status };
    const j = await resp.json();
    const md = j?.data?.markdown || j?.markdown || '';
    if (!md) return { ok: false, error: 'no markdown in response' };
    return { ok: true, markdown: md };
  } catch (e) {
    return { ok: false, error: (e?.name === 'AbortError' ? 'timeout' : (e?.message || 'fetch failed')) };
  } finally {
    clearTimeout(t);
  }
}

/* Extract model names from scraped markdown using the provider's regex,
   then normalize and dedupe. Returns the unique model strings as they
   appear in the source (cleaned of trailing punctuation), so the operator
   can audit visually, plus their normalized form for drift comparison. */
function extractModels(markdown, pattern) {
  if (!markdown) return [];
  const matches = markdown.match(pattern) || [];
  const seen = new Map();
  for (const raw of matches) {
    let cleaned = raw.toLowerCase();
    // Strip trailing image/asset extensions that the regex catches when a
    // model name appears inside a markdown image filename (e.g.
    // "gpt-image-2.png", "gpt-4o-mini-tts.png").
    cleaned = cleaned.replace(/\.(png|jpe?g|gif|svg|webp)$/i, '');
    // Strip trailing punctuation that might cling from sentence context
    cleaned = cleaned.replace(/[\.\,\)\]\:\;]+$/, '');
    if (!/\d/.test(cleaned)) continue;
    if (cleaned.length < 5 || cleaned.length > 60) continue;
    const norm = normalizeModel(cleaned);
    if (!seen.has(norm)) seen.set(norm, cleaned);
  }
  return Array.from(seen, ([norm, model]) => ({ model, norm })).sort((a, b) => a.model < b.model ? -1 : 1);
}

/* Build the externalCatalog block. Returns a fully-shaped object whether or
   not Firecrawl is enabled. Pricing math is independent — this can fail
   completely without affecting the rest of the response. Providers are
   keyed by slug (object form, per spec) for easy per-provider lookup. */
async function buildExternalCatalog(env, providerCatalog) {
  if (!env?.FIRECRAWL_API_KEY) {
    return {
      source: 'firecrawl',
      enabled: false,
      reason: 'FIRECRAWL_API_KEY not configured',
      providers: {},
      notes: [],
    };
  }

  const ppByProvider = new Map(
    (providerCatalog || []).map(pc => [
      pc.providerSlug,
      new Set((pc.models || []).map(m => normalizeModel(m.model))),
    ])
  );

  const providers = {};
  const notes = [];
  let anyOk = false;

  await Promise.all(
    EXTERNAL_PROVIDERS.map(async p => {
      const r = await fetchFirecrawlMarkdown(env, p.url);
      if (!r.ok) {
        providers[p.slug] = {
          providerLabel: p.label,
          scrapedUrl: p.url,
          ok: false,
          error: r.error,
          observedModels: [],
          possibleNewerModels: [],
        };
        notes.push(p.label + ' scrape failed: ' + r.error);
        return;
      }
      anyOk = true;
      const observed = extractModels(r.markdown, p.pattern);
      const ppNorms = ppByProvider.get(p.slug) || new Set();
      const possibleNewerModels = observed
        .filter(o => !ppNorms.has(o.norm))
        .map(o => o.model);

      providers[p.slug] = {
        providerLabel: p.label,
        scrapedUrl: p.url,
        ok: true,
        observedModels: observed.map(o => o.model),
        possibleNewerModels,
      };
    })
  );

  return {
    source: 'firecrawl',
    enabled: true,
    generatedAt: new Date().toISOString(),
    allowlist: EXTERNAL_PROVIDERS.map(p => ({ slug: p.slug, url: p.url })),
    providers,
    notes,
    // Honest signal flag: when ALL Firecrawl calls failed, surface that the
    // audit was attempted but unusable. Endpoint still returns success:true
    // because pricepertoken pricing math is independent.
    degraded: !anyOk,
  };
}

/* Per-rep freshness computation. Status hierarchy (most actionable first):
     STALE  — pricepertoken catalog has a non-version-bump newer same-provider
              model with ≥60 obs (about 2 months daily). Operator can rotate
              the fixed rep with confidence — full QoQ history would carry over.
     REVIEW — pricepertoken sees a newer model but with limited obs (<60).
              Operator should evaluate; rotation might fragment QoQ.
     WATCH  — Firecrawl saw a model on the official docs page that
              pricepertoken hasn't cataloged at all yet. Pricepertoken needs
              to ingest before action is possible.
     OK     — no actionable signal.
   The reason field always cites both sources separately so the operator
   can see what evidence drove the status. */
const REP_FRESHNESS_PP_STABLE_OBS = 60;
function computeRepFreshness(rep, providerData, externalCatalog) {
  const ppRows = providerData?.rows || [];
  const repNorms = rep.chosenCandidateNorms || [];
  const repFirstDate = rep.matchedModels?.length
    ? ppRows.filter(r => rep.matchedModels.includes(r.model))
        .map(r => r.date)
        .sort()[0] || null
    : null;

  // pricepertoken evidence: same-provider models in catalog that
  //   - aren't already part of this rep's matched set (so version-bump
  //     successors of the rep's own candidate are excluded — they're the
  //     same model class, intentionally),
  //   - have firstDate strictly later than the rep's own firstDate,
  //   - have ≥REP_FRESHNESS_PP_STABLE_OBS observations.
  // Aggregate per distinct upstream model name.
  const repModelSet = new Set(rep.matchedModels || []);
  // A candidate model that is a version-bump sibling of any rep norm
  // (e.g. claude-opus-4.7 vs rep claude-opus-4) or a tier sibling
  // (e.g. gpt-5-mini vs rep gpt-5) is the SAME class for fixed-rep
  // purposes — the matcher already rejects these so they aren't part
  // of repModelSet. Without this guard the freshness check treats every
  // version bump as a "newer model class" and floods every rep with
  // STALE noise — exactly the lineup-churn signal the customer wanted
  // the fixed-rep design to suppress in the first place.
  const isVersionOrTierSibling = (candNorm) =>
    repNorms.some(rn => {
      if (candNorm === rn) return false;
      if (!candNorm.startsWith(rn)) return false;
      const suffix = candNorm.slice(rn.length);
      return TIER_REJECT_PREFIXES.test(suffix) || VERSION_BUMP_SUFFIX.test(suffix);
    });
  const ppByModel = new Map();
  for (const row of ppRows) {
    if (typeof row?.model !== 'string') continue;
    if (repModelSet.has(row.model)) continue;
    if (isVersionOrTierSibling(normalizeModel(row.model))) continue;
    if (typeof row?.date !== 'string') continue;
    const e = ppByModel.get(row.model) || { model: row.model, firstDate: row.date, obs: 0 };
    if (row.date < e.firstDate) e.firstDate = row.date;
    e.obs += 1;
    ppByModel.set(row.model, e);
  }
  const ppNewerStable = [];
  const ppNewerLimited = [];
  for (const e of ppByModel.values()) {
    if (!repFirstDate || e.firstDate > repFirstDate) {
      // Reject obvious version-bump siblings using the same matcher rules.
      // If repNorms contains a target the candidate matches, it'd already
      // be inside repModelSet — so anything reaching here is a genuinely
      // different class (different prefix or version-bumped).
      if (e.obs >= REP_FRESHNESS_PP_STABLE_OBS) ppNewerStable.push(e);
      else ppNewerLimited.push(e);
    }
  }

  // Firecrawl evidence: provider's possibleNewerModels (already filtered
  // to "Firecrawl observed but pricepertoken doesn't have").
  const fcProvider = externalCatalog?.providers?.[rep.providerSlug] || null;
  const firecrawlEnabled = !!externalCatalog?.enabled;
  const firecrawlPossibleNewer = fcProvider?.possibleNewerModels || [];

  // Decide status. Only Firecrawl evidence escalates status today —
  // pp-evidence stays visible in ppEvidence for transparency but doesn't
  // claim STALE/REVIEW because detecting "genuinely newer model class"
  // (vs version bump, peer tier, specialty mode like audio/image/codex)
  // requires per-provider class parsing that's out of scope here.
  // Bias is conservative on purpose: better to under-flag than to push
  // the operator to rotate a rep on a noisy heuristic, which would defeat
  // the whole point of having stable peer reps for QoQ continuity.
  let status = 'OK';
  const reasonParts = [];

  if (ppNewerStable.length || ppNewerLimited.length) {
    const top = [...ppNewerStable, ...ppNewerLimited].sort((a, b) => b.obs - a.obs).slice(0, 2);
    reasonParts.push(
      'pricepertoken: same-provider newer-launched models in catalog — ' +
      top.map(t => t.model + ' (' + t.obs + ' obs)').join(', ') +
      '. Operator review only; status escalation requires per-provider class parsing not yet implemented.'
    );
  } else {
    reasonParts.push('pricepertoken: no newer-launched same-provider models.');
  }

  if (firecrawlEnabled && firecrawlPossibleNewer.length) {
    status = 'WATCH';
    reasonParts.push(
      'Firecrawl/' + (fcProvider?.providerLabel || rep.provider) +
      ' docs: ' + firecrawlPossibleNewer.slice(0, 3).join(', ') +
      (firecrawlPossibleNewer.length > 3 ? ' (+' + (firecrawlPossibleNewer.length - 3) + ' more)' : '') +
      ' present on official page but not in pricepertoken catalog yet.'
    );
  } else if (!firecrawlEnabled) {
    reasonParts.push('Firecrawl: disabled (' + (externalCatalog?.reason || 'no env key') + ').');
  } else {
    reasonParts.push('Firecrawl: official docs lineup matches pricepertoken catalog.');
  }

  return {
    status,
    reason: reasonParts.join(' '),
    ppEvidence: {
      newerStable: ppNewerStable.map(e => ({ model: e.model, obs: e.obs, firstDate: e.firstDate.slice(0, 10) })),
      newerLimited: ppNewerLimited.map(e => ({ model: e.model, obs: e.obs, firstDate: e.firstDate.slice(0, 10) })),
    },
    firecrawlEvidence: {
      enabled: firecrawlEnabled,
      possibleNewerModels: firecrawlPossibleNewer.slice(0, 10),
    },
  };
}

export async function onRequestGet({ request, env }) {
  // Fetch each unique provider once even if multiple reps share it
  const providerSlugs = Array.from(new Set(PEER_MODELS.map(r => r.providerSlug)));
  const fetched = await Promise.all(providerSlugs.map(s => fetchProvider(s)));
  const byProvider = new Map(fetched.map(f => [f.slug, f]));

  if (![...byProvider.values()].some(f => f.rows.length)) {
    return jsonResp({
      success: false,
      error: 'Upstream returned no rows for any provider',
      providerErrors: fetched.map(f => ({ slug: f.slug, error: f.error })),
    }, 502, { 'Cache-Control': 'no-store' });
  }

  const allQuarters = new Set();
  let earliestDate = null;

  // For each rep model, walk its candidate list and pick the FIRST candidate
  // with at least one matching upstream row. Each candidate may declare a
  // SET of norms (`norms: [...]`) — when a flagship transitions across
  // closely-related sub-versions (e.g. Gemini 3 Pro → 3.1 Pro), all matching
  // rows from the set are aggregated into one continuous series.
  const reps = PEER_MODELS.map(rep => {
    const provider = byProvider.get(rep.providerSlug);
    let chosen = null;
    let matched = [];
    for (const cand of rep.candidates) {
      const norms = Array.isArray(cand.norms) ? cand.norms : [cand.norm];
      const hits = (provider?.rows || []).filter(row =>
        typeof row?.model === 'string' && norms.some(n => modelMatches(row.model, n))
      );
      if (hits.length > 0) {
        chosen = cand;
        matched = hits;
        break;
      }
    }

    const matchedModelSet = new Set();
    const buckets = new Map();
    for (const row of matched) {
      const dateStr = row?.date;
      if (typeof dateStr !== 'string' || dateStr.length < 10) continue;
      if (!earliestDate || dateStr < earliestDate) earliestDate = dateStr;
      const qid = quarterOf(dateStr);
      allQuarters.add(qid);
      if (!buckets.has(qid)) buckets.set(qid, { sumIn: 0, nIn: 0, sumOut: 0, nOut: 0 });
      const b = buckets.get(qid);
      const inP  = row?.pricing_prompt;
      const outP = row?.pricing_completion;
      if (typeof inP  === 'number' && isFinite(inP)  && inP  >= 0) { b.sumIn  += inP;  b.nIn  += 1; }
      if (typeof outP === 'number' && isFinite(outP) && outP >= 0) { b.sumOut += outP; b.nOut += 1; }
      if (row.model) matchedModelSet.add(row.model);
    }

    const input = {}, output = {}, obsCount = {};
    for (const [qid, b] of buckets) {
      // Upstream is $/token; scale to $/1M for display parity with the rest
      // of the dashboard's pricing surfaces.
      input[qid]  = b.nIn  ? round3((b.sumIn  / b.nIn)  * 1_000_000) : null;
      output[qid] = b.nOut ? round3((b.sumOut / b.nOut) * 1_000_000) : null;
      obsCount[qid] = b.nIn || b.nOut;
    }

    return {
      key: rep.key,
      provider: rep.provider,
      providerSlug: rep.providerSlug,
      tier: rep.tier,
      label: rep.label,
      modelDisplay: chosen?.display || rep.candidates[0]?.display || null,
      chosenCandidateNorms: chosen ? (chosen.norms || [chosen.norm]) : null,
      hasData: chosen !== null,
      input,
      output,
      obsCount,
      matchedModels: Array.from(matchedModelSet).sort(),
      _buckets: buckets,
    };
  });

  const todayQ = currentQuarterKey();

  // Compute QoQ / YoY for input + output. Suppress for the QTD quarter so
  // partial-quarter averages don't get compared against full quarters.
  for (const rep of reps) {
    rep.qoqInput = {};
    rep.qoqOutput = {};
    rep.yoyInput = {};
    rep.yoyOutput = {};
    for (const qid of Object.keys(rep.input)) {
      if (qid === todayQ) continue;
      const pq = priorQuarter(qid);
      const yq = yearAgoQuarter(qid);
      const inCur = rep.input[qid],  outCur = rep.output[qid];
      const inPri = rep.input[pq],   outPri = rep.output[pq];
      const inYa  = rep.input[yq],   outYa  = rep.output[yq];
      if (inCur  != null && inPri  != null && inPri  > 0) rep.qoqInput[qid]  = round3((inCur  - inPri)  / inPri);
      if (inCur  != null && inYa   != null && inYa   > 0) rep.yoyInput[qid]  = round3((inCur  - inYa)   / inYa);
      if (outCur != null && outPri != null && outPri > 0) rep.qoqOutput[qid] = round3((outCur - outPri) / outPri);
      if (outCur != null && outYa  != null && outYa  > 0) rep.yoyOutput[qid] = round3((outCur - outYa)  / outYa);
    }
    delete rep._buckets;
  }

  // Quarters chronological so the renderer reads left → right
  const quarters = Array.from(allQuarters).sort().map(qid => {
    const range = quarterRange(qid);
    return { id: qid, start: range.start, end: range.end, partial: qid === todayQ };
  });

  // Frontier Reference by Period — informational only. Per provider, per
  // quarter, walk that provider's frontier-priority list and pick the first
  // candidate with at least one upstream model matching it in that quarter.
  // This is what changes over time (the customer's "the frontier today is
  // not the same model as 12 quarters ago" point) and is intentionally
  // SEPARATE from the peer matrix so the main QoQ/YoY math stays clean.
  const frontierReference = FRONTIER_REFERENCE_PROVIDERS.map(prov => {
    const provider = byProvider.get(prov.slug);
    const rowsByQ = new Map();
    for (const row of provider?.rows || []) {
      if (typeof row?.date !== 'string' || row.date.length < 10) continue;
      if (typeof row?.model !== 'string') continue;
      const qid = quarterOf(row.date);
      if (!rowsByQ.has(qid)) rowsByQ.set(qid, new Set());
      rowsByQ.get(qid).add(row.model);
    }
    const cells = {};
    const priorities = FRONTIER_PRIORITIES[prov.slug] || [];
    for (const [qid, modelSet] of rowsByQ) {
      const modelList = Array.from(modelSet);
      let cell = null;
      for (const cand of priorities) {
        const matched = modelList.filter(m => modelMatches(m, cand.norm));
        if (matched.length > 0) {
          cell = { display: cand.display, matchedVariants: matched.sort() };
          break;
        }
      }
      cells[qid] = cell; // null if no priority matched
    }
    return { providerSlug: prov.slug, providerLabel: prov.label, cells };
  });

  const providerErrors = fetched.filter(f => f.error).map(f => ({ slug: f.slug, error: f.error }));

  // Provider catalog — per-provider list of distinct model names actually
  // observed in the upstream window, with first/last date and obs count.
  // Surfaces which model classes are real so peer/legacy/frontier picks can
  // be audited (e.g. "is Claude 4.7 in the upstream yet?").
  const providerCatalog = fetched.map(f => {
    const m = new Map();
    for (const row of f.rows || []) {
      if (typeof row?.model !== 'string') continue;
      if (typeof row?.date !== 'string' || row.date.length < 10) continue;
      const e = m.get(row.model) || { model: row.model, firstDate: row.date, lastDate: row.date, obsCount: 0 };
      if (row.date < e.firstDate) e.firstDate = row.date;
      if (row.date > e.lastDate)  e.lastDate  = row.date;
      e.obsCount += 1;
      m.set(row.model, e);
    }
    const models = Array.from(m.values()).sort((a, b) =>
      a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : 0
    );
    return { providerSlug: f.slug, modelCount: models.length, models };
  });

  // External catalog is OPTIONAL — used only for discovery/freshness drift.
  // Pricing math (avg, QoQ, YoY) above is fully sourced from pricepertoken
  // and independent of this block. If FIRECRAWL_API_KEY is missing or the
  // scrape fails, we return enabled=false and the rest of the response is
  // unaffected. Reps are NOT auto-promoted from these observations — that's
  // a deliberate human decision; this block just surfaces drift signals.
  const externalCatalog = await buildExternalCatalog(env, providerCatalog);

  // Per-rep freshness audit. Combines two evidence sources without ever
  // letting Firecrawl drive pricing math or auto-rotate reps:
  //   pricepertoken evidence — does the upstream catalog already have a
  //     newer model class with substantial obs (>=60 days ≈ 2 months)?
  //     "Newer" excludes pure version-bump siblings of the rep's own
  //     candidate norms (so claudeopus4.7 doesn't trigger STALE for the
  //     claudeopus4 rep — same model class, just incremented).
  //   Firecrawl evidence — does the official-docs scrape mention model
  //     names that pricepertoken hasn't cataloged at all (= newer launch
  //     not yet ingested by pricepertoken)?
  // Status priority: STALE > REVIEW > WATCH > OK.
  for (const rep of reps) {
    rep.repFreshness = computeRepFreshness(rep, byProvider.get(rep.providerSlug), externalCatalog);
  }

  return jsonResp({
    success: true,
    source: UPSTREAM_BASE,
    sourceNote:
      'Per-model arithmetic mean of daily pricepertoken.com observations within each ' +
      'calendar quarter, filtered to a fixed peer-pair set so QoQ math reflects real ' +
      'provider repricing on the same model. No synthetic backfill — pre-upstream ' +
      'quarters simply do not appear. Frontier Reference is a separate informational ' +
      'projection — it picks the highest-tier-available model per (provider, quarter) ' +
      'and is intentionally not used for the main QoQ/YoY math. externalCatalog (when ' +
      'enabled) is a Firecrawl-discovered list of models the provider currently ' +
      'documents, used purely as a freshness audit signal — pricing math never reads it.',
    earliestDateObserved: earliestDate ? earliestDate.slice(0, 10) : null,
    quarters,
    reps,
    frontierReference,
    providerCatalog,
    externalCatalog,
    providerErrors,
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

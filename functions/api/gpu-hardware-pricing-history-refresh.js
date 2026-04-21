/**
 * Cloudflare Pages Function — GPU Pricing History Refresh (GPU-only)
 * Route: /api/gpu-hardware-pricing-history-refresh
 * Method: GET
 *
 * Force-refreshes ONLY the `gpu` block of today's daily snapshot
 * (`day:YYYY-MM-DD`) without running the full history-capture pipeline.
 * Useful for mid-day GPU price pulls.
 *
 * Same KV key space as /api/history-capture — one snapshot per UTC day.
 * If today's snapshot exists, the gpu block is replaced in place and the
 * snapshot's hash is recomputed. If it doesn't exist, a minimal "gpu-only"
 * snapshot is created (tagged partial: "gpu-only") so the daily index
 * still records activity; the main /api/history-capture cron call later
 * that day will supersede it with the full payload.
 *
 * Auth: same HISTORY_CAPTURE_SECRET as /api/history-capture (Bearer,
 * x-history-capture-secret header, or ?key= query). If the secret env is
 * not configured (dev), the endpoint is open.
 *
 * Dedup: if today's snapshot already has a `gpu` block with identical
 * values, returns action: "skipped" without a write. Cross-day dedup
 * against the day-before mirrors the main capture logic.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const GPU_TRACKED_SKUS = [
  'Nvidia H100',
  'Nvidia H200',
  'Nvidia B200',
  'Nvidia GB200',
  'Nvidia A100',
  'Nvidia L40S',
];

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

async function contentHash(payload) {
  const sorted = JSON.stringify(payload, Object.keys(payload).sort());
  const buf = new TextEncoder().encode(sorted);
  const hashBuf = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function dayBeforeUTC(dateStr) {
  const t = Date.parse(dateStr + 'T00:00:00Z');
  return new Date(t - 86400000).toISOString().slice(0, 10);
}

function validateBackfillDate(input) {
  if (typeof input !== 'string') return { ok: false, error: 'date must be a string' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return { ok: false, error: 'date must match YYYY-MM-DD format' };
  const t = Date.parse(input + 'T00:00:00Z');
  if (Number.isNaN(t)) return { ok: false, error: 'date is not a valid calendar date' };
  const roundTrip = new Date(t).toISOString().slice(0, 10);
  if (roundTrip !== input) return { ok: false, error: 'date is not a real calendar date' };
  if (input > todayUTC()) return { ok: false, error: 'date cannot be in the future' };
  return { ok: true, date: input };
}

async function localFetch(request, path) {
  const origin = new URL(request.url).origin;
  try {
    const resp = await fetch(origin + path, {
      headers: { 'User-Agent': 'gdash-gpu-history-refresh/1.0' },
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch (_) {
    return null;
  }
}

function normalizeGPU(raw) {
  if (!raw || !raw.ok || !Array.isArray(raw.rows)) return null;
  const trackedSet = new Set(GPU_TRACKED_SKUS);
  const models = [];
  for (const r of raw.rows) {
    if (!trackedSet.has(r.gpuModel)) continue;
    const min = typeof r.minPricePerHour === 'number' ? r.minPricePerHour : null;
    const max = typeof r.maxPricePerHour === 'number' ? r.maxPricePerHour : null;
    const spreadAbsolute = (min != null && max != null) ? +(max - min).toFixed(4) : null;
    const spreadMultiple = (min != null && max != null && min > 0) ? +(max / min).toFixed(3) : null;
    const priceMidpoint = (min != null && max != null) ? +((min + max) / 2).toFixed(4) : null;
    models.push({
      gpuModel: r.gpuModel,
      vram: r.vram || null,
      category: r.category || null,
      providerCount: typeof r.providerCount === 'number' ? r.providerCount : null,
      minPricePerHour: min,
      maxPricePerHour: max,
      spreadAbsolute,
      spreadMultiple,
      priceMidpoint,
    });
  }
  models.sort((a, b) => (a.gpuModel < b.gpuModel ? -1 : a.gpuModel > b.gpuModel ? 1 : 0));
  return {
    models,
    trackedSKUs: GPU_TRACKED_SKUS,
    coverage: models.length,
    sourceUpdatedAt: raw.sourceUpdatedAt || null,
    sourceUrl: raw.sourceUrl || null,
    fetchedAt: raw.fetchedAt || new Date().toISOString(),
  };
}

function authz(request, env) {
  const secret = env?.HISTORY_CAPTURE_SECRET;
  if (!secret) return { ok: true, method: 'none' };
  const url = new URL(request.url);
  const authHeader = request.headers.get('authorization') || '';
  const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
  const headerSecret = request.headers.get('x-history-capture-secret') || '';
  const querySecret = url.searchParams.get('key') || '';
  const provided = bearer || headerSecret || querySecret;
  if (provided !== secret) {
    return { ok: false, method: 'none' };
  }
  return {
    ok: true,
    method: bearer ? 'bearer' : headerSecret ? 'header' : 'query',
  };
}

export async function onRequestGet({ request, env }) {
  const auth = authz(request, env);
  if (!auth.ok) {
    return jsonResp(
      {
        success: false,
        error: 'Unauthorized',
        hint: 'Send Authorization: Bearer <HISTORY_CAPTURE_SECRET>, x-history-capture-secret header, or ?key=<SECRET>',
      },
      403
    );
  }

  const kv = env?.HISTORY_KV;
  if (!kv) {
    return jsonResp(
      {
        success: false,
        error: 'HISTORY_KV not bound',
      },
      500
    );
  }

  const gpuRaw = await localFetch(request, '/api/gpu-hardware-pricing-data');
  const gpu = normalizeGPU(gpuRaw);
  if (!gpu) {
    return jsonResp(
      { success: false, error: 'GPU parser unavailable — cannot refresh' },
      502
    );
  }

  const url = new URL(request.url);
  const today = todayUTC();
  const dateParam = url.searchParams.get('date');
  let date = today;
  let isBackfill = false;
  if (dateParam !== null) {
    const v = validateBackfillDate(dateParam);
    if (!v.ok) {
      return jsonResp(
        { success: false, error: 'Invalid date parameter: ' + v.error },
        400
      );
    }
    date = v.date;
    isBackfill = date !== today;
  }
  const dayKey = 'day:' + date;
  const capturedAt = new Date().toISOString();

  const existing = await kv.get(dayKey, 'json');

  // Dedup: if today's snapshot already has an identical gpu block, skip.
  if (existing && existing.gpu) {
    const prevHash = await contentHash({ gpu: existing.gpu });
    const newHash = await contentHash({ gpu });
    if (prevHash === newHash) {
      return jsonResp({
        success: true,
        action: 'skipped',
        reason: 'gpu block unchanged vs existing snapshot',
        date,
        coverage: gpu.coverage,
      });
    }
  }

  let snapshot;
  let action;

  if (existing) {
    // Merge: replace the gpu block in today's existing snapshot, recompute
    // hash from the same canonical payload the main capture uses.
    const merged = { ...existing, gpu };
    const canonicalPayload = {
      or: merged.or || [],
      bots: merged.bots || [],
      trends: merged.trends || [],
      filing: merged.filing || null,
      openrouterSummary: merged.openrouterSummary || null,
      pricing: merged.pricing || null,
      gpu: merged.gpu,
    };
    merged.hash = await contentHash(canonicalPayload);
    merged.gpuRefreshedAt = capturedAt;
    merged.version = Math.max(merged.version || 3, 4);
    snapshot = merged;
    action = 'merged';
  } else {
    // No snapshot for today yet — write a minimal gpu-only snapshot.
    // The full /api/history-capture cron call later today will supersede
    // this with the complete payload (or + bots + trends + filing + pricing + gpu).
    const canonicalPayload = {
      or: [],
      bots: [],
      trends: [],
      filing: null,
      openrouterSummary: null,
      pricing: null,
      gpu,
    };
    const hash = await contentHash(canonicalPayload);
    snapshot = {
      ts: capturedAt,
      date,
      capturedAt,
      hash,
      version: 4,
      source: isBackfill ? 'gpu-refresh-backfill' : 'gpu-refresh',
      authMethod: auth.method,
      dedup: false,
      sameAs: null,
      partial: 'gpu-only',
      backfill: isBackfill,
      or: [],
      bots: [],
      trends: [],
      filing: null,
      openrouterSummary: null,
      pricing: null,
      gpu,
      gpuRefreshedAt: capturedAt,
    };
    action = 'created-gpu-only';

    // Cross-day dedup for the minimal case
    const prev = await kv.get('day:' + dayBeforeUTC(date), 'json');
    if (prev && prev.gpu) {
      const prevGpuHash = await contentHash({ gpu: prev.gpu });
      const newGpuHash = await contentHash({ gpu });
      if (prevGpuHash === newGpuHash) {
        snapshot.dedup = true;
        snapshot.sameAs = 'day:' + dayBeforeUTC(date);
      }
    }
  }

  await kv.put(dayKey, JSON.stringify(snapshot));

  // Maintain days index (desc order, cap 400)
  let index = (await kv.get('index:days', 'json')) || [];
  if (!index.includes(date)) {
    if (isBackfill) {
      index.push(date);
      index.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    } else {
      index.unshift(date);
    }
    index = index.slice(0, 400);
    await kv.put('index:days', JSON.stringify(index));
  }

  return jsonResp({
    success: true,
    action,
    date,
    hash: snapshot.hash,
    coverage: gpu.coverage,
    trackedSKUs: GPU_TRACKED_SKUS.length,
    sourceUpdatedAt: gpu.sourceUpdatedAt,
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

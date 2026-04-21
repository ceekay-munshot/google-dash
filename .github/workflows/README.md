# GitHub Actions — Google Dash

## `history-capture.yml` — Daily Canonical History Capture

Automatically triggers the production `/api/history-capture` endpoint once per
day so the History tab accumulates canonical daily snapshots without anyone
needing to open the dashboard.

### Required GitHub Secrets

Add in the GitHub repo: **Settings → Secrets and variables → Actions → Repository secrets**

| Secret | Example value | Purpose |
|---|---|---|
| `HISTORY_CAPTURE_URL` | `https://google-dash-git.pages.dev/api/history-capture` | Full URL of the production capture endpoint. Must be exact — no trailing slash, include scheme. |
| `HISTORY_CAPTURE_SECRET` | `<random 32+ char string>` | Must match the `HISTORY_CAPTURE_SECRET` env var in Cloudflare Pages. |

### Required Cloudflare Pages Settings

Confirm in **Cloudflare dashboard → Pages → <project> → Settings → Environment variables**

| Variable | Environment | Value |
|---|---|---|
| `HISTORY_CAPTURE_SECRET` | Production (and Preview if you want preview captures) | Same random string as the GitHub secret |

Also confirm the KV binding exists:
- **Cloudflare dashboard → Pages → <project> → Settings → Functions → KV namespace bindings**
- Binding: `HISTORY_KV` → your production KV namespace

### Schedule

- Runs daily at **09:07 UTC** (approximately — GitHub cron can drift 5–30 minutes under load)
- Uses an off-minute (`:07` rather than `:00`) to avoid the heavily-queued hot slot
- Also triggers on manual dispatch via **Actions tab → "Daily History Capture" → Run workflow**

### Behavior

- `curl` with `Authorization: Bearer <HISTORY_CAPTURE_SECRET>` header (primary auth path)
- Up to 3 attempts with 15s/30s backoff on non-200 responses
- 2-minute timeout per attempt (upstream endpoint fans out to 4 APIs including Firecrawl)
- `concurrency: history-capture` guard prevents overlapping runs
- Full JSON response body printed to the Actions log for debugging
- Fails loudly (non-zero exit) if all attempts fail — you'll see a red X in the Actions tab

### Idempotency

The capture endpoint is **content-hash deduplicated**:
- Same calendar day + same content → returns `{action: "skipped"}` with HTTP 200
- Same day + different content (e.g. fresh OpenRouter data after the first run) → overwrites, returns `{action: "superseded"}`
- New day → returns `{action: "created"}`

Multiple daily runs are safe; only one canonical entry per date ever exists.

### Manual Trigger

1. Go to **GitHub repo → Actions tab**
2. Select **"Daily History Capture"** from the left sidebar
3. Click **"Run workflow"** (top right of the runs list)
4. Optionally enter a reason in the input field
5. Click the green **"Run workflow"** button

### Backfilling a missed day

If the workflow failed for one or more days and you want to fill the gap,
call the capture endpoint manually with the `?date=YYYY-MM-DD` parameter.
The endpoint validates the date strictly (correct format, real calendar
date, not in the future), tags the entry with `source: "backfill"`, and
includes a `backfillNote` clarifying that the upstream values reflect the
state at capture time rather than the original missed day.

```bash
# Backfill 2026-04-10 from your local machine
curl -fsS "https://<your-domain>/api/history-capture?date=2026-04-10" \
  -H "Authorization: Bearer <HISTORY_CAPTURE_SECRET>" | jq
```

Same content-hash dedup rules apply: if the target date already has a
snapshot with identical content, the call returns `action: "skipped"`. If
different, it overwrites (`action: "superseded"`). Backfilled days are
inserted in correct chronological position in `index:days`.

Future dates and malformed dates return HTTP 400 with a clear error.

### Failure alerting

When the workflow fails (after 3 retries), the **"Open or update failure
issue"** step automatically:

1. Searches for an existing open issue titled `🔴 History capture failing`
   tagged with the `history-capture-failure` label
2. If one exists → posts a comment with the new failure details (run URL,
   timestamp, HTTP code, attempts, response body)
3. If none exists → opens a new issue with the same title and label

This produces **one rolling issue** per failure cluster instead of spamming
the inbox. Close the issue once the underlying problem is fixed; the next
failure opens a fresh one.

The step uses the auto-provided `GITHUB_TOKEN` with `issues: write`
permission — no extra secrets, no external services. The workflow's
`permissions:` block at the job level grants only the minimum scopes
needed (`contents: read`, `issues: write`).

### Verification

After a run (scheduled or manual):

1. **Check the Actions log**: the curl step prints the full JSON response. Look for `"success": true` and one of `action: "created"` / `"skipped"` / `"superseded"`.

2. **Confirm the new day is in KV**:
   ```bash
   curl -s "https://google-dash-git.pages.dev/api/history?meta=true" | jq '.earliest, .latest, .count'
   ```
   The `latest` date should match today (UTC).

3. **Confirm in the dashboard UI**: open the History tab → footer should read `"Tracking since YYYY-MM-DD"` with `latest` reflecting today.

### Troubleshooting

| Symptom | Likely cause |
|---|---|
| `HTTP 403 Unauthorized` | `HISTORY_CAPTURE_SECRET` in GitHub doesn't match the one in Cloudflare Pages env vars |
| `HTTP 500 HISTORY_KV not bound` | KV namespace binding missing in Cloudflare Pages → Settings → Functions |
| `HTTP 502 OpenRouter data unavailable` | Upstream OpenRouter / Firecrawl rate-limited. Capture refuses to write partial data. Retry later. |
| Workflow shows green but no new day in KV | Check response body — `action: "skipped"` means content was identical to an earlier entry for today (this is correct behavior, not a bug) |
| Workflow didn't run at scheduled time | GitHub cron is best-effort; drifts 5-30 min on busy clusters. Accept this or switch to a paid scheduler (cron-job.org, EasyCron) if precision matters. |
| Failure alerting step fails with `Resource not accessible by integration` | The job's `permissions: issues: write` block is missing or your repo settings restrict workflow permissions. Check **Settings → Actions → General → Workflow permissions**. |
| Backfill returns `Invalid date parameter` | The `?date=` value either has the wrong format, is not a real calendar date (e.g. `2026-02-30`), or is in the future. Use plain `YYYY-MM-DD` for a past or current UTC date. |

### Limitations / Known caveats

- **GitHub Actions cron is best-effort**, not guaranteed. If the scheduled slot is contended, runs can be delayed or (rarely) skipped entirely. For a daily snapshot this is acceptable; the `concurrency` guard plus content-hash dedup means late runs still produce the correct canonical state.
- **Timezone**: the cron schedule is UTC. `09:07 UTC` is 02:07 PT / 05:07 ET / 14:37 IST. Adjust if you want the capture to align with a specific business day boundary.
- **GitHub auto-disables workflows after 60 days of repo inactivity**. If the repo goes dormant, the cron will stop. Any manual run or commit re-enables it.

---

## `history-freshness-check.yml` — Independent Freshness Watchdog

Independent watchdog that detects when canonical history stops updating
**even if the capture workflow itself never ran**. The capture workflow's
own failure-alerting only fires when the workflow runs and fails — it
cannot detect skipped scheduled runs, GitHub Actions outages, repo
auto-disable after inactivity, or capture endpoints that return success
without actually writing.

### Why this is separate

Capture-failure alerting answers: *"Did this attempt fail?"*
Freshness alerting answers: *"Does today have a canonical snapshot?"*

These catch different failure modes. Both run as independent workflows
so a regression in one cannot mask the other.

### Required GitHub Secret

| Secret | Example value | Purpose |
|---|---|---|
| `HISTORY_READ_URL` | `https://google-dash-git.pages.dev/api/history` | Full URL of the production read endpoint. The `?meta=true` suffix is appended automatically. No auth needed (read endpoint is public). |

### Schedule

- Runs daily at **13:23 UTC** (~4 hours after the 09:07 UTC capture
  workflow). Buffer accommodates worst-case GitHub cron drift (30 min)
  plus the capture's retry budget (~6 min).
- Off-minute (`:23`) avoids the heavily-queued `:00` / `:30` slots.
- Also triggers on **`workflow_dispatch`** (manual run) for testing.

### Freshness rule (exact)

The workflow fails (and alerts) if **any** of the following is true:

1. `/api/history?meta=true` returns a non-200 HTTP code (after 2 retries)
2. The response body has `success: false`
3. The response has no snapshots at all (`latest` is null/empty)
4. `latest` does not equal today's date in UTC

When `latest === today UTC`, the check passes silently with no
side effects.

**No tolerance window.** If `latest` is yesterday at 13:23 UTC, that's
explicitly stale — today's capture didn't happen and an alert fires. The
goal is fast, unambiguous detection; ambiguity is what we're trying to
avoid.

### Stale alerting behavior

Same rolling-issue pattern as the capture-failure workflow but with a
**different title and label** so the two cannot collide:

- Title: `🔴 History freshness stale`
- Label: `history-freshness-stale`

Behavior:

1. Searches for an open issue with that label
2. **Found** → posts a comment with run URL, today UTC, latest snapshot
   date, total snapshot count, response body excerpt, and a copy-pasteable
   backfill curl command
3. **Not found** → opens a new issue with the same content as the initial
   body

Each alert includes a quick-fix hint pointing at the
`?date=YYYY-MM-DD` backfill parameter on `/api/history-capture` and a
manual-dispatch link to the capture workflow.

Close the issue once the latest snapshot date is today UTC again; the
next stale detection opens a fresh issue.

### Manual test

1. Go to **GitHub repo → Actions tab**
2. Select **"History Freshness Check"** in the left sidebar
3. Click **"Run workflow"** → optional reason → green button
4. Wait ~10–30 seconds for the run to complete

In the run log, look at the **"Fetch /api/history?meta=true and check freshness"**
step. You should see either:

- `::notice::Freshness OK — latest=YYYY-MM-DD matches today UTC (N snapshots total)` — pass
- `::error::Latest snapshot is YYYY-MM-DD but today UTC is YYYY-MM-DD (drift: N day(s))` — fail, alerting step fires

### Verification of the alerting path

To verify alerting actually opens issues without breaking production:

- **Easiest**: temporarily set `HISTORY_READ_URL` to a bogus URL like
  `https://example.invalid/api/history`, manually dispatch the workflow,
  confirm a new issue with label `history-freshness-stale` appears, then
  restore the real URL.
- **Or**: wait for a real stale day to occur (uncommon unless capture
  is genuinely broken).

### Caveats

- **GitHub Actions cron is best-effort** (5–30 min drift typical, longer
  in rare incidents). The 13:23 UTC slot is chosen well after the 09:07
  UTC capture so even worst-case drift on both sides leaves an hour of
  buffer.
- **UTC only.** "Today" is `date -u +%Y-%m-%d`. If you want a different
  timezone basis (e.g., US business day), edit the bash that produces
  `TODAY` in the workflow.
- **One issue per stale-cluster.** If you don't close the issue,
  subsequent stale checks comment instead of opening duplicates. This
  matches the capture-failure pattern; consistent inbox semantics.
- **Same `permissions: issues: write` requirement** as the capture-failure
  alerting. If your repo's "Workflow permissions" setting is locked
  read-only, the alerting step fails with `Resource not accessible by
  integration`. Fix at **Settings → Actions → General → Workflow
  permissions**.
- **Does not detect gaps in older history.** Only checks "is today
  present?". If yesterday's snapshot is missing but today's exists, no
  alert fires. Use the gap-audit workflow (below) for that.

---

## `history-gap-audit.yml` — Mid-History Gap Detection

Independent audit that detects **mid-history gaps** the freshness watchdog
cannot see. It scans the recent canonical history for any UTC date that
is missing a snapshot inside a rolling window.

### Why this is separate from freshness

Freshness answers: *"is today present?"*
Gap audit answers: *"are all UTC dates in the last N days present?"*

Today fresh + yesterday missing is a real failure mode (e.g., yesterday's
cron skipped, today's ran fine) that freshness can't see. Gap audit
catches it.

### Required GitHub Secrets

| Secret | Required? | Purpose |
|---|---|---|
| `HISTORY_READ_URL` | yes | Production read endpoint, e.g. `https://google-dash-git.pages.dev/api/history`. The `?meta=true` suffix is appended automatically. |
| `HISTORY_CAPTURE_URL` | optional but recommended | Production capture endpoint, used to build copy-pasteable backfill `curl` commands inside the alert. If unset, the alert uses a `<HISTORY_CAPTURE_URL>` placeholder. |

The capture secret (`HISTORY_CAPTURE_SECRET`) is **never** referenced by
this workflow. The backfill commands in alerts use `$HISTORY_CAPTURE_SECRET`
as a shell variable that the operator exports locally before pasting.

### Schedule

- Runs daily at **13:47 UTC** — ~24 minutes after the freshness check at
  13:23 UTC. Sequencing matters so the freshness alert (today missing)
  fires before the gap alert (general gaps including today).
- Off-minute (`:47`) avoids the heavily-queued `:00` / `:30` slots.
- Also triggers on **`workflow_dispatch`** with two inputs:
  - `window_days` — override the audit window (default 14, range 2–365)
  - `reason` — free-text audit-log note

### Gap rule (exact)

For each daily run:

1. Compute today UTC: `date -u +%Y-%m-%d`.
2. Compute the **naive window**: today minus `window_days - 1` to today,
   inclusive (e.g. window_days=14 → 14 calendar days ending today).
3. Compute the **effective window**: `max(naiveStart, earliest)` to today,
   where `earliest` comes from `/api/history?meta=true`. This ensures the
   audit never expects history before tracking began.
4. Build the expected list of every UTC date inside the effective window.
5. Build the present set from `snapshots[].date` in the API response.
6. **A gap = an expected date that is not in the present set.**
7. **Pass:** zero gaps in the effective window. Workflow exits 0 silently
   (only a `::notice::` line in the log).
8. **Fail:** any gap. Workflow opens or comments on a rolling issue and
   `setFailed` with the count.

The effective window can be shorter than `window_days` if tracking only
started recently (e.g., earliest=2026-04-10, today=2026-04-15 → effective
window is 6 days, not 14).

### Stale alerting behavior

Same rolling-issue pattern as the other two workflows but with a
**dedicated title and label**:

- **Title:** `🟠 History gaps detected` (orange — gaps are typically
  recoverable via backfill, less urgent than freshness=red)
- **Label:** `history-gap-detected`

Each alert includes:

- Run URL
- Timestamp UTC
- Trigger and reason
- Today UTC, effective window range and length
- Earliest tracked date
- Number of gaps
- **Full list of missing UTC dates** (one per line, copy-pasteable)
- **Present dates inside the window** (for context)
- **One `curl` command per missing date**, using the stored
  `HISTORY_CAPTURE_URL` and `$HISTORY_CAPTURE_SECRET` shell variable

Example backfill block in an alert:

```bash
curl -fsS "https://google-dash-git.pages.dev/api/history-capture?date=2026-04-12" \
  -H "Authorization: Bearer $HISTORY_CAPTURE_SECRET" | jq
curl -fsS "https://google-dash-git.pages.dev/api/history-capture?date=2026-04-13" \
  -H "Authorization: Bearer $HISTORY_CAPTURE_SECRET" | jq
```

Run from your local shell after `export HISTORY_CAPTURE_SECRET=…`.

Close the issue once the gaps are filled (next scheduled run, or a
manual dispatch, will confirm zero gaps and stay silent). The next
detected gap opens a fresh issue.

### Backfill caveat (important)

Backfilled days carry `source: "backfill"` and a `backfillNote` because
**the captured upstream values reflect state at capture time, not the
original missed UTC date**. OpenRouter weekly aggregates and Cloudflare's
28-day rolling windows shift slowly so this is usually acceptable, but
treat backfilled days as proxies — not as ground-truth historical
snapshots. The dashboard's History tab and the `/api/history?date=…`
response surface this metadata so consumers can distinguish the two.

### Manual test

1. **Actions → "History Gap Audit" → Run workflow** (optionally tweak
   `window_days` for a quick narrow check)
2. Wait ~10–30 seconds
3. In the run log, expand the **"Compute gaps and alert if any"** step:
   - Pass: `::notice::No gaps detected in N-day window (X → Y)`
   - Fail: `::error::Found N gap(s) in canonical history (date1, date2, …)`
4. The job summary shows window range, present count, missing count

### Verification of the alerting path

Without breaking production, confirm alerting works by simulating gaps:

- **Easiest**: pick a `window_days` larger than your tracked-history span
  with known holes. E.g., if tracking started Apr 10 and Apr 11–15 were
  never captured, dispatch with `window_days=14`. Alert fires with the
  exact missing dates and ready-to-paste curl commands.
- **Or**: temporarily set `HISTORY_READ_URL` to a bogus URL → curl step
  fails HTTP → workflow fails → no alerting (alerting only fires on the
  gap-found path inside the script step, not on infrastructure errors).
  Use the freshness watchdog's failure path instead for infrastructure
  alerting.

### Caveats

- **Gap audit does not auto-backfill** by design. Running the
  backfill `curl` is a deliberate human action because backfilled values
  are proxies, not ground truth (see "Backfill caveat" above). If you
  want push-button auto-backfill, that's a future enhancement deliberately
  out of scope.
- **Window boundary matters.** With `window_days=14`, a gap from 15+
  days ago will roll out of the audit window the day after it occurred.
  Adjust `window_days` upward if you need a wider audit window, but
  large windows can produce noisy issues if your tracking start is
  recent.
- **One issue per gap-cluster.** Same rolling-issue semantics as the
  other two alerting workflows. Closing the issue is the explicit "I
  fixed it" signal; the next gap detection opens a new issue.
- **GitHub cron drift** (5–30 min typical) does not affect correctness
  here — the audit reads "today UTC" from `date`, not from the cron
  schedule, so even a delayed run still computes against the correct
  current date.
- **Does not detect content quality issues** — only date-presence. A
  snapshot with `or: []` (OpenRouter scrape failed but capture saved
  anyway) counts as present. The capture endpoint refuses to write when
  OR is empty (returns HTTP 502), so this is uncommon.
- **Same `permissions: issues: write` requirement** as the other
  alerting workflows.

---

## `/api/history-health` — Out-of-Band Health Endpoint

This is **not a workflow** — it's a read-only HTTP endpoint that exposes
canonical history health for an external monitor to poll. It exists so
the system is not relying entirely on GitHub Actions to detect history
regressions: if GitHub Actions is delayed, disabled, or down, this
endpoint still tells you whether canonical history is healthy.

### URL

```
GET https://<your-domain>/api/history-health
```

No auth required (read-only, public, surfaces no sensitive data).
`Cache-Control: no-store` — always reflects current state.

### Query parameters

| Param | Default | Effect |
|---|---|---|
| `strict` | `false` | When `true`, returns **HTTP 503** if `status != "healthy"`. Default returns HTTP 200 always; the `status` field describes the actual state. |
| `window` | `14` | Recent-window length (days) used for gap detection. Range 2–365. Window clamps to `earliest` so it never expects history before tracking began. |

### Status values (mutually exclusive)

| Status | Meaning | Strict HTTP |
|---|---|---|
| `healthy` | Latest snapshot is today UTC AND zero gaps in window | 200 |
| `stale` | Latest snapshot date != today UTC | 503 |
| `gapped` | Today is fresh but at least one date is missing in the window | 503 |
| `broken` | KV unbound, KV read failed, or no snapshots at all | 503 |

### Response shape (always returned, regardless of HTTP code)

```json
{
  "status": "healthy",
  "todayUtc": "2026-04-18",
  "latest": "2026-04-18",
  "earliest": "2026-04-10",
  "count": 9,
  "fresh": true,
  "gapCount": 0,
  "missingDates": [],
  "missingDatesTruncated": false,
  "checkedWindowStart": "2026-04-10",
  "checkedWindowEnd": "2026-04-18",
  "checkedWindowDays": 14,
  "checkedAt": "2026-04-18T21:30:14.123Z",
  "reason": "Latest snapshot matches today UTC; 14-day window has no gaps"
}
```

### Example: unhealthy response (gaps present, strict mode)

```bash
$ curl -fsS "https://<your-domain>/api/history-health?strict=true"
curl: (22) The requested URL returned error: 503

$ curl -s "https://<your-domain>/api/history-health?strict=true" | jq
{
  "status": "gapped",
  "todayUtc": "2026-04-18",
  "latest": "2026-04-18",
  "earliest": "2026-04-10",
  "count": 4,
  "fresh": true,
  "gapCount": 5,
  "missingDates": [
    "2026-04-11",
    "2026-04-12",
    "2026-04-13",
    "2026-04-14",
    "2026-04-15"
  ],
  "missingDatesTruncated": false,
  "checkedWindowStart": "2026-04-10",
  "checkedWindowEnd": "2026-04-18",
  "checkedWindowDays": 14,
  "checkedAt": "2026-04-18T21:30:14.123Z",
  "reason": "5 missing date(s) in window 2026-04-10..2026-04-18"
}
```

`missingDates` is capped at 20 entries; `missingDatesTruncated: true`
indicates more were elided.

### Hooking up an external monitor

Any uptime monitoring tool that supports HTTP(S) checks works.
Recommended setup:

| Tool | URL to check | Expected | Interval |
|---|---|---|---|
| **UptimeRobot** (free) | `https://<your-domain>/api/history-health?strict=true` | HTTP 200 | 5 min |
| **Better Uptime** | same | HTTP 200 | 5 min |
| **cron-job.org** | same | HTTP 200 | hourly is enough |
| **Healthchecks.io** | same (use as `?ping=` URL) | HTTP 200 | hourly |

In all cases:
- Set the alert condition to **HTTP status != 200**
- Optionally set the response-body check to contain `"status":"healthy"`
  for an extra integrity guard
- Notification channels (email, Slack, SMS) are configured inside the
  monitor — no per-repo setup needed

### Why strict mode is right for monitors

Monitors only understand "is the response 200 or not". With
`?strict=true`:
- `healthy` → 200 → silent
- anything else → 503 → alert fires

Without strict mode, a monitor would always see HTTP 200 and never alert.
The non-strict mode exists for dashboards / debug tools that want the
full status JSON without triggering monitor failures during routine
inspection.

### Manual test

```bash
# Healthy state (always succeeds)
curl -s "https://<your-domain>/api/history-health" | jq '.status'
# → "healthy" (or whatever the actual state is)

# Strict mode — exits non-zero if unhealthy
curl -fsS "https://<your-domain>/api/history-health?strict=true" >/dev/null \
  && echo "HEALTHY" || echo "UNHEALTHY"

# Custom window
curl -s "https://<your-domain>/api/history-health?window=30" | jq '.gapCount'

# All four status branches reachable; verified via unit tests against:
#   - missing KV binding             → status: broken
#   - empty index:days               → status: broken
#   - latest != today                → status: stale
#   - mid-window gap                 → status: gapped
#   - full window present + fresh    → status: healthy
```

### Caveats

- **No auth.** The endpoint exposes only date metadata and counts —
  nothing sensitive. If you need to gate it behind a token (e.g., to
  rate-limit a public monitoring URL), use a Cloudflare Access policy at
  the dashboard level rather than baking auth into this endpoint.
- **`Cache-Control: no-store`.** Each call hits KV. KV reads are cheap
  (~5 ms) so cost at 5-min monitoring intervals is negligible
  (~9k reads/month, well under any free tier).
- **UTC only.** "Today" is `new Date().toISOString().slice(0,10)`. If you
  want a different timezone basis, edit the function — both this endpoint
  and the freshness/gap-audit workflows would need to change in sync.
- **No detection of stale-but-present-today edge case.** If today's
  snapshot exists but its data is stale-looking (e.g., OpenRouter scrape
  silently returned old numbers), `status` is still `healthy`. Date
  presence is the only signal. The capture endpoint already refuses to
  write when OR is empty (HTTP 502), so this is uncommon — but if you
  want content-quality validation, that's a separate concern.
- **Window param affects gap sensitivity, not freshness.** `?window=2`
  reduces gap-noise to "yesterday + today" — useful for tighter alerting
  if you've recently filled long-tail gaps and only want fresh failures
  to trigger. Default 14 matches the gap-audit workflow.

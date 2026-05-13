/**
 * UBS Evidence Lab — dataset registry (server-side only).
 *
 * Single source of truth for which UBS datasets we plan to surface in
 * this dashboard, what dashboard area they belong to, and what charts
 * they will feed. Flip `enabled: true` only after the real UBS asset
 * id (i.e. UBS catalogue `dataAssetKey`) has been confirmed.
 *
 * Shape per entry:
 *   key                  — internal slug used as the D1 dataset_key
 *                          AND the path param on /api/ubs/dataset/:key
 *   label                — human-readable name
 *   ubsDatasetId         — UBS dataAssetKey (placeholder until confirmed)
 *   dashboardArea        — which section of the dashboard the data feeds
 *   useCase              — one-line analyst rationale
 *   refreshFrequency     — UBS publication cadence
 *   chartFamilies        — array of intended chart types/groups
 *   entitlementRequired  — whether this dataset is gated by paid entitlement
 *   enabled              — capture/UI gating flag (default false)
 */

export const UBS_DATASETS = [
  // ─── AI Adoption ───────────────────────────────────────────────────
  {
    key: 'ai_developers_models',
    label: 'AI Developers & Models',
    ubsDatasetId: '',
    dashboardArea: 'AI Adoption',
    useCase: 'Track developer engagement and model adoption signals to corroborate OpenRouter/HF leaderboards.',
    refreshFrequency: 'unknown',
    chartFamilies: ['model-leaderboard', 'developer-mindshare-trend'],
    entitlementRequired: true,
    enabled: false,
  },
  {
    key: 'global_app_usage_ai',
    label: 'Global App Usage Monitor - Artificial Intelligence',
    ubsDatasetId: '10464',
    dashboardArea: 'AI Adoption',
    useCase: 'Track MAU, WAU, QMAU and share trends for app categories including Artificial Intelligence as a consumer AI adoption proxy.',
    refreshFrequency: 'biweekly',
    chartFamilies: ['ai-app-usage', 'mau-wau-qmau', 'category-share'],
    entitlementRequired: true,
    enabled: true,
  },
  {
    key: 'global_app_downloads_ai',
    label: 'Global App Downloads Monitor - Artificial Intelligence',
    ubsDatasetId: '10087',
    dashboardArea: 'AI Adoption',
    useCase: 'Track app download growth, download rank and download share for categories including Artificial Intelligence as an adoption proxy.',
    refreshFrequency: 'biweekly',
    chartFamilies: ['ai-app-downloads', 'download-growth', 'download-share'],
    entitlementRequired: true,
    enabled: true,
  },
  {
    key: 'global_earnings_calls_thematics',
    label: 'Global Earnings Calls Thematics',
    ubsDatasetId: '10493',
    dashboardArea: 'AI Adoption',
    useCase: 'Track thematic trends and sentiment across companies, industries and regions, useful for AI narrative monitoring.',
    refreshFrequency: 'weekly',
    chartFamilies: ['earnings-call-thematics', 'sentiment', 'company-theme-trends'],
    entitlementRequired: true,
    enabled: true,
  },
  {
    key: 'china_ai_workplace_app_usage',
    label: 'China AI and Workplace Solution App Usage',
    ubsDatasetId: '1455',
    dashboardArea: 'AI Adoption',
    useCase: 'Track China-specific AI and workplace solution app usage trends.',
    refreshFrequency: 'monthly',
    chartFamilies: ['china-ai-app-usage', 'wau-mau-trends'],
    entitlementRequired: true,
    enabled: true,
  },

  // ─── AI Infrastructure ─────────────────────────────────────────────
  {
    key: 'gpu_cloud_chips_price_monitor',
    label: 'GPU / Cloud Chips Price Monitor',
    ubsDatasetId: '',
    dashboardArea: 'AI Infrastructure',
    useCase: 'Cross-check GPU hardware pricing series against an independent UBS-published monitor.',
    refreshFrequency: 'unknown',
    chartFamilies: ['gpu-price-trend', 'gpu-price-by-vendor'],
    entitlementRequired: true,
    enabled: false,
  },
  {
    key: 'electronics_distributor_inventory',
    label: 'Electronics Distributor Inventory',
    ubsDatasetId: '10474',
    dashboardArea: 'AI Infrastructure',
    useCase: 'Inventory signal as a leading indicator of GPU/accelerator supply tightness.',
    refreshFrequency: 'weekly',
    chartFamilies: ['inventory-level-trend', 'inventory-yoy-delta'],
    entitlementRequired: true,
    enabled: true,
  },
  {
    key: 'data_center_reg',
    label: 'US Construction Projects incl. Data Centers',
    ubsDatasetId: '10190',
    dashboardArea: 'AI Infrastructure',
    useCase: 'Track US construction project values and square footage, including data-center construction, as a proxy for AI infrastructure buildout.',
    refreshFrequency: 'unknown',
    chartFamilies: ['capacity-pipeline-trend', 'jurisdiction-heatmap'],
    entitlementRequired: true,
    enabled: true,
  },
];

/** Lookup by internal key (the value persisted as D1 dataset_key). */
export function getUbsDataset(key) {
  return UBS_DATASETS.find((d) => d.key === key) || null;
}

/** All registry entries whose enabled flag is true (i.e. ready for capture/UI). */
export function getEnabledUbsDatasets() {
  return UBS_DATASETS.filter((d) => d.enabled);
}

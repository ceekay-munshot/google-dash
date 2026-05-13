/**
 * UBS Evidence Lab — dataset registry (server-side only).
 *
 * Single source of truth for which UBS datasets we plan to surface in
 * this dashboard, what dashboard area they belong to, and what charts
 * they will feed. Each entry starts disabled with an empty
 * `ubsDatasetId`; flip `enabled` to true only after the real UBS asset
 * id (returned by /api/ubs/catalogue) has been confirmed and pasted in.
 *
 * Shape per entry:
 *   key                  — internal slug used as the D1 dataset_key
 *   label                — human-readable name
 *   ubsDatasetId         — UBS asset id (placeholder until confirmed)
 *   dashboardArea        — which section of the dashboard the data feeds
 *   useCase              — one-line analyst rationale
 *   refreshFrequency     — UBS publication cadence ('daily'|'weekly'|'monthly'|'quarterly'|'unknown')
 *   chartFamilies        — array of intended chart types/groups
 *   entitlementRequired  — whether this dataset is gated by paid entitlement
 *   enabled              — capture/UI gating flag (default false)
 */

export const UBS_DATASETS = [
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
    ubsDatasetId: '',
    dashboardArea: 'AI Infrastructure',
    useCase: 'Inventory signal as a leading indicator of GPU/accelerator supply tightness.',
    refreshFrequency: 'unknown',
    chartFamilies: ['inventory-level-trend', 'inventory-yoy-delta'],
    entitlementRequired: true,
    enabled: false,
  },
  {
    key: 'data_center_reg',
    label: 'Data Center Regulation / Registry',
    ubsDatasetId: '',
    dashboardArea: 'AI Infrastructure',
    useCase: 'Pipeline of new data-center capacity and regulatory constraints feeding compute supply.',
    refreshFrequency: 'unknown',
    chartFamilies: ['capacity-pipeline-trend', 'jurisdiction-heatmap'],
    entitlementRequired: true,
    enabled: false,
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

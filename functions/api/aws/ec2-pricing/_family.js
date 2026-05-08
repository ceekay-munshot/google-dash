// Map AWS EC2 instance type → { instance_family, instance_size,
// family_class, bare_metal }. Order in FAMILY_RULES matters: bare-metal
// is tested first so '*.metal*' wins over the prefix-based rules.
//
// Mirror copy lives at the top of AwsPricingTrendsSection in
// js/dashboard.jsx — keep both lookup tables in sync when AWS adds new
// instance families.
const FAMILY_RULES = [
  { test: /\.metal/i,                  family_class: 'baremetal' },
  { test: /^(p|g|inf|dl|trn|f|vt)\d/i, family_class: 'gpu'       },
  { test: /^(r|x|z)\d/i,               family_class: 'memory'    },
  { test: /^(d|h|i|im|is)\d/i,         family_class: 'storage'   },
  { test: /^(c|hpc)\d/i,               family_class: 'compute'   },
  { test: /^(t|m|a|mac)\d/i,           family_class: 'general'   },
];

export function classifyInstance(instanceType) {
  const dotIdx = instanceType.indexOf('.');
  const instance_family = dotIdx === -1 ? instanceType : instanceType.slice(0, dotIdx);
  const instance_size   = dotIdx === -1 ? null : instanceType.slice(dotIdx + 1);
  const bare_metal      = /\.metal/i.test(instanceType) ? 1 : 0;
  let family_class = 'other';
  for (const r of FAMILY_RULES) {
    if (r.test.test(instanceType)) { family_class = r.family_class; break; }
  }
  return { instance_family, instance_size, family_class, bare_metal };
}

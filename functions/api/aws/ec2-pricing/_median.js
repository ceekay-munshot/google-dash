// Median of a numeric array. NaN/non-finite values are filtered out
// before the calc — D1 cannot emit NULL for missing prices in our
// schema, but a defensive median handles bad upstream data without
// poisoning the dashboard.
//
// Even-length arrays return the average of the two middle values
// (standard convention; matches what AWS spec readers expect for
// "median price change").
export function median(values) {
  const xs = values.filter(v => Number.isFinite(v)).slice().sort((a, b) => a - b);
  const n = xs.length;
  if (n === 0) return null;
  if (n % 2 === 1) return xs[(n - 1) / 2];
  return (xs[n / 2 - 1] + xs[n / 2]) / 2;
}

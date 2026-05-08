import test from 'node:test';
import assert from 'node:assert/strict';
import { median } from '../_median.js';

test('empty array → null', () => {
  assert.equal(median([]), null);
});

test('single element', () => {
  assert.equal(median([5]), 5);
});

test('odd length', () => {
  assert.equal(median([1, 2, 3]), 2);
});

test('even length averages two middles', () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test('NaN values are filtered before sort', () => {
  assert.equal(median([NaN, 1, 2]), 1.5);
});

test('negative + zero values', () => {
  assert.equal(median([-1, -2, 0, 5]), -0.5);
});

test('real EC2 price spread', () => {
  // (0.0084 + 0.0168) / 2 = 0.0126
  assert.equal(median([0.0042, 0.0084, 0.0168, 0.0336]), 0.0126);
});

test('Infinity is filtered out', () => {
  assert.equal(median([Infinity, -Infinity, 1, 2, 3]), 2);
});

import { describe, test, expect } from 'vitest';
import { computeActivityScore, selectBottomHalf, MIN_ACTIVE_POOL_SIZE } from '../../src/api/admin.js';

describe('computeActivityScore', () => {
  test('0 votes → score 0', () => {
    expect(computeActivityScore(0, 0)).toBe(0);
  });

  test('total votes with no recent activity → score = total votes', () => {
    expect(computeActivityScore(5, 0)).toBe(5);
  });

  test('any recent vote doubles the score', () => {
    expect(computeActivityScore(5, 1)).toBe(10);
    expect(computeActivityScore(3, 10)).toBe(6);
  });

  test('0 total votes with recent votes → score 0', () => {
    expect(computeActivityScore(0, 1)).toBe(0);
  });
});

describe('MIN_ACTIVE_POOL_SIZE', () => {
  test('is 10', () => {
    expect(MIN_ACTIVE_POOL_SIZE).toBe(10);
  });
});

describe('selectBottomHalf', () => {
  test('empty array → empty', () => {
    expect(selectBottomHalf([])).toEqual([]);
  });

  test('single movie → empty (floor(1/2)=0, cull 0)', () => {
    expect(selectBottomHalf([{ id: 1, score: 0 }])).toEqual([]);
  });

  test('two movies → returns the one with lower score', () => {
    const movies = [{ id: 1, score: 5 }, { id: 2, score: 2 }];
    const result = selectBottomHalf(movies);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(2);
  });

  test('three movies → returns bottom one (floor(3/2)=1)', () => {
    const movies = [
      { id: 1, score: 10 },
      { id: 2, score: 4 },
      { id: 3, score: 1 }
    ];
    const result = selectBottomHalf(movies);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(3);
  });

  test('four movies → returns bottom two', () => {
    const movies = [
      { id: 1, score: 10 }, { id: 2, score: 8 },
      { id: 3, score: 4 }, { id: 4, score: 1 }
    ];
    const result = selectBottomHalf(movies);
    expect(result).toHaveLength(2);
    expect(result.map(m => m.id).sort()).toEqual([3, 4]);
  });

  test('does not mutate the input array', () => {
    const movies = [{ id: 1, score: 5 }, { id: 2, score: 2 }];
    const copy = [...movies];
    selectBottomHalf(movies);
    expect(movies).toEqual(copy);
  });
});

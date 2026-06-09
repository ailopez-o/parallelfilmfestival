import { describe, it, expect } from 'vitest';
import { shouldUseWebSearch, buildGenreMap, buildProviderMap } from '../../src/controllers/ExploreController.js';

describe('shouldUseWebSearch', () => {
  it('returns true for queries containing current-year triggers', () => {
    expect(shouldUseWebSearch('oscars 2026 winners')).toBe(true);
    expect(shouldUseWebSearch('estrenos recientes')).toBe(true);
  });

  it('returns false for normal queries', () => {
    expect(shouldUseWebSearch('science fiction 1970s')).toBe(false);
    expect(shouldUseWebSearch('kubrick films')).toBe(false);
  });
});

describe('buildGenreMap', () => {
  it('builds a map of id -> name from an array of genre objects', () => {
    const genres = [{ id: 28, name: 'Action' }, { id: 18, name: 'Drama' }];
    expect(buildGenreMap(genres)).toEqual({ 28: 'Action', 18: 'Drama' });
  });

  it('returns empty object for empty input', () => {
    expect(buildGenreMap([])).toEqual({});
  });
});

describe('buildProviderMap', () => {
  it('builds a map of provider_id -> provider object', () => {
    const providers = [{ provider_id: 8, provider_name: 'Netflix' }];
    const result = buildProviderMap(providers);
    expect(result[8]).toEqual({ provider_id: 8, provider_name: 'Netflix' });
  });
});

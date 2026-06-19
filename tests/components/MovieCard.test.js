import { describe, it, expect } from 'vitest';
import { createMovieCardHTML } from '../../src/components/MovieCard.js';

const baseMovie = {
  id: 'test-1',
  title: 'The Godfather',
  director: 'Francis Ford Coppola',
  release_year: '1972',
  runtime: 175,
  synopsis: 'A mafia patriarch.',
  genres: ['Drama', 'Crime'],
  poster_url: null,
  tmdb_id: 238,
  vote_count: 5,
  vote_average: 8.7,
};

describe('createMovieCardHTML — runtime display', () => {
  it('renders director and year in .movie-meta, NOT runtime', () => {
    const html = createMovieCardHTML(baseMovie, { context: 'proposal' });
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const meta = doc.querySelector('.movie-meta');
    expect(meta).not.toBeNull();
    expect(meta.textContent).toContain('Francis Ford Coppola');
    expect(meta.textContent).toContain('1972');
    expect(meta.textContent).not.toContain('2h');
  });

  it('renders runtime in .movie-runtime with clock icon', () => {
    const html = createMovieCardHTML(baseMovie, { context: 'proposal' });
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const runtime = doc.querySelector('.movie-runtime');
    expect(runtime).not.toBeNull();
    expect(runtime.textContent).toContain('2h 55m');
    const icon = runtime.querySelector('i[data-lucide="clock"]');
    expect(icon).not.toBeNull();
  });

  it('shows "—" placeholder when runtime is missing', () => {
    const movie = { ...baseMovie, runtime: null };
    const html = createMovieCardHTML(movie, { context: 'proposal' });
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const runtime = doc.querySelector('.movie-runtime');
    expect(runtime).not.toBeNull();
    expect(runtime.textContent).toContain('—');
  });

  it('shows "—" placeholder for runtime: 0', () => {
    const movie = { ...baseMovie, runtime: 0 };
    const html = createMovieCardHTML(movie, { context: 'proposal' });
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const runtime = doc.querySelector('.movie-runtime');
    expect(runtime.textContent).toContain('—');
  });

  it('renders .movie-runtime in cemetery context', () => {
    const html = createMovieCardHTML(baseMovie, { context: 'cemetery' });
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    expect(doc.querySelector('.movie-runtime')).not.toBeNull();
  });

  it('renders .movie-runtime in activity context', () => {
    const html = createMovieCardHTML(baseMovie, { context: 'activity' });
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    expect(doc.querySelector('.movie-runtime')).not.toBeNull();
  });
});

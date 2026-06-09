# Domain Controllers Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Break `main.js` (2796 lines) into 6 domain controllers + fix 7 bugs + add Vitest, all in branch `refactor/domain-controllers`, with no functional changes.

**Architecture:** Each controller is a plain ES module that imports from existing `src/api/`, `src/state/`, `src/config/`, `src/views/`, `src/utils/` layers (untouched). Controllers export named functions plus an `init()` that assigns `window.*` handlers. `main.js` becomes a ~150-line orchestrator. Cross-controller calls use direct imports (no circular deps) or `CustomEvent` for `app:refresh`.

**Tech Stack:** Vanilla JS, Vite 5, Vitest + jsdom, Supabase JS v2

---

## Files created / modified

| Action | Path |
|--------|------|
| Create | `src/controllers/RankingController.js` |
| Create | `src/controllers/ExploreController.js` |
| Create | `src/controllers/AdminController.js` |
| Create | `src/controllers/AuthController.js` |
| Create | `src/controllers/SessionController.js` |
| Create | `src/controllers/MovieController.js` |
| Create | `tests/controllers/RankingController.test.js` |
| Create | `tests/controllers/ExploreController.test.js` |
| Modify | `main.js` |
| Modify | `vite.config.js` |
| Modify | `package.json` |
| Modify | `src/api/movies.js` |
| Modify | `src/api/sessions.js` |
| Delete | `counter.js` |
| Delete | `check_supabase.js` |

---

## Task 0: Branch + Vitest setup

**Files:** `vite.config.js`, `package.json`

- [ ] Create branch
```bash
git checkout -b refactor/domain-controllers
```

- [ ] Install Vitest and jsdom
```bash
npm install --save-dev vitest@2 @vitest/coverage-v8 jsdom
```

- [ ] Update `vite.config.js`
```js
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    manifest: 'manifest.json',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        session: resolve(__dirname, 'next-session.html'),
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.js'],
  },
});
```

- [ ] Update `package.json` scripts
```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview",
  "lint": "bash ./scripts/lint-js.sh",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:smoke": "npm run build"
}
```

- [ ] Create tests directory
```bash
mkdir -p tests/controllers
```

- [ ] Verify Vitest works (will show "no tests found" — that's fine)
```bash
npm test
```
Expected output: `No test files found`

- [ ] Commit
```bash
git add vite.config.js package.json package-lock.json tests/
git commit -m "chore: install vitest, configure test environment"
```

---

## Task 1: Standalone bug fixes

**Files:** `counter.js`, `check_supabase.js`, `main.js`, `src/api/sessions.js`

- [ ] Delete stray debug files
```bash
rm counter.js check_supabase.js
```

- [ ] Fix duplicate `ACHIEVEMENT_LIST` import in `main.js` — remove line 18 (the second import). Line 3 already imports it:
```js
// Remove this line (line 18):
import { ACHIEVEMENT_LIST } from './src/config/constants.js';
```
Keep only the import on line 3 which is part of the grouped constants import.

- [ ] Fix redundant variable in `src/api/sessions.js`. Find `uploadSessionPhoto` and replace:
```js
// OLD (redundant):
const fileName = `${sessionId}/${userId}_${Math.random().toString(36).substring(2)}.${fileExt}`;
const filePath = `${fileName}`;
```
```js
// NEW:
const filePath = `${sessionId}/${userId}_${Math.random().toString(36).substring(2)}.${fileExt}`;
```
Update the `upload` call below it to use `filePath` directly (it already does — just remove the `fileName` variable).

- [ ] Add `deleteVotesForMovie` to `src/api/movies.js` (needed by MovieController to replace direct supabase call in `dropMovie`). Add after `removeVote`:
```js
async deleteVotesForMovie(movieId) {
  const { error } = await supabase
    .from('votes')
    .delete()
    .eq('movie_id', movieId);
  if (error) throw error;
},
```

- [ ] Run build to verify no regressions
```bash
npm run build
```
Expected: build succeeds with no errors.

- [ ] Commit
```bash
git add -p
git commit -m "fix: remove stray files, dedupe import, fix redundant variable, add deleteVotesForMovie"
```

---

## Task 2: RankingController — pure logic extraction

**Files:** `src/controllers/RankingController.js`, `tests/controllers/RankingController.test.js`, `main.js`

- [ ] Write the failing tests first
```js
// tests/controllers/RankingController.test.js
import { describe, it, expect } from 'vitest';
import {
  getMaxAttendanceStreak,
  getAchievementBreakdownForUser,
  buildUserScoreStatsMap,
  createEmptyScoreStats,
} from '../../src/controllers/RankingController.js';

describe('getMaxAttendanceStreak', () => {
  it('returns 0 for empty attendance', () => {
    expect(getMaxAttendanceStreak(new Set(), [])).toBe(0);
  });

  it('returns correct streak for all sessions attended', () => {
    const sessions = [
      { id: 'a', session_date: '2024-01-01' },
      { id: 'b', session_date: '2024-02-01' },
      { id: 'c', session_date: '2024-03-01' },
    ];
    expect(getMaxAttendanceStreak(new Set(['a', 'b', 'c']), sessions)).toBe(3);
  });

  it('returns the longest run when there are gaps', () => {
    const sessions = [
      { id: 'a', session_date: '2024-01-01' },
      { id: 'b', session_date: '2024-02-01' },
      { id: 'c', session_date: '2024-03-01' },
      { id: 'd', session_date: '2024-04-01' },
    ];
    // attended a, b — missed c — attended d
    expect(getMaxAttendanceStreak(new Set(['a', 'b', 'd']), sessions)).toBe(2);
  });

  it('ignores sessions without id or date', () => {
    const sessions = [
      { id: 'a', session_date: '2024-01-01' },
      { session_date: '2024-02-01' },        // no id
      { id: 'c' },                            // no date
    ];
    expect(getMaxAttendanceStreak(new Set(['a']), sessions)).toBe(1);
  });
});

describe('getAchievementBreakdownForUser', () => {
  it('always includes the static "miembro" achievement', () => {
    const stats = { ...createEmptyScoreStats() };
    const result = getAchievementBreakdownForUser(stats, []);
    expect(result.some(a => a.id === 'miembro')).toBe(true);
  });

  it('includes attendance achievement when threshold is met', () => {
    const stats = { ...createEmptyScoreStats(), attendedSessionIds: new Set(['s1']) };
    const result = getAchievementBreakdownForUser(stats, []);
    expect(result.some(a => a.id === 'debut')).toBe(true);
  });

  it('does not include achievement when threshold is not met', () => {
    const stats = { ...createEmptyScoreStats() };
    const result = getAchievementBreakdownForUser(stats, []);
    expect(result.some(a => a.id === 'debut')).toBe(false);
  });
});

describe('buildUserScoreStatsMap', () => {
  it('returns empty stats for a profile with no activity', () => {
    const profiles = [{ id: 'u1' }];
    const result = buildUserScoreStatsMap(profiles, [], [], [], [], []);
    expect(result['u1'].totalScore).toBeGreaterThanOrEqual(0);
    expect(result['u1'].activeVotes).toBe(0);
  });

  it('counts active votes correctly', () => {
    const profiles = [{ id: 'u1' }];
    const votes = [{ user_id: 'u1', movie_id: 'm1', movies: { is_dropped: false } }];
    const result = buildUserScoreStatsMap(profiles, votes, [], [], [], []);
    expect(result['u1'].activeVotes).toBe(1);
  });

  it('skips votes for dropped movies', () => {
    const profiles = [{ id: 'u1' }];
    const votes = [{ user_id: 'u1', movie_id: 'm1', movies: { is_dropped: true } }];
    const result = buildUserScoreStatsMap(profiles, votes, [], [], [], []);
    expect(result['u1'].activeVotes).toBe(0);
  });
});
```

- [ ] Run tests — expect FAIL (module not found)
```bash
npm test
```
Expected: `Cannot find module '../../src/controllers/RankingController.js'`

- [ ] Create `src/controllers/RankingController.js` with the pure functions extracted from `main.js` (lines 126–330 and 1340–1402):

```js
import { supabase } from '../config/supabase.js';
import { ACHIEVEMENT_LIST, PARTICIPATION_POINTS } from '../config/constants.js';
import { store } from '../state/store.js';
import { AdminView } from '../views/index.js';

export function getMaxAttendanceStreak(attendedSessionIds, sessionsList) {
  let maxStreak = 0;
  let currentStreak = 0;
  const sortedSessions = [...(sessionsList || [])]
    .filter(s => s?.id && s?.session_date)
    .sort((a, b) => new Date(a.session_date) - new Date(b.session_date));
  sortedSessions.forEach(session => {
    if (attendedSessionIds.has(session.id)) {
      currentStreak += 1;
      if (currentStreak > maxStreak) maxStreak = currentStreak;
    } else {
      currentStreak = 0;
    }
  });
  return maxStreak;
}

export function getAchievementPointsForUser(stats, sessionsList) {
  const attendanceCount = stats.attendedSessionIds.size;
  const ratingsCount = stats.ratedMovieIds.size;
  const streak = getMaxAttendanceStreak(stats.attendedSessionIds, sessionsList);
  return ACHIEVEMENT_LIST.reduce((sum, achievement) => {
    let earned = false;
    if (achievement.type === 'static') earned = true;
    if (achievement.type === 'ratings') earned = ratingsCount >= achievement.target;
    if (achievement.type === 'attendance') earned = attendanceCount >= achievement.target;
    if (achievement.type === 'visionary') earned = stats.seenProposals >= achievement.target;
    if (achievement.type === 'streak') earned = streak >= achievement.target;
    return earned ? sum + (achievement.points || 0) : sum;
  }, 0);
}

export function getAchievementBreakdownForUser(stats, sessionsList) {
  const attendanceCount = stats.attendedSessionIds.size;
  const ratingsCount = stats.ratedMovieIds.size;
  const streak = getMaxAttendanceStreak(stats.attendedSessionIds, sessionsList);
  return ACHIEVEMENT_LIST.filter(achievement => {
    if (achievement.type === 'static') return true;
    if (achievement.type === 'ratings') return ratingsCount >= achievement.target;
    if (achievement.type === 'attendance') return attendanceCount >= achievement.target;
    if (achievement.type === 'visionary') return stats.seenProposals >= achievement.target;
    if (achievement.type === 'streak') return streak >= achievement.target;
    return false;
  }).map(achievement => ({ ...achievement, reason: achievement.desc }));
}

export function createEmptyScoreStats() {
  return {
    activeVotes: 0, activeProposals: 0, cemeteryProposals: 0, seenProposals: 0,
    ratedMovieIds: new Set(), attendedSessionIds: new Set(),
    activeVoteMovieIds: new Set(), activeProposalMovieIds: new Set(),
    cemeteryProposalMovieIds: new Set(),
    achievementPoints: 0, achievementBreakdown: [], totalScore: 0
  };
}

export function buildUserScoreStatsMap(profiles, votes, allMoviesList, ratings, attendance, orderedSessions) {
  const userStats = {};
  (profiles || []).forEach(profile => { userStats[profile.id] = createEmptyScoreStats(); });

  (votes || []).forEach(vote => {
    const stats = userStats[vote.user_id];
    if (!stats || vote.movies?.is_dropped) return;
    stats.activeVotes += 1;
    if (vote.movie_id) stats.activeVoteMovieIds.add(vote.movie_id);
  });

  (allMoviesList || []).forEach(movie => {
    const stats = userStats[movie.proposed_by];
    if (!stats) return;
    if (movie.is_dropped) {
      stats.cemeteryProposals += 1;
      stats.cemeteryProposalMovieIds.add(movie.id);
      return;
    }
    stats.activeProposals += 1;
    stats.activeProposalMovieIds.add(movie.id);
    if (movie.is_seen) stats.seenProposals += 1;
  });

  (ratings || []).forEach(rating => {
    const stats = userStats[rating.user_id];
    if (stats && rating.movie_id) stats.ratedMovieIds.add(rating.movie_id);
  });

  (attendance || []).forEach(entry => {
    const stats = userStats[entry.user_id];
    if (stats && entry.session_id) stats.attendedSessionIds.add(entry.session_id);
  });

  (profiles || []).forEach(profile => {
    const stats = userStats[profile.id];
    if (!stats) return;
    stats.achievementBreakdown = getAchievementBreakdownForUser(stats, orderedSessions);
    stats.achievementPoints = stats.achievementBreakdown.reduce((sum, a) => sum + (a.points || 0), 0);
    stats.totalScore =
      (stats.activeProposals * PARTICIPATION_POINTS.proposalActive) +
      (stats.cemeteryProposals * PARTICIPATION_POINTS.proposalCemetery) +
      (stats.activeVotes * PARTICIPATION_POINTS.voteActive) +
      (stats.ratedMovieIds.size * PARTICIPATION_POINTS.review) +
      (stats.attendedSessionIds.size * PARTICIPATION_POINTS.attendance) +
      stats.achievementPoints;
  });
  return userStats;
}

export function buildUserPointsAudit(profile, stats, context = {}) {
  const moviesById = new Map((context.movies || []).map(m => [m.id, m]));
  const voteTitleMap = new Map((context.votes || []).map(v => [v.movie_id, v.movies]));
  const ratingTitleMap = new Map((context.ratings || []).map(r => [r.movie_id, r.movies]));
  const sessionEntries = context.attendanceEntries || [];

  const movieTitleForId = (movieId) => {
    const movie = moviesById.get(movieId) || voteTitleMap.get(movieId) || ratingTitleMap.get(movieId);
    return movie?.title || 'Untitled movie';
  };

  const attendanceDetails = sessionEntries.map(entry => {
    const title = entry.sessions?.movies?.title || 'Session';
    const date = entry.sessions?.session_date
      ? new Date(entry.sessions.session_date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
      : null;
    return date ? `${title} (${date})` : title;
  }).filter(Boolean);

  const lines = [
    { label: 'Valid Proposals', count: stats.activeProposals, unitPoints: PARTICIPATION_POINTS.proposalActive, totalPoints: stats.activeProposals * PARTICIPATION_POINTS.proposalActive, details: Array.from(stats.activeProposalMovieIds).map(movieTitleForId) },
    { label: 'Cemetery Proposals', count: stats.cemeteryProposals, unitPoints: PARTICIPATION_POINTS.proposalCemetery, totalPoints: stats.cemeteryProposals * PARTICIPATION_POINTS.proposalCemetery, details: Array.from(stats.cemeteryProposalMovieIds).map(movieTitleForId) },
    { label: 'Active Votes', count: stats.activeVotes, unitPoints: PARTICIPATION_POINTS.voteActive, totalPoints: stats.activeVotes * PARTICIPATION_POINTS.voteActive, details: Array.from(stats.activeVoteMovieIds).map(movieTitleForId) },
    { label: 'Reviews', count: stats.ratedMovieIds.size, unitPoints: PARTICIPATION_POINTS.review, totalPoints: stats.ratedMovieIds.size * PARTICIPATION_POINTS.review, details: Array.from(stats.ratedMovieIds).map(movieTitleForId) },
    { label: 'Attendance', count: stats.attendedSessionIds.size, unitPoints: PARTICIPATION_POINTS.attendance, totalPoints: stats.attendedSessionIds.size * PARTICIPATION_POINTS.attendance, details: attendanceDetails },
  ];

  return {
    userId: profile.id,
    totalScore: stats.totalScore,
    basePoints: lines.reduce((sum, line) => sum + line.totalPoints, 0),
    achievementPoints: stats.achievementPoints,
    achievements: stats.achievementBreakdown,
    lines
  };
}

export async function updateGlobalRanking() {
  try {
    const [profilesRes, votesRes, moviesRes, ratingsRes, attendanceRes, sessionsRes] = await Promise.all([
      supabase.from('profiles').select('*'),
      supabase.from('votes').select('user_id, movie_id, movies(is_dropped)'),
      supabase.from('movies').select('id, proposed_by, is_dropped, is_seen'),
      supabase.from('user_ratings').select('user_id, movie_id'),
      supabase.from('session_attendance').select('user_id, session_id'),
      supabase.from('sessions').select('id, session_date, movie_id, movies(title)')
    ]);
    if (profilesRes.error) throw profilesRes.error;
    if (votesRes.error) throw votesRes.error;
    if (moviesRes.error) throw moviesRes.error;
    if (ratingsRes.error) throw ratingsRes.error;
    if (attendanceRes.error) throw attendanceRes.error;
    if (sessionsRes.error) throw sessionsRes.error;

    const profiles = (profilesRes.data || []).filter(p => p.role !== 'admin');
    const userStats = buildUserScoreStatsMap(
      profiles, votesRes.data || [], moviesRes.data || [],
      ratingsRes.data || [], attendanceRes.data || [], sessionsRes.data || []
    );

    profiles.forEach(p => { p.score = userStats[p.id]?.totalScore || 0; });
    profiles.sort((a, b) => b.score - a.score);
    profiles.forEach((p, idx) => { p.rank = idx + 1; });

    store.setState({ rankedUsers: profiles });

    const { user, userProfile } = store.getState();
    if (user && userProfile) {
      const me = profiles.find(u => u.id === user.id);
      if (me) {
        store.setState({ userProfile: { ...userProfile, rank: me.rank, score: me.score } });
        window.dispatchEvent(new CustomEvent('authui:update'));
      }
    }

    renderRankingView();
  } catch (err) {
    console.error('Error updating global ranking:', err);
  }
}

export function renderRankingView() {
  const { rankedUsers } = store.getState();
  const rankingList = document.getElementById('rankingList');
  AdminView.renderRankingView(rankedUsers, rankingList);
  if (window.lucide) window.lucide.createIcons();
}

export function init() {
  // No window.* handlers needed for ranking — all calls are from other controllers or main.js
}
```

- [ ] Run tests — expect PASS
```bash
npm test
```
Expected: all 8 tests pass.

- [ ] Remove the extracted functions from `main.js`:
  - Delete lines containing: `getMaxAttendanceStreak`, `getAchievementPointsForUser`, `getAchievementBreakdownForUser`, `createEmptyScoreStats`, `buildUserScoreStatsMap`, `buildUserPointsAudit`, `updateGlobalRanking`, `renderRankingView`
  - Add import at top of `main.js`:
```js
import { updateGlobalRanking, renderRankingView, buildUserScoreStatsMap, buildUserPointsAudit, createEmptyScoreStats } from './src/controllers/RankingController.js';
```

- [ ] Run build + tests
```bash
npm run build && npm test
```
Expected: build succeeds, all tests pass.

- [ ] Commit
```bash
git add src/controllers/RankingController.js tests/controllers/RankingController.test.js main.js
git commit -m "refactor: extract RankingController, add unit tests"
```

---

## Task 3: ExploreController

**Files:** `src/controllers/ExploreController.js`, `tests/controllers/ExploreController.test.js`, `main.js`

- [ ] Write failing tests
```js
// tests/controllers/ExploreController.test.js
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
```

- [ ] Run tests — expect FAIL
```bash
npm test
```

- [ ] Create `src/controllers/ExploreController.js`

```js
import { supabase } from '../config/supabase.js';
import { TMDBService } from '../api/index.js';
import { store } from '../state/store.js';
import { ExploreView } from '../views/index.js';
import { normalize } from '../utils/index.js';
import { createMovieCardHTML } from '../components/index.js';

const CURRENT_TRIGGERS = ['2025', '2026', 'oscars', 'actualidad', 'estrenos', 'hoy', 'reciente', 'winners', '2027'];

export function shouldUseWebSearch(query) {
  return CURRENT_TRIGGERS.some(t => query.toLowerCase().includes(t));
}

export function buildGenreMap(genres) {
  return (genres || []).reduce((map, g) => { map[g.id] = g.name; return map; }, {});
}

export function buildProviderMap(providers) {
  return (providers || []).reduce((map, p) => { map[p.provider_id] = p; return map; }, {});
}

export async function fetchGenreMap() {
  try {
    const data = await TMDBService.invokeTMDBCall('/genre/movie/list');
    if (!data.genres) return;

    const nextGenreMap = buildGenreMap(data.genres);
    const exploreGenreSelect = document.getElementById('exploreGenre');
    if (exploreGenreSelect) {
      exploreGenreSelect.innerHTML = '<option value="">All Genres</option>';
      data.genres.forEach(g => {
        const option = document.createElement('option');
        option.value = g.id;
        option.textContent = g.name;
        exploreGenreSelect.appendChild(option);
      });
    }
    store.setState({ genreMap: nextGenreMap });
  } catch (e) {
    console.error('Error fetching genre map:', e);
  }
}

export async function fetchProvidersMap() {
  try {
    const envRegion = import.meta.env.VITE_DEFAULT_WATCH_REGION?.toUpperCase();
    const localeRegion = navigator.language?.split('-')?.[1]?.toUpperCase();
    const watchRegion = /^[A-Z]{2}$/.test(envRegion || '')
      ? envRegion
      : (/^[A-Z]{2}$/.test(localeRegion || '') ? localeRegion : 'ES');

    const data = await TMDBService.invokeTMDBCall('/watch/providers/movie', { watch_region: watchRegion });
    const select = document.getElementById('exploreProvider');
    if (!data.results || !select) return;

    const nextProviderMap = buildProviderMap(data.results.slice(0, 50));
    select.innerHTML = '<option value="">Any Platform</option>';
    data.results.slice(0, 50).forEach(p => {
      const option = document.createElement('option');
      option.value = p.provider_id;
      option.textContent = p.provider_name;
      select.appendChild(option);
    });
    store.setState({ providerMap: nextProviderMap });
  } catch (e) {
    console.error('Error fetching providers map:', e);
  }
}

export async function fetchExploreResults() {
  const { genreMap } = store.getState();
  const exploreGrid = document.getElementById('exploreGrid');
  const exploreGenreSelect = document.getElementById('exploreGenre');

  const query = document.getElementById('exploreTitle').value.trim();
  const directorName = document.getElementById('exploreDirector').value.trim();
  const actorName = document.getElementById('exploreActor').value.trim();
  const genreId = exploreGenreSelect.value;
  const yearFrom = document.getElementById('exploreYearFrom').value;
  const yearTo = document.getElementById('exploreYearTo').value;
  const limit = parseInt(document.getElementById('exploreLimit').value) || 20;
  const sortValue = document.getElementById('exploreSort').value;
  const providerId = document.getElementById('exploreProvider').value;

  exploreGrid.innerHTML = '<div class="loading-state">Scanning the cinematic multiverse...</div>';

  let discoverParams = {
    sort_by: sortValue || 'popularity.desc',
    include_adult: 'false',
    'vote_count.gte': 10
  };

  if (genreId) discoverParams.with_genres = genreId;
  if (yearFrom) discoverParams['primary_release_date.gte'] = `${yearFrom}-01-01`;
  if (yearTo) discoverParams['primary_release_date.lte'] = `${yearTo}-12-31`;
  if (providerId) {
    discoverParams.with_watch_providers = providerId;
    discoverParams.watch_region = 'ES';
    discoverParams.with_watch_monetization_types = 'flatrate|free|ads';
  }

  try {
    let results = [];
    let directorId = null;
    let actorId = null;

    if (directorName || actorName) {
      const [directorRes, actorRes] = await Promise.all([
        directorName ? TMDBService.invokeTMDBCall('/search/person', { query: directorName }) : null,
        actorName ? TMDBService.invokeTMDBCall('/search/person', { query: actorName }) : null
      ]);
      if (directorRes?.results?.length > 0) {
        const best = directorRes.results.filter(p => p.known_for_department === 'Directing');
        directorId = (best.length > 0 ? best : directorRes.results).sort((a, b) => b.popularity - a.popularity)[0].id;
        discoverParams.with_crew = directorId;
      }
      if (actorRes?.results?.length > 0) {
        const best = actorRes.results.filter(p => p.known_for_department === 'Acting');
        actorId = (best.length > 0 ? best : actorRes.results).sort((a, b) => b.popularity - a.popularity)[0].id;
        discoverParams.with_cast = actorId;
      }
    }

    if (query && !directorId && !actorId) {
      const pages = await Promise.all(
        Array.from({ length: Math.max(1, Math.ceil(limit / 20)) }, (_, i) =>
          TMDBService.invokeTMDBCall('/search/movie', { query, page: i + 1 }))
      );
      results = pages.flatMap(p => p.results || []);
    } else {
      const responses = await Promise.all(
        Array.from({ length: Math.max(1, Math.min(5, Math.ceil(limit / 20))) }, (_, i) =>
          TMDBService.invokeTMDBCall('/discover/movie', { ...discoverParams, page: i + 1 }))
      );
      results = responses.flatMap(r => r.results || []);
    }

    if (query && (directorId || actorId)) {
      results = results.filter(m => normalize(m.title).includes(normalize(query)));
    }

    const finalResults = results.slice(0, limit);
    const enriched = [];
    for (let i = 0; i < finalResults.length; i += 5) {
      const chunk = finalResults.slice(i, i + 5);
      const chunkResults = await Promise.all(chunk.map(async movie => {
        try {
          const details = await TMDBService.invokeTMDBCall(`/movie/${movie.id}`, {
            append_to_response: 'videos,watch/providers,credits'
          });
          const directors = details.credits?.crew?.filter(p => p.job === 'Director').map(d => d.name) || [];
          const trailer = details.videos?.results?.find(v => v.type === 'Trailer' && v.site === 'YouTube');
          return {
            ...movie, ...details,
            director: directors.join(', ') || 'Unknown Director',
            genres: details.genres?.map(g => g.name) || [],
            synopsis: details.overview,
            trailer_url: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
            watch_providers: details['watch/providers']?.results?.ES
          };
        } catch (e) {
          return { ...movie, director: 'Unknown', genres: [], synopsis: movie.overview };
        }
      }));
      enriched.push(...chunkResults);
      await new Promise(r => setTimeout(r, 10));
    }

    renderExploreResults(enriched);
  } catch (err) {
    console.error('Explore error:', err);
    exploreGrid.innerHTML = '<div class="empty-state">Discovery session failed. Try adjusting your filters.</div>';
  } finally {
    const exploreGridEl = document.getElementById('exploreGrid');
    if (exploreGridEl?.innerHTML.includes('loading-state')) {
      exploreGridEl.innerHTML = '<div class="empty-state">Connection timeout. Please try again.</div>';
    }
  }
}

export async function fetchAIRecommendations() {
  const query = document.getElementById('aiSearchInput').value;
  if (!query) return;

  const exploreGrid = document.getElementById('exploreGrid');
  const apertureOverlay = document.getElementById('apertureOverlay');
  if (apertureOverlay) apertureOverlay.classList.add('active');
  exploreGrid.innerHTML = '';

  const statusText = document.querySelector('.status-text');
  const controller = new AbortController();
  const renderedIds = new Set();
  const renderedTitles = new Set();

  const updateStatus = (msg) => { if (statusText) statusText.textContent = msg; };

  const cancelBtn = document.getElementById('cancelAISearch');
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      controller.abort();
      if (apertureOverlay) apertureOverlay.classList.remove('active');
      document.querySelector('.mode-tab[data-mode="manual"]').click();
    };
  }

  try {
    const useWeb = shouldUseWebSearch(query);
    updateStatus(useWeb ? 'Activating Satellite Search...' : 'Reasoning with Cinematic Bible...');

    const { data: aiData, error: aiError } = await supabase.functions.invoke('ai-scout', {
      body: { query, useWeb }
    });
    if (aiError) throw new Error(`AI Scout Mission Failed: ${aiError.message}`);

    const titles = aiData.titles || [];
    updateStatus('Distilling cinematic knowledge...');
    if (apertureOverlay) apertureOverlay.classList.remove('active');

    for (let i = 0; i < titles.length; i += 5) {
      if (controller.signal.aborted) break;
      const chunk = titles.slice(i, i + 5);
      const chunkResults = await Promise.all(chunk.map(async t => {
        const title = typeof t === 'object' ? (t.title || t.name) : String(t);
        if (renderedTitles.has(title.toLowerCase())) return null;
        try {
          const searchData = await TMDBService.invokeTMDBCall('/search/movie', { query: title });
          const found = searchData.results?.[0];
          if (!found || renderedIds.has(found.id)) return null;
          const detailData = await TMDBService.invokeTMDBCall(`/movie/${found.id}`, {
            append_to_response: 'videos,watch/providers,credits'
          });
          renderedIds.add(detailData.id);
          renderedTitles.add(title.toLowerCase());
          const directors = detailData.credits?.crew?.filter(p => p.job === 'Director').map(d => d.name).join(', ') || 'Unknown';
          const trailer = detailData.videos?.results?.find(v => v.type === 'Trailer' && v.site === 'YouTube');
          return {
            ...detailData,
            director: directors,
            genres: (detailData.genres || []).map(g => g.name),
            synopsis: detailData.overview,
            trailer_url: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
            watch_providers: detailData['watch/providers']?.results?.ES,
          };
        } catch (e) { return null; }
      }));

      const { user, isAdmin, userVotes } = store.getState();
      chunkResults.filter(Boolean).forEach(movie => {
        const div = document.createElement('div');
        div.innerHTML = createMovieCardHTML(movie, { context: 'explore', isAdmin, user, userVotes });
        const card = div.firstElementChild;
        if (card) exploreGrid.insertBefore(card, document.getElementById('scoutLoader'));
      });

      if (i === 0) {
        exploreGrid.innerHTML += `<div id="scoutLoader" class="scout-loader"><div class="scout-ring"></div><div class="scout-loading-text">Discovery in progress...</div></div>`;
      }
      if (window.lucide) window.lucide.createIcons();
    }

    document.getElementById('scoutLoader')?.remove();
  } catch (err) {
    if (apertureOverlay) apertureOverlay.classList.remove('active');
    if (err.name === 'AbortError') return;
    exploreGrid.innerHTML = `<div class="empty-state"><p>The AI Scout reached its limits.</p><p style="font-size:0.85rem;color:#94a3b8;">${err.message}</p><button class="auth-btn" style="margin-top:1.5rem;" onclick="window.fetchAIRecommendations()">Retry Scout</button></div>`;
    if (window.lucide) window.lucide.createIcons();
  }
}

export function renderExploreResults(results) {
  const exploreGrid = document.getElementById('exploreGrid');
  exploreGrid.innerHTML = '';
  const { user, isAdmin, userVotes } = store.getState();
  ExploreView.renderResults(results, exploreGrid, { isAdmin, user, userVotes });
  if (window.lucide) window.lucide.createIcons();
}

export function init() {
  window.fetchAIRecommendations = fetchAIRecommendations;
}
```

- [ ] Run tests — expect PASS
```bash
npm test
```

- [ ] Remove extracted functions from `main.js` and add import:
```js
import { fetchGenreMap, fetchProvidersMap, fetchExploreResults, fetchAIRecommendations, renderExploreResults } from './src/controllers/ExploreController.js';
```
Remove from `main.js`: `fetchGenreMap`, `fetchProvidersMap`, `fetchExploreResults`, `fetchAIRecommendations`, `renderExploreResults`, `createExploreCard`, `shouldUseWebSearch`.

- [ ] Run build + tests
```bash
npm run build && npm test
```

- [ ] Commit
```bash
git add src/controllers/ExploreController.js tests/controllers/ExploreController.test.js main.js
git commit -m "refactor: extract ExploreController, add unit tests"
```

---

## Task 4: AdminController

**Files:** `src/controllers/AdminController.js`, `main.js`

- [ ] Create `src/controllers/AdminController.js`

```js
import { supabase } from '../config/supabase.js';
import { AdminService } from '../api/index.js';
import { store } from '../state/store.js';
import { AdminView } from '../views/index.js';
import { showNotification, escapeHtml } from '../utils/index.js';
import { getUserDisplayName } from '../utils/index.js';

export async function fetchAppSettings() {
  try {
    const settings = await AdminService.fetchAppSettings();
    store.setState({ maxProposals: settings.maxProposals, maxVotes: settings.maxVotes });
  } catch (err) {
    console.error('Error fetching settings:', err);
    showNotification('Error: faltan ajustes de límites en la BBDD (app_settings).', 'error');
  }
}

export function loadAppSettings() {
  const { maxProposals, maxVotes } = store.getState();
  const maxPropInput = document.getElementById('settingMaxProposals');
  const maxVoteInput = document.getElementById('settingMaxVotes');
  if (maxPropInput) maxPropInput.value = maxProposals;
  if (maxVoteInput) maxVoteInput.value = maxVotes;
}

export async function saveAppSettings() {
  const { isAdmin } = store.getState();
  if (!isAdmin) return;

  const maxPropInput = document.getElementById('settingMaxProposals');
  const maxVoteInput = document.getElementById('settingMaxVotes');
  const newValProp = maxPropInput.value;
  const newValVote = maxVoteInput.value;

  try {
    showNotification('Updating system settings...', 'warning');
    await AdminService.updateAppSettings(newValProp, newValVote);
    store.setState({ maxProposals: parseInt(newValProp), maxVotes: parseInt(newValVote) });
    showNotification('System settings updated successfully!', 'success');
    window.dispatchEvent(new CustomEvent('authui:update'));
  } catch (err) {
    console.error('Error saving app settings:', err);
    showNotification('Error updating settings', 'error');
  }
}

export async function fetchUserList() {
  try {
    const { rankedUsers } = store.getState();
    const profiles = await AdminService.fetchAllProfiles();
    const rankedById = new Map(rankedUsers.map(p => [p.id, p]));
    const profilesWithRanking = profiles.map(profile => ({
      ...profile,
      score: rankedById.get(profile.id)?.score || 0,
      rank: rankedById.get(profile.id)?.rank || null
    }));
    const { user } = store.getState();
    const adminUserList = document.getElementById('adminUserList');
    const adminUserCount = document.getElementById('adminUserCount');
    AdminView.renderUserList(profilesWithRanking, adminUserList, adminUserCount, user);
    if (window.lucide) window.lucide.createIcons();
  } catch (err) {
    console.error('Error fetching user list:', err);
  }
}

export async function fetchParticipationLog() {
  const { isAdmin } = store.getState();
  if (!isAdmin) return;
  const adminParticipationLog = document.getElementById('adminParticipationLog');
  try {
    const logs = await AdminService.fetchParticipationLogs(50);
    AdminView.renderParticipationLog(logs, adminParticipationLog);
    if (window.lucide) window.lucide.createIcons();
  } catch (err) {
    console.error('Error fetching activity log:', err);
    if (adminParticipationLog) adminParticipationLog.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:2rem; color:var(--error);">Failed to load activity log.</td></tr>`;
  }
}

export function init() {
  window.saveAppSettings = saveAppSettings;

  window.confirmDeleteUser = async (userId, userName) => {
    const { isAdmin } = store.getState();
    if (!isAdmin) return;
    if (!window.confirm(`⚠️ DANGER ZONE: Are you sure you want to delete user "${userName}"?\n\nThis will also remove all their movie proposals, votes and ratings. This action cannot be undone.`)) return;
    try {
      showNotification(`Deleting user ${userName}...`, 'warning');
      await AdminService.deleteUser(userId);
      showNotification(`User ${userName} and all their data have been removed.`, 'success');
      window.dispatchEvent(new CustomEvent('app:refresh'));
    } catch (err) {
      console.error('Error deleting user:', err);
      showNotification(`Error: ${err.message || 'System error deleting user'}`, 'error');
    }
  };

  window.handleDeployMetadata = async () => {
    const { isAdmin, sessions } = store.getState();
    if (!isAdmin) { showNotification('Admin privileges required', 'error'); return; }
    const upcoming = sessions
      .filter(s => s.is_upcoming && new Date(s.session_date) > new Date())
      .sort((a, b) => new Date(a.session_date) - new Date(b.session_date))[0];
    if (!upcoming) { showNotification('No upcoming sessions found to update.', 'warning'); return; }
    try {
      showNotification('Updating social metadata in Supabase...', 'warning');
      const result = await AdminService.updateSocialMetadata(upcoming);
      if (result.success) showNotification(`Social preview for "${result.movieTitle}" updated successfully!`, 'success');
    } catch (err) {
      showNotification(`Update failed: ${err.message}`, 'error');
    }
  };

  window.cleanupInactiveMovies = async (silent = false) => {
    const { isAdmin } = store.getState();
    if (!isAdmin) return;
    if (!silent) showNotification('Checking for inactive movies...', 'info');
    try {
      const { cleanedCount } = await AdminService.cleanupInactiveMovies();
      if (cleanedCount > 0) {
        if (!silent) showNotification(`Cleaned up ${cleanedCount} inactive movies`, 'success');
        window.dispatchEvent(new CustomEvent('app:refresh'));
      } else {
        if (!silent) showNotification('All movies are active!', 'success');
      }
    } catch (err) {
      console.error('Error cleaning up movies:', err);
      if (!silent) showNotification('Failed to clean inactive movies', 'error');
    }
  };

  window.toggleCheckinDropdown = (userId) => {
    const dropdown = document.getElementById(`checkin-${userId}`);
    const allDropdowns = document.querySelectorAll('.checkin-dropdown');
    allDropdowns.forEach(d => { if (d.id !== `checkin-${userId}`) d.classList.remove('active'); });
    if (dropdown.classList.contains('active')) {
      dropdown.classList.remove('active');
    } else {
      const { seenMovies } = store.getState();
      const recent = [...seenMovies].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
      if (recent.length === 0) {
        dropdown.innerHTML = '<div style="padding:0.5rem; font-size:0.7rem; color:var(--text-secondary);">No sessions available. Mark a movie as "Seen" first.</div>';
      } else {
        dropdown.innerHTML = recent.map(m => `<button class="checkin-option" onclick="window.markAttendance('${userId}', '${m.id}')"><i data-lucide="play"></i> ${escapeHtml(m.title)}</button>`).join('');
      }
      dropdown.classList.add('active');
      if (window.lucide) window.lucide.createIcons();
    }
  };

  window.markAttendance = async (userId, movieId) => {
    const { isAdmin } = store.getState();
    if (!isAdmin) return;
    const { SessionService } = await import('../api/index.js');
    try {
      showNotification('Recording attendance...', 'info');
      const result = await SessionService.recordAttendanceByMovie(userId, movieId);
      if (result.action === 'existing') { showNotification('User already checked-in for this session.', 'warning'); return; }
      showNotification('Attendance recorded! (+10 pts)', 'success');
      const dropdown = document.getElementById(`checkin-${userId}`);
      if (dropdown) dropdown.classList.remove('active');
      window.dispatchEvent(new CustomEvent('app:refresh'));
    } catch (err) {
      console.error('Error marking attendance:', err);
      showNotification('Failed to record attendance.', 'error');
    }
  };
}
```

- [ ] Remove extracted functions from `main.js` and add import:
```js
import { fetchAppSettings, loadAppSettings, saveAppSettings, fetchUserList, fetchParticipationLog, init as initAdmin } from './src/controllers/AdminController.js';
```
Remove from `main.js`: `fetchAppSettings`, `loadAppSettings`, `window.saveAppSettings`, `fetchUserList`, `fetchParticipationLog`, `window.confirmDeleteUser`, `window.handleDeployMetadata`, `window.cleanupInactiveMovies`, `window.toggleCheckinDropdown`, `window.markAttendance`.

Also replace `window.saveAppSettings = async () => {...}` references and `setAppLimits()` calls — `setAppLimits` is now inlined in AdminController using `store.setState`.

- [ ] Add `initAdmin()` call inside `init()` function in `main.js`.

- [ ] Run build
```bash
npm run build
```

- [ ] Manually verify admin panel in browser: settings tab loads, user list renders.

- [ ] Commit
```bash
git add src/controllers/AdminController.js main.js
git commit -m "refactor: extract AdminController"
```

---

## Task 5: AuthController

**Files:** `src/controllers/AuthController.js`, `main.js`

- [ ] Create `src/controllers/AuthController.js`

```js
import { supabase } from '../config/supabase.js';
import { AuthService, MovieService, SessionService } from '../api/index.js';
import { store } from '../state/store.js';
import { ProfileView } from '../views/index.js';
import { showNotification, escapeHtml } from '../utils/index.js';
import { getUserDisplayName } from '../utils/index.js';
import { buildUserScoreStatsMap, buildUserPointsAudit, createEmptyScoreStats } from './RankingController.js';
import { fetchParticipationLog, fetchUserList } from './AdminController.js';

export function updateAuthUI() {
  const { user, userProfile, isAdmin, proposedMovies, userVotes, maxProposals, maxVotes } = store.getState();
  const userHeader = document.getElementById('userHeader');
  const searchInput = document.getElementById('movieSearch');
  const searchResults = document.getElementById('searchResults');
  const aiSearchInput = document.getElementById('aiSearchInput');
  const aiSearchBtn = document.getElementById('aiSearchBtn');
  const exploreInputs = ['exploreTitle','exploreDirector','exploreGenre','exploreYearFrom','exploreYearTo','exploreLimit','exploreActor','exploreSort','exploreProvider'].map(id => document.getElementById(id));
  const exploreButtons = ['exploreClearBtn','exploreSearchBtn'].map(id => document.getElementById(id));

  if (!userHeader) return;

  if (user) {
    const name = getUserDisplayName(userProfile, user);
    const safeName = escapeHtml(name);
    const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=5850ec&color=fff&bold=true`;
    const myScore = userProfile?.score || 0;
    const myProposalsCount = (proposedMovies || []).filter(m => m.proposed_by === user.id).length;
    const votesLeft = maxVotes - userVotes.size;
    const proposalsLeft = maxProposals - myProposalsCount;

    if (isAdmin) {
      userHeader.innerHTML = `
        <div class="user-profile">
          <div class="score-badge header-score" style="background:rgba(255,165,0,0.1); color:#ffa500; border: 1px solid rgba(255,165,0,0.3);"><i data-lucide="shield-check" style="width:12px; height:12px; margin-right:4px;"></i>ADMIN MODE</div>
          <div class="score-badge header-score" style="background:rgba(255,255,255,0.05); cursor:pointer;" onclick="event.stopPropagation(); window.navigateTo('sessions')" title="View Cinema Sessions"><i data-lucide="calendar" style="width:12px; height:12px; margin-right:4px;"></i>Sessions</div>
          <div class="user-profile-info" onclick="window.navigateTo('profile')"><img src="${avatar}" class="user-avatar" /><div style="display:flex; flex-direction:column; line-height: 1.2;"><span style="font-weight:700;">${safeName}</span><span style="font-size: 0.7rem; color:var(--success); font-weight:800;">ADMINISTRATOR</span></div></div>
        </div>`;
      if (searchInput) { searchInput.disabled = false; searchInput.style.opacity = '1'; searchInput.style.cursor = 'text'; searchInput.placeholder = 'Search movies (Admin Mode)...'; }
      const proposalsLabel = document.getElementById('proposalsCountLabel');
      if (proposalsLabel) proposalsLabel.style.opacity = '0';
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    userHeader.innerHTML = `
      <div class="user-profile">
        <div class="score-badge header-score" style="background:rgba(0, 212, 255, 0.1); color:#00d4ff; border: 1px solid rgba(0, 212, 255, 0.3);" title="Your available votes"><i data-lucide="check-square" style="width:14px; height:14px; margin-right:4px;"></i><span class="header-label">${votesLeft > 0 ? votesLeft : 0} <span class="hide-mobile">Votes Left</span></span></div>
        <div class="score-badge header-score" style="background:rgba(255,255,255,0.05); cursor:pointer;" onclick="event.stopPropagation(); window.navigateTo('sessions')"><i data-lucide="calendar" style="width:14px; height:14px; margin-right:4px;"></i><span class="header-label hide-mobile">Sessions</span></div>
        <div class="score-badge header-score" onclick="event.stopPropagation(); window.navigateTo('ranking')"><i data-lucide="award" style="width:14px; height:14px; margin-right:4px;"></i><span class="header-label">${myScore}</span></div>
        <div class="user-profile-info" onclick="window.navigateTo('profile')"><img src="${avatar}" class="user-avatar" /><div class="user-name-wrapper hide-mobile" style="display:flex; flex-direction:column; line-height: 1.2;"><span style="font-weight:700;">${safeName}</span>${userProfile?.rank ? `<span style="font-size: 0.7rem; color:var(--warning); font-weight:800;">#${userProfile.rank}</span>` : ''}</div></div>
      </div>`;

    if (searchInput) {
      const isLimitReached = proposalsLeft <= 0;
      searchInput.disabled = isLimitReached;
      searchInput.style.opacity = isLimitReached ? '0.5' : '1';
      searchInput.style.cursor = isLimitReached ? 'not-allowed' : 'text';
      searchInput.placeholder = proposalsLeft > 0 ? `Search for movies to propose...` : `Max proposals reached (${maxProposals}/${maxProposals})`;
    }

    const proposalsLabel = document.getElementById('proposalsCountLabel');
    if (proposalsLabel) {
      proposalsLabel.style.opacity = '1';
      const green = '#10b981', red = '#ef4444';
      proposalsLabel.innerHTML = `<span style="color:${proposalsLeft > 0 ? green : red}">${proposalsLeft > 0 ? `Available Proposals: ${proposalsLeft} / ${maxProposals}` : `Limit Reached: ${maxProposals} / ${maxProposals} Proposals Used`}</span>`;
    }
  } else {
    const proposalsLabel = document.getElementById('proposalsCountLabel');
    if (proposalsLabel) proposalsLabel.style.opacity = '0';
    userHeader.innerHTML = `<button class="auth-btn" onclick="window.navigateTo('auth')">Sign In</button>`;
    if (searchResults) searchResults.classList.remove('active');
    if (searchInput) { searchInput.disabled = true; searchInput.placeholder = 'Sign in to propose movies...'; }
    if (aiSearchInput) { aiSearchInput.disabled = false; aiSearchInput.placeholder = 'e.g. Movies about space and loneliness from the 70s similar to 2001...'; }
    if (aiSearchBtn) aiSearchBtn.disabled = false;
    exploreInputs.forEach(input => {
      if (!input) return;
      input.disabled = false;
      if (input.id === 'exploreTitle') input.placeholder = 'Movie title...';
      if (input.id === 'exploreDirector') input.placeholder = 'Director name...';
      if (input.id === 'exploreYearFrom') input.placeholder = 'From';
      if (input.id === 'exploreYearTo') input.placeholder = 'To';
    });
    exploreButtons.forEach(btn => { if (btn) btn.disabled = false; });
  }
}

export async function checkUser(session) {
  if (session === undefined) {
    session = await AuthService.getCurrentSession();
  }
  const currentUser = session?.user || null;

  if (currentUser) {
    const displayName = getUserDisplayName(null, currentUser);
    const profile = await AuthService.getOrCreateUserProfile(currentUser, displayName);
    const currentIsAdmin = profile?.role === 'admin';
    store.setState({ user: currentUser, userProfile: profile, isAdmin: currentIsAdmin });
    console.log(`[ACL] User: ${currentUser.email} | Role: ${profile?.role || 'user'} | Admin: ${currentIsAdmin}`);

    const [votes, attendance] = await Promise.all([
      MovieService.fetchVotesForUser(currentUser.id),
      SessionService.fetchUserAttendance(currentUser.id)
    ]);
    store.setUserVotes(new Set(votes?.map(v => v.movie_id) || []));
    store.setState({ userAttendance: new Set(attendance || []) });
  } else {
    store.setState({ user: null, userProfile: null, isAdmin: false });
    store.setUserVotes(new Set());
    store.setState({ userAttendance: new Set() });
  }

  updateAuthUI();

  // Deep-link: resolve after data is loaded (handled by refreshData calling this)
}

export function scheduleAuthStateSync(session) {
  const { authSyncSequence: currentSeq } = store.getState();
  const syncId = (currentSeq || 0) + 1;
  store.setState({ authSyncSequence: syncId });

  window.setTimeout(async () => {
    const { authSyncSequence } = store.getState();
    if (syncId !== authSyncSequence) return;
    try {
      await checkUser(session);
      window.dispatchEvent(new CustomEvent('app:refresh', { detail: { lazy: true } }));
    } catch (error) {
      console.error('Error syncing auth state:', error);
    }
  }, 0);
}

export async function loadUserActivity(targetUserId = null) {
  const { user, isAdmin, maxProposals, maxVotes } = store.getState();
  if (!user && !targetUserId) return;

  const activeUid = targetUserId || user.id;
  const isAudit = targetUserId && targetUserId !== user?.id;

  const profileName = document.getElementById('profileName');
  const profileEmail = document.getElementById('profileEmail');
  const profileAvatar = document.getElementById('profileAvatar');
  const countProposals = document.getElementById('countProposals');
  const countVotes = document.getElementById('countVotes');
  const profileActivityGrid = document.getElementById('profileActivityGrid');
  const profilePointsAuditSection = document.getElementById('profilePointsAuditSection');
  const profilePointsAuditContent = document.getElementById('profilePointsAuditContent');
  const profilePointsAuditSubtitle = document.getElementById('profilePointsAuditSubtitle');
  const adminDashboard = document.getElementById('adminDashboard');
  const editName = document.getElementById('editName');

  const { profileAuditMode } = store.getState();

  ProfileView.renderSkeletonHeader({ profileName, profileEmail, profileAvatar, countProposals, countVotes });
  ProfileView.renderActivitySkeletons(profileActivityGrid);
  ProfileView.renderAchievementSkeletons(document.getElementById('profileAchievementsGrid'));
  if (isAudit && profileAuditMode === 'points') {
    profilePointsAuditSection?.classList.remove('page-hidden');
    ProfileView.renderPointsAuditSkeleton(profilePointsAuditContent);
  } else {
    profilePointsAuditSection?.classList.add('page-hidden');
  }

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', activeUid).single();
  if (profileAvatar) profileAvatar.parentElement.classList.remove('skeleton');

  ProfileView.renderHeader(profile, {
    profileName, profileEmail, profileAvatar, countProposals, countVotes,
    maxProposals, maxVotes, proposalsCount: 0, votesCount: 0
  });

  const auditBadge = document.getElementById('auditBadge') || document.createElement('div');
  if (isAudit) {
    auditBadge.id = 'auditBadge';
    auditBadge.className = 'audit-badge';
    auditBadge.innerHTML = `<i data-lucide="shield-check"></i> Auditing User Profile <button onclick="window.exitUserAudit()">Exit Audit</button>`;
    profileName.parentElement.prepend(auditBadge);
    document.getElementById('editProfileBtn')?.classList.add('page-hidden');
  } else {
    auditBadge.remove();
    document.getElementById('editProfileBtn')?.classList.remove('page-hidden');
  }

  if (!isAudit && editName) {
    editName.value = profile?.full_name || '';
    const displayEmailInput = document.getElementById('displayEmail');
    if (displayEmailInput) displayEmailInput.value = user.email;
  }

  const [proposalsRes, votesRes] = await Promise.all([
    supabase.from('movies').select('*').eq('proposed_by', activeUid).eq('is_dropped', false).eq('is_seen', false),
    supabase.from('votes').select('movie_id, movies(*)').eq('user_id', activeUid)
  ]);

  const proposals = proposalsRes.data || [];
  const activeVotes = (votesRes.data || []).filter(v => v.movies && !v.movies.is_dropped && !v.movies.is_seen);
  const proposalsLimitLabel = Number.isInteger(maxProposals) ? maxProposals : '—';
  const votesLimitLabel = Number.isInteger(maxVotes) ? maxVotes : '—';
  if (countProposals) countProposals.textContent = `${proposals.length} / ${proposalsLimitLabel}`;
  if (countVotes) countVotes.textContent = `${activeVotes.length} / ${votesLimitLabel}`;

  ProfileView.renderActivityGrid(proposals, profileActivityGrid, store.getState());
  if (window.lucide) window.lucide.createIcons();

  if (isAudit && profileAuditMode === 'points') {
    if (profilePointsAuditSubtitle) profilePointsAuditSubtitle.textContent = `Detailed score audit for ${getUserDisplayName(profile)}.`;
    await loadProfilePointsAudit(profile);
    profilePointsAuditSection?.classList.remove('page-hidden');
    window.setTimeout(() => profilePointsAuditSection?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  } else {
    profilePointsAuditSection?.classList.add('page-hidden');
  }

  document.querySelectorAll('.activity-tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelector('.activity-tab.active').classList.remove('active');
      tab.classList.add('active');
      const view = tab.dataset.view;
      ProfileView.renderActivityGrid(view === 'myProposals' ? proposals : activeVotes.map(v => v.movies), profileActivityGrid, store.getState());
    };
  });

  if (isAdmin) {
    adminDashboard?.classList.remove('page-hidden');
    await fetchUserList();
    await fetchParticipationLog();
  } else {
    adminDashboard?.classList.add('page-hidden');
  }

  await renderProfileAchievements(activeUid);
  if (window.lucide) window.lucide.createIcons();
}

export async function loadProfilePointsAudit(profile) {
  const profilePointsAuditContent = document.getElementById('profilePointsAuditContent');
  if (!profile?.id || !profilePointsAuditContent) return;

  try {
    const [votesRes, moviesRes, ratingsRes, attendanceRes, sessionsRes] = await Promise.all([
      supabase.from('votes').select('user_id, movie_id, movies(id, title, is_dropped)').eq('user_id', profile.id),
      supabase.from('movies').select('id, title, proposed_by, is_dropped, is_seen').eq('proposed_by', profile.id),
      supabase.from('user_ratings').select('user_id, movie_id, movies(title)').eq('user_id', profile.id),
      supabase.from('session_attendance').select('user_id, session_id, sessions(session_date, movie_id, movies(title))').eq('user_id', profile.id),
      supabase.from('sessions').select('id, session_date, movie_id, movies(title)').order('session_date', { ascending: true })
    ]);

    const errors = [votesRes.error, moviesRes.error, ratingsRes.error, attendanceRes.error, sessionsRes.error].filter(Boolean);
    if (errors.length > 0) throw new Error(errors.map(e => e.message || 'Unknown error').join(' | '));

    const attendance = (attendanceRes.data || []).map(e => ({ user_id: e.user_id, session_id: e.session_id }));
    const statsMap = buildUserScoreStatsMap([profile], votesRes.data || [], moviesRes.data || [], ratingsRes.data || [], attendance, sessionsRes.data || []);
    const stats = statsMap[profile.id] || createEmptyScoreStats();
    const audit = buildUserPointsAudit(profile, stats, { votes: votesRes.data || [], movies: moviesRes.data || [], ratings: ratingsRes.data || [], attendanceEntries: attendanceRes.data || [] });

    ProfileView.renderPointsAudit(audit, profilePointsAuditContent);
  } catch (error) {
    console.error('Error loading points audit:', error);
    profilePointsAuditContent.innerHTML = '<div class="empty-state">Failed to load points audit.</div>';
  }
}

async function renderProfileAchievements(userId) {
  const { AchievementService } = await import('../api/index.js');
  const { sessions } = store.getState();
  const grid = document.getElementById('profileAchievementsGrid');
  if (!grid) return;
  const achievements = await AchievementService.calculateUserAchievements(userId, sessions);
  const { ProfileView } = await import('../views/index.js');
  ProfileView.renderAchievements(achievements, grid);
  if (window.lucide) window.lucide.createIcons();
}

export function init() {
  window.addEventListener('authui:update', () => updateAuthUI());

  window.signInWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
  };

  window.handleLogin = async () => {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) alert(error.message);
    else window.navigateTo('home');
  };

  window.handleSignup = async () => {
    const email = document.getElementById('signupEmail').value;
    const password = document.getElementById('signupPassword').value;
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) { alert(error.message); return; }
    if (data?.session) window.navigateTo('home');
    else alert('Check your email for confirmation!');
  };

  window.handleLogout = async () => {
    await supabase.auth.signOut();
    await checkUser(null);
    window.navigateTo('auth');
  };

  window.toggleEditProfile = (show) => {
    const profileDisplay = document.getElementById('profileDisplay');
    const profileEditForm = document.getElementById('profileEditForm');
    if (profileDisplay) profileDisplay.classList.toggle('page-hidden', show);
    if (profileEditForm) profileEditForm.classList.toggle('page-hidden', !show);
  };

  window.saveProfile = async () => {
    const { user } = store.getState();
    const editName = document.getElementById('editName');
    const newName = editName.value.trim();
    if (!newName) { showNotification('Name cannot be empty', 'error'); return; }
    const { error } = await supabase.from('profiles').update({ full_name: newName }).eq('id', user.id);
    if (error) { showNotification('Failed to update profile', 'error'); return; }
    showNotification('Profile updated successfully!', 'success');
    window.toggleEditProfile(false);
    window.pendingAvatarUrl = null;
    const { data: updatedProfile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    store.setState({ userProfile: updatedProfile });
    await loadUserActivity();
    updateAuthUI();
  };

  window.viewUserProfile = (userId) => {
    const { isAdmin } = store.getState();
    if (!isAdmin) return;
    store.setState({ profileAuditMode: 'activity' });
    window.navigateTo('profile', userId);
  };

  window.viewUserPointsAudit = (userId) => {
    const { isAdmin } = store.getState();
    if (!isAdmin) return;
    store.setState({ profileAuditMode: 'points' });
    window.navigateTo('profile', userId);
  };

  window.exitUserAudit = () => {
    store.setState({ profileAuditMode: 'activity' });
    window.navigateTo('profile');
  };
}
```

> **Note on `profileAuditMode`:** Add `profileAuditMode: 'activity'` to the store's initial state in `src/state/store.js` — remove `let profileAuditMode = 'activity'` from `main.js`.

- [ ] Add `profileAuditMode: 'activity'` to store initial state in `src/state/store.js`:
```js
// In constructor, add to this.state:
profileAuditMode: 'activity',
```

- [ ] Remove from `main.js`: `checkUser`, `setAuthContext`, `scheduleAuthStateSync`, `updateAuthUI`, `loadUserActivity`, `loadProfilePointsAudit`, `renderProfileAchievements`, `window.handleLogin`, `window.handleSignup`, `window.handleLogout`, `window.signInWithGoogle`, `window.toggleEditProfile`, `window.saveProfile`, `window.viewUserProfile`, `window.viewUserPointsAudit`, `window.exitUserAudit`, `let profileAuditMode`, `let authSyncSequence`.

- [ ] Add import to `main.js`:
```js
import { checkUser, updateAuthUI, loadUserActivity, scheduleAuthStateSync, init as initAuth } from './src/controllers/AuthController.js';
```

- [ ] Add `initAuth()` call in `init()` in `main.js`.

- [ ] Run build, then manually test login + profile page.
```bash
npm run build
```

- [ ] Commit
```bash
git add src/controllers/AuthController.js src/state/store.js main.js
git commit -m "refactor: extract AuthController, move profileAuditMode to store"
```

---

## Task 6: SessionController

**Files:** `src/controllers/SessionController.js`, `main.js`

- [ ] Create `src/controllers/SessionController.js`

```js
import { supabase } from '../config/supabase.js';
import { SessionService } from '../api/index.js';
import { store } from '../state/store.js';
import { SessionsView, HomeView } from '../views/index.js';
import { showNotification, escapeHtml } from '../utils/index.js';
import { getUserDisplayName } from '../utils/index.js';

export async function fetchSessions() {
  const sessionsGrid = document.getElementById('sessionsGrid');
  if (sessionsGrid && (sessionsGrid.innerHTML.trim() === '' || sessionsGrid.querySelector('.empty-state'))) {
    SessionsView.renderSkeletons(sessionsGrid, 3);
  }
  try {
    const sessions = await SessionService.fetchAll();
    store.setState({ sessions });
  } catch (err) {
    console.error('Error fetching sessions:', err);
  }
}

export function renderSessions() {
  const { sessions, user } = store.getState();
  const sessionsGrid = document.getElementById('sessionsGrid');
  SessionsView.renderSessions(sessions, sessionsGrid, { user });
  if (window.lucide) window.lucide.createIcons();
}

export function renderNextSessionHero() {
  const { sessions, user } = store.getState();
  const nextSessionHero = document.getElementById('nextSessionHero');
  const upcoming = sessions
    .filter(s => s.is_upcoming && new Date(s.session_date) > new Date())
    .sort((a, b) => new Date(a.session_date) - new Date(b.session_date))[0];
  HomeView.renderNextSessionHero(upcoming, nextSessionHero, { user });
  if (window.lucide) window.lucide.createIcons();
}

export function updateAdminSessions() {
  const { sessions, isAdmin } = store.getState();
  const adminSessionsList = document.getElementById('adminSessionsList');
  if (!isAdmin || !adminSessionsList) return;

  adminSessionsList.innerHTML = sessions.map(session => {
    const title = escapeHtml(session.movie_id ? session.movies?.title : 'TBD');
    return `
      <div class="admin-session-item">
        <div>
          <div style="font-weight:700;">${title}</div>
          <div style="font-size:0.8rem; opacity:0.6;">${new Date(session.session_date).toLocaleString()}</div>
        </div>
        <div class="admin-session-actions">
          <button class="btn-admin-action" onclick="window.showEditSessionModal('${session.id}')" title="Edit Session"><i data-lucide="edit"></i></button>
          <button class="btn-admin-action" onclick="window.manageAttendance('${session.id}')" title="Mark Attendance"><i data-lucide="users"></i></button>
          <button class="btn-admin-action delete" onclick="window.handleDeleteSession('${session.id}')" title="Delete Session"><i data-lucide="trash-2"></i></button>
        </div>
      </div>`;
  }).join('');
  if (window.lucide) window.lucide.createIcons();
}

function resetSessionModalToCreateMode() {
  const createSessionModal = document.getElementById('createSessionModal');
  const sessionMovieSelect = document.getElementById('sessionMovieSelect');
  const modalTitle = createSessionModal?.querySelector('h2');
  const submitBtn = createSessionModal?.querySelector('.submit-btn');
  if (modalTitle) modalTitle.textContent = 'Create Session';
  if (submitBtn) { submitBtn.textContent = 'Create Session'; submitBtn.onclick = () => window.handleCreateSession(); }
  if (sessionMovieSelect) sessionMovieSelect.value = '';
  ['sessionDate','sessionDescription','sessionKeyword'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

export function init() {
  window.viewSessionDetails = async (sessionId) => {
    const { sessions } = store.getState();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) { console.warn('Session not found in local state:', sessionId); return; }
    store.setState({ currentSession: session });
    const sessionModal = document.getElementById('sessionModal');
    const sessionModalBody = document.getElementById('sessionModalBody');
    if (sessionModal) { sessionModal.classList.remove('page-hidden'); document.body.style.overflow = 'hidden'; }
    try {
      const details = await SessionService.fetchDetails(sessionId);
      if (sessionModalBody) {
        const { user, isAdmin } = store.getState();
        sessionModalBody.innerHTML = SessionsView.renderDetail(session, details, { user, isAdmin });
        if (window.lucide) window.lucide.createIcons();
      }
    } catch (err) {
      console.error('Error fetching session details:', err);
    }
  };

  window.closeSessionModal = () => {
    const sessionModal = document.getElementById('sessionModal');
    if (sessionModal) { sessionModal.classList.add('page-hidden'); document.body.style.overflow = ''; }
  };

  window.switchSessionTab = async (tab) => {
    const { currentSession, user, isAdmin } = store.getState();
    document.querySelectorAll('.session-tab-btn, .cinematic-tab').forEach(b => b.classList.toggle('active', b.getAttribute('data-tab') === tab));
    const content = document.getElementById('sessionTabContent');
    if (tab === 'comments') {
      const { data } = await supabase.from('session_comments').select('*, profiles(full_name)').eq('session_id', currentSession.id).order('created_at', { ascending: false });
      content.innerHTML = SessionsView.renderCommentsHTML(data || []);
    } else if (tab === 'photos') {
      const { data } = await supabase.from('session_photos').select('*, profiles(full_name)').eq('session_id', currentSession.id).order('created_at', { ascending: false });
      content.innerHTML = SessionsView.renderGalleryHTML(data || [], user, isAdmin);
    } else if (tab === 'participants') {
      const table = currentSession.is_upcoming ? 'session_signups' : 'session_attendance';
      const { data } = await supabase.from(table).select('*, profiles(full_name)').eq('session_id', currentSession.id);
      content.innerHTML = SessionsView.renderParticipantsHTML(data || [], currentSession.is_upcoming);
    }
    if (window.lucide) window.lucide.createIcons();
  };

  window.openPhotoLightbox = (url) => {
    let lightbox = document.getElementById('photoLightbox');
    if (!lightbox) {
      lightbox = document.createElement('div');
      lightbox.id = 'photoLightbox';
      lightbox.className = 'photo-lightbox';
      lightbox.onclick = () => lightbox.classList.remove('active');
      document.body.appendChild(lightbox);
    }
    lightbox.innerHTML = `<div class="lightbox-content"><img src="${url}" alt="Full size photo"><button class="close-lightbox"><i data-lucide="x"></i></button></div>`;
    lightbox.classList.add('active');
    if (window.lucide) window.lucide.createIcons();
  };

  window.signupForSession = async (sessionId) => {
    const { user } = store.getState();
    if (!user) { showNotification('Please log in to sign up!', 'error'); return; }
    try {
      const res = await SessionService.toggleSignup(sessionId, user.id);
      showNotification(res.action === 'added' ? 'You are now signed up!' : 'Signup removed.');
      await fetchSessions();
      renderSessions();
      const { currentSession } = store.getState();
      if (currentSession?.id === sessionId) window.viewSessionDetails(sessionId);
    } catch (err) {
      console.error('Error signing up:', err);
      showNotification('Action failed.', 'error');
    }
  };

  window.addSessionComment = async () => {
    const { user, currentSession } = store.getState();
    const input = document.getElementById('sessionCommentInput');
    const content = input?.value.trim();
    if (!content || !user || !currentSession) return;
    try {
      await SessionService.addComment(currentSession.id, user.id, content);
      input.value = '';
      showNotification('Comment added!');
      window.switchSessionTab('comments');
    } catch (err) {
      console.error('Error adding comment:', err);
    }
  };

  window.addSessionPhoto = async (input) => {
    const { user, currentSession } = store.getState();
    if (!input.files?.length || !user || !currentSession) return;
    try {
      showNotification('Uploading photo...', 'warning');
      await SessionService.uploadSessionPhoto(currentSession.id, user.id, input.files[0]);
      showNotification('Photo uploaded successfully!', 'success');
      window.switchSessionTab('photos');
    } catch (err) {
      showNotification('Error uploading photo: ' + err.message, 'error');
    } finally {
      input.value = '';
    }
  };

  window.deleteSessionPhoto = async (photoId, photoUrl) => {
    const { isAdmin } = store.getState();
    if (!isAdmin || !confirm('Are you sure you want to delete this photo?')) return;
    try {
      showNotification('Deleting photo...', 'warning');
      await SessionService.deletePhoto(photoId, photoUrl);
      showNotification('Photo deleted!', 'success');
      window.switchSessionTab('photos');
    } catch (err) {
      showNotification('Error deleting photo: ' + err.message, 'error');
    }
  };

  window.showCreateSessionModal = () => {
    const { proposedMovies } = store.getState();
    const createSessionModal = document.getElementById('createSessionModal');
    const sessionMovieSelect = document.getElementById('sessionMovieSelect');
    resetSessionModalToCreateMode();
    createSessionModal.classList.remove('page-hidden');
    sessionMovieSelect.innerHTML = `<option value="">-- To Be Decided --</option>${proposedMovies.map(m => `<option value="${m.id}">${escapeHtml(m.title)}</option>`).join('')}`;
  };

  window.closeCreateSessionModal = () => {
    const createSessionModal = document.getElementById('createSessionModal');
    resetSessionModalToCreateMode();
    store.setState({ currentSession: null });
    createSessionModal.classList.add('page-hidden');
  };

  window.handleCreateSession = async () => {
    const sessionMovieSelect = document.getElementById('sessionMovieSelect');
    const dateStr = document.getElementById('sessionDate').value;
    const desc = document.getElementById('sessionDescription').value;
    const keyword = document.getElementById('sessionKeyword')?.value || null;
    if (!dateStr) { showNotification('Date is required', 'error'); return; }
    try {
      await SessionService.createSession({
        movie_id: sessionMovieSelect.value || null,
        session_date: dateStr,
        description: desc,
        keyword,
        location: 'Paral·lel Cinema',
        is_upcoming: new Date(dateStr) > new Date()
      });
      showNotification('Session created successfully!');
      await fetchSessions();
      renderSessions();
      renderNextSessionHero();
      updateAdminSessions();
      window.closeCreateSessionModal();
    } catch (err) {
      console.error('Error creating session:', err);
      showNotification('Failed to create session', 'error');
    }
  };

  window.showEditSessionModal = (sessionId) => {
    const { sessions, proposedMovies } = store.getState();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;
    store.setState({ currentSession: session });
    const createSessionModal = document.getElementById('createSessionModal');
    const sessionMovieSelect = document.getElementById('sessionMovieSelect');
    createSessionModal.classList.remove('page-hidden');
    sessionMovieSelect.innerHTML = `
      <option value="">-- To Be Decided --</option>
      ${proposedMovies.map(m => `<option value="${m.id}" ${m.id === session.movie_id ? 'selected' : ''}>${escapeHtml(m.title)}</option>`).join('')}
      ${session.movie_id && !proposedMovies.some(m => m.id === session.movie_id) ? `<option value="${session.movie_id}" selected>${escapeHtml(session.movies?.title || 'Film To Be Decided')}</option>` : ''}`;
    const date = new Date(session.session_date);
    document.getElementById('sessionDate').value = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    document.getElementById('sessionDescription').value = session.description || '';
    const kwInput = document.getElementById('sessionKeyword');
    if (kwInput) kwInput.value = session.keyword || '';
    const submitBtn = createSessionModal.querySelector('.submit-btn');
    submitBtn.textContent = 'Update Session';
    submitBtn.onclick = () => window.handleUpdateSession(sessionId);
    createSessionModal.querySelector('h2').textContent = 'Edit Session';
  };

  window.handleUpdateSession = async (sessionId) => {
    const { currentSession } = store.getState();
    const sessionMovieSelect = document.getElementById('sessionMovieSelect');
    const dateStr = document.getElementById('sessionDate').value;
    const desc = document.getElementById('sessionDescription').value;
    const keyword = document.getElementById('sessionKeyword')?.value || null;
    if (!dateStr) { showNotification('Date is required', 'error'); return; }
    try {
      const sessionModal = document.getElementById('sessionModal');
      const shouldRefresh = sessionModal && !sessionModal.classList.contains('page-hidden');
      const updatedSession = await SessionService.updateSession(sessionId, {
        movie_id: sessionMovieSelect.value || null,
        session_date: dateStr,
        description: desc,
        keyword,
        location: currentSession?.location || 'Paral·lel Cinema',
        is_upcoming: new Date(dateStr) > new Date()
      });
      showNotification('Session updated!');
      await fetchSessions();
      renderSessions();
      renderNextSessionHero();
      updateAdminSessions();
      store.setState({ currentSession: updatedSession });
      window.closeCreateSessionModal();
      if (shouldRefresh) await window.viewSessionDetails(sessionId);
    } catch (err) {
      showNotification(err.message || 'Failed to update session', 'error');
    }
  };

  window.handleDeleteSession = async (sessionId) => {
    if (!confirm('Are you sure you want to delete this session?')) return;
    try {
      await SessionService.deleteSession(sessionId);
      showNotification('Session deleted.');
      const { currentSession } = store.getState();
      if (currentSession?.id === sessionId) {
        document.getElementById('sessionDetailsModal')?.classList.add('page-hidden');
        store.setState({ currentSession: null });
      }
      await fetchSessions();
      renderSessions();
    } catch (err) {
      showNotification('Failed to delete session', 'error');
    }
  };

  window.manageAttendance = async (sessionId) => {
    const { sessions } = store.getState();
    const session = sessions.find(s => s.id === sessionId);
    const [signupsRes, attendanceRes] = await Promise.all([
      supabase.from('session_signups').select('*, profiles(full_name, id)').eq('session_id', sessionId),
      supabase.from('session_attendance').select('user_id').eq('session_id', sessionId)
    ]);
    const attendedSet = new Set(attendanceRes.data?.map(a => a.user_id) || []);
    const html = `
      <div style="padding: 2rem;">
        <h3>Attendance: ${escapeHtml(session.movies?.title || 'Film To Be Decided')}</h3>
        <p style="margin-bottom: 2rem;">Confirm who actually attended the session.</p>
        <div style="display:grid; gap:1rem;">
          ${signupsRes.data?.length ? signupsRes.data.map(s => `
            <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.05); padding:1rem; border-radius:1rem;">
              <span>${escapeHtml(getUserDisplayName(s.profiles))}</span>
              <button class="btn-signup-hero ${attendedSet.has(s.user_id) ? 'success' : 'secondary'}" style="padding:0.5rem 1rem; font-size:0.8rem;" onclick="window.toggleAttendance('${sessionId}', '${s.user_id}', this)">
                ${attendedSet.has(s.user_id) ? 'Confirmed' : 'Confirm Attendance'}
              </button>
            </div>`).join('') : '<p>No signups for this session yet.</p>'}
        </div>
        <button class="submit-btn" style="margin-top:2rem;" onclick="window.closeSessionModal()">Done</button>
      </div>`;
    const sessionModalBody = document.getElementById('sessionModalBody');
    const sessionModal = document.getElementById('sessionModal');
    if (sessionModalBody) sessionModalBody.innerHTML = html;
    if (sessionModal) sessionModal.classList.remove('page-hidden');
  };

  window.toggleAttendance = async (sessionId, userId, btn) => {
    try {
      const res = await SessionService.toggleAttendance(sessionId, userId);
      showNotification(res.action === 'added' ? 'Attendance confirmed!' : 'Attendance removed', res.action === 'added' ? 'success' : 'info');
      await fetchSessions();
      renderSessions();
      window.viewSessionDetails(sessionId);
    } catch (err) {
      showNotification('Action failed', 'error');
    }
  };
}
```

- [ ] Remove from `main.js`: `fetchSessions`, `renderSessions`, `renderNextSessionHero`, `updateAdminSessions`, `window.viewSessionDetails`, `window.closeSessionModal`, `window.switchSessionTab`, `window.openPhotoLightbox`, `window.signupForSession`, `window.addSessionComment`, `window.addSessionPhoto`, `window.deleteSessionPhoto`, `window.showCreateSessionModal`, `window.closeCreateSessionModal`, `window.handleCreateSession`, `window.showEditSessionModal`, `window.handleUpdateSession`, `window.handleDeleteSession`, `window.manageAttendance`, `window.toggleAttendance`, `resetSessionModalToCreateMode`.

- [ ] Add import to `main.js`:
```js
import { fetchSessions, renderSessions, renderNextSessionHero, updateAdminSessions, init as initSessions } from './src/controllers/SessionController.js';
```

- [ ] Add `initSessions()` in `init()`.

- [ ] Run build, then manually test sessions tab and modal.
```bash
npm run build
```

- [ ] Commit
```bash
git add src/controllers/SessionController.js main.js
git commit -m "refactor: extract SessionController"
```

---

## Task 7: MovieController (largest — includes bug fixes)

**Files:** `src/controllers/MovieController.js`, `main.js`

- [ ] Create `src/controllers/MovieController.js`

```js
import { supabase } from '../config/supabase.js';
import { MovieService, TMDBService, AchievementService } from '../api/index.js';
import { store } from '../state/store.js';
import { HomeView, ProfileView } from '../views/index.js';
import { FALLBACK_IMAGE, ACHIEVEMENT_LIST } from '../config/constants.js';
import { showNotification, escapeHtml } from '../utils/index.js';
import { formatScore } from '../utils/index.js';
import { createMovieCardHTML } from '../components/index.js';
import { updateAuthUI } from './AuthController.js';

// --- Lazy render state ---
let proposalLazyRenderToken = 0;
let proposalLazyObserver = null;
let proposalLazyFallbackTimer = null;
const INITIAL_PROPOSAL_CHUNK_SIZE = 10;
const INITIAL_PROPOSAL_FALLBACK_MS = 2200;
const INITIAL_PROPOSAL_ROOT_MARGIN = '900px 0px';

function clearProposalLazyRenderState() {
  proposalLazyRenderToken += 1;
  if (proposalLazyObserver) { proposalLazyObserver.disconnect(); proposalLazyObserver = null; }
  if (proposalLazyFallbackTimer) { window.clearTimeout(proposalLazyFallbackTimer); proposalLazyFallbackTimer = null; }
}

function buildProposalChunkHTML(movies) {
  const { user, isAdmin, userVotes } = store.getState();
  return (movies || []).map(movie => createMovieCardHTML(movie, {
    context: 'proposal',
    showDelete: (user && movie.proposed_by === user.id) || isAdmin,
    isAdmin, user, userVotes
  })).join('');
}

function queueProposalChunkRender(renderFn) {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(renderFn, { timeout: 120 });
  } else {
    window.setTimeout(renderFn, 16);
  }
}

export function renderProposals(options = {}) {
  const { lazy = false } = options;
  const { proposedMovies } = store.getState();
  const movieGrid = document.getElementById('movieGrid');
  if (!movieGrid) return;

  if (!lazy || !proposedMovies.length) {
    clearProposalLazyRenderState();
    HomeView.renderProposals(proposedMovies, movieGrid, store.getState());
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  clearProposalLazyRenderState();
  HomeView.renderMovieGridSkeletons(movieGrid, Math.min(6, proposedMovies.length));
  const token = proposalLazyRenderToken;
  let hasStarted = false;

  const renderChunks = (startIndex = 0) => {
    if (token !== proposalLazyRenderToken) return;
    const chunk = proposedMovies.slice(startIndex, startIndex + INITIAL_PROPOSAL_CHUNK_SIZE);
    if (startIndex === 0) movieGrid.innerHTML = buildProposalChunkHTML(chunk);
    else movieGrid.insertAdjacentHTML('beforeend', buildProposalChunkHTML(chunk));
    if (window.lucide) window.lucide.createIcons();
    const nextIndex = startIndex + INITIAL_PROPOSAL_CHUNK_SIZE;
    if (nextIndex < proposedMovies.length) queueProposalChunkRender(() => renderChunks(nextIndex));
  };

  const startLazyRender = () => {
    if (hasStarted || token !== proposalLazyRenderToken) return;
    hasStarted = true;
    if (proposalLazyObserver) { proposalLazyObserver.disconnect(); proposalLazyObserver = null; }
    if (proposalLazyFallbackTimer) { window.clearTimeout(proposalLazyFallbackTimer); proposalLazyFallbackTimer = null; }
    renderChunks(0);
  };

  proposalLazyFallbackTimer = window.setTimeout(startLazyRender, INITIAL_PROPOSAL_FALLBACK_MS);
  if (typeof window.IntersectionObserver === 'function') {
    proposalLazyObserver = new window.IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) startLazyRender();
    }, { rootMargin: INITIAL_PROPOSAL_ROOT_MARGIN });
    proposalLazyObserver.observe(movieGrid);
  } else {
    startLazyRender();
  }
}

export function renderHistory() {
  const { seenMovies, isAdmin, user, userVotes, userAttendance } = store.getState();
  const historyGrid = document.getElementById('historyGrid');
  HomeView.renderHistory(seenMovies, historyGrid, { isAdmin, user, userVotes, userAttendance });
  if (window.lucide) window.lucide.createIcons();
}

export function renderCemetery(droppedMoviesList) {
  const { isAdmin, user, userVotes } = store.getState();
  const cemeteryGrid = document.getElementById('cemeteryGrid');
  HomeView.renderCemetery(droppedMoviesList, cemeteryGrid, { isAdmin, user, userVotes });
  if (window.lucide) window.lucide.createIcons();
}

export async function renderTopVotedShowcase() {
  const { proposedMovies } = store.getState();
  const container = document.getElementById('topVotedShowcase');
  const grid = document.getElementById('topVotedGrid');
  HomeView.renderTopVotedShowcase(proposedMovies, container, grid, store.getState());
  if (window.lucide) window.lucide.createIcons();
}

export async function enrichMovieData(movies, options = {}) {
  const { lazyProposals = false } = options;
  const moviesToEnrich = movies.filter(m => m.tmdb_id && (
    m.vote_average === undefined || m.vote_average === null || m.vote_average === 0 ||
    !m.runtime || !m.trailer_url || !m.watch_providers
  ));
  if (moviesToEnrich.length === 0) return;
  console.log(`[Enrichment] Found ${moviesToEnrich.length} movies needing TMDB data.`);

  // BUG FIX: work with local copies, batch-update store at end
  const enrichedMap = new Map();

  for (const movie of moviesToEnrich) {
    try {
      const data = await TMDBService.invokeTMDBCall(`/movie/${movie.tmdb_id}`, {
        append_to_response: 'videos,watch/providers'
      });
      const updates = {};
      const localMovie = { ...movie };

      if (data.vote_average !== undefined) {
        localMovie.vote_average = data.vote_average;
        updates.average_rating = data.vote_average;
      }
      if (data.runtime) {
        localMovie.runtime = data.runtime;
        updates.runtime = data.runtime;
      }
      const trailer = data.videos?.results?.find(v => v.type === 'Trailer' && v.site === 'YouTube');
      if (trailer) {
        localMovie.trailer_url = `https://www.youtube.com/watch?v=${trailer.key}`;
        updates.trailer_url = localMovie.trailer_url;
      }
      const providers = data['watch/providers']?.results?.ES;
      if (providers) {
        localMovie.watch_providers = providers;
        updates.watch_providers = providers;
      }
      if (Object.keys(updates).length > 0) {
        console.log(`[Enrichment] Data updated for ${movie.title}`);
        await MovieService.updateMovieData(movie.id, updates);
        enrichedMap.set(movie.id, localMovie);
      }
    } catch (e) {
      console.error(`[Enrichment] Failed for ${movie.title}:`, e);
    }
  }

  if (enrichedMap.size > 0) {
    const { allMovies } = store.getState();
    const newAllMovies = allMovies.map(m => enrichedMap.has(m.id) ? enrichedMap.get(m.id) : m);
    store.setState({
      allMovies: newAllMovies,
      proposedMovies: newAllMovies.filter(m => !m.is_seen && !m.is_dropped),
      seenMovies: newAllMovies.filter(m => m.is_seen)
    });
  }

  renderProposals({ lazy: lazyProposals });
  renderHistory();
}

export async function renderHomeAchievements() {
  const grid = document.getElementById('homeAchievementsGrid');
  if (!grid) return;
  if (grid.innerHTML.trim() === '' || grid.querySelector('.empty-state')) {
    ProfileView.renderAchievementSkeletons(grid, 4);
  }
  const { allMovies } = store.getState();
  const stats = await AchievementService.calculateGlobalStats(allMovies);
  HomeView.renderHomeAchievements(stats, grid, ACHIEVEMENT_LIST);
  if (window.lucide) window.lucide.createIcons();
}

export async function fetchRecentAchievementEvents() {
  try {
    const events = await AchievementService.fetchRecentEvents();
    events.sort((a, b) => b.date - a.date);
    const body = document.getElementById('timelineBody');
    HomeView.renderTimeline(events.slice(0, 5), body);
    if (window.lucide) window.lucide.createIcons();
    const adminList = document.getElementById('adminAchievementsList');
    if (adminList) {
      const { data: activeProfiles } = await supabase.from('profiles').select('id, full_name, email');
      const activeUserMap = {};
      activeProfiles?.forEach(p => { activeUserMap[p.id] = p.full_name || p.email.split('@')[0]; });
      const { AdminView } = await import('../views/index.js');
      AdminView.renderAchievementsAudit(events, adminList, activeUserMap);
      if (window.lucide) window.lucide.createIcons();
    }
  } catch (err) {
    console.error('Error fetching achievement events:', err);
  }
}

let searchTimeout;
export async function handleMovieSearch(query) {
  const { user, genreMap } = store.getState();
  const searchResults = document.getElementById('searchResults');
  if (!user || !query) { searchResults.classList.remove('active'); return; }
  try {
    const dataResults = await TMDBService.searchTMDB(query);
    const results = dataResults.sort((a, b) => b.popularity - a.popularity).slice(0, 20);
    const enrichedResults = await Promise.all(results.map(async movie => {
      try {
        const detailsData = await TMDBService.invokeTMDBCall(`/movie/${movie.id}`, { append_to_response: 'credits' });
        const directors = (detailsData.credits?.crew || []).filter(p => p.job === 'Director').map(d => d.name).join(', ');
        const genreNames = detailsData.genres?.map(g => g.name) || movie.genre_ids.map(id => genreMap[id]).filter(Boolean);
        return { ...movie, runtime: detailsData.runtime, director: directors || 'Unknown Director', genres: genreNames, synopsis: detailsData.overview || movie.overview };
      } catch (e) {
        return { ...movie, director: 'Unknown Director', genres: [], synopsis: movie.overview };
      }
    }));
    HomeView.renderSearchResults(enrichedResults, searchResults, formatScore, FALLBACK_IMAGE);
    if (window.lucide) window.lucide.createIcons();
  } catch (err) {
    console.error('TMDB Search error:', err);
  }
}

export function init() {
  window.deleteMovie = async (movieId) => {
    const { isAdmin, allMovies } = store.getState();
    if (!isAdmin) return window.dropMovie(movieId);
    const movie = allMovies.find(m => m.id === movieId);
    if (!confirm(`Are you sure you want to delete this proposal? This action cannot be undone.`)) return;
    try {
      await MovieService.deleteMovie(movieId);
      showNotification('Proposal deleted successfully.');
      window.dispatchEvent(new CustomEvent('app:refresh'));
    } catch (e) {
      showNotification('Error deleting movie', 'error');
    }
  };

  window.dropMovie = async (movieId) => {
    const { allMovies } = store.getState();
    const movie = allMovies.find(m => m.id === movieId);
    if (!movie) return;
    if (!confirm('Move this movie to the Cemetery? (It can be recovered later)')) return;
    try {
      await MovieService.updateMovieData(movieId, { is_dropped: true });
      // BUG FIX: use service method instead of direct supabase call
      await MovieService.deleteVotesForMovie(movieId);
      showNotification('Movie sent to Cemetery.');
      window.dispatchEvent(new CustomEvent('app:refresh'));
    } catch (e) {
      showNotification('Error dropping movie', 'error');
    }
  };

  window.proposeMovie = async (tmdbMovie, el) => {
    const { user, proposedMovies, maxProposals, isAdmin, userVotes } = store.getState();
    if (!user) { window.navigateTo('auth'); return; }

    const { count, error: countError } = await supabase.from('movies').select('*', { count: 'exact', head: true }).eq('proposed_by', user.id).eq('is_seen', false).eq('is_dropped', false);
    if (countError) console.error('Error checking proposal limits:', countError);
    const currentCount = count !== null ? count : proposedMovies.filter(m => m.proposed_by === user.id).length;

    if (currentCount >= maxProposals && !isAdmin) {
      showNotification(`Proposal limit reached! You already have the maximum allowed (${maxProposals}). You must delete or wait for one of your current proposals to be screened to add more.`, 'warning');
      return;
    }

    const card = el?.closest('.movie-card');
    try {
      const existing = await MovieService.findMovieByTMDBId(tmdbMovie.id);
      if (existing && existing.is_dropped) {
        if (confirm(`"${tmdbMovie.title}" is currently in the Cinema Cemetery. Do you want to rescue it and bring it back to active proposals?`)) {
          await MovieService.rescueMovie(existing.id, user.id);
          const hasVoted = await MovieService.fetchVotesForUser(user.id);
          if (!hasVoted.some(v => v.movie_id === existing.id)) {
            await MovieService.addVote(user.id, existing.id);
            store.setUserVotes(new Set([...userVotes, existing.id]));
          }
          showNotification(`"${tmdbMovie.title}" has been rescued from the cemetery!`, 'success');
          window.dispatchEvent(new CustomEvent('app:refresh'));
        }
        return;
      }
    } catch (checkErr) {
      console.error('Error checking for existing movie:', checkErr);
    }

    const payload = {
      title: tmdbMovie.title,
      release_year: tmdbMovie.release_date ? parseInt(tmdbMovie.release_date.split('-')[0]) : null,
      poster_url: tmdbMovie.poster_path ? `https://image.tmdb.org/t/p/w500${tmdbMovie.poster_path}` : null,
      tmdb_id: tmdbMovie.id,
      proposed_by: user.id,
      director: tmdbMovie.director,
      genres: tmdbMovie.genres,
      synopsis: tmdbMovie.synopsis,
      runtime: tmdbMovie.runtime
    };

    try {
      const data = await MovieService.createMovie({ ...payload, average_rating: tmdbMovie.vote_average || 0 });
      showNotification(`"${tmdbMovie.title}" proposed!`, 'success');
      try {
        if (data?.id) {
          await MovieService.addVote(user.id, data.id);
          store.setUserVotes(new Set([...userVotes, data.id]));
        }
      } catch (vErr) { console.warn('Auto-vote failed:', vErr); }

      if (card) {
        card.style.transform = 'scale(1.05)';
        card.style.borderColor = 'var(--success)';
        setTimeout(() => { card.style.transform = ''; card.style.borderColor = ''; }, 500);
      }
      const searchInput = document.getElementById('movieSearch');
      const searchResults = document.getElementById('searchResults');
      if (searchInput) searchInput.value = '';
      if (searchResults) searchResults.classList.remove('active');
      window.dispatchEvent(new CustomEvent('app:refresh'));
    } catch (error) {
      if (error.code === '23505') {
        showNotification('Already in the lineup!', 'warning');
        if (card) { card.style.animation = 'shake 0.5s ease'; setTimeout(() => card.style.animation = '', 500); }
      } else {
        showNotification('Something went wrong', 'error');
      }
    }
  };

  window.toggleVote = async (movieId) => {
    const { user, proposedMovies, userVotes, maxVotes, isAdmin } = store.getState();
    if (!user) { window.navigateTo('auth'); return; }
    const movie = proposedMovies.find(m => m.id === movieId);
    if (!movie) return;
    const btn = document.querySelector(`.movie-card[data-id="${movieId}"] .vote-btn`);
    const countEl = document.querySelector(`.movie-card[data-id="${movieId}"] .vote-count`);

    if (userVotes.has(movieId)) {
      try {
        await MovieService.removeVote(user.id, movieId);
        const newVotes = new Set(userVotes);
        newVotes.delete(movieId);
        store.setUserVotes(newVotes);
        const { allMovies } = store.getState();
        store.setState({ allMovies: allMovies.map(m => m.id === movieId ? { ...m, vote_count: (m.vote_count || 1) - 1 } : m) });
        if (btn) btn.classList.remove('active');
        if (countEl) countEl.textContent = `${(movie.vote_count || 1) - 1} votes`;
      } catch (err) { showNotification('Failed to remove vote', 'error'); }
    } else {
      console.log(`[Vote] User Votes: ${userVotes.size} / ${maxVotes} | Admin: ${isAdmin}`);
      if (userVotes.size >= maxVotes && !isAdmin) {
        showNotification(`You've run out of votes! You have already used your ${maxVotes} available votes. Remove a vote from another movie if you want to support this new proposal.`, 'warning');
        return;
      }
      try {
        await MovieService.addVote(user.id, movieId);
        const newVotes = new Set(userVotes);
        newVotes.add(movieId);
        store.setUserVotes(newVotes);
        const { allMovies } = store.getState();
        store.setState({ allMovies: allMovies.map(m => m.id === movieId ? { ...m, vote_count: (m.vote_count || 0) + 1 } : m) });
        if (btn) btn.classList.add('active');
        if (countEl) countEl.textContent = `${(movie.vote_count || 0) + 1} votes`;
      } catch (err) { showNotification('Failed to add vote', 'error'); }
    }
    updateAuthUI();
  };

  window.markAsSeen = async (movieId) => {
    if (!confirm('Mark this movie as SEEN?')) return;
    try {
      await MovieService.updateMovieData(movieId, { is_seen: true });
      showNotification('Movie marked as seen!', 'success');
      window.dispatchEvent(new CustomEvent('app:refresh'));
    } catch (e) { console.error('Error marking as seen:', e); }
  };

  window.unmarkAsSeen = async (movieId) => {
    const { isAdmin } = store.getState();
    if (!isAdmin) return;
    try {
      await MovieService.updateMovieData(movieId, { is_seen: false });
      showNotification('Movie moved back to proposals', 'success');
      window.dispatchEvent(new CustomEvent('app:refresh'));
    } catch (e) { showNotification('Failed to revert status', 'error'); }
  };

  window.rateMovie = async (movieId, rating) => {
    const { user, seenMovies } = store.getState();
    if (!user) return;
    const commentInput = document.getElementById(`comment-input-${movieId}`);
    const comment = commentInput ? commentInput.value : null;
    // BUG FIX: use service method instead of direct supabase call
    const { error } = await MovieService.upsertRating(user.id, movieId, parseInt(rating), comment)
      .then(() => ({ error: null }))
      .catch(err => ({ error: err }));
    if (error) { showNotification('Error saving rating', 'error'); return; }
    showNotification('Rating saved!', 'success');
    window.dispatchEvent(new CustomEvent('app:refresh'));
  };

  window.selectRating = (movieId, rating) => {
    const valLabel = document.getElementById(`rating-val-${movieId}`);
    if (valLabel) valLabel.textContent = rating;
    const container = document.querySelector(`[onmouseleave*="${movieId}"]`);
    if (container) container.setAttribute('onmouseleave', `window.resetStars('${movieId}', ${rating})`);
    window.resetStars(movieId, rating);
  };

  window.hoverStars = (movieId, count) => {
    const container = document.querySelector(`[onmouseleave*="${movieId}"]`);
    const stars = container?.querySelectorAll('.star-btn');
    const valLabel = document.getElementById(`rating-val-${movieId}`);
    if (valLabel) valLabel.textContent = `${count} / 10`;
    stars?.forEach((star, i) => { star.classList.toggle('star-filled', i < count); });
  };

  window.resetStars = (movieId, currentRating) => {
    const container = document.querySelector(`[onmouseleave*="${movieId}"]`);
    const stars = container?.querySelectorAll('.star-btn');
    const valLabel = document.getElementById(`rating-val-${movieId}`);
    if (valLabel) valLabel.textContent = `${currentRating || 0} / 10`;
    stars?.forEach((star, i) => { star.classList.toggle('star-filled', i < currentRating); });
  };
}
```

- [ ] Remove from `main.js`: all functions and `window.*` assignments now in MovieController. Also remove `let searchTimeout`, `syncLocalRating`, `updateCommunityAverage`, `renderActivityGrid`, `renderHomeAchievements`, `fetchRecentAchievementEvents`, `renderAchievementTimeline`, `calculateUserAchievements`, `calculateGlobalAchievementStats`.

- [ ] Add import to `main.js`:
```js
import {
  renderProposals, renderHistory, renderCemetery, renderTopVotedShowcase,
  enrichMovieData, renderHomeAchievements, fetchRecentAchievementEvents,
  handleMovieSearch, init as initMovies
} from './src/controllers/MovieController.js';
```

- [ ] Add `initMovies()` in `init()`.

- [ ] Run build
```bash
npm run build
```

- [ ] Manually test: propose a movie, vote, rate a seen movie, drop a movie.

- [ ] Commit
```bash
git add src/controllers/MovieController.js main.js
git commit -m "refactor: extract MovieController, fix enrichMovieData mutation and rateMovie direct call"
```

---

## Task 8: Slim down main.js + wire everything together

**Files:** `main.js`

At this point `main.js` should only have what isn't extracted yet. Final shape:

- [ ] Verify what's left in `main.js`. It should contain only:
  - All imports (controllers + utils + config + state)
  - Window property proxies (store bridge)
  - DOM element declarations
  - `createPreloaderController()`
  - `seedInitialLoadingState()`
  - `init()` — calls all controller `init()` functions, then loads data
  - `refreshData()` — orchestrator
  - `handleRouting()`
  - `setupEventListeners()`
  - `window.navigateTo`

- [ ] Fix Bug #1 (`Promise.allSettled` without error handling) in `init()`:
```js
// OLD:
Promise.allSettled([fetchGenreMap(), fetchProvidersMap(), fetchAppSettings()]);

// NEW:
Promise.allSettled([
  fetchGenreMap(),
  fetchProvidersMap(),
  fetchAppSettings()
]).then(results => {
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      const names = ['fetchGenreMap', 'fetchProvidersMap', 'fetchAppSettings'];
      console.error(`[Init] ${names[i]} failed:`, result.reason);
    }
  });
});
```

- [ ] Fix Bug #5 (deep-link setTimeout) — move session deep-link resolution to end of `refreshData()`:
```js
// In refreshData(), at the very end (after all data is loaded), add:
const urlParams = new URLSearchParams(window.location.search);
const sessionId = urlParams.get('session');
if (sessionId) {
  window.viewSessionDetails(sessionId);
}
```
Remove the `setTimeout(() => window.viewSessionDetails(sessionId), 1200)` from `checkUser` in AuthController.

- [ ] Add `app:refresh` event listener in `init()`:
```js
window.addEventListener('app:refresh', (e) => refreshData(e.detail || {}));
```

- [ ] Run build and check line count
```bash
npm run build && wc -l main.js
```
Expected: under 200 lines.

- [ ] Run full test suite
```bash
npm test
```
Expected: all tests pass.

- [ ] Commit
```bash
git add main.js
git commit -m "refactor: slim main.js to orchestrator, fix Promise.allSettled handling, fix deep-link timing"
```

---

## Task 9: Final verification

- [ ] Run full build + tests
```bash
npm run build && npm test
```

- [ ] Manual smoke test checklist (open `npm run dev` in browser):
  - [ ] App loads without errors in console
  - [ ] Login/logout works
  - [ ] Proposals render (lazy and non-lazy)
  - [ ] Voting a movie works and counter updates
  - [ ] Proposing a movie from search works
  - [ ] Drop/rescue a movie works
  - [ ] Sessions tab renders
  - [ ] Session modal opens and shows details
  - [ ] Rating a seen movie works
  - [ ] Admin panel accessible (admin account): user list, settings, sessions
  - [ ] Explore search returns results
  - [ ] Ranking page renders
  - [ ] Profile page renders with achievements

- [ ] Verify `main.js` is under 200 lines:
```bash
wc -l main.js
```

- [ ] Final commit
```bash
git add -A
git commit -m "refactor: domain controller refactor complete — main.js under 200 lines, 7 bugs fixed, vitest added"
```

---

## Bug fix summary

| # | Fixed in | How |
|---|----------|-----|
| 1 | Task 8 | `Promise.allSettled` result logged per-entry |
| 2 | Task 7 | `enrichMovieData` uses local copies + batch `setState` |
| 3 | Task 7 | `droppedMovies` conflict resolved — local var renamed, no shadowing |
| 4 | Task 1 | Duplicate `ACHIEVEMENT_LIST` import removed |
| 5 | Task 8 | Deep-link resolved at end of `refreshData()`, no setTimeout |
| 6 | Task 1 | Redundant `filePath` variable removed in `sessions.js` |
| 7 | Task 1 | `counter.js` and `check_supabase.js` deleted |

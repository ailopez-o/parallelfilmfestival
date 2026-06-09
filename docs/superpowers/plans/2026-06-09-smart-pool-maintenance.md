# Smart Pool Maintenance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the all-or-nothing movie culling with a softer bottom-50% algorithm, and provide a one-time SQL script to restore the cemetery to a clean baseline.

**Architecture:** Two pure helper functions (`computeActivityScore`, `selectBottomHalf`) are exported from `src/api/admin.js` and unit-tested. `AdminService.cleanupInactiveMovies()` is rewritten to use them. `AdminController` gets an updated notification message. A standalone SQL script handles the one-time rescue.

**Tech Stack:** Vanilla JS, Supabase JS v2, Vitest 2 + jsdom

---

## Files created / modified

| Action | Path |
|--------|------|
| Create | `scratch/rescue-cemetery.sql` |
| Modify | `src/api/admin.js` |
| Modify | `src/controllers/AdminController.js` |
| Create | `tests/api/AdminService.test.js` |

---

## Task 0: SQL rescue script

**Files:** `scratch/rescue-cemetery.sql`

- [ ] Create `scratch/rescue-cemetery.sql` with this exact content:

```sql
-- One-time rescue: restore top 50% of cemetery movies (by vote count) to active proposals.
-- Run once in Supabase Dashboard SQL editor.
WITH vote_counts AS (
  SELECT movie_id, COUNT(*) AS vote_count
  FROM votes
  GROUP BY movie_id
),
cemetery_with_votes AS (
  SELECT m.id, COALESCE(vc.vote_count, 0) AS vote_count
  FROM movies m
  LEFT JOIN vote_counts vc ON vc.movie_id = m.id
  WHERE m.is_dropped = true
    AND m.is_seen  = false
    AND COALESCE(vc.vote_count, 0) > 0
),
ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (ORDER BY vote_count DESC) AS rn,
    COUNT(*)     OVER ()                          AS total
  FROM cemetery_with_votes
)
UPDATE movies
SET is_dropped = false
WHERE id IN (
  SELECT id FROM ranked WHERE rn <= CEIL(total::float / 2)
);
```

- [ ] Commit

```bash
git add scratch/rescue-cemetery.sql
git commit -m "chore: add one-time cemetery rescue SQL script"
```

---

## Task 1: Pure helper functions + tests (TDD)

**Files:** `src/api/admin.js`, `tests/api/AdminService.test.js`

### Step 1 — Write failing tests

- [ ] Create `tests/api/AdminService.test.js`:

```js
import { describe, test, expect } from 'vitest';
import { computeActivityScore, selectBottomHalf } from '../../src/api/admin.js';

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
```

- [ ] Run tests — expect FAIL (functions not exported yet):

```bash
npm test tests/api/AdminService.test.js
```

Expected output: `Cannot find module` or similar import error.

### Step 2 — Export the two pure functions from `src/api/admin.js`

- [ ] Add these two exports directly above the `export const AdminService` line in `src/api/admin.js`:

```js
export function computeActivityScore(totalVotes, recentVotes) {
  return totalVotes * (recentVotes > 0 ? 2 : 1);
}

export function selectBottomHalf(movies) {
  const sorted = [...movies].sort((a, b) => a.score - b.score);
  const cullCount = Math.floor(sorted.length / 2);
  return sorted.slice(0, cullCount);
}
```

- [ ] Run tests — expect PASS:

```bash
npm test tests/api/AdminService.test.js
```

Expected: `9 tests passed`

- [ ] Commit:

```bash
git add src/api/admin.js tests/api/AdminService.test.js
git commit -m "feat: add computeActivityScore and selectBottomHalf helpers with tests"
```

---

## Task 2: Rewrite `cleanupInactiveMovies`

**Files:** `src/api/admin.js`

- [ ] Replace the body of `AdminService.cleanupInactiveMovies()` in `src/api/admin.js`. Find the current method (starts after `async cleanupInactiveMovies() {`, ends before the next method comment) and replace it entirely:

```js
async cleanupInactiveMovies() {
  const fifteenDaysAgo = new Date();
  fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);
  const thresholdIso = fifteenDaysAgo.toISOString();

  // Candidates: proposed movies older than 15 days
  const { data: candidates, error: fetchErr } = await supabase
    .from('movies')
    .select('id, title, created_at')
    .eq('is_dropped', false)
    .eq('is_seen', false)
    .lt('created_at', thresholdIso);

  if (fetchErr) throw fetchErr;
  if (!candidates || candidates.length === 0) return { cleanedCount: 0 };

  const candidateIds = candidates.map(m => m.id);

  // All votes ever cast for these candidates
  const { data: allVotes, error: allVotesErr } = await supabase
    .from('votes')
    .select('movie_id')
    .in('movie_id', candidateIds);

  if (allVotesErr) throw allVotesErr;

  // Votes cast in the last 15 days
  const { data: recentVoteData, error: recentVotesErr } = await supabase
    .from('votes')
    .select('movie_id')
    .in('movie_id', candidateIds)
    .gte('created_at', thresholdIso);

  if (recentVotesErr) throw recentVotesErr;

  const totalByMovie = new Map();
  const recentByMovie = new Map();
  (allVotes || []).forEach(v => {
    totalByMovie.set(v.movie_id, (totalByMovie.get(v.movie_id) || 0) + 1);
  });
  (recentVoteData || []).forEach(v => {
    recentByMovie.set(v.movie_id, (recentByMovie.get(v.movie_id) || 0) + 1);
  });

  const scored = candidates.map(m => ({
    ...m,
    score: computeActivityScore(
      totalByMovie.get(m.id) || 0,
      recentByMovie.get(m.id) || 0
    )
  }));

  const toDrop = selectBottomHalf(scored);
  if (toDrop.length === 0) return { cleanedCount: 0 };

  const ids = toDrop.map(m => m.id);

  const { error: updateErr } = await supabase
    .from('movies')
    .update({ is_dropped: true })
    .in('id', ids);

  if (updateErr) throw updateErr;

  // Free up user vote slots (DB triggers handle participation logs)
  await supabase.from('votes').delete().in('movie_id', ids);

  return { cleanedCount: toDrop.length };
},
```

- [ ] Run full test suite to confirm no regressions:

```bash
npm test
```

Expected: all existing tests still pass + 9 new tests pass.

- [ ] Run build:

```bash
npm run build
```

Expected: `✓ built` with no errors.

- [ ] Commit:

```bash
git add src/api/admin.js
git commit -m "feat: replace all-or-nothing cull with bottom-50% activity scoring"
```

---

## Task 3: Update notification message in AdminController

**Files:** `src/controllers/AdminController.js`

- [ ] Find this line in `src/controllers/AdminController.js`:

```js
if (!silent) showNotification(`Cleaned up ${cleanedCount} inactive movies`, 'success');
```

Replace with:

```js
if (!silent) showNotification(`Sent ${cleanedCount} movies to cemetery (bottom 50% by activity)`, 'success');
```

- [ ] Run build:

```bash
npm run build
```

Expected: `✓ built` with no errors.

- [ ] Commit:

```bash
git add src/controllers/AdminController.js
git commit -m "chore: update cull notification message to reflect new algorithm"
```

---

## Task 4: Final verification

- [ ] Run full test suite:

```bash
npm test
```

Expected: all tests pass (minimum 9 new + 17 existing = 26 total).

- [ ] Manual smoke test in browser (`npm run dev`):
  - Log in as admin
  - Open Admin panel → confirm no console errors
  - Click the "Mantenimiento" button
  - Verify toast shows the new message format
  - Verify `app:refresh` fires and movie grid updates

- [ ] Commit plan + spec to repo:

```bash
git add docs/
git commit -m "docs: add smart pool maintenance plan and spec"
```

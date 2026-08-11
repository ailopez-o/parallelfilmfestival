# Smart Pool Maintenance — Design Spec

**Date:** 2026-06-09
**Branch:** feature/smart-pool-maintenance
**Status:** Approved

---

## Problem

The existing `cleanupInactiveMovies` function drops **all** proposed movies with no vote activity in 15 days. This empties the pool too aggressively. Additionally, movies already in the cemetery that accumulated votes before being dropped are never recovered, leaving legitimate community interest buried.

---

## Solution

Two independent interventions:

1. **One-time SQL rescue** — restore the top 50% of cemetery movies (by historical vote count) to the active proposal pool, establishing a clean baseline before the new algorithm takes effect.
2. **New culling algorithm** — replace the all-or-nothing drop with a softer cull: among inactive proposals, only the bottom 50% by interaction score are sent to the cemetery.

---

## Part 1 — One-Time SQL Rescue Script

**File:** `scratch/rescue-cemetery.sql`
**Execution:** Run once in Supabase Dashboard SQL editor.

### Logic

- Selects all cemetery movies (`is_dropped = true, is_seen = false`) that have at least 1 vote ever.
- Ranks them by total vote count descending.
- Rescues the top 50% (rounded up) by setting `is_dropped = false`.
- No time filter — applies to the entire cemetery history.
- Idempotent: safe to re-run.

### SQL

```sql
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

---

## Part 2 — New Culling Algorithm

**Files modified:**
- `src/api/admin.js` — `AdminService.cleanupInactiveMovies()`
- `src/controllers/AdminController.js` — notification message update only

### Interaction Score Formula

```
score = total_votes × (recent_votes > 0 ? 2 : 1)
```

- `total_votes`: all votes ever cast for the movie
- `recent_votes`: votes cast in the last 15 days
- A movie touched recently doubles its score, protecting it from culling even if its historical vote count is low.

### Algorithm Steps

1. Fetch all proposed movies (`is_dropped = false, is_seen = false`) with `created_at` older than 15 days.
2. For each candidate, query the `votes` table to compute:
   - `total_votes`: `COUNT(*)` for that movie
   - `recent_votes`: `COUNT(*)` where `created_at >= now - 15 days`
3. Compute `score` per movie using the formula above.
4. Sort candidates by score ascending (lowest first).
5. Take the bottom 50% (floor rounding — when in doubt, cull fewer).
6. Batch-update those movies to `is_dropped = true`.

### Return value

```js
{ cleanedCount: N }
```

Same shape as before — `AdminController` reads this and shows the notification.

### Notification message

```
"Sent N movies to cemetery (bottom 50% by activity)"
```

### No HTML changes

The existing button in the admin panel already calls `window.cleanupInactiveMovies()`. No changes needed.

---

## Out of Scope

- Configurable threshold (15 days, 50%) — hardcoded for now, can be added later via app settings.
- Dry-run / preview mode — not needed for this iteration.
- Automatic scheduled execution — button remains manual.

---

## Files Changed

| Action | File |
|--------|------|
| Create | `scratch/rescue-cemetery.sql` |
| Modify | `src/api/admin.js` |
| Modify | `src/controllers/AdminController.js` |

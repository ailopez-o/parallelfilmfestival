# Cemetery Vote Preservation — Design Spec

**Date:** 2026-06-09
**Branch:** feature/smart-pool-maintenance
**Status:** Approved

---

## Problem

`cleanupInactiveMovies` deletes votes from the `votes` table when it sends movies to the cemetery. This is incorrect: the cemetery is a soft state, not a hard delete. Votes represent community history and should survive indefinitely unless the movie is permanently deleted. Additionally, cemetery cards currently show no vote count, so there is no visibility into past popularity.

---

## Solution

Two focused changes:

### 1. Preserve votes on cemetery drop (`src/api/admin.js`)

Remove the vote deletion line from `cleanupInactiveMovies`:

```js
// DELETE THIS LINE:
await supabase.from('votes').delete().in('movie_id', ids);
```

Votes now survive the drop. They are only removed when the movie is permanently deleted (Supabase CASCADE on the `votes.movie_id → movies.id` foreign key handles this automatically).

**Side effects (all positive):**
- Rescued movies recover their full vote history.
- The SQL rescue script (`scratch/rescue-cemetery.sql`) uses `vote_count` which now always reflects the true historical count.
- Users who voted for a now-cemetery movie retain their vote slots freed implicitly since the movie is no longer active in the proposal pool.

### 2. Show vote count on cemetery cards (`src/components/MovieCard.js`)

Add `vote_count` display to the `cemetery-status` section:

```html
<div class="cemetery-status">
  <i data-lucide="skull"></i>
  <span>Dropped Film</span>
  <span class="vote-count">${movie.vote_count || 0} votes</span>
</div>
```

`vote_count` is already present on every movie object (fetched via `select('*')` in `fetchAllMovies`). No additional API calls needed.

---

## Out of Scope

- Styling of the vote count badge (use existing `.vote-count` class).
- Showing who voted (names, avatars) — just the count.
- Any changes to manual `dropMovie` flow (already correct — never deleted votes).

---

## Files Changed

| Action | File |
|--------|------|
| Modify | `src/api/admin.js` — remove 1 line |
| Modify | `src/components/MovieCard.js` — add 1 line |

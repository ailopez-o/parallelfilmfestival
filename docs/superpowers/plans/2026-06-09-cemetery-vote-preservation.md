# Cemetery Vote Preservation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop deleting votes when movies are sent to the cemetery, and show vote count on cemetery cards.

**Architecture:** Two isolated one-line changes. The cemetery becomes a pure soft-state: votes survive until explicit permanent deletion. `vote_count` on the movie object is already available — it just needs to be rendered in the cemetery card section.

**Tech Stack:** Vanilla JS, Vite 5, Supabase JS v2

---

## Files modified

| Action | File |
|--------|------|
| Modify | `src/api/admin.js` — remove 1 line from `cleanupInactiveMovies` |
| Modify | `src/components/MovieCard.js` — add 1 line to cemetery-status section |

---

## Task 1: Preserve votes on cemetery drop

**Files:** `src/api/admin.js`

- [ ] Open `src/api/admin.js`. Find `cleanupInactiveMovies`. At the bottom of the method, just before `return { cleanedCount: toDrop.length };`, find and **delete** this exact line:

```js
// Free up user vote slots (DB triggers handle participation logs)
await supabase.from('votes').delete().in('movie_id', ids);
```

Both the comment and the `await` line must be removed. The method should end like this after the change:

```js
  const { error: updateErr } = await supabase
    .from('movies')
    .update({ is_dropped: true })
    .in('id', ids);

  if (updateErr) throw updateErr;

  return { cleanedCount: toDrop.length };
},
```

- [ ] Run build to confirm no errors:

```bash
npm run build 2>&1 | tail -4
```

Expected: `✓ built in ...ms`

- [ ] Run full test suite:

```bash
npm test 2>&1 | tail -8
```

Expected: `27 passed (27)` — all existing tests still pass.

- [ ] Commit:

```bash
git add src/api/admin.js
git commit -m "fix: preserve votes when sending movies to cemetery"
```

---

## Task 2: Show vote count on cemetery cards

**Files:** `src/components/MovieCard.js`

- [ ] Open `src/components/MovieCard.js`. Find this block (around line 244):

```js
${context === "cemetery" ? `
  <div class="cemetery-status">
    <i data-lucide="skull"></i>
    <span>Dropped Film</span>
  </div>
` : ""}
```

Replace it with:

```js
${context === "cemetery" ? `
  <div class="cemetery-status">
    <i data-lucide="skull"></i>
    <span>Dropped Film</span>
    <span class="vote-count">${movie.vote_count || 0} votes</span>
  </div>
` : ""}
```

- [ ] Run build:

```bash
npm run build 2>&1 | tail -4
```

Expected: `✓ built in ...ms`

- [ ] Run full test suite:

```bash
npm test 2>&1 | tail -8
```

Expected: `27 passed (27)`

- [ ] Commit:

```bash
git add src/components/MovieCard.js
git commit -m "feat: show vote count on cemetery cards"
```

---

## Task 3: Final verification

- [ ] Run full test suite + build one last time:

```bash
npm test && npm run build 2>&1 | tail -4
```

Expected: all 27 tests pass, `✓ built`.

- [ ] Commit plan + spec:

```bash
git add docs/
git commit -m "docs: add cemetery vote preservation plan and spec"
```

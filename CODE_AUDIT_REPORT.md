# Code Audit Report — Paral·lel Film Festival

Date: 2026-04-29
Scope: Full repository review (frontend SPA, API/service layer, Supabase edge functions, config/docs)

## Executive summary

The project has a solid modular baseline (controller + state + service separation), but there are several high-priority risks around security boundaries, error handling consistency, and maintainability drift between architecture docs and implementation. The app currently builds successfully, but robustness in production can be improved materially with a focused hardening sprint.

## What I reviewed

- Application entrypoint and orchestration (`main.js`)
- Service layer (`src/api/*.js`)
- State management (`src/state/store.js`)
- Configuration and constants (`src/config/*.js`)
- Edge functions (`supabase/functions/*`)
- Project scripts/docs (`package.json`, `README.md`, `ARCHITECTURE.md`)

---

## Findings (prioritized)

## P0 — Critical

1. **No runtime validation for required Supabase env vars before creating client**  
   `createClient` is called directly with `import.meta.env` values and there is no fail-fast guard. If variables are missing/malformed, behavior can fail later in non-obvious ways.  
   **Where:** `src/config/supabase.js`.

2. **Potential privilege/control leakage through global mutable window bindings**  
   The code maps many state values onto `window` with both getters and setters (`isAdmin`, `user`, `MAX_*`, etc.). This makes accidental or malicious mutation from browser console/plugins easier, and blurs trust boundaries.  
   **Where:** `main.js` lines defining `Object.defineProperty(window, key, ...)` and `window.MAX_*` setters.

## P1 — High

3. **Mixed data-access pattern bypasses service layer consistency**  
   Architecture says controller avoids direct API calls, but `main.js` still performs direct Supabase reads/writes for profile logic. This weakens testability and maintainability.  
   **Where:** `main.js` user/profile checks and inserts around auth bootstrap.

4. **Missing error checks in settings update path**  
   `updateAppSettings` performs two updates with `Promise.all` but does not inspect/throw on returned errors, allowing silent partial failures.  
   **Where:** `src/api/admin.js` in `updateAppSettings`.

5. **Hardcoded region/provider assumptions reduce portability**  
   Provider map fetch uses hardcoded `watch_region: 'ES'`. If the app is used in other regions, results can be irrelevant.  
   **Where:** `main.js` provider fetch.

6. **Hardcoded Supabase storage public URL in social metadata**  
   A fixed project URL is embedded in code, coupling deployments to one Supabase project and risking broken previews across environments.  
   **Where:** `src/api/admin.js` (`imageUrl` generation).

## P2 — Medium

7. **State store exposes mutable references and lacks immutability protections**  
   `getState()` returns raw object references. Consumers can mutate nested structures directly without `setState`, causing side effects and debugging complexity.  
   **Where:** `src/state/store.js`.

8. **Race-prone read-then-write logic for ratings upsert**  
   `upsertRating` does SELECT then UPDATE/INSERT in two steps. Under concurrency, duplicate/ordering issues are possible unless database constraints or RPC upsert semantics enforce integrity.  
   **Where:** `src/api/movies.js`.

9. **Aggressive data fetching patterns may not scale**  
   Inactive cleanup fetches all candidate movies and all votes, then filters in memory. This can become expensive with growth.  
   **Where:** `src/api/admin.js` `cleanupInactiveMovies`.

10. **Documentation drift vs implementation**  
   Architecture doc claims “zero direct API calls” in controller, which is not currently true. This mismatch can mislead contributors.  
   **Where:** `ARCHITECTURE.md` vs `main.js`.

## P3 — Low

11. **No lint/test scripts in package scripts**  
   `package.json` only includes `dev/build/preview`; no standard `test`, `lint`, or `typecheck` commands for CI quality gates.

12. **Minor naming typo in package name**  
   `paralellfilmfestival` likely intended `parallelfilmfestival` (double “l” placement). Low risk but can cause discoverability/confusion.

---

## Recommendations roadmap

### Sprint 1 (security/reliability hardening)
- Add strict env validation in `src/config/supabase.js` (throw with actionable message when missing).
- Remove writable `window` state setters for privileged flags (`isAdmin`, `user`) and config; expose explicit controller methods instead.
- Fix `AdminService.updateAppSettings` to validate each update response and handle partial failure safely.
- Replace hardcoded Supabase URL in social metadata with derived storage public URL from config.

### Sprint 2 (architecture & data integrity)
- Refactor direct Supabase profile operations in `main.js` into `AuthService` methods.
- Convert rating flow to DB-native upsert (`onConflict`) + unique constraint (`user_id`, `movie_id`).
- Move inactive cleanup logic to SQL/RPC to avoid app-side O(n) memory scans.
- Make `watch_region` configurable (env or per-user locale).

### Sprint 3 (engineering quality)
- Add ESLint + basic unit tests for service layer, plus smoke integration checks.
- Add CI pipeline with `npm run lint`, `npm run build`, tests.
- Update `ARCHITECTURE.md` to match real implementation.

---

## Verification executed

- Production build completed successfully (`npm run build`).


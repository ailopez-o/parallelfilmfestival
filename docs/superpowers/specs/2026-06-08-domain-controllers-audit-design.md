# Spec: Auditoría y Refactor — Domain Controllers

**Fecha:** 2026-06-08  
**Rama:** `refactor/domain-controllers`  
**Alcance:** Reestructuración completa de `main.js` en controladores por dominio + corrección de bugs identificados. Sin cambios de funcionalidad.

---

## Contexto

El proyecto es una SPA vanilla JS (Vite + Supabase) con una arquitectura modular en `src/` que funciona bien en la capa de servicios y componentes, pero cuyo punto de entrada `main.js` ha crecido hasta **2796 líneas** mezclando lógica de negocio, renderizado, gestión de eventos y orquestación. Esto dificulta el mantenimiento, el testing y la localización de bugs.

Los módulos existentes (`src/api/`, `src/components/`, `src/views/`, `src/utils/`, `src/state/`, `src/config/`) están bien definidos y **no se modifican**.

---

## Objetivos

1. Romper `main.js` en controladores por dominio, cada uno con una responsabilidad clara.
2. Corregir los bugs identificados durante el proceso de extracción.
3. Añadir Vitest como framework de testing con cobertura mínima por fase.
4. Dejar `main.js` como orquestador mínimo (~100-150 líneas).

---

## Nueva estructura de archivos

```
src/
  controllers/
    AuthController.js
    MovieController.js
    SessionController.js
    RankingController.js
    ExploreController.js
    AdminController.js

main.js                  ← orquestador mínimo
```

Los módulos existentes en `src/api/`, `src/components/`, `src/views/`, `src/utils/`, `src/state/` y `src/config/` no se tocan.

---

## Responsabilidades por controlador

### AuthController
- `checkUser(session?)` — resolución del usuario actual y perfil
- `setAuthContext(user, profile, isAdmin)` — escritura al store
- `updateAuthUI()` — actualización de la UI según estado de auth
- Handlers: login con email, signup, login con Google, logout, edición de perfil

### MovieController
- `renderProposals(options)` — render del grid de propuestas con lazy loading
- `renderHistory()` — render de películas vistas
- `renderCemetery(movies)` — render del cementerio
- `renderTopVotedShowcase()` — showcase de las más votadas
- `enrichMovieData(movies, options)` — enriquecimiento TMDB (corrigiendo mutación directa)
- Handlers: `proposeMovie`, `deleteMovie`, `dropMovie`, `rescueMovie`, `toggleVote`, `submitRating`
- Gestión del estado lazy render (token, observer, fallback timer)

### SessionController
- `fetchSessions()` — carga de sesiones desde el servicio
- `renderSessions()` — render del grid de sesiones
- `renderNextSessionHero()` — render del hero de próxima sesión
- `viewSessionDetails(sessionId)` — apertura del modal de sesión
- `updateAdminSessions()` — actualización del panel de admin de sesiones
- Handlers: asistencia, fotos, comentarios, signup, creación/edición de sesión

### RankingController
- `buildUserScoreStatsMap(profiles, votes, movies, ratings, attendance, sessions)` — cálculo de puntuación
- `buildUserPointsAudit(profile, stats, context)` — desglose de puntos por usuario
- `getAchievementPointsForUser(stats, sessions)` — puntos por logros
- `getAchievementBreakdownForUser(stats, sessions)` — lista de logros conseguidos
- `getMaxAttendanceStreak(attendedIds, sessions)` — racha máxima de asistencia
- `updateGlobalRanking()` — render del ranking global

### ExploreController
- `fetchGenreMap()` — carga y caché del mapa de géneros TMDB
- `fetchProvidersMap()` — carga y caché del mapa de proveedores TMDB
- `exploreMovies()` — búsqueda por filtros en TMDB
- Handler de AI search

### AdminController
- `fetchAppSettings()` — carga de configuración desde la BBDD
- `loadAppSettings()` — carga de valores en el formulario del panel
- `saveAppSettings()` — guardado de cambios de configuración
- Render del panel admin, lista de usuarios, log de participación

---

## Bugs a corregir

| # | Bug | Dónde | Corrección |
|---|-----|-------|------------|
| 1 | `Promise.allSettled` sin `await` en `init()` — las promesas se lanzan en fire-and-forget, los fallos se pierden sin ningún handler | `main.js` | Conservar la ejecución en paralelo con `checkUser()`, pero capturar el resultado de `allSettled` para loguear fallos individuales |
| 2 | Mutación directa del store en `enrichMovieData` (`movie.vote_average = ...`) | `main.js` | Usar `store.setState` o trabajar con copia local, no con referencias del store |
| 3 | Shadowing silencioso de `droppedMovies` (`const` local vs. propiedad del store) | `main.js` `refreshData()` | Renombrar la variable local a `localDroppedMovies` |
| 4 | Import duplicado de `ACHIEVEMENT_LIST` | `main.js` líneas 3 y 18 | Eliminar el import duplicado |
| 5 | Deep-linking con `setTimeout(..., 1200)` arbitrario — si la carga tarda más de 1.2s el modal no se abre | `main.js` `checkUser()` | Leer el parámetro `?session=` al final de `refreshData()`, después de que los datos estén disponibles, eliminando el timeout |
| 6 | `filePath = \`${fileName}\`` redundante | `src/api/sessions.js` | Eliminar la variable redundante, usar `fileName` directamente |
| 7 | Archivos huérfanos `counter.js` y `check_supabase.js` en raíz | raíz del proyecto | Eliminar ambos archivos |

---

## Testing por fase

Se añade **Vitest** como devDependency. Se configura en `vite.config.js`.

| Fase | Controlador | Tipo de test |
|------|-------------|--------------|
| 1 | RankingController | Tests unitarios: `buildUserScoreStatsMap`, `getMaxAttendanceStreak`, `getAchievementBreakdownForUser` |
| 2 | ExploreController | Tests unitarios: parsing de géneros y providers |
| 3 | AdminController | Smoke: `npm run build` pasa + comprobación manual del panel |
| 4 | AuthController | Smoke: `npm run build` pasa + flujo de login manual |
| 5 | SessionController | Smoke: `npm run build` pasa + render de sesiones manual |
| 6 | MovieController | Smoke: `npm run build` pasa + render de proposals manual |

Cada fase **debe pasar su test antes de iniciar la siguiente**.

---

## Estrategia de rama

```bash
git checkout -b refactor/domain-controllers
```

El orden de extracción va de menor a mayor riesgo (lógica pura primero, renderizado al final).  
Commit al final de cada fase con el build y tests pasando.

---

## Criterios de éxito

- `main.js` queda por debajo de 200 líneas
- Cada controlador tiene responsabilidad única y clara
- `npm run build` pasa sin errores en cada fase
- Los 7 bugs listados están corregidos
- Vitest instalado con al menos los tests unitarios de RankingController y ExploreController pasando
- La funcionalidad de la app es idéntica a la rama `main`

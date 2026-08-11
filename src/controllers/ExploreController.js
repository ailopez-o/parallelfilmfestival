import { supabase } from '../config/supabase.js';
import { TMDBService } from '../api/index.js';
import { store } from '../state/store.js';
import { ExploreView } from '../views/index.js';
import { normalize } from '../utils/index.js';
import { createMovieCardHTML } from '../components/index.js';

// Triggers that indicate the user wants current/real-time results (web search)
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
  const exploreGenreSelect = document.getElementById('exploreGenre');
  try {
    const data = await TMDBService.invokeTMDBCall('/genre/movie/list');
    if (!data.genres) return;
    const nextGenreMap = buildGenreMap(data.genres);
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
    const topProviders = data.results.slice(0, 50);
    const nextProviderMap = buildProviderMap(topProviders);
    select.innerHTML = '<option value="">Any Platform</option>';
    topProviders.forEach(p => {
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
  const query = document.getElementById('exploreTitle').value.trim();
  const directorName = document.getElementById('exploreDirector').value.trim();
  const actorName = document.getElementById('exploreActor').value.trim();
  const exploreGenreSelect = document.getElementById('exploreGenre');
  const genreId = exploreGenreSelect ? exploreGenreSelect.value : '';
  const yearFrom = document.getElementById('exploreYearFrom').value;
  const yearTo = document.getElementById('exploreYearTo').value;
  const limitValue = document.getElementById('exploreLimit').value;
  const sortValue = document.getElementById('exploreSort').value;
  const providerId = document.getElementById('exploreProvider').value;
  const limit = parseInt(limitValue) || 20;

  const exploreGrid = document.getElementById('exploreGrid');
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

    // 1. Resolve Person IDs
    if (directorName || actorName) {
      const [directorRes, actorRes] = await Promise.all([
        directorName ? TMDBService.invokeTMDBCall('/search/person', { query: directorName }) : null,
        actorName ? TMDBService.invokeTMDBCall('/search/person', { query: actorName }) : null
      ]);

      if (directorRes?.results?.length > 0) {
        // Prioritize people in the 'Directing' department
        let directors = directorRes.results.filter(p => p.known_for_department === 'Directing');
        let bestDirector = directors.length > 0 ? directors : directorRes.results;
        directorId = bestDirector.sort((a, b) => b.popularity - a.popularity)[0].id;
        discoverParams.with_crew = directorId;
      }
      if (actorRes?.results?.length > 0) {
        // Prioritize people in the 'Acting' department
        let actors = actorRes.results.filter(p => p.known_for_department === 'Acting');
        let bestActor = actors.length > 0 ? actors : actorRes.results;
        actorId = bestActor.sort((a, b) => b.popularity - a.popularity)[0].id;
        discoverParams.with_cast = actorId;
      }
    }

    // 2. Fetch Results
    if (query && !directorId && !actorId) {
      // Title search only
      const pagesToFetch = Math.max(1, Math.ceil(limit / 20));
      const pages = await Promise.all(
        Array.from({ length: pagesToFetch }, (_, i) =>
          TMDBService.invokeTMDBCall('/search/movie', { query, page: i + 1 })
        )
      );
      results = pages.flatMap(p => p.results || []);
    } else {
      // Discover (supports combinations of Director, Actor, Genre, Year, Provider)
      const pagesToFetch = Math.max(1, Math.min(5, Math.ceil(limit / 20)));
      const responses = await Promise.all(
        Array.from({ length: pagesToFetch }, (_, i) =>
          TMDBService.invokeTMDBCall('/discover/movie', { ...discoverParams, page: i + 1 })
        )
      );
      results = responses.flatMap(r => r.results || []);
    }

    // Secondary client-side title filter if Title + Person were provided
    if (query && (directorId || actorId)) {
      results = results.filter(m => normalize(m.title).includes(normalize(query)));
    }

    // 3. Final Enrichment & Detail Fetching (More resilient batching)
    const finalResults = results.slice(0, limit);
    const enriched = [];

    // Process in small chunks to avoid hanging the server
    for (let i = 0; i < finalResults.length; i += 5) {
      const chunk = finalResults.slice(i, i + 5);
      const chunkResults = await Promise.all(chunk.map(async movie => {
        try {
          const details = await TMDBService.invokeTMDBCall(`/movie/${movie.id}`, {
            append_to_response: 'videos,watch/providers,credits'
          });

          const directors = details.credits?.crew
            ?.filter(p => p.job === 'Director')
            .map(d => d.name) || [];
          const movieGenres = details.genres?.map(g => g.name) || [];
          const trailer = details.videos?.results?.find(v => v.type === 'Trailer' && v.site === 'YouTube');

          return {
            ...movie,
            ...details,
            director: directors.join(', ') || 'Unknown Director',
            genres: movieGenres,
            synopsis: details.overview,
            trailer_url: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
            watch_providers: details['watch/providers']?.results?.ES
          };
        } catch (e) {
          console.warn(`[Explore] Failed to enrich ${movie.title}, using basic data.`, e);
          return { ...movie, director: 'Unknown', genres: [], synopsis: movie.overview };
        }
      }));
      enriched.push(...chunkResults);
      // Give the browser a tiny breath
      await new Promise(r => setTimeout(r, 10));
    }

    renderExploreResults(enriched);
  } catch (err) {
    console.error('Explore error:', err);
    exploreGrid.innerHTML = '<div class="empty-state">Discovery session failed. Try adjusting your filters.</div>';
  } finally {
    // If it's still showing the loader, clean it up
    if (exploreGrid.innerHTML.includes('loading-state')) {
      exploreGrid.innerHTML = '<div class="empty-state">Connection timeout. Please try again.</div>';
    }
  }
}

export async function fetchAIRecommendations() {
  const query = document.getElementById('aiSearchInput').value;
  if (!query) return;

  const apertureOverlay = document.getElementById('apertureOverlay');
  if (apertureOverlay) apertureOverlay.classList.add('active');

  const exploreGrid = document.getElementById('exploreGrid');
  // Clear previous results
  exploreGrid.innerHTML = '';

  const statusText = document.querySelector('.status-text');
  const controller = new AbortController();
  const renderedIds = new Set();
  const renderedTitles = new Set();

  const updateStatus = (msg) => {
    if (statusText) statusText.textContent = msg;
    console.log(`[AI Scout]: ${msg}`);
  };

  // Cancel Logic
  const cancelBtn = document.getElementById('cancelAISearch');
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      controller.abort();
      if (apertureOverlay) apertureOverlay.classList.remove('active');
      document.querySelector('.mode-tab[data-mode="manual"]').click();
    };
  }

  const { user, isAdmin, userVotes } = store.getState();

  try {
    const today = new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
    const useWeb = shouldUseWebSearch(query);

    const prompt = `Today is ${today}. You are the "Cinematic Bible", the world's most erudite and precise movie authority.
    Analyze the request and provide an extensive list of exactly 40-50 specific movie titles.
    ${useWeb ? "Use your WEB_SEARCH tool to verify recent data/winners." : "Provide results based on your extensive cinematic knowledge."}

    FORMAT: Return MANDATORY a JSON array of strings: ["Title 1", "Title 2", ..., "Title 50"]
    USER REQUEST: "${query}"`;

    updateStatus(useWeb ? "Activating Satellite Search..." : "Reasoning with Cinematic Bible...");

    // Call Secure AI Edge Function
    const { data: aiData, error: aiError } = await supabase.functions.invoke('ai-scout', {
      body: { query, useWeb }
    });

    if (aiError) throw new Error(`AI Scout Mission Failed: ${aiError.message}`);
    const titles = aiData.titles || [];

    updateStatus("Distilling cinematic knowledge...");
    if (apertureOverlay) apertureOverlay.classList.remove('active');

    // Process in chunks for immediate feedback
    const chunkSize = 5;
    for (let i = 0; i < titles.length; i += chunkSize) {
      if (controller.signal.aborted) break;

      const chunk = titles.slice(i, i + chunkSize);
      const chunkResults = await Promise.all(chunk.map(async t => {
        const title = typeof t === 'object' ? (t.title || t.name) : String(t);
        if (renderedTitles.has(title.toLowerCase())) return null;

        try {
          // 1. Search for ID via Proxy
          const searchData = await TMDBService.invokeTMDBCall('/search/movie', { query: title });
          const found = searchData.results?.[0];

          if (found && !renderedIds.has(found.id)) {
            // 2. Fetch Rich Details via Proxy
            const detailData = await TMDBService.invokeTMDBCall(`/movie/${found.id}`, {
              append_to_response: 'videos,watch/providers,credits'
            });

            renderedIds.add(detailData.id);
            renderedTitles.add(title.toLowerCase());

            const directors = detailData.credits?.crew?.filter(p => p.job === 'Director').map(d => d.name).join(', ') || 'Unknown';
            const genreNames = (detailData.genres || []).map(g => g.name);

            const trailer = detailData.videos?.results?.find(v => v.type === 'Trailer' && v.site === 'YouTube');
            const providers = detailData['watch/providers']?.results?.ES;

            return {
              ...detailData,
              director: directors,
              genres: genreNames,
              synopsis: detailData.overview,
              trailer_url: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
              watch_providers: providers,
              poster_path: detailData.poster_path,
              vote_average: detailData.vote_average,
              release_date: detailData.release_date
            };
          }
        } catch (e) { console.error('AI Detail Fetch Error:', e); return null; }
        return null;
      }));

      // Append valid results
      chunkResults.filter(Boolean).forEach(movie => {
        const div = document.createElement('div');
        div.innerHTML = createMovieCardHTML(movie, { context: 'explore', isAdmin, user, userVotes });
        const card = div.firstElementChild;
        exploreGrid.insertBefore(card, document.getElementById('scoutLoader'));
      });

      if (i === 0) {
        exploreGrid.innerHTML += `
          <div id="scoutLoader" class="scout-loader">
            <div class="scout-ring"></div>
            <div class="scout-loading-text">Discovery in progress...</div>
          </div>`;
      }
      if (window.lucide) window.lucide.createIcons();
    }

    const finalLoader = document.getElementById('scoutLoader');
    if (finalLoader) finalLoader.remove();

  } catch (err) {
    if (apertureOverlay) apertureOverlay.classList.remove('active');
    if (err.name === 'AbortError') return;

    exploreGrid.innerHTML = '';
    console.error('AI Scout error:', err);
    exploreGrid.innerHTML = `
      <div class="empty-state">
        <i data-lucide="alert-circle" style="width:48px; height:48px; color:#f87171; margin-bottom:1rem;"></i>
        <p>The AI Scout reached its limits.</p>
        <p style="font-size: 0.85rem; color: #94a3b8;">${err.message}</p>
        <button class="auth-btn" style="margin-top:1.5rem;" onclick="window.fetchAIRecommendations()">Retry Scout</button>
      </div>`;
    if (window.lucide) window.lucide.createIcons();
  }
}

export function renderExploreResults(results) {
  const exploreGrid = document.getElementById('exploreGrid');
  const { user, isAdmin, userVotes } = store.getState();
  exploreGrid.innerHTML = '';
  ExploreView.renderResults(results, exploreGrid, { isAdmin, user, userVotes });
  if (window.lucide) window.lucide.createIcons();
}

export function init() {
  window.fetchAIRecommendations = fetchAIRecommendations;

  document.getElementById('exploreSearchBtn').onclick = fetchExploreResults;
  document.getElementById('aiSearchBtn').onclick = fetchAIRecommendations;

  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelector('.mode-tab.active').classList.remove('active');
      tab.classList.add('active');
      const isAI = tab.dataset.mode === 'ai';
      document.getElementById('manualSearchPanel').classList.toggle('page-hidden', isAI);
      document.getElementById('aiSearchPanel').classList.toggle('page-hidden', !isAI);
      document.getElementById('exploreGrid').innerHTML = '<div class="empty-state">Start searching to discover films.</div>';
    };
  });

  const exploreInputs = [
    document.getElementById('exploreTitle'),
    document.getElementById('exploreDirector'),
    document.getElementById('exploreGenre'),
    document.getElementById('exploreYearFrom'),
    document.getElementById('exploreYearTo'),
    document.getElementById('exploreLimit'),
    document.getElementById('exploreActor'),
    document.getElementById('exploreSort'),
    document.getElementById('exploreProvider')
  ];
  document.getElementById('exploreClearBtn').onclick = () => {
    exploreInputs.forEach(input => {
      if (input.id === 'exploreLimit') {
        input.value = '20';
      } else if (input.id === 'exploreSort') {
        input.value = 'popularity.desc';
      } else {
        input.value = '';
      }
    });
    document.getElementById('exploreGrid').innerHTML = '<div class="empty-state">Start searching to discover films.</div>';
  };
}

import { supabase } from '../config/supabase.js';
import { MovieService, TMDBService, AchievementService } from '../api/index.js';
import { computeActivityScoresForMovies } from '../api/admin.js';
import { store } from '../state/store.js';
import { HomeView, ProfileView, AdminView } from '../views/index.js';
import { FALLBACK_IMAGE, ACHIEVEMENT_LIST } from '../config/constants.js';
import { showNotification, escapeHtml, formatScore } from '../utils/index.js';
import { createMovieCardHTML } from '../components/index.js';
import { updateAuthUI } from './AuthController.js';

// Lazy render state (module-level)
let proposalLazyRenderToken = 0;
let proposalLazyObserver = null;
let proposalLazyFallbackTimer = null;

const INITIAL_PROPOSAL_CHUNK_SIZE = 10;
const INITIAL_PROPOSAL_FALLBACK_MS = 2200;
const INITIAL_PROPOSAL_ROOT_MARGIN = '900px 0px';

// Search state
let searchTimeout;

// ─── Lazy Render Helpers ──────────────────────────────────────────────────────

function clearProposalLazyRenderState() {
  proposalLazyRenderToken += 1;

  if (proposalLazyObserver) {
    proposalLazyObserver.disconnect();
    proposalLazyObserver = null;
  }

  if (proposalLazyFallbackTimer) {
    window.clearTimeout(proposalLazyFallbackTimer);
    proposalLazyFallbackTimer = null;
  }
}

function buildProposalChunkHTML(movies) {
  const { isAdmin, user, userVotes } = store.getState();
  return (movies || []).map((movie) => {
    const isOwner = user && movie.proposed_by === user.id;
    return createMovieCardHTML(movie, {
      context: 'proposal',
      showDelete: isOwner || isAdmin,
      isAdmin,
      user,
      userVotes
    });
  }).join('');
}

function queueProposalChunkRender(renderFn) {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(renderFn, { timeout: 120 });
    return;
  }
  window.setTimeout(renderFn, 16);
}

// ─── Render Functions ─────────────────────────────────────────────────────────

export function renderProposals(options = {}) {
  const { lazy = false } = options;
  const { proposedMovies, isAdmin, user, userVotes } = store.getState();

  const movieGrid = document.getElementById('movieGrid');
  if (!movieGrid) return;

  if (!lazy) {
    clearProposalLazyRenderState();
    HomeView.renderProposals(proposedMovies, movieGrid, { isAdmin, user, userVotes });
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  if (!proposedMovies.length) {
    clearProposalLazyRenderState();
    HomeView.renderProposals(proposedMovies, movieGrid, { isAdmin, user, userVotes });
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
    if (startIndex === 0) {
      movieGrid.innerHTML = buildProposalChunkHTML(chunk);
    } else {
      movieGrid.insertAdjacentHTML('beforeend', buildProposalChunkHTML(chunk));
    }

    if (window.lucide) window.lucide.createIcons();

    const nextIndex = startIndex + INITIAL_PROPOSAL_CHUNK_SIZE;
    if (nextIndex < proposedMovies.length) {
      queueProposalChunkRender(() => renderChunks(nextIndex));
    }
  };

  const startLazyRender = () => {
    if (hasStarted || token !== proposalLazyRenderToken) return;
    hasStarted = true;

    if (proposalLazyObserver) {
      proposalLazyObserver.disconnect();
      proposalLazyObserver = null;
    }

    if (proposalLazyFallbackTimer) {
      window.clearTimeout(proposalLazyFallbackTimer);
      proposalLazyFallbackTimer = null;
    }

    renderChunks(0);
  };

  proposalLazyFallbackTimer = window.setTimeout(startLazyRender, INITIAL_PROPOSAL_FALLBACK_MS);

  if (typeof window.IntersectionObserver === 'function') {
    proposalLazyObserver = new window.IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        startLazyRender();
      }
    }, { rootMargin: INITIAL_PROPOSAL_ROOT_MARGIN });

    proposalLazyObserver.observe(movieGrid);
  } else {
    startLazyRender();
  }
}

export function renderHistory() {
  const { seenMovies, isAdmin, user, userVotes, userAttendance, sessions } = store.getState();
  const historyGrid = document.getElementById('historyGrid');

  const sessionDateByMovieId = new Map((sessions || []).map(s => [s.movie_id, s.session_date]));
  const sorted = [...seenMovies].sort((a, b) => {
    const dateA = sessionDateByMovieId.get(a.id);
    const dateB = sessionDateByMovieId.get(b.id);
    if (!dateA && !dateB) return 0;
    if (!dateA) return 1;
    if (!dateB) return -1;
    return new Date(dateB) - new Date(dateA);
  });

  HomeView.renderHistory(sorted, historyGrid, { isAdmin, user, userVotes, userAttendance });
  if (window.lucide) window.lucide.createIcons();
}

export async function renderCemetery(droppedMoviesList) {
  const { isAdmin, user, userVotes } = store.getState();
  const cemeteryGrid = document.getElementById('cemeteryGrid');
  if (!cemeteryGrid || !droppedMoviesList.length) {
    HomeView.renderCemetery(droppedMoviesList, cemeteryGrid, { isAdmin, user, userVotes });
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  // Fetch live vote counts from votes table — more reliable than the denormalized
  // vote_count column, which may be stale for movies dropped before vote-preservation was added.
  let movies = droppedMoviesList;
  try {
    const ids = droppedMoviesList.map(m => m.id);
    const liveCounts = await MovieService.getVoteCountsByMovieIds(ids);
    if (liveCounts.size > 0) {
      movies = droppedMoviesList.map(m => ({
        ...m,
        vote_count: liveCounts.get(m.id) ?? m.vote_count ?? 0
      }));
    }
  } catch (err) {
    console.warn('[Cemetery] Could not fetch live vote counts, using stored values:', err);
  }

  HomeView.renderCemetery(movies, cemeteryGrid, { isAdmin, user, userVotes });
  if (window.lucide) window.lucide.createIcons();
}

export async function renderTopVotedShowcase() {
  const { proposedMovies, isAdmin, user, userVotes } = store.getState();
  const container = document.getElementById('topVotedShowcase');
  const grid = document.getElementById('topVotedGrid');

  // Build top3 only from the most-active half so forgotten high-vote
  // movies don't block the showcase indefinitely.
  let activePool = proposedMovies;
  if (proposedMovies.length >= 2) {
    try {
      const scored = await computeActivityScoresForMovies(proposedMovies);
      const sorted = [...scored].sort((a, b) => b.activity_score - a.activity_score);
      const activeCount = Math.ceil(sorted.length / 2);
      activePool = sorted.slice(0, activeCount);
    } catch (e) {
      console.error('[Showcase] Could not compute activity scores, falling back to all proposals:', e);
    }
  }

  HomeView.renderTopVotedShowcase(activePool, container, grid, { isAdmin, user, userVotes });
  if (window.lucide) window.lucide.createIcons();
}

// ─── Enrichment ───────────────────────────────────────────────────────────────

// BUG FIX #2: enrichMovieData no longer mutates store objects directly.
// It works with local copies and does a batch store.setState at the end.
export async function enrichMovieData(movies, options = {}) {
  const { lazyProposals = false } = options;

  const moviesToEnrich = movies.filter(m => m.tmdb_id && (
    m.vote_average === undefined || m.vote_average === null || m.vote_average === 0 ||
    !m.runtime ||
    !m.trailer_url ||
    !m.watch_providers
  ));

  if (moviesToEnrich.length === 0) return;

  const enrichedMap = new Map();

  await Promise.all(moviesToEnrich.map(async (movie) => {
    try {
      const data = await TMDBService.invokeTMDBCall(`/movie/${movie.tmdb_id}`, {
        append_to_response: 'videos,watch/providers'
      });

      const localMovie = { ...movie };
      const updates = {};

      // 1. Enriched Scores
      if (data.vote_average !== undefined) {
        localMovie.vote_average = data.vote_average;
        updates.average_rating = data.vote_average;
      }

      if (data.runtime) {
        localMovie.runtime = data.runtime;
        updates.runtime = data.runtime;
      }

      // 2. Trailers
      const trailer = data.videos?.results?.find(v => v.type === 'Trailer' && v.site === 'YouTube');
      if (trailer) {
        localMovie.trailer_url = `https://www.youtube.com/watch?v=${trailer.key}`;
        updates.trailer_url = localMovie.trailer_url;
      }

      // 3. Watch Providers (Spain priority)
      const providers = data['watch/providers']?.results?.ES;
      if (providers) {
        localMovie.watch_providers = providers;
        updates.watch_providers = providers;
      }

      enrichedMap.set(movie.id, localMovie);

      if (Object.keys(updates).length > 0) {
        await MovieService.updateMovieData(movie.id, updates).catch(() => {});
      }
    } catch (e) {
      console.error(`[Enrichment] Failed for ${movie.title}:`, e);
    }
  }));

  // Batch update store — no direct mutation of existing references.
  // Merge enriched fields (runtime, trailer, providers) with current store values for
  // user-specific data (ratings, comments, reviews) that may have been hydrated
  // concurrently by ratingsHydrationTask.
  if (enrichedMap.size > 0) {
    const { allMovies } = store.getState();
    const newAllMovies = allMovies.map(m => {
      if (!enrichedMap.has(m.id)) return m;
      const enriched = enrichedMap.get(m.id);
      return {
        ...enriched,
        user_rating: m.user_rating,
        user_comment: m.user_comment,
        reviews: m.reviews,
        average_community_rating: m.average_community_rating,
      };
    });
    store.setState({
      allMovies: newAllMovies,
      proposedMovies: newAllMovies.filter(m => !m.is_seen && !m.is_dropped),
      seenMovies: newAllMovies.filter(m => m.is_seen)
    });
  }

  // Re-render immediately (non-lazy) so enriched data (e.g. runtime) appears without delay
  renderProposals({ lazy: false });
  renderHistory();
  renderTopVotedShowcase();
}

// ─── Achievements ─────────────────────────────────────────────────────────────

async function calculateGlobalAchievementStats() {
  const { allMovies } = store.getState();
  return AchievementService.calculateGlobalStats(allMovies);
}

export async function renderHomeAchievements() {
  const grid = document.getElementById('homeAchievementsGrid');
  if (!grid) return;

  if (grid.innerHTML.trim() === '' || grid.querySelector('.empty-state')) {
    ProfileView.renderAchievementSkeletons(grid, 4);
  }

  const stats = await calculateGlobalAchievementStats();
  HomeView.renderHomeAchievements(stats, grid, ACHIEVEMENT_LIST);
  if (window.lucide) window.lucide.createIcons();
}

export async function fetchRecentAchievementEvents() {
  try {
    const events = await AchievementService.fetchRecentEvents();

    events.sort((a, b) => b.date - a.date);

    // Home Timeline (Top 5)
    renderAchievementTimeline(events.slice(0, 5));

    // Admin Audit List (Full history)
    const adminList = document.getElementById('adminAchievementsList');
    if (adminList) {
      const { data: activeProfiles } = await supabase.from('profiles').select('id, full_name, email');
      const activeUserMap = {};
      activeProfiles?.forEach(p => activeUserMap[p.id] = p.full_name || p.email.split('@')[0]);

      AdminView.renderAchievementsAudit(events, adminList, activeUserMap);
      if (window.lucide) window.lucide.createIcons();
    }
  } catch (err) {
    console.error('Error fetching achievement events:', err);
  }
}

function renderAchievementTimeline(events) {
  const body = document.getElementById('timelineBody');
  HomeView.renderTimeline(events, body);
  if (window.lucide) window.lucide.createIcons();
}

// ─── Search ───────────────────────────────────────────────────────────────────

export async function handleMovieSearch(query) {
  const { user } = store.getState();
  const searchResults = document.getElementById('searchResults');

  if (!user || !query) {
    searchResults.classList.remove('active');
    return;
  }

  try {
    const dataResults = await TMDBService.searchTMDB(query);

    const results = dataResults
      .sort((a, b) => b.popularity - a.popularity)
      .slice(0, 20);

    const enrichedResults = await Promise.all(results.map(async movie => {
      try {
        const detailsData = await TMDBService.invokeTMDBCall(`/movie/${movie.id}`, {
          append_to_response: 'credits'
        });
        const directors = (detailsData.credits?.crew || [])
          .filter(person => person.job === 'Director')
          .map(d => d.name)
          .join(', ');

        const { genreMap } = store.getState();
        const genreNames = detailsData.genres?.map(genre => genre.name)
          || movie.genre_ids.map(id => genreMap[id]).filter(Boolean);

        return {
          ...movie,
          runtime: detailsData.runtime,
          director: directors || 'Unknown Director',
          genres: genreNames,
          synopsis: detailsData.overview || movie.overview
        };
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

// ─── Window Actions ───────────────────────────────────────────────────────────

export function init() {
  const searchInput = document.getElementById('movieSearch');
  const searchResults = document.getElementById('searchResults');
  let searchTimeout;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => handleMovieSearch(e.target.value), 500);
  });
  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
      searchResults.classList.remove('active');
    }
  });

  window.deleteMovie = async (movieId) => {
    const { isAdmin, allMovies } = store.getState();
    if (!isAdmin) {
      return window.dropMovie(movieId);
    }
    const movie = allMovies.find(m => m.id === movieId);
    const title = movie ? movie.title : 'this movie';
    if (!confirm('Are you sure you want to delete this proposal? This action cannot be undone.')) return;

    try {
      await MovieService.deleteMovie(movieId);
      showNotification('Proposal deleted successfully.');
      window.dispatchEvent(new CustomEvent('app:refresh'));
    } catch (e) {
      showNotification('Error deleting movie', 'error');
    }
  };

  // BUG FIX: use MovieService.deleteVotesForMovie instead of direct supabase call
  window.dropMovie = async (movieId) => {
    const { allMovies } = store.getState();
    const movie = allMovies.find(m => m.id === movieId);
    if (!movie) return;
    if (!confirm('Move this movie to the Cemetery? (It can be recovered later)')) return;

    try {
      await MovieService.updateMovieData(movieId, { is_dropped: true });
      await MovieService.deleteVotesForMovie(movieId);
      showNotification('Movie sent to Cemetery.');
      window.dispatchEvent(new CustomEvent('app:refresh'));
    } catch (e) {
      showNotification('Error dropping movie', 'error');
    }
  };

  window.proposeMovie = async (tmdbMovie, el) => {
    const { user, proposedMovies, isAdmin, userVotes, maxProposals: MAX_PROPOSALS } = store.getState();

    if (!user) {
      window.navigateTo('auth');
      return;
    }

    // Check limits with a fresh DB query to avoid race conditions
    const { count, error: countError } = await supabase
      .from('movies')
      .select('*', { count: 'exact', head: true })
      .eq('proposed_by', user.id)
      .eq('is_seen', false)
      .eq('is_dropped', false);

    if (countError) {
      console.error('Error checking proposal limits:', countError);
    }

    const currentCount = count !== null ? count : proposedMovies.filter(m => m.proposed_by === user.id).length;

    if (currentCount >= MAX_PROPOSALS && !isAdmin) {
      showNotification(`Proposal limit reached! You already have the maximum allowed (${MAX_PROPOSALS}). You must delete or wait for one of your current proposals to be screened to add more.`, 'warning');
      return;
    }

    const card = el?.closest('.movie-card');

    // Resurrection logic: Check if movie is in the cemetery
    try {
      const existing = await MovieService.findMovieByTMDBId(tmdbMovie.id);

      if (existing && existing.is_dropped) {
        if (confirm(`"${tmdbMovie.title}" is currently in the Cinema Cemetery. Do you want to rescue it and bring it back to active proposals?`)) {
          await MovieService.rescueMovie(existing.id, user.id);

          const hasVoted = await MovieService.fetchVotesForUser(user.id);
          if (!hasVoted.some(v => v.movie_id === existing.id)) {
            await MovieService.addVote(user.id, existing.id);
            store.setUserVotes(new Set([...store.getState().userVotes, existing.id]));
          }

          showNotification(`"${tmdbMovie.title}" has been rescued from the cemetery!`, 'success');
          window.dispatchEvent(new CustomEvent('app:refresh'));
          return;
        } else {
          return;
        }
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

    const searchInput = document.getElementById('movieSearch');
    const searchResults = document.getElementById('searchResults');

    try {
      const data = await MovieService.createMovie({
        ...payload,
        average_rating: tmdbMovie.vote_average || 0
      });

      showNotification(`"${tmdbMovie.title}" proposed!`, 'success');

      try {
        if (data && data.id) {
          await MovieService.addVote(user.id, data.id);
          store.setUserVotes(new Set([...store.getState().userVotes, data.id]));
        }
      } catch (vErr) {
        console.warn('Auto-vote failed:', vErr);
      }

      if (card) {
        card.style.transform = 'scale(1.05)';
        card.style.borderColor = 'var(--success)';
        setTimeout(() => {
          card.style.transform = '';
          card.style.borderColor = '';
        }, 500);
      }
      if (searchInput) searchInput.value = '';
      if (searchResults) searchResults.classList.remove('active');
      await window.dispatchEvent(new CustomEvent('app:refresh'));
    } catch (error) {
      if (error.code === '23505') {
        showNotification('Already in the lineup!', 'warning');
        if (card) {
          card.style.animation = 'shake 0.5s ease';
          setTimeout(() => card.style.animation = '', 500);
        }
      } else {
        console.error('Error proposing movie:', error);
        showNotification('Something went wrong', 'error');
      }
    }
  };

  window.toggleVote = async (movieId) => {
    const { user, proposedMovies, userVotes, isAdmin, maxVotes: MAX_VOTES } = store.getState();

    if (!user) {
      window.navigateTo('auth');
      return;
    }

    const movie = proposedMovies.find(m => m.id === movieId);
    if (!movie) return;

    const btn = document.querySelector(`.movie-card[data-id="${movieId}"] .vote-btn`);
    const countEl = document.querySelector(`.movie-card[data-id="${movieId}"] .vote-count`);

    if (userVotes.has(movieId)) {
      // Unvote is ALWAYS allowed
      try {
        await MovieService.removeVote(user.id, movieId);
        const newVotes = new Set(userVotes);
        newVotes.delete(movieId);
        store.setUserVotes(newVotes);

        movie.vote_count = (movie.vote_count || 1) - 1;
        if (btn) btn.classList.remove('active');
        if (countEl) countEl.textContent = `${movie.vote_count} votes`;
      } catch (err) {
        console.error('Failed to remove vote:', err);
        showNotification('Failed to remove vote', 'error');
      }
    } else {
      console.log(`[Vote] User Votes: ${userVotes.size} / ${MAX_VOTES} | Admin: ${isAdmin}`);

      if (userVotes.size >= MAX_VOTES && !isAdmin) {
        showNotification(`You've run out of votes! You have already used your ${MAX_VOTES} available votes. Remove a vote from another movie if you want to support this new proposal.`, 'warning');
        return;
      }

      try {
        await MovieService.addVote(user.id, movieId);
        const newVotes = new Set(userVotes);
        newVotes.add(movieId);
        store.setUserVotes(newVotes);

        movie.vote_count = (movie.vote_count || 0) + 1;
        if (btn) btn.classList.add('active');
        if (countEl) countEl.textContent = `${movie.vote_count} votes`;
      } catch (err) {
        console.error('Failed to add vote:', err);
        showNotification('Failed to add vote', 'error');
      }
    }
    updateAuthUI();
  };

  window.rescueCemeteryMovie = async (movieId) => {
    const { user, allMovies, isAdmin, proposedMovies, maxProposals: MAX_PROPOSALS } = store.getState();
    if (!user) { window.navigateTo('auth'); return; }

    const movie = allMovies.find(m => m.id === movieId);
    if (!movie) return;

    if (!confirm(`Rescue "${movie.title}" from the Cemetery and bring it back to active proposals?`)) return;

    const { count, error: countError } = await supabase
      .from('movies')
      .select('*', { count: 'exact', head: true })
      .eq('proposed_by', user.id)
      .eq('is_seen', false)
      .eq('is_dropped', false);

    if (countError) console.error('Error checking proposal limits:', countError);

    const currentCount = count !== null ? count : proposedMovies.filter(m => m.proposed_by === user.id).length;
    if (currentCount >= MAX_PROPOSALS && !isAdmin) {
      showNotification(`Proposal limit reached! You can't rescue right now — you already have ${MAX_PROPOSALS} active proposals.`, 'warning');
      return;
    }

    try {
      await MovieService.rescueMovie(movieId, user.id);

      const userVotesData = await MovieService.fetchVotesForUser(user.id);
      if (!userVotesData.some(v => v.movie_id === movieId)) {
        await MovieService.addVote(user.id, movieId);
        store.setUserVotes(new Set([...store.getState().userVotes, movieId]));
      }

      // Update store immediately so re-renders see the correct state before app:refresh completes.
      const { allMovies: currentMovies } = store.getState();
      const updatedMovies = currentMovies.map(m =>
        m.id === movieId ? { ...m, is_dropped: false, proposed_by: user.id } : m
      );
      store.setState({
        allMovies: updatedMovies,
        proposedMovies: updatedMovies.filter(m => !m.is_seen && !m.is_dropped),
      });
      renderCemetery(updatedMovies.filter(m => m.is_dropped));

      showNotification(`"${movie.title}" has been rescued from the cemetery!`, 'success');
      window.dispatchEvent(new CustomEvent('app:refresh'));
    } catch (e) {
      console.error('Error rescuing movie:', e);
      showNotification('Error rescuing movie', 'error');
    }
  };

  window.markAsSeen = async (movieId) => {
    if (!confirm('Mark this movie as SEEN?')) return;
    try {
      await MovieService.updateMovieData(movieId, { is_seen: true });
      showNotification('Movie marked as seen!', 'success');
      await window.dispatchEvent(new CustomEvent('app:refresh'));
    } catch (e) {
      console.error('Error marking as seen:', e);
    }
  };

  window.unmarkAsSeen = async (movieId) => {
    const { isAdmin } = store.getState();
    if (!isAdmin) return;
    try {
      await MovieService.updateMovieData(movieId, { is_seen: false });
      showNotification('Movie moved back to proposals', 'success');
      await window.dispatchEvent(new CustomEvent('app:refresh'));
    } catch (e) {
      showNotification('Failed to revert status', 'error');
    }
  };

  // BUG FIX: use MovieService.upsertRating instead of direct supabase call
  window.rateMovie = async (movieId, rating) => {
    const { user, seenMovies } = store.getState();
    if (!user) return;

    const movie = seenMovies.find(m => m.id === movieId);
    if (movie) movie.user_rating = rating;

    const commentInput = document.getElementById(`comment-input-${movieId}`);
    const comment = commentInput ? commentInput.value : null;

    try {
      await MovieService.upsertRating(user.id, movieId, parseInt(rating), comment);
      showNotification('Rating saved!', 'success');
      await window.dispatchEvent(new CustomEvent('app:refresh'));
    } catch (error) {
      console.error('Error rating movie:', error);
      showNotification('Error saving rating', 'error');
    }
  };

  window.startEditReview = (movieId) => {
    const section = document.getElementById(`review-section-${movieId}`);
    if (!section) return;
    section.querySelector('.review-view-mode').style.display = 'none';
    section.querySelector('.review-edit-mode').style.display = '';
  };

  window.cancelEditReview = (movieId) => {
    const section = document.getElementById(`review-section-${movieId}`);
    if (!section) return;
    section.querySelector('.review-edit-mode').style.display = 'none';
    section.querySelector('.review-view-mode').style.display = '';
  };

  window.selectRating = (movieId, rating) => {
    const valLabel = document.getElementById(`rating-val-${movieId}`);
    if (valLabel) valLabel.textContent = rating;

    const container = document.querySelector(`[onmouseleave*="${movieId}"]`);
    if (container) {
      container.setAttribute('onmouseleave', `window.resetStars('${movieId}', ${rating})`);
    }

    window.resetStars(movieId, rating);
  };

  window.hoverStars = (movieId, count) => {
    const container = document.querySelector(`[onmouseleave*="${movieId}"]`);
    const stars = container.querySelectorAll('.star-btn');
    const valLabel = document.getElementById(`rating-val-${movieId}`);
    if (valLabel) valLabel.textContent = `${count} / 10`;

    stars.forEach((star, i) => {
      if (i < count) star.classList.add('star-filled');
      else star.classList.remove('star-filled');
    });
  };

  window.resetStars = (movieId, currentRating) => {
    const container = document.querySelector(`[onmouseleave*="${movieId}"]`);
    const stars = container.querySelectorAll('.star-btn');
    const valLabel = document.getElementById(`rating-val-${movieId}`);
    if (valLabel) valLabel.textContent = `${currentRating || 0} / 10`;

    stars.forEach((star, i) => {
      if (i < currentRating) star.classList.add('star-filled');
      else star.classList.remove('star-filled');
    });
  };
}

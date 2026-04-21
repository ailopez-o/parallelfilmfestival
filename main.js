import { createClient } from '@supabase/supabase-js';

// Configuration
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Edge Function Proxy Helper
async function invokeTMDBCall(path, params = {}) {
  const { data, error } = await supabase.functions.invoke('tmdb-proxy', {
    body: { path, params }
  });
  
  if (error) {
    // If it's a non-2xx status, find the error message in the payload
    const msg = error.message || "Unknown Proxy Error";
    console.error(`[TMDB Proxy Error]: ${msg}`, error);
    throw new Error(`TMDB Proxy Error: ${msg}`);
  }
  
  if (data && data.error) {
    console.error(`[TMDB Proxy Logic Error]: ${data.error}`, data.details);
    throw new Error(data.error);
  }

  return data;
}

// State
let allMovies = [];
let proposedMovies = [];
let seenMovies = [];
let userVotes = new Set(); // Set of movie IDs the user voted for
let user = null;
let userProfile = null; // Cache for profile data (name, avatar, role)
let isAdmin = false;
let rankedUsers = []; // Global leaderboard data
let currentView = 'home';
let genreMap = {}; // Map of genre ID to name
let providerMap = {}; // Map of provider ID to data (name, logo)
let sessions = [];
let currentSession = null;

async function fetchAppSettings() {
  try {
    const { data, error } = await supabase.from('app_settings').select('*');
    if (error) throw error;
    
    data?.forEach(setting => {
      if (setting.key === 'max_proposals') MAX_PROPOSALS = parseInt(setting.value);
      if (setting.key === 'max_votes') MAX_VOTES = parseInt(setting.value);
    });
  } catch (err) {
    console.error('Error fetching app settings:', err);
  }
}

function loadAppSettings() {
  const maxPropInput = document.getElementById('settingMaxProposals');
  const maxVoteInput = document.getElementById('settingMaxVotes');
  if (maxPropInput) maxPropInput.value = MAX_PROPOSALS;
  if (maxVoteInput) maxVoteInput.value = MAX_VOTES;
}

window.saveAppSettings = async () => {
  if (!isAdmin) return;
  const maxPropInput = document.getElementById('settingMaxProposals');
  const maxVoteInput = document.getElementById('settingMaxVotes');
  
  const newValProp = maxPropInput.value;
  const newValVote = maxVoteInput.value;

  try {
    showNotification('Updating system settings...', 'warning');
    
    await Promise.all([
      supabase.from('app_settings').update({ value: newValProp.toString() }).eq('key', 'max_proposals'),
      supabase.from('app_settings').update({ value: newValVote.toString() }).eq('key', 'max_votes')
    ]);

    // Update local state
    MAX_PROPOSALS = parseInt(newValProp);
    MAX_VOTES = parseInt(newValVote);

    showNotification('System settings updated successfully!', 'success');
    
    // Refresh UI components that use these limits
    updateAuthUI();
    if (currentView === 'profile') loadUserActivity();

  } catch (err) {
    console.error('Error saving app settings:', err);
    showNotification('Error updating settings', 'error');
  }
};

/**
 * Normalizes strings for robust comparison:
 * - Trims whitespace
 * - Converts to lowercase
 * - Removes diacritics (accents)
 */
const normalize = (str) => {
  if (!str) return "";
  return str
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
};

// DOM Elements
const views = {
  home: document.getElementById('homeView'),
  auth: document.getElementById('authView'),
  profile: document.getElementById('profileView'),
  ranking: document.getElementById('rankingView'),
  explore: document.getElementById('exploreView'),
  sessions: document.getElementById('sessionsView')
};
const rankingList = document.getElementById('rankingList');
const movieGrid = document.getElementById('movieGrid');
const historyGrid = document.getElementById('historyGrid');
const adminToggle = document.getElementById('adminToggle');
const searchInput = document.getElementById('movieSearch');
const searchResults = document.getElementById('searchResults');
const userHeader = document.getElementById('userHeader');
const exploreGrid = document.getElementById('exploreGrid');
const exploreGenreSelect = document.getElementById('exploreGenre');
const aiSearchInput = document.getElementById('aiSearchInput');
const aiSearchBtn = document.getElementById('aiSearchBtn');
const exploreSearchBtn = document.getElementById('exploreSearchBtn');
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
const exploreButtons = [
  document.getElementById('exploreClearBtn'),
  document.getElementById('exploreSearchBtn')
];

// Profile Elements
const profileName = document.getElementById('profileName');
const profileEmail = document.getElementById('profileEmail');
const profileAvatar = document.getElementById('profileAvatar');
const countProposals = document.getElementById('countProposals');
const countVotes = document.getElementById('countVotes');
const profileActivityGrid = document.getElementById('profileActivityGrid');
const adminDashboard = document.getElementById('adminDashboard');
const adminUserList = document.getElementById('adminUserList');
const adminUserCount = document.getElementById('adminUserCount');
const adminParticipationLog = document.getElementById('adminParticipationLog');
const homeLeaderboard = document.getElementById('homeLeaderboard');
const homeLeaderboardSection = document.getElementById('homeLeaderboardSection');
const nextSessionHero = document.getElementById('nextSessionHero');
const sessionsGrid = document.getElementById('sessionsGrid');
const sessionModal = document.getElementById('sessionModal');
const sessionModalBody = document.getElementById('sessionModalBody');
const createSessionModal = document.getElementById('createSessionModal');
const sessionMovieSelect = document.getElementById('sessionMovieSelect');
const adminSessionsList = document.getElementById('adminSessionsList');

// Profile Edit Elements
const profileDisplay = document.getElementById('profileDisplay');
const profileEditForm = document.getElementById('profileEditForm');
const editName = document.getElementById('editName');
const editAvatar = document.getElementById('editAvatar');

// Fallback image helper
const FALLBACK_IMAGE = 'https://placehold.co/300x450/1a1a1f/94a3b8?text=Cinema+Poster';
const TBD_POSTER = '/coming-soon.png';

// Limits configuration (Dynamic from DB)
let MAX_PROPOSALS = 3;
let MAX_VOTES = 5;

// Initialization
async function init() {
  const dismissPreloader = () => {
    const preloader = document.getElementById('preloader');
    if (preloader && !preloader.classList.contains('fade-out')) {
      preloader.classList.add('fade-out');
      setTimeout(() => preloader.remove(), 800);
    }
  };

  try {
    // 1. Critical path: User and Genre/Provider maps (Parallel)
    await Promise.all([
      fetchGenreMap(),
      fetchProvidersMap(),
      fetchAppSettings(),
      checkUser()
    ]);

    // 2. Essential data: First batch of movies
    await refreshData();

    // 3. Dismiss preloader NOW - user can see movies
    dismissPreloader();

    // 4. Background tasks: Ranking and Sessions (don't block the UI)
    updateGlobalRanking();
    fetchSessions().then(() => renderSessions());
    fetchRecentAchievementEvents();

  } catch (err) {
    console.error('Initialization error:', err);
    dismissPreloader(); // Dismiss anyway to show error state or partial content
  }

  setupEventListeners();
  handleRouting();
}

async function fetchGenreMap() {
  try {
    const data = await invokeTMDBCall('/genre/movie/list');
    if (data.genres) {
      exploreGenreSelect.innerHTML = '<option value="">All Genres</option>';
      data.genres.forEach(g => {
        genreMap[g.id] = g.name;
        const option = document.createElement('option');
        option.value = g.id;
        option.textContent = g.name;
        exploreGenreSelect.appendChild(option);
      });
    }
  } catch (e) {
    console.error('Error fetching genre map:', e);
  }
}

async function fetchProvidersMap() {
  try {
    const data = await invokeTMDBCall('/watch/providers/movie', { watch_region: 'ES' });
    const select = document.getElementById('exploreProvider');
    if (data.results && select) {
      select.innerHTML = '<option value="">Any Platform</option>';
      // Sort and take top providers or specific ones
      const topProviders = data.results.slice(0, 50); 
      topProviders.forEach(p => {
        providerMap[p.provider_id] = p;
        const option = document.createElement('option');
        option.value = p.provider_id;
        option.textContent = p.provider_name;
        select.appendChild(option);
      });
    }
  } catch (e) {
    console.error('Error fetching providers map:', e);
  }
}

async function checkUser(session) {
  if (session === undefined) {
    const { data } = await supabase.auth.getSession();
    session = data.session;
  }
  
  user = session?.user || null;
  
  if (user) {
    // 🛡️ Dynamic RBAC: Fetch role from profiles table
    let { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    // If no profile exists (e.g., new Google login), create one automatically
    if (!profile) {
      console.log('[Auth] Profile missing, creating default profile...');
      const metadata = user.user_metadata || {};
      const { data: newProfile, error: insertError } = await supabase
        .from('profiles')
        .insert([{
          id: user.id,
          full_name: metadata.full_name || user.email.split('@')[0],
          role: 'user'
        }])
        .select()
        .single();
      
      if (!insertError) profile = newProfile;
    }

    userProfile = profile;
    isAdmin = userProfile?.role === 'admin';
    console.log(`[ACL] User: ${user.email} | Role: ${userProfile?.role || 'user'} | Admin: ${isAdmin}`);

    const { data: votes } = await supabase.from('votes').select('movie_id').eq('user_id', user.id);
    userVotes = new Set(votes?.map(v => v.movie_id) || []);
  } else {
    userProfile = null;
    isAdmin = false;
    userVotes = new Set();
  }
  updateAuthUI();
  if (isAdmin) {
    window.cleanupInactiveMovies(true);
  }
}

async function refreshData() {
  const { data, error } = await supabase
    .from('movies')
    .select('*')
    .order('created_at', { ascending: false });

  if (!error) allMovies = data || [];

  if (error) {
    console.error('Error fetching movies:', error);
    return;
  }

  // Hydrate with ratings if user logged in
  let individualRatings = [];
  let allRatings = [];

  if (user) {
    const { data: ratings } = await supabase.from('user_ratings').select('*').eq('user_id', user.id);
    individualRatings = ratings || [];
  }

  const { data: globalRatings } = await supabase.from('user_ratings').select('movie_id, rating');
  allRatings = globalRatings || [];

  allMovies.forEach(m => {
    const userV = individualRatings.find(r => r.movie_id === m.id);
    m.user_rating = userV ? userV.rating : 0;
    
    const mRatings = allRatings.filter(r => r.movie_id === m.id);
    m.average_community_rating = mRatings.length > 0 
      ? mRatings.reduce((sum, r) => sum + r.rating, 0) / mRatings.length 
      : 0;

    // Harmonize score fields (favoring vote_average if present, then average_rating)
    if (m.vote_average === undefined || m.vote_average === null || m.vote_average === 0) {
      if (typeof m.average_rating === 'number' && m.average_rating !== 0) {
        m.vote_average = m.average_rating;
      }
    }
  });

  // Background enrichment for movies with missing data
  enrichMovieData(allMovies);

  // 1. TEMPORARY: Sanitization of corrupted vote counts from TMDB global data
  const corrupted = allMovies.filter(m => !m.is_seen && m.vote_count > 50);
  if (corrupted.length > 0) {
    console.log(`[Migration] Sanitizing ${corrupted.length} corrupted movie counts...`);
    supabase.from('movies').update({ vote_count: 0 }).in('id', corrupted.map(m => m.id)).then(() => {
      corrupted.forEach(m => m.vote_count = 0);
      renderProposals();
    });
  }

  proposedMovies = allMovies.filter(m => !m.is_seen && !m.is_dropped);
  seenMovies = allMovies.filter(m => m.is_seen);
  const droppedMovies = allMovies.filter(m => m.is_dropped);

  renderProposals();
  renderHistory();
  renderCemetery(droppedMovies);
  if (currentView === 'profile') loadUserActivity();
  
  // Also refresh ranking on any state change
  updateGlobalRanking();

  // Achievements rendering
  renderHomeAchievements();
  renderTopVotedShowcase();
  renderAchievementTimeline();
  if (currentView === 'profile') renderProfileAchievements();

  // Sessions rendering
  await fetchSessions();
  renderSessions();
  renderNextSessionHero();
  updateAuthUI();
  updateAdminSessions();
}

// Rendering Helpers
function formatScore(score) {
  if (score === undefined || score === null || (typeof score === 'string' && score === 'N/A')) return 'N/A';
  const num = parseFloat(score);
  return isNaN(num) ? 'N/A' : num.toFixed(1);
}

async function enrichMovieData(movies) {
  // Find movies that need enrichment (missing scores, trailers, or providers)
  const moviesToEnrich = movies.filter(m => m.tmdb_id && (
    m.vote_average === undefined || m.vote_average === null || m.vote_average === 0 ||
    !m.trailer_url || 
    !m.watch_providers
  ));
  
  if (moviesToEnrich.length === 0) return;

  console.log(`[Enrichment] Found ${moviesToEnrich.length} movies needing TMDB data.`);

  for (const movie of moviesToEnrich) {
    try {
      const data = await invokeTMDBCall(`/movie/${movie.tmdb_id}`, {
        append_to_response: 'videos,watch/providers'
      });
      
      const updates = {};
      
      // 1. Enriched Scores
      if (data.vote_average !== undefined) {
        movie.vote_average = data.vote_average;
        updates.average_rating = data.vote_average;
        // Don't overwrite local vote_count with TMDB's global count
      }
      
      // 2. Trailers
      const trailer = data.videos?.results?.find(v => v.type === 'Trailer' && v.site === 'YouTube');
      if (trailer) {
        movie.trailer_url = `https://www.youtube.com/watch?v=${trailer.key}`;
        updates.trailer_url = movie.trailer_url;
      }
      
      // 3. Watch Providers (Spain priority)
      const providers = data['watch/providers']?.results?.ES;
      if (providers) {
        movie.watch_providers = providers;
        updates.watch_providers = providers;
      }
      
      if (Object.keys(updates).length > 0) {
        console.log(`[Enrichment] Data updated for ${movie.title}`);
        await supabase.from('movies').update(updates).eq('id', movie.id);
      }
    } catch (e) {
      console.error(`[Enrichment] Failed for ${movie.title}:`, e);
    }
  }

  // Re-render
  renderProposals();
  renderHistory();
}

// Routing
window.navigateTo = (viewId, targetUserId = null) => {
  currentView = viewId;
  
  // Hide all views
  Object.values(views).forEach(v => v.classList.add('page-hidden'));
  adminDashboard.classList.add('page-hidden');

  // If we are navigating to profile, check if it's our own or another user's (audit)
  if (viewId === 'profile') {
    loadUserActivity(targetUserId);
  }

  // Show target view
  if (views[viewId]) {
    views[viewId].classList.remove('page-hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  updateActiveNavLink(viewId);
};

window.viewUserProfile = (userId) => {
  if (!isAdmin) return;
  console.log(`[Admin] Auditing user profile: ${userId}`);
  window.navigateTo('profile', userId);
};

function handleRouting() {
  const hash = window.location.hash.replace('#', '') || 'home';
  currentView = hash;

  Object.keys(views).forEach(v => {
    if (v === hash) views[v].classList.remove('page-hidden');
    else views[v].classList.add('page-hidden');
  });

  if (hash === 'profile' && !user) {
    window.navigateTo('auth');
    return;
  }

  if (hash === 'profile') loadUserActivity();
  if (hash === 'ranking') renderRankingView();
  
  if (window.lucide) window.lucide.createIcons();
}

// Visual Feedback System (Toasts)
function showNotification(message, type = 'success') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  const icons = {
    success: 'check-circle',
    warning: 'alert-triangle',
    error: 'alert-circle'
  };

  toast.innerHTML = `
    <div class="toast-icon">
      <i data-lucide="${icons[type]}"></i>
    </div>
    <span>${message}</span>
  `;

  container.appendChild(toast);
  if (window.lucide) window.lucide.createIcons();

  // Auto remove
  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 400);
  }, 3000);
}

// Unified Movie Component
function createMovieCardHTML(movie, options = {}) {
  const { context = 'proposal', showDelete = false } = options;
  
  const hasVoted = userVotes.has(movie.id);
  const genres = (movie.genres || []).slice(0, 3);
  const posterUrl = movie.poster_url || (movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : FALLBACK_IMAGE);
  const releaseYear = movie.release_year || (movie.release_date ? movie.release_date.split('-')[0] : 'N/A');
  
  // Watch providers
  const providers = movie.watch_providers?.flatrate || [];
  const providersLink = movie.watch_providers?.link || '#';

  const cardClass = context === 'history' ? 'movie-card seen' : 
                   context === 'showcase' ? 'movie-card top-highlight-card' : 
                   context === 'cemetery' ? 'movie-card dropped' : 'movie-card';

  return `
    <div class="${cardClass}" data-id="${movie.id || ''}">
      ${context === 'showcase' ? `
        <div class="top-badge">
          <i data-lucide="award"></i> #${options.rank} MOST WANTED
        </div>
      ` : ''}
      <div class="poster-wrapper">
        <img src="${posterUrl}" alt="${movie.title}" loading="lazy" onerror="this.onerror=null; this.src='${FALLBACK_IMAGE}'">
        
        <!-- Explore Context Overlay (Now inside poster) -->
        ${context === 'explore' ? `
          <div class="propose-overlay">
            <button class="btn-propose" onclick="window.proposeMovie(${JSON.stringify(movie).replace(/"/g, '&quot;')}, this)">
              <i data-lucide="plus"></i> Propose Movie
            </button>
          </div>
        ` : ''}
      </div>

      ${isAdmin ? `
        <div class="admin-actions-overlay">
          <button class="delete-movie-btn drop-only" onclick="window.dropMovie('${movie.id}')" title="Move to Cemetery">
            <i data-lucide="trash-2"></i>
          </button>
          <button class="delete-movie-btn perm-delete" onclick="window.deleteMovie('${movie.id}')" title="Delete Permanently">
            <i data-lucide="x-circle"></i>
          </button>
        </div>
      ` : ((showDelete || (user && movie.proposed_by === user.id)) && !movie.is_seen && context !== 'cemetery' ? `
        <div class="admin-actions-overlay user-only">
          <button class="delete-movie-btn drop-only" onclick="window.dropMovie('${movie.id}')" title="Move to Cemetery">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      ` : '')}

      <div class="movie-info">
        <div class="header-main">
          <div class="title-row">
            <div class="movie-title">${movie.title}</div>
            <div class="rating-badge">
              <i data-lucide="star" style="width:12px; height:12px; fill:#fbbf24;"></i>
              <span class="rating-value">${formatScore(movie.vote_average)}</span>
            </div>
          </div>
          <div class="movie-meta">
            <span>${releaseYear} • ${movie.director || 'Unknown'}</span>
            ${movie.trailer_url ? `
              <a href="${movie.trailer_url}" target="_blank" class="trailer-link-btn ${context === 'history' ? 'mini' : ''}" title="Watch Trailer">
                <i data-lucide="play-circle"></i> Trailer
              </a>
            ` : ''}
          </div>
        </div>

        <div class="genre-tags">
          ${genres.map(g => `<span class="genre-tag">${g}</span>`).join('')}
        </div>

        <div class="synopsis">${movie.synopsis || 'No synopsis available.'}</div>

        <!-- Watch Providers -->
        ${providers.length > 0 ? `
          <div class="watch-providers ${context === 'history' || context === 'activity' ? 'mini' : ''}">
            <span class="provider-label">Available on:</span>
            <div class="provider-list">
              ${providers.slice(0, 4).map(p => `
                <a href="${providersLink}" target="_blank" class="provider-icon ${context === 'history' || context === 'activity' ? 'small' : ''}" title="${p.provider_name}">
                  <img src="https://image.tmdb.org/t/p/original${p.logo_path}" alt="${p.provider_name}">
                </a>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Context Actions -->
        ${context === 'proposal' ? `
          <div class="voting-container">
            <div class="vote-main-actions">
              <button class="vote-btn like-btn ${hasVoted ? 'active' : ''}" onclick="window.toggleVote('${movie.id}')">
                <i data-lucide="heart"></i>
                <span>${hasVoted ? 'Voted' : 'Vote'}</span>
              </button>
              <span class="vote-count">${movie.vote_count || 0} votes</span>
            </div>

            ${isAdmin ? `
              <button class="mark-seen-btn" onclick="window.markAsSeen('${movie.id}')">
                <i data-lucide="check-circle"></i> Mark as Seen
              </button>
            ` : ''}
          </div>
        ` : ''}

        ${context === 'history' ? `
          <div class="rating-input-wrapper">
            <div style="display:flex; justify-content:space-between; font-size: 0.8rem; margin-bottom: 0.5rem;">
              <span style="font-weight:600; color:var(--text-secondary);">Your Rating</span>
              <span id="rating-val-${movie.id}" style="font-weight:700; color:#fbbf24;">${movie.user_rating || 0} / 10</span>
            </div>
            <div class="star-rating" onmouseleave="window.resetStars('${movie.id}', ${movie.user_rating || 0})">
              ${Array.from({ length: 10 }, (_, i) => i + 1).map(num => `
                <button class="star-btn ${movie.user_rating >= num ? 'star-filled' : ''}" 
                        data-star="${num}"
                        onmouseover="window.hoverStars('${movie.id}', ${num})"
                        onclick="window.rateMovie('${movie.id}', ${num})">
                  <i data-lucide="star"></i>
                </button>
              `).join('')}
            </div>
            <div class="community-avg-box">
              <span class="community-label">Festival Average</span>
              <span class="community-score" id="comm-avg-${movie.id}">${movie.average_community_rating ? movie.average_community_rating.toFixed(1) : '0.0'}</span>
            </div>
          </div>
        ` : ''}

        ${context === 'history' && isAdmin ? `
          <button class="unmark-seen-btn" onclick="window.unmarkAsSeen('${movie.id}')">
            <i data-lucide="rotate-ccw"></i> Back to Proposals
          </button>
        ` : ''}
        ${context === "cemetery" ? `
          <div class="cemetery-status">
            <i data-lucide="skull"></i>
            <span>Dropped Film</span>
          </div>
        ` : ""}
      </div>
    </div>
  `;
}

// Rendering
function renderProposals() {
  if (!proposedMovies.length) {
    movieGrid.innerHTML = '<div class="empty-state">No movies proposed yet. Be the first!</div>';
    return;
  }

  movieGrid.innerHTML = proposedMovies.map(movie => {
    const isOwner = user && movie.proposed_by === user.id;
    const canDelete = isOwner || isAdmin;
    
    return createMovieCardHTML(movie, { 
      context: 'proposal', 
      showDelete: canDelete 
    });
  }).join('');
  
  if (window.lucide) window.lucide.createIcons();
  if (window.lucide) window.lucide.createIcons();
}

async function renderTopVotedShowcase() {
  const container = document.getElementById('topVotedShowcase');
  const grid = document.getElementById('topVotedGrid');
  if (!grid || !container) return;

  // Filter movies that are NOT seen and have at least 1 vote
  const topContenders = [...proposedMovies]
    .filter(m => (m.vote_count || 0) > 0)
    .sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0))
    .slice(0, 3);

  if (topContenders.length === 0) {
    container.classList.add('page-hidden');
    return;
  }

  container.classList.remove('page-hidden');
  grid.innerHTML = topContenders.map((movie, index) => 
    createMovieCardHTML(movie, { context: 'showcase', rank: index + 1 })
  ).join('');

  if (window.lucide) window.lucide.createIcons();
}

function renderHistory() {
  if (!seenMovies.length) {
    historyGrid.innerHTML = '<div class="empty-state">No movies in history yet.</div>';
    return;
  }

  historyGrid.innerHTML = seenMovies.map(movie => {
    return createMovieCardHTML(movie, { 
      context: 'history', 
      showDelete: false // Protected from deletion
    });
  }).join('');
  
  if (window.lucide) window.lucide.createIcons();
}

function updateAuthUI() {
  if (user) {
    const name = userProfile?.full_name || user.user_metadata?.full_name || user.email.split('@')[0];
    const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=5850ec&color=fff&bold=true`;
    const myScore = userProfile?.score || 0;
    
    // Calculate current usage
    const myProposalsCount = proposedMovies.filter(m => m.proposed_by === user.id).length;
    const votesLeft = MAX_VOTES - userVotes.size;
    const proposalsLeft = MAX_PROPOSALS - myProposalsCount;

    if (isAdmin) {
      userHeader.innerHTML = `
        <div class="user-profile">
          <div class="score-badge header-score" style="background:rgba(255,165,0,0.1); color:#ffa500; border: 1px solid rgba(255,165,0,0.3);">
            <i data-lucide="shield-check" style="width:12px; height:12px; margin-right:4px;"></i>
            ADMIN MODE
          </div>
          <div class="score-badge header-score" style="background:rgba(255,255,255,0.05); cursor:pointer;" onclick="event.stopPropagation(); window.navigateTo('sessions')" title="View Cinema Sessions">
            <i data-lucide="calendar" style="width:12px; height:12px; margin-right:4px;"></i>
            Sessions
          </div>
          <div class="user-profile-info" onclick="window.navigateTo('profile')">
            <img src="${avatar}" class="user-avatar" />
            <div style="display:flex; flex-direction:column; line-height: 1.2;">
              <span style="font-weight:700;">${name}</span>
              <span style="font-size: 0.7rem; color:var(--success); font-weight:800;">ADMINISTRATOR</span>
            </div>
          </div>
        </div>
      `;
      if (searchInput) {
        searchInput.disabled = false;
        searchInput.style.opacity = '1';
        searchInput.style.cursor = 'text';
        searchInput.placeholder = "Search movies (Admin Mode)...";
      }
      const proposalsLabel = document.getElementById('proposalsCountLabel');
      if (proposalsLabel) proposalsLabel.style.opacity = '0';
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    userHeader.innerHTML = `
      <div class="user-profile">
        <div class="score-badge header-score" style="background:rgba(0, 212, 255, 0.1); color:#00d4ff; border: 1px solid rgba(0, 212, 255, 0.3);" title="Your available votes">
          <i data-lucide="check-square" style="width:14px; height:14px; margin-right:4px;"></i>
          <span class="header-label">${votesLeft > 0 ? votesLeft : 0} <span class="hide-mobile">Votes Left</span></span>
        </div>
        <div class="score-badge header-score" style="background:rgba(255,255,255,0.05); cursor:pointer;" onclick="event.stopPropagation(); window.navigateTo('sessions')" title="View Cinema Sessions">
          <i data-lucide="calendar" style="width:14px; height:14px; margin-right:4px;"></i>
          <span class="header-label hide-mobile">Sessions</span>
        </div>
        <div class="score-badge header-score" onclick="event.stopPropagation(); window.navigateTo('ranking')" title="View Global Ranking">
          <i data-lucide="award" style="width:14px; height:14px; margin-right:4px;"></i>
          <span class="header-label">${myScore}</span>
        </div>
        <div class="user-profile-info" onclick="window.navigateTo('profile')">
          <img src="${avatar}" class="user-avatar" />
          <div class="user-name-wrapper hide-mobile" style="display:flex; flex-direction:column; line-height: 1.2;">
            <span style="font-weight:700;">${name}</span>
            ${userProfile?.rank ? `<span style="font-size: 0.7rem; color:var(--warning); font-weight:800;">#${userProfile.rank}</span>` : ""}
          </div>
        </div>
      </div>
    `;

    if (searchInput) {
      const isLimitReached = proposalsLeft <= 0;
      searchInput.disabled = isLimitReached;
      searchInput.style.opacity = isLimitReached ? '0.5' : '1';
      searchInput.style.cursor = isLimitReached ? 'not-allowed' : 'text';
      searchInput.placeholder = proposalsLeft > 0 
        ? `Search for movies to propose...`
        : "Max proposals reached (3/3)";
    }

    const proposalsLabel = document.getElementById('proposalsCountLabel');
    if (proposalsLabel) {
      proposalsLabel.style.opacity = '1';
      const green = '#10b981';
      const red = '#ef4444';
      proposalsLabel.innerHTML = `
        <span style="color:${proposalsLeft > 0 ? green : red}">
          ${proposalsLeft > 0 ? `Available Proposals: ${proposalsLeft} / 3` : 'Limit Reached: 3 / 3 Proposals Used'}
        </span>
      `;
    }
  } else {
    const proposalsLabel = document.getElementById('proposalsCountLabel');
    if (proposalsLabel) proposalsLabel.style.opacity = '0';
    userHeader.innerHTML = `<button class="auth-btn" onclick="window.navigateTo('auth')">Sign In</button>`;
    
    searchResults.classList.remove('active');
    
    // 🛡️ Lock only the Proposal-specific search (Home/Header) 
    if (searchInput) {
      searchInput.disabled = true;
      searchInput.placeholder = "Sign in to propose movies...";
    }
    
    // ✅ Re-enable Explore/Discover features for everyone (already enabled by default)
    if (aiSearchInput) {
      aiSearchInput.disabled = false;
      aiSearchInput.placeholder = "e.g. Movies about space and loneliness from the 70s similar to 2001...";
    }
    if (aiSearchBtn) aiSearchBtn.disabled = false;
    
    exploreInputs.forEach(input => {
      if (input) {
        input.disabled = false;
        if (input.id === 'exploreTitle') input.placeholder = "Movie title...";
        if (input.id === 'exploreDirector') input.placeholder = "Director name...";
        if (input.id === 'exploreYearFrom') input.placeholder = "From";
        if (input.id === 'exploreYearTo') input.placeholder = "To";
      }
    });
    exploreButtons.forEach(btn => {
      if (btn) btn.disabled = false;
    });
  }

  // Restore interaction if user returns
  if (user) {
    if (searchInput) {
      searchInput.disabled = false;
      searchInput.placeholder = "Search movies to propose...";
    }
    // ... AI & Explore already enabled above ...
  }
}

// Actions
window.deleteMovie = async (movieId) => {
  if (!isAdmin) {
    return window.dropMovie(movieId);
  }
  const movie = allMovies.find(m => m.id === movieId);
  const title = movie ? movie.title : "this movie";
  if (!confirm(`ADMIN ACTION: Permanently delete "${title}"? This cannot be undone.`)) return;
  const { error } = await supabase.from("movies").delete().eq("id", movieId);
  if (error) {
    showNotification("Error deleting movie", "error");
  } else {
    showNotification("Movie permanently deleted", "success");
    refreshData();
  }
};

window.dropMovie = async (movieId) => {
  const movie = allMovies.find(m => m.id === movieId);
  if (!movie) return;
  if (!confirm(`Move "${movie.title}" to the Cemetery? It will no longer be an active proposal.`)) return;
  const { error } = await supabase.from("movies").update({ is_dropped: true }).eq("id", movieId);
  if (error) {
    showNotification("Error dropping movie", "error");
  } else {
    showNotification("Movie moved to the Cemetery", "info");
    refreshData();
  }
};

// Auth Logic
window.signInWithGoogle = async () => {
  await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  });
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
  
  if (error) {
    alert(error.message);
    return;
  }
  
  // If email confirmation is disabled, 'data.session' will be present
  if (data?.session) {
    window.navigateTo('home');
  } else {
    alert('Check your email for confirmation!');
  }
};

window.handleLogout = async () => {
  await supabase.auth.signOut();
  // Clear local state instantly
  await checkUser(null);
  window.navigateTo('auth');
};

// Profile Logic
async function loadUserActivity(targetUserId = null) {
  if (!user && !targetUserId) return;
  
  const isAudit = targetUserId && targetUserId !== user?.id;
  const activeUid = targetUserId || user.id;

  // Fetch target profile data from the DB
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', activeUid).single();
  
  const displayName = profile?.full_name || profile?.email?.split('@')[0] || 'User';
  const displayEmail = profile?.email || 'N/A';
  
  // Generate high-end initial-based avatar
  const displayAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=5850ec&color=fff&size=256&bold=true`;
  
  profileName.textContent = displayName;
  profileEmail.textContent = displayEmail;
  profileAvatar.src = displayAvatar;

  // Show audit badge if viewing another user
  const auditBadge = document.getElementById('auditBadge') || document.createElement('div');
  if (isAudit) {
    auditBadge.id = 'auditBadge';
    auditBadge.className = 'audit-badge';
    auditBadge.innerHTML = `<i data-lucide="shield-check"></i> Auditing User Profile <button onclick="window.navigateTo('profile')">Exit Audit</button>`;
    profileName.parentElement.prepend(auditBadge);
    document.getElementById('editProfileBtn')?.classList.add('page-hidden');
  } else {
    auditBadge.remove();
    document.getElementById('editProfileBtn')?.classList.remove('page-hidden');
  }

  // Pre-fill edit form (only if it's our own profile)
  if (!isAudit) {
    editName.value = displayName;
    const displayEmailInput = document.getElementById('displayEmail');
    if (displayEmailInput) displayEmailInput.value = user.email;
  }

  const { data: proposals } = await supabase
    .from('movies')
    .select('*')
    .eq('proposed_by', activeUid)
    .eq('is_dropped', false);
    
  const { data: votes } = await supabase.from('votes').select('movie_id, movies(*)').eq('user_id', activeUid);

  countProposals.textContent = `${proposals?.length || 0} / ${MAX_PROPOSALS}`;
  countVotes.textContent = `${votes?.length || 0} / ${MAX_VOTES}`;

  // Default view is proposals
  renderActivityGrid(proposals || []);
  
  // Set up tab switching for profile
  document.querySelectorAll('.activity-tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelector('.activity-tab.active').classList.remove('active');
      tab.classList.add('active');
      const view = tab.dataset.view;
      renderActivityGrid(view === 'myProposals' ? (proposals || []) : (votes?.map(v => v.movies) || []));
    };
  });

  // ADMIN DASHBOARD logic
  if (isAdmin) {
    adminDashboard.classList.remove('page-hidden');
    await fetchUserList();
    await fetchParticipationLog();
  } else {
    adminDashboard.classList.add('page-hidden');
  }

  // Trophies rendering
  await renderProfileAchievements();

  if (window.lucide) window.lucide.createIcons();
}

window.toggleEditProfile = (show) => {
  const profileDisplay = document.getElementById('profileDisplay');
  const profileEditForm = document.getElementById('profileEditForm');
  if (profileDisplay) profileDisplay.classList.toggle('page-hidden', show);
  if (profileEditForm) profileEditForm.classList.toggle('page-hidden', !show);
};


window.saveProfile = async () => {
  const newName = editName.value.trim();
  const newAvatar = window.pendingAvatarUrl || profileAvatar.src;

  if (!newName) {
    showNotification('Name cannot be empty', 'error');
    return;
  }

  const { error } = await supabase
    .from('profiles')
    .update({ 
      full_name: newName
    })
    .eq('id', user.id);

  if (error) {
    console.error('Error updating profile:', error);
    showNotification('Failed to update profile', 'error');
  } else {
    showNotification('Profile updated successfully!', 'success');
    window.toggleEditProfile(false);
    window.pendingAvatarUrl = null;
    
    // Refresh local cache and UI
    const { data: updatedProfile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    userProfile = updatedProfile;
    
    await loadUserActivity();
    updateAuthUI(); // Update header too
  }
};

async function fetchParticipationLog() {
  if (!isAdmin) return;
  
  try {
    // Fetch everything in parallel since automatic joins are failing due to missing schema FKs
    const [proposalsRes, votesRes, ratingsRes, profilesRes] = await Promise.all([
      supabase.from('movies').select('title, created_at, proposed_by, tmdb_id').order('created_at', { ascending: false }).limit(30),
      supabase.from('votes').select('created_at, user_id, movie_id').order('created_at', { ascending: false }).limit(30),
      supabase.from('user_ratings').select('created_at, rating, user_id, movie_id').order('created_at', { ascending: false }).limit(30),
      supabase.from('profiles').select('id, full_name, email')
    ]);

    if (profilesRes.error) throw profilesRes.error;

    // Create a quick lookup map for profiles and movies
    const profileMap = {};
    (profilesRes.data || []).forEach(p => profileMap[p.id] = p);

    // We also need movie data for lookup
    const allMovies = [...proposedMovies, ...seenMovies];
    const movieLookup = {};
    allMovies.forEach(m => movieLookup[m.id] = { title: m.title, tmdb_id: m.tmdb_id });

    let logItems = [];

    // Process Proposals
    if (proposalsRes.data) {
      proposalsRes.data.forEach(p => {
        const prof = profileMap[p.proposed_by];
        logItems.push({
          user: prof?.full_name || prof?.email?.split('@')[0] || 'Unknown User',
          email: prof?.email || 'N/A',
          action: '<span class="action-tag proposal">Proposed</span>',
          points: '+5',
          movieTitle: p.title,
          tmdbId: p.tmdb_id,
          date: new Date(p.created_at)
        });
      });
    }

    // Process Votes
    if (votesRes.data) {
      votesRes.data.forEach(v => {
        const prof = profileMap[v.user_id];
        const mData = movieLookup[v.movie_id];
        logItems.push({
          user: prof?.full_name || prof?.email?.split('@')[0] || 'Unknown User',
          email: prof?.email || 'N/A',
          action: '<span class="action-tag vote">Voted</span>',
          points: '+1',
          movieTitle: mData?.title || 'Unknown Movie',
          tmdbId: mData?.tmdb_id,
          date: new Date(v.created_at)
        });
      });
    }

    // Process Ratings
    if (ratingsRes.data) {
      ratingsRes.data.forEach(r => {
        const prof = profileMap[r.user_id];
        const mData = movieLookup[r.movie_id];
        logItems.push({
          user: prof?.full_name || prof?.email?.split('@')[0] || 'Unknown User',
          email: prof?.email || 'N/A',
          action: `<span class="action-tag rating">Rated (${r.rating}/10)</span>`,
          points: '+3',
          movieTitle: mData?.title || 'Unknown Movie',
          tmdbId: mData?.tmdb_id,
          date: new Date(r.created_at)
        });
      });
    }

    // Sort combined log by date descending
    logItems.sort((a, b) => b.date - a.date);
    
    // Take top 40 recent actions
    const recentItems = logItems.slice(0, 40);

    if (recentItems.length === 0) {
      adminParticipationLog.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:2rem; color:var(--text-secondary);">No recent activity recorded.</td></tr>`;
      return;
    }

    adminParticipationLog.innerHTML = recentItems.map(item => {
      const name = item.user;
      const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=5850ec&color=fff&bold=true`;
      const movieLink = item.tmdbId ? `https://www.themoviedb.org/movie/${item.tmdbId}` : null;
      
      const movieDisplay = movieLink 
        ? `<a href="${movieLink}" target="_blank" class="movie-title-cell link">${item.movieTitle}</a>`
        : `<span class="movie-title-cell">${item.movieTitle}</span>`;

      return `
        <tr>
          <td>
            <div class="user-cell">
              <img src="${avatar}" alt="${name}">
              <span class="user-name">${name}</span>
            </div>
          </td>
          <td>${item.action}</td>
          <td>${movieDisplay}</td>
          <td><span class="points-badge">${item.points}</span></td>
          <td><span class="user-date">${item.date.toLocaleString()}</span></td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    adminParticipationLog.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:2rem; color:var(--error);">Failed to load participation log. Check console for details.</td></tr>`;
  }
}

async function updateGlobalRanking() {
  try {
    const [profilesRes, votesRes, moviesRes, ratingsRes, participationRes] = await Promise.all([
      supabase.from('profiles').select('*'),
      supabase.from('votes').select('user_id, movie_id, movies(is_seen)'),
      supabase.from('movies').select('proposed_by, is_dropped, is_seen'),
      supabase.from('user_ratings').select('user_id'),
      supabase.from('participation_log').select('user_id, action_type')
    ]);
    
    if (profilesRes.error) throw profilesRes.error;
    // Exclude admins from the competitive ranking
    const profiles = (profilesRes.data || []).filter(p => p.role !== 'admin');
    const votes = votesRes.data || [];
    const allMoviesList = moviesRes.data || [];
    const ratings = ratingsRes.data || [];
    const attendance = (participationRes.data || []).filter(p => p.action_type === 'attendance');

    // Calculate activity per user
    const userStats = {};
    profiles.forEach(p => {
      userStats[p.id] = { 
        votesNormal: 0, 
        votesSeen: 0, 
        proposalsActive: 0, 
        proposalsDropped: 0, 
        seenProposals: 0,
        ratings: 0,
        sessionsCount: 0,
        achievementsCount: 0,
        achievementPoints: 0
      };
    });

    votes.forEach(v => {
      if (!userStats[v.user_id]) return;
      if (v.movies?.is_seen) userStats[v.user_id].votesSeen++;
      else userStats[v.user_id].votesNormal++;
    });

    allMoviesList.forEach(m => {
      if (!userStats[m.proposed_by]) return;
      if (m.is_dropped) {
        userStats[m.proposed_by].proposalsDropped++;
      } else {
        userStats[m.proposed_by].proposalsActive++;
        if (m.is_seen) userStats[m.proposed_by].seenProposals++;
      }
    });

    ratings.forEach(r => {
      if (userStats[r.user_id]) userStats[r.user_id].ratings++;
    });

    attendance.forEach(a => {
      if (userStats[a.user_id]) userStats[a.user_id].sessionsCount++;
    });

    // Calculate Achievements for each user
    (profiles || []).forEach(p => {
      const stats = userStats[p.id];
      if (!stats) return;

      const earnedAchievements = ACHIEVEMENT_LIST.filter(def => {
        if (def.type === 'static') return true;
        if (def.type === 'ratings') return (stats.ratings || 0) >= def.target;
        if (def.type === 'attendance') return (stats.sessionsCount || 0) >= def.target;
        if (def.type === 'visionary') return (stats.seenProposals || 0) >= def.target;
        if (def.type === 'streak') return (stats.sessionsCount || 0) >= 3; 
        return false;
      });
      stats.achievementsCount = earnedAchievements.length;
      stats.achievementPoints = earnedAchievements.reduce((sum, ach) => sum + (ach.points || 0), 0);
    });

    // Final Score Calculation
    (profiles || []).forEach(p => {
      const s = userStats[p.id];
      if (!s) { p.score = 0; return; }
      p.score = (s.proposalsActive * 5) + 
                (s.proposalsDropped * 1) + 
                (s.votesNormal * 1) + 
                (s.votesSeen * 2) + 
                (s.ratings * 3) + 
                (s.achievementPoints);
    });

    // Sort by score descending
    profiles.sort((a, b) => b.score - a.score);
    
    // Assign Rank
    profiles.forEach((p, idx) => {
      p.rank = idx + 1;
    });

    rankedUsers = profiles;
    
    // Update current user profile cache with new rank and score
    if (user && userProfile) {
      const me = rankedUsers.find(u => u.id === user.id);
      if (me) {
        userProfile.rank = me.rank;
        userProfile.score = me.score;
        updateAuthUI(); // Keep header in sync
      }
    }

    renderRankingView();
  } catch (err) {
    console.error('Error updating global ranking:', err);
  }
}

function renderRankingView() {
  if (!rankingList) return;
  
  rankingList.innerHTML = rankedUsers.map(p => {
    const name = p.full_name || p.email.split('@')[0];
    const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=5850ec&color=fff&bold=true`;
    const rankClass = p.rank <= 3 ? `top-${p.rank}` : '';
    
    return `
      <tr>
        <td><span class="user-rank ${rankClass}">#${p.rank}</span></td>
        <td>
          <div class="user-cell">
            <img src="${avatar}" alt="${name}">
            <span class="user-name">${name}</span>
          </div>
        </td>
        <td>
          <div class="score-badge" onclick="window.navigateTo('ranking')" title="View Global Ranking">
            <i data-lucide="award" style="width:12px; height:12px; margin-right:4px;"></i>
            ${p.score}
          </div>
        </td>
      </tr>
    `;
  }).join('');
  
  if (window.lucide) window.lucide.createIcons();
}

async function fetchUserList() {
  try {
    // ranking is already updated by updateGlobalRanking() called in refreshData()
    const profiles = rankedUsers;

    adminUserCount.textContent = `${profiles?.length || 0} Users`;
    adminUserList.innerHTML = (profiles || []).map(p => {
      const name = p.full_name || p.email.split('@')[0];
      const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=5850ec&color=fff&bold=true`;
      const date = p.created_at ? new Date(p.created_at).toLocaleDateString() : 'N/A';
      const roleLabel = p.role === 'admin' ? '<span style="color:var(--success); font-size: 0.7rem; font-weight:700;">ADMIN</span>' : '<span style="color:var(--text-secondary); font-size: 0.7rem;">USER</span>';
      const rankClass = p.rank <= 3 ? `top-${p.rank}` : '';

      return `
        <tr class="admin-user-row clickable" onclick="window.viewUserProfile('${p.id}')">
          <td>
            <div class="user-cell">
              <span class="user-rank ${rankClass}">#${p.rank}</span>
              <img src="${avatar}" alt="${p.full_name || 'User'}">
              <div style="display:flex; flex-direction:column;">
                <span class="user-name">${p.full_name || 'Anonymous User'}</span>
                ${roleLabel}
              </div>
            </div>
          </td>
          <td><span class="user-email">${p.email}</span></td>
          <td>
            <div class="score-badge" title="View Global Ranking">
              <i data-lucide="award" style="width:12px; height:12px; margin-right:4px;"></i>
              ${p.score}
            </div>
          </td>
          <td><span class="user-date">${date}</span></td>
          <td>
            <div class="user-actions-cell" onclick="event.stopPropagation()">
              <button class="btn-icon view-btn" title="View Profile" onclick="window.viewUserProfile('${p.id}')">
                <i data-lucide="eye"></i>
              </button>
              ${p.id !== user?.id ? `
                <button class="delete-user-btn" onclick="window.deleteUser('${p.id}', '${name}')" title="Delete User">
                  <i data-lucide="user-minus"></i>
                </button>
              ` : '<span style="color:var(--text-secondary); font-size:0.7rem; font-style:italic;">(You)</span>'}
            </div>
          </td>
        </tr>
      `;
    }).join('');

    if (window.lucide) window.lucide.createIcons();

  } catch (err) {
    console.error('Error fetching user list:', err);
    adminUserList.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:2rem; color:var(--text-secondary);">Unable to fetch user list.</td></tr>`;
  }
}

// Attendance Logic
window.toggleCheckinDropdown = (userId) => {
  const dropdown = document.getElementById(`checkin-${userId}`);
  const allDropdowns = document.querySelectorAll('.checkin-dropdown');
  
  // Close others
  allDropdowns.forEach(d => { if (d.id !== `checkin-${userId}`) d.classList.remove('active'); });

  if (dropdown.classList.contains('active')) {
    dropdown.classList.remove('active');
  } else {
    // Populate with seen movies
    const sessions = [...seenMovies].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
    
    if (sessions.length === 0) {
      dropdown.innerHTML = '<div style="padding:0.5rem; font-size:0.7rem; color:var(--text-secondary);">No sessions available. Mark a movie as "Seen" first.</div>';
    } else {
      dropdown.innerHTML = sessions.map(m => `
        <button class="checkin-option" onclick="window.markAttendance('${userId}', '${m.id}')">
          <i data-lucide="play"></i> ${m.title}
        </button>
      `).join('');
    }
    
    dropdown.classList.add('active');
    if (window.lucide) window.lucide.createIcons();
  }
};

window.markAttendance = async (userId, movieId) => {
  if (!isAdmin) return;

  try {
    showNotification('Recording attendance...', 'info');
    
    // Check if already attended
    const { data: existing } = await supabase
      .from('participation_log')
      .select('*')
      .eq('user_id', userId)
      .eq('movie_id', movieId)
      .eq('action_type', 'attendance')
      .single();
    
    if (existing) {
      showNotification('User already checked-in for this session.', 'warning');
      return;
    }

    const { error } = await supabase.from('participation_log').insert([{
      user_id: userId,
      movie_id: movieId,
      action_type: 'attendance',
      points: 10
    }]);

    if (error) throw error;

    showNotification('Attendance recorded! (+10 pts)', 'success');
    
    // Auto-refresh UI
    const dropdown = document.getElementById(`checkin-${userId}`);
    if (dropdown) dropdown.classList.remove('active');
    
    refreshData();
    
  } catch (err) {
    console.error('Error marking attendance:', err);
    showNotification('Failed to record attendance.', 'error');
  }
};

window.deleteUser = async (userId, userName) => {
  if (!isAdmin) return;
  
  const confirmed = window.confirm(`⚠️ DANGER ZONE: Are you sure you want to delete user "${userName}"? \n\nThis will also remove all their movie proposals, votes and ratings. This action cannot be undone.`);
  if (!confirmed) return;

  try {
    showNotification(`Deleting user ${userName}...`, 'warning');
    // 1. Delete user's votes (Standard table: votes)
    console.log(' - Cleaning votes...');
    await supabase.from('votes').delete().eq('user_id', userId);
    
    // 2. Delete user's ratings (stars on seen movies)
    console.log(' - Cleaning user_ratings...');
    await supabase.from('user_ratings').delete().eq('user_id', userId);

    // 3. Delete user's participation logs (points and attendance history)
    console.log(' - Cleaning participation_log...');
    await supabase.from('participation_log').delete().eq('user_id', userId);
    
    // 5. Delete user's movie proposals
    console.log(' - Cleaning movie proposals...');
    const { error: e5 } = await supabase.from('movies').delete().eq('proposed_by', userId);
    if (e5) console.error('Error cleaning movies:', e5);
    
    // 6. Finally, delete user's profile
    console.log(' - Deleting profile record...');
    const { error: profileError } = await supabase.from('profiles').delete().eq('id', userId);
    
    if (profileError) {
      console.error('CRITICAL: Error deleting profile:', profileError);
      throw profileError;
    }

    console.log(`[Admin] User ${userName} successfully removed from the system.`);
    showNotification(`User ${userName} and all their data have been removed.`, 'success');
    
    // Refresh UI
    await updateGlobalRanking();
    await fetchUserList();
    await fetchParticipationLog();
    await refreshData();
  } catch (err) {
    console.error('Error deleting user:', err);
    showNotification(`Error: ${err.message || 'System error deleting user'}`, 'error');
  }
};

window.unmarkAsSeen = async (movieId) => {
  if (!isAdmin) return;
  const { error } = await supabase.from('movies').update({ is_seen: false }).eq('id', movieId);
  if (error) {
    console.error('Error unmarking as seen:', error);
    showNotification('Failed to revert status', 'error');
  } else {
    showNotification('Movie moved back to proposals', 'success');
    await refreshData();
  }
};

function renderActivityGrid(movies) {
  if (!movies || movies.length === 0) {
    profileActivityGrid.innerHTML = '<div class="empty-state">Nothing to show here yet.</div>';
    return;
  }
  profileActivityGrid.innerHTML = movies.map(movie => {
    return createMovieCardHTML(movie, { 
      context: 'activity', 
      showDelete: true 
    });
  }).join('');
  
  if (window.lucide) window.lucide.createIcons();
}

// TMDB Search Logic
let searchTimeout;
async function searchTMDB(query) {
  if (!user || !query) {
    searchResults.classList.remove('active');
    return;
  }

  try {
    const data = await invokeTMDBCall('/search/movie', { query, include_adult: 'false' });
    

    // No restrictive filtering - just sort by popularity (desc) and take top 20
    const results = (data.results || [])
      .sort((a, b) => b.popularity - a.popularity)
      .slice(0, 20);

    const enrichedResults = await Promise.all(results.map(async movie => {
      try {
        const creditsData = await invokeTMDBCall(`/movie/${movie.id}/credits`);
        const directors = creditsData.crew
          .filter(person => person.job === 'Director')
          .map(d => d.name)
          .join(', ');
        
        // Map genres
        const genreNames = movie.genre_ids.map(id => genreMap[id]).filter(Boolean);

        return { ...movie, director: directors || 'Unknown Director', genres: genreNames, synopsis: movie.overview };
      } catch (e) {
        return { ...movie, director: 'Unknown Director', genres: [], synopsis: movie.overview };
      }
    }));

    renderSearchResults(enrichedResults);
  } catch (err) {
    console.error('TMDB Search error:', err);
  }
}

// Explore Logic
async function fetchExploreResults() {
  const query = document.getElementById('exploreTitle').value.trim();
  const directorName = document.getElementById('exploreDirector').value.trim();
  const actorName = document.getElementById('exploreActor').value.trim();
  const genreId = exploreGenreSelect.value;
  const yearFrom = document.getElementById('exploreYearFrom').value;
  const yearTo = document.getElementById('exploreYearTo').value;
  const limitValue = document.getElementById('exploreLimit').value;
  const sortValue = document.getElementById('exploreSort').value;
  const providerId = document.getElementById('exploreProvider').value;
  const limit = parseInt(limitValue) || 20;

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
      const personRequests = [];
      if (directorName) personRequests.push(invokeTMDBCall('/search/person', { query: directorName }));
      if (actorName) personRequests.push(invokeTMDBCall('/search/person', { query: actorName }));
      
      const [directorRes, actorRes] = await Promise.all([
        directorName ? invokeTMDBCall('/search/person', { query: directorName }) : null,
        actorName ? invokeTMDBCall('/search/person', { query: actorName }) : null
      ]);

      if (directorRes?.results?.length > 0) {
        // Prioritize people in the 'Directing' department
        let directors = directorRes.results.filter(p => p.known_for_department === 'Directing');
        let bestDirector = directors.length > 0 ? directors : directorRes.results;
        directorId = bestDirector.sort((a,b) => b.popularity - a.popularity)[0].id;
        discoverParams.with_crew = directorId;
      }
      if (actorRes?.results?.length > 0) {
        // Prioritize people in the 'Acting' department
        let actors = actorRes.results.filter(p => p.known_for_department === 'Acting');
        let bestActor = actors.length > 0 ? actors : actorRes.results;
        actorId = bestActor.sort((a,b) => b.popularity - a.popularity)[0].id;
        discoverParams.with_cast = actorId;
      }
    }

    // 2. Fetch Results
    if (query && !directorId && !actorId) {
      // Title search only
      const pagesToFetch = Math.max(1, Math.ceil(limit / 20));
      const pages = await Promise.all(
        Array.from({ length: pagesToFetch }, (_, i) => 
          invokeTMDBCall('/search/movie', { query, page: i + 1 })
        )
      );
      results = pages.flatMap(p => p.results || []);
    } else {
      // Discover (supports combinations of Director, Actor, Genre, Year, Provider)
      const pagesToFetch = Math.max(1, Math.min(5, Math.ceil(limit / 20)));
      const responses = await Promise.all(
        Array.from({ length: pagesToFetch }, (_, i) => 
          invokeTMDBCall('/discover/movie', { ...discoverParams, page: i + 1 })
        )
      );
      results = responses.flatMap(r => r.results || []);
    }

    // Secondary client-side title filter if Title + Person were provided
    if (query && (directorId || actorId)) {
      results = results.filter(m => normalize(m.title).includes(normalize(query)));
    }

    // 3. Final Enrichment & Detail Fetching
    const finalResults = results.slice(0, limit);
    const enriched = await Promise.all(finalResults.map(async movie => {
      try {
        const details = await invokeTMDBCall(`/movie/${movie.id}`, {
          append_to_response: 'videos,watch/providers,credits'
        });
        
        const directors = details.credits?.crew
          ?.filter(p => p.job === 'Director')
          .map(d => d.name) || [];
        const movieGenres = details.genres?.map(g => g.name) || [];
        const trailer = details.videos?.results?.find(v => v.type === 'Trailer' && v.site === 'YouTube');
        
        return {
          ...details,
          director: directors.join(', ') || 'Unknown Director',
          genres: movieGenres,
          synopsis: details.overview,
          trailer_url: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
          watch_providers: details['watch/providers']?.results?.ES
        };
      } catch (e) {
        return { ...movie, director: 'Unknown', genres: [], synopsis: movie.overview };
      }
    }));

    renderExploreResults(enriched);
  } catch (err) {
    console.error('Explore error:', err);
    exploreGrid.innerHTML = '<div class="empty-state">Discovery session failed. Try adjusting your filters.</div>';
  }
}

// AI Scout Engine
function shouldUseWebSearch(query) {
  const currentTriggers = ['2025', '2026', 'oscars', 'actualidad', 'estrenos', 'hoy', 'reciente', 'winners', '2027'];
  return currentTriggers.some(t => query.toLowerCase().includes(t));
}

async function fetchAIRecommendations() {
  const query = document.getElementById('aiSearchInput').value;
  if (!query) return;

  const apertureOverlay = document.getElementById('apertureOverlay');
  if (apertureOverlay) apertureOverlay.classList.add('active');

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
          const searchData = await invokeTMDBCall('/search/movie', { query: title });
          const found = searchData.results?.[0];

          if (found && !renderedIds.has(found.id)) {
            // 2. Fetch Rich Details via Proxy
            const detailData = await invokeTMDBCall(`/movie/${found.id}`, {
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
        const card = createExploreCard(movie);
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

function createExploreCard(movie) {
  const div = document.createElement('div');
  div.innerHTML = createMovieCardHTML(movie, { context: 'explore' });
  return div.firstElementChild;
}

function renderExploreResults(results) {
  exploreGrid.innerHTML = ''; // Clear everything
  if (!results.length) {
    exploreGrid.innerHTML = '<div class="empty-state">No movies found matching those criteria.</div>';
    return;
  }
  results.forEach(movie => {
    exploreGrid.appendChild(createExploreCard(movie));
  });
  if (window.lucide) window.lucide.createIcons();
}

function renderSearchResults(results) {
  if (!results.length) {
    searchResults.innerHTML = '<div class="search-result-item">No movies found</div>';
  } else {
    searchResults.innerHTML = results.map(movie => `
      <div class="search-result-item" onclick="window.proposeMovie(${JSON.stringify(movie).replace(/"/g, '&quot;')})">
        <img class="result-poster" src="${movie.poster_path ? 'https://image.tmdb.org/t/p/w92' + movie.poster_path : FALLBACK_IMAGE}">
        <div class="result-info">
          <div class="result-title">${movie.title}</div>
          <div class="result-meta">
            <span>${movie.release_date ? movie.release_date.split('-')[0] : 'N/A'}</span>
            <span style="color: rgba(255,255,255,0.2);">•</span>
            <div class="rating-badge" style="margin:0; padding:0; background:transparent; border:none; font-size: 0.75rem;">
              <i data-lucide="star" style="width:12px; height:12px; fill:#fbbf24;"></i>
              <span style="color:#fbbf24;">${formatScore(movie.vote_average)}</span>
            </div>
          </div>
          <div style="font-size: 0.7rem; color: var(--text-secondary); opacity: 0.7;">${movie.director}</div>
        </div>
      </div>
    `).join('');
  }
  searchResults.classList.add('active');
}

// Actions
window.proposeMovie = async (tmdbMovie, el) => {
  if (!user) {
    window.navigateTo('auth');
    return;
  }

  // Check limits
  const userProposals = proposedMovies.filter(m => m.proposed_by === user.id);
  if (userProposals.length >= MAX_PROPOSALS && !isAdmin) {
    showNotification(`Limit reached! You can only have ${MAX_PROPOSALS} active proposals.`, 'warning');
    return;
  }

  const card = el?.closest('.movie-card');

  // 🪦 RESURRECTION LOGIC: Check if movie is in the cemetery
  const { data: existing, error: checkError } = await supabase
    .from('movies')
    .select('*')
    .eq('tmdb_id', tmdbMovie.id)
    .single();

  if (existing && existing.is_dropped) {
    if (confirm(`"${tmdbMovie.id}" is currently in the Cinema Cemetery. Do you want to rescue it and bring it back to active proposals?`)) {
      const { error: rescueError } = await supabase
        .from('movies')
        .update({ is_dropped: false, proposed_by: user.id })
        .eq('id', existing.id);
      
      if (!rescueError) {
        showNotification(`"${tmdbMovie.title}" has been rescued from the cemetery!`, 'success');
        refreshData();
        return;
      }
    } else {
      return; // User cancelled rescue
    }
  }

  // SAFE INSERT LOGIC
  const payload = {
    title: tmdbMovie.title,
    release_year: tmdbMovie.release_date ? parseInt(tmdbMovie.release_date.split('-')[0]) : null,
    poster_url: tmdbMovie.poster_path ? `https://image.tmdb.org/t/p/w500${tmdbMovie.poster_path}` : null,
    tmdb_id: tmdbMovie.id,
    proposed_by: user.id,
    director: tmdbMovie.director,
    genres: tmdbMovie.genres,
    synopsis: tmdbMovie.synopsis
  };

  // Insert logic matching actual schema
  let { data, error } = await supabase.from('movies').insert([{
    ...payload,
    average_rating: tmdbMovie.vote_average || 0,
    vote_count: 0 // Start with zero festival votes
  }]).select();

  if (error) {
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
  } else {
    showNotification(`"${tmdbMovie.title}" proposed!`, 'success');

    // Automatically add user's vote to their own proposal
    try {
      if (data && data[0]) {
        await supabase.from('votes').insert([{ user_id: user.id, movie_id: data[0].id }]);
      }
    } catch (vErr) {
      console.error('Auto-vote failed:', vErr);
    }

    if (card) {
      card.style.transform = 'scale(1.05)';
      card.style.borderColor = 'var(--success)';
      setTimeout(() => {
        card.style.transform = '';
        card.style.borderColor = '';
      }, 500);
    }
    searchInput.value = '';
    searchResults.classList.remove('active');
    await refreshData();
  }
};

window.toggleVote = async (movieId) => {
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
    const { error } = await supabase.from('votes').delete().match({ user_id: user.id, movie_id: movieId });
    if (!error) {
      userVotes.delete(movieId);
      movie.vote_count = (movie.vote_count || 1) - 1;
      if (btn) btn.classList.remove('active');
      if (countEl) countEl.textContent = `${movie.vote_count} votes`;
    }
  } else {
    // Check vote limits
    console.log(`[Vote] User Votes: ${userVotes.size} / ${MAX_VOTES} | Admin: ${isAdmin}`);
    
    if (userVotes.size >= MAX_VOTES && !isAdmin) {
      showNotification(`Limit reached! You have already used your ${MAX_VOTES} votes.`, 'warning');
      return;
    }

    // Vote
    const { error } = await supabase.from('votes').insert([{ user_id: user.id, movie_id: movieId }]);
    if (!error) {
      userVotes.add(movieId);
      movie.vote_count = (movie.vote_count || 0) + 1;
      if (btn) btn.classList.add('active');
      if (countEl) countEl.textContent = `${movie.vote_count} votes`;
    }
  }
  updateAuthUI();
};

window.markAsSeen = async (movieId) => {
  const { error } = await supabase.from('movies').update({ is_seen: true }).eq('id', movieId);
  if (error) console.error('Error marking as seen:', error);
  else await refreshData();
};

window.rateMovie = async (movieId, rating) => {
  if (!user) return;
  
  // Update state for immediate feedback
  const movie = seenMovies.find(m => m.id === movieId);
  if (movie) movie.user_rating = rating;

  const { error } = await supabase
    .from('user_ratings')
    .upsert({ 
      movie_id: movieId, 
      user_id: user.id, 
      rating: parseInt(rating) 
    }, { onConflict: 'movie_id,user_id' });

  if (error) {
    console.error('Error rating movie:', error);
    showNotification('Error saving rating', 'error');
  } else {
    showNotification('Rating saved!', 'success');
    // Instant UI update
    syncLocalRating(movieId, rating);
    const valLabel = document.getElementById(`rating-val-${movieId}`);
    if (valLabel) valLabel.textContent = `${rating} / 10`;
    
    const container = document.querySelector(`[onmouseleave*="${movieId}"]`);
    if (container) {
      container.setAttribute('onmouseleave', `window.resetStars('${movieId}', ${rating})`);
    }
    
    // Refresh the star visuals
    window.resetStars(movieId, rating);
    
    // Update community average
    await updateCommunityAverage(movieId);
  }
};

function syncLocalRating(movieId, rating) {
  const movie = seenMovies.find(m => m.id === movieId);
  if (movie) movie.user_rating = rating;
}

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

async function updateCommunityAverage(movieId) {
  const { data, error } = await supabase
    .from('user_ratings')
    .select('rating')
    .eq('movie_id', movieId);

  if (!error && data.length > 0) {
    const avg = data.reduce((sum, r) => sum + r.rating, 0) / data.length;
    const avgLabel = document.getElementById(`comm-avg-${movieId}`);
    if (avgLabel) avgLabel.textContent = avg.toFixed(1);
  }
}

function setupEventListeners() {
  supabase.auth.onAuthStateChange(async (event, session) => {
    await checkUser(session);
    refreshData();
  });

  window.addEventListener('hashchange', handleRouting);

  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => searchTMDB(e.target.value), 500);
  });

  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
      searchResults.classList.remove('active');
    }
  });

  // Auth Tab Toggling
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelector('.auth-tab.active').classList.remove('active');
      tab.classList.add('active');
      const isLogin = tab.dataset.tab === 'login';
      document.getElementById('loginForm').classList.toggle('page-hidden', !isLogin);
      document.getElementById('signupForm').classList.toggle('page-hidden', isLogin);
    };
  });

  // Explore Controls
  document.getElementById('exploreSearchBtn').onclick = fetchExploreResults;
  document.getElementById('aiSearchBtn').onclick = fetchAIRecommendations;
  
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelector('.mode-tab.active').classList.remove('active');
      tab.classList.add('active');
      const isAI = tab.dataset.mode === 'ai';
      document.getElementById('manualSearchPanel').classList.toggle('page-hidden', isAI);
      document.getElementById('aiSearchPanel').classList.toggle('page-hidden', !isAI);
      exploreGrid.innerHTML = '<div class="empty-state">Start searching to discover films.</div>';
    };
  });

  // Admin Tabs
  document.querySelectorAll('.admin-tab-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelector('.admin-tab-btn.active').classList.remove('active');
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      document.getElementById('adminUsersTab').classList.toggle('page-hidden', tab !== 'users');
      document.getElementById('adminSessionsTab').classList.toggle('page-hidden', tab !== 'sessions');
      document.getElementById('adminLogsTab').classList.toggle('page-hidden', tab !== 'logs');
      document.getElementById('adminSettingsTab').classList.toggle('page-hidden', tab !== 'settings');
      if (tab === 'settings') loadAppSettings();
    };
  });

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
    exploreGrid.innerHTML = '<div class="empty-state">Start searching to discover films.</div>';
  };
}

/* --- Achievements System Logic --- */
const ACHIEVEMENT_LIST = [
  {
    id: 'oracle',
    name: 'The Oracle',
    desc: 'You have shaped the festival: 3 of your proposals have been screened!',
    icon: 'sparkles',
    target: 3,
    type: 'visionary',
    class: 'medal-oracle',
    points: 50
  },
  {
    id: 'visionary',
    name: 'The Visionary',
    desc: 'One of your proposed movies has been screened!',
    icon: 'eye',
    target: 1,
    type: 'visionary',
    class: 'medal-visionary',
    points: 20
  },
  {
    id: 'miembro',
    name: 'Festival Member',
    desc: 'You have joined our cinephile community.',
    icon: 'user-check',
    target: 1,
    type: 'static',
    class: 'medal-miembro',
    points: 5
  },
  {
    id: 'streak',
    name: 'Cinema Streak',
    desc: 'You have attended 3 sessions in a row!',
    icon: 'zap',
    target: 1,
    type: 'streak',
    class: 'medal-streak',
    points: 20
  },
  {
    id: 'debut',
    name: 'Grand Premiere',
    desc: 'You attended your first physical session.',
    icon: 'ticket',
    target: 1,
    type: 'attendance',
    class: 'medal-attendance',
    points: 10
  },
  {
    id: 'regular',
    name: 'Festival Regular',
    desc: 'You have attended 3 physical sessions.',
    icon: 'calendar',
    target: 3,
    type: 'attendance',
    class: 'medal-attendance',
    points: 15
  },
  {
    id: 'legend',
    name: 'Cinema Legend',
    desc: 'You have attended 5 physical sessions.',
    icon: 'crown',
    target: 5,
    type: 'attendance',
    class: 'medal-attendance',
    points: 25
  },
  {
    id: 'feroz',
    name: 'Fierce Critic',
    desc: 'You have rated 5 or more movies.',
    icon: 'clapperboard',
    target: 5,
    type: 'ratings',
    class: 'medal-feroz',
    points: 10
  },
  {
    id: 'oro',
    name: 'Golden Cinephile',
    desc: 'You have rated 10 or more movies.',
    icon: 'award',
    target: 10,
    type: 'ratings',
    class: 'medal-oro',
    points: 15
  },
  {
    id: 'trend',
    name: 'Trendsetter',
    desc: 'A movie proposed by you entered the Top 3 voted list.',
    icon: 'trending-up',
    target: 1,
    type: 'trend',
    class: 'medal-trend',
    points: 10
  }
];

/**
 * Calculates achievement progress for a specific user.
 */
async function calculateUserAchievements(userId) {
  // Return all medals with 0 progress if no user
  if (!userId) return ACHIEVEMENT_LIST.map(a => ({ ...a, progress: 0, current: 0, completed: false }));

  try {
    const { count: ratingsCount } = await supabase
      .from('user_ratings')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    const top3Movies = [...proposedMovies]
      .sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0))
      .slice(0, 3);
    
    const hasTop3 = top3Movies.some(m => m.proposed_by === userId);

    // Fetch attendance from participation_log
    const { data: attendanceLogs } = await supabase
      .from('participation_log')
      .select('movie_id')
      .eq('user_id', userId)
      .eq('action_type', 'attendance');
    
    const attendanceCount = attendanceLogs?.length || 0;
    const attendedMovieIds = new Set(attendanceLogs?.map(l => l.movie_id) || []);

    // Visionary Logic: One of your proposals is marked as seen
    const { count: seenCount } = await supabase
      .from('movies')
      .select('*', { count: 'exact', head: true })
      .eq('proposed_by', userId)
      .eq('is_seen', true);

    // Streak Logic: Attended the last 3 "seen" movies
    const last3Seen = [...seenMovies]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 3);
    
    const hasStreak = last3Seen.length >= 3 && last3Seen.every(m => attendedMovieIds.has(m.id));

    return ACHIEVEMENT_LIST.map(achievement => {
      let current = 0;
      let completed = false;

      if (achievement.type === 'static') {
        current = 1;
        completed = true;
      } else if (achievement.type === 'ratings') {
        current = ratingsCount || 0;
        completed = current >= achievement.target;
      } else if (achievement.type === 'attendance') {
        current = attendanceCount;
        completed = current >= achievement.target;
      } else if (achievement.type === 'streak') {
        current = hasStreak ? 1 : 0;
        completed = hasStreak;
      } else if (achievement.type === 'trend') {
        current = hasTop3 ? 1 : 0;
        completed = hasTop3;
      } else if (achievement.type === 'visionary') {
        current = seenCount || 0;
        completed = current >= achievement.target;
      }

      const progress = Math.min(100, (current / achievement.target) * 100);
      if (completed) current = achievement.target;

      return { ...achievement, current, completed, progress };
    });
  } catch (e) {
    console.error('Error calculating achievements:', e);
    return ACHIEVEMENT_LIST.map(a => ({ ...a, progress: 0, current: 0, completed: false }));
  }
}

async function calculateGlobalAchievementStats() {
  const stats = { miembro: 0, feroz: 0, oro: 0, trend: 0, streak: 0, debut: 0, regular: 0, legend: 0 };
  try {
    // Count total unique profiles for 'miembro'
    const { data: profiles } = await supabase.from('profiles').select('id');
    stats.miembro = profiles?.length || 0;

    const { data: allRatings } = await supabase.from('user_ratings').select('user_id');
    const ratingsMap = {};
    allRatings?.forEach(r => { ratingsMap[r.user_id] = (ratingsMap[r.user_id] || 0) + 1; });

    Object.values(ratingsMap).forEach(count => {
      if (count >= 5) stats.feroz++;
      if (count >= 10) stats.oro++;
    });

    const top3Movies = [...proposedMovies].sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0)).slice(0, 3);
    const trendsetters = new Set(top3Movies.map(m => m.proposed_by));
    stats.trend = trendsetters.size;

    // Attendance stats
    const { data: allAttendance } = await supabase.from('participation_log').select('user_id').eq('action_type', 'attendance');
    const attMap = {};
    allAttendance?.forEach(a => { attMap[a.user_id] = (attMap[a.user_id] || 0) + 1; });

    Object.values(attMap).forEach(count => {
      if (count >= 1) stats.debut++;
      if (count >= 3) stats.regular++;
      if (count >= 5) stats.legend++;
    });

  } catch (e) {
    console.error('Error calculating global stats:', e);
  }
  return stats;
}

async function renderHomeAchievements() {
  const grid = document.getElementById('homeAchievementsGrid');
  if (!grid) return;

  const stats = await calculateGlobalAchievementStats();

  grid.innerHTML = ACHIEVEMENT_LIST.map(a => {
    const userCount = stats[a.id] || 0;
    return `
      <div class="achievement-card ${a.class} active">
        <div class="achievement-header">
          <div class="medal-icon-wrapper">
            <i data-lucide="${a.icon}"></i>
          </div>
          <div class="achievement-info">
            <span class="achievement-name">${a.name}</span>
            <span class="achievement-desc">${a.desc}</span>
            <div class="achievement-stats-badge">
              <i data-lucide="users" style="width:12px; height:12px;"></i>
              ${userCount} users earned this
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();
}

async function renderProfileAchievements() {
  const grid = document.getElementById('profileAchievementsGrid');
  if (!grid) return;

  const achievements = await calculateUserAchievements(user?.id);

  grid.innerHTML = achievements.map(a => `
    <div class="achievement-card ${a.class} ${a.completed ? 'completed active' : 'locked'}">
      <i data-lucide="check-circle" class="completed-check"></i>
      <div class="achievement-header">
        <div class="medal-icon-wrapper">
          <i data-lucide="${a.icon}"></i>
        </div>
        <div class="achievement-info">
          <span class="achievement-name">${a.name}</span>
          <span class="achievement-desc">${a.desc}</span>
        </div>
      </div>
      
      <div class="achievement-progress-section">
        <div class="progress-label-row">
          <span>Progress</span>
          <span>${a.current} / ${a.target}</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width: ${a.progress}%"></div>
        </div>
      </div>
    </div>
  `).join('');

  if (window.lucide) window.lucide.createIcons();
}

/**
 * Helper to format date as "time ago"
 */
function timeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  let interval = seconds / 31536000;
  if (interval > 1) return `${Math.floor(interval)} years ago`;
  interval = seconds / 2592000;
  if (interval > 1) return `${Math.floor(interval)} months ago`;
  interval = seconds / 86400;
  if (interval > 1) return `${Math.floor(interval)} days ago`;
  interval = seconds / 3600;
  if (interval > 1) return `${Math.floor(interval)} hours ago`;
  interval = seconds / 60;
  if (interval > 1) return `${Math.floor(interval)} min ago`;
  return 'just now';
}

/**
 * Fetches recent achievement events
 */
async function fetchRecentAchievementEvents() {
  const events = [];
  try {
    // Fetch all necessary data to calculate achievements globally
    const [profiles, allRatings, allAttendance, allMovies] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email, created_at').order('created_at', { ascending: false }).limit(20),
      supabase.from('user_ratings').select('user_id, created_at, movie_id'),
      supabase.from('participation_log').select('user_id, created_at, action_type'),
      supabase.from('movies').select('proposed_by, is_seen, title, created_at')
    ]);

    console.log('[Timeline] Supabase Data:', {
      profiles: profiles.data?.length || 0,
      ratings: allRatings.data?.length || 0,
      logs: allAttendance.data?.length || 0,
      movies: allMovies.data?.length || 0
    });

    if (profiles.error) return;

    // 1. Join Events (Festival Member)
    profiles.data?.forEach(p => {
      events.push({
        type: 'miembro',
        icon: 'user-check',
        userId: p.id,
        name: p.full_name || p.email.split('@')[0],
        date: new Date(p.created_at),
        text: 'earned the <span class="event-medal-name">Festival Member</span> medal'
      });
    });

    // 2. Ratings Milestones (Unique movies only, sorted by date)
    const ratingStats = {};
    const processedRatings = (allRatings.data || []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    
    processedRatings.forEach(r => {
      if (!ratingStats[r.user_id]) ratingStats[r.user_id] = new Set();
      ratingStats[r.user_id].add(r.movie_id);
      
      const count = ratingStats[r.user_id].size;
      if (count === 5 || count === 10) {
        const isOro = count === 10;
        // Only add if not already added for this specific count (avoiding duplicates if logic runs twice)
        events.push({
          type: isOro ? 'oro' : 'feroz',
          icon: isOro ? 'award' : 'clapperboard',
          userId: r.user_id,
          date: new Date(r.created_at),
          text: `earned the <span class="event-medal-name">${isOro ? 'Golden Cinephile' : 'Fierce Critic'}</span> medal`
        });
      }
    });

    // 3. Attendance Milestones (Sorted by date)
    const attendanceStats = {};
    const processedAttendance = (allAttendance.data || [])
      .filter(a => a.action_type === 'attendance')
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    processedAttendance.forEach(a => {
      if (!attendanceStats[a.user_id]) attendanceStats[a.user_id] = 0;
      attendanceStats[a.user_id]++;

      const count = attendanceStats[a.user_id];
      if (count === 1 || count === 3 || count === 5) {
        let medal = '';
        let icon = '';
        if (count === 1) { medal = 'Grand Premiere'; icon = 'ticket'; }
        else if (count === 3) { medal = 'Festival Regular'; icon = 'calendar'; }
        else if (count === 5) { medal = 'Cinema Legend'; icon = 'crown'; }

        events.push({
          type: 'asistencia',
          icon: icon,
          userId: a.user_id,
          date: new Date(a.created_at),
          text: `earned the <span class="event-medal-name">${medal}</span> medal`
        });
      }
    });

    // 4. Visionary Milestones (ONLY for SEEN movies, sorted by when they were proposed)
    const visionaryStats = {};
    const seenMoviesData = (allMovies.data || [])
      .filter(m => m.is_seen)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    seenMoviesData.forEach(m => {
      if (!visionaryStats[m.proposed_by]) visionaryStats[m.proposed_by] = 0;
      visionaryStats[m.proposed_by]++;

      const count = visionaryStats[m.proposed_by];
      if (count === 1 || count === 3) {
        const isOracle = count === 3;
        events.push({
          type: 'visionary',
          icon: isOracle ? 'sparkles' : 'eye',
          userId: m.proposed_by,
          date: new Date(m.created_at || Date.now()), // Ideally this would be 'seen_at', using created_at as proxy for now
          text: `earned the <span class="event-medal-name">${isOracle ? 'The Oracle' : 'The Visionary'}</span> medal`
        });
      }
    });

    // Enrich names and STRICT FILTER
    const eventUserIds = [...new Set(events.filter(e => e.userId).map(e => e.userId))];
    
    // Get ALL active profile IDs to ensure we don't show ghosts
    console.log(`[Timeline] Generated ${events.length} total raw events.`);
    const { data: activeProfiles, error: profError } = await supabase.from('profiles').select('id, full_name, email');
    
    if (profError) {
      console.error('[Timeline] Error fetching active profiles:', profError);
      // Fallback: Use what we have without strict filtering if we can't verify
      events.sort((a, b) => b.date - a.date);
      renderAchievementTimeline(events.slice(0, 5));
      return;
    }

    const activeUserMap = {};
    activeProfiles?.forEach(p => activeUserMap[p.id] = p.full_name || p.email.split('@')[0]);

    // Final Filter: The user MUST exist in activeProfiles
    const filteredEvents = events.filter(e => activeUserMap[e.userId]);
    console.log(`[Timeline] ${filteredEvents.length} events survived the active user filter.`);

    filteredEvents.forEach(e => {
      if (e.userId) e.name = activeUserMap[e.userId] || e.name;
    });

    // Sort and render
    filteredEvents.sort((a, b) => b.date - a.date);
    renderAchievementTimeline(filteredEvents.slice(0, 5));

  } catch (err) {
    console.error('Error fetching achievement events:', err);
  }
}

async function renderAchievementTimeline(events) {
  const body = document.getElementById('timelineBody');
  if (!body) {
    console.error('[Timeline] Target element #timelineBody not found in DOM');
    return;
  }
  
  const safeEvents = events || [];
  
  // CRITICAL FIX: If we already have items and the new update is empty, 
  // do NOT clear the UI. This prevents the "flash" of empty state.
  if (safeEvents.length === 0 && body.children.length > 1) {
    console.log('[Timeline] Ignoring empty update to preserve existing items.');
    return;
  }

  console.log(`[Timeline] Rendering ${safeEvents.length} items to #timelineBody:`, safeEvents);
  
  if (safeEvents.length === 0) {
    body.innerHTML = `<tr><td colspan="2" style="text-align:center; padding: 2rem; color: var(--text-secondary);">No recent activity yet.</td></tr>`;
    return;
  }

  // Simplified and more robust HTML structure
  const html = safeEvents.map(e => `
    <tr class="timeline-row event-${e.type}">
      <td>
        <div class="event-user-cell">
          <div class="event-icon-circle">
            <i data-lucide="${e.icon || 'star'}"></i>
          </div>
          <div class="event-content">
            <div class="event-message">
              <span class="event-name">${e.name || 'User'}</span> ${e.text}
            </div>
            <div class="event-date">${timeAgo(e.date)}</div>
          </div>
        </div>
      </td>
    </tr>
  `).join('');

  body.innerHTML = html;
  console.log('[Timeline] HTML successfully injected into DOM.');

  // More robust icon refresh
  const refreshIcons = () => {
    if (window.lucide) {
      window.lucide.createIcons();
      console.log('[Timeline] Lucide icons refreshed.');
    } else {
      console.warn('[Timeline] Lucide not found, retrying...');
      setTimeout(refreshIcons, 200);
    }
  };
  
  setTimeout(refreshIcons, 100);
}

// Intercept lifecycle to render achievements - REMOVED WRAPPING

// Direct calls added to refreshData and loadUserActivity





/* --- Session System Logic --- */

async function fetchSessions() {
  const { data, error } = await supabase
    .from('sessions')
    .select('*, movies(*), session_signups(user_id, profiles(full_name))')
    .order('session_date', { ascending: false });

  if (!error) {
    sessions = data || [];
  }
}

function renderAvatarStack(signups) {
  if (!signups || signups.length === 0) return '';
  
  const limit = 3;
  const displayed = signups.slice(0, limit);
  const moreCount = signups.length - limit;
  const allNames = signups.map(s => s.profiles?.full_name || 'Anonymous').join('\n');

  return `
    <div class="avatar-stack" data-tooltip="Interested:\n${allNames}">
      ${moreCount > 0 ? `<div class="more-count">+${moreCount}</div>` : ''}
      ${displayed.reverse().map(s => `
        <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(s.profiles?.full_name || 'A')}&background=random" alt="Avatar">
      `).join('')}
    </div>
  `;
}

function renderSessions() {
  if (!sessionsGrid) return;
  
  if (sessions.length === 0) {
    sessionsGrid.innerHTML = '<div class="empty-state">No sessions scheduled yet.</div>';
    return;
  }

  sessionsGrid.innerHTML = sessions.map(session => {
    const poster = session.movie_id ? (session.movies?.poster_url || FALLBACK_IMAGE) : TBD_POSTER;
    const title = session.movie_id ? session.movies?.title : 'Film To Be Decided';
    
    return `
      <div class="session-card" onclick="window.openSessionDetail('${session.id}')">
        <div class="session-card-poster">
          <img src="${poster}" alt="${title}">
        </div>
        <div class="session-card-content">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:0.5rem;">
            <div class="session-date-badge">
              ${new Date(session.session_date).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
            ${renderAvatarStack(session.session_signups)}
          </div>
          <div class="session-card-title">${title}</div>
          <p style="color:var(--text-secondary); font-size: 0.9rem; line-height: 1.4; margin-top: 0.5rem;">
            ${session.description || 'Join us for this special screening!'}
          </p>
        </div>
      </div>
    `;
  }).join('');
}

function renderNextSessionHero() {
  if (!nextSessionHero) return;

  const upcoming = sessions
    .filter(s => s.is_upcoming && new Date(s.session_date) > new Date())
    .sort((a, b) => new Date(a.session_date) - new Date(b.session_date))[0];

  if (!upcoming) {
    nextSessionHero.classList.add('page-hidden');
    return;
  }

  const poster = upcoming.movie_id ? (upcoming.movies?.poster_url || FALLBACK_IMAGE) : TBD_POSTER;
  const title = upcoming.movie_id ? upcoming.movies?.title : 'Film To Be Decided';
  const isSignedUp = user && upcoming.session_signups?.some(s => s.user_id === user.id);
  const signupCount = upcoming.session_signups?.length || 0;

  nextSessionHero.classList.remove('page-hidden');
  nextSessionHero.innerHTML = `
    <img src="${poster}" class="next-session-poster" alt="${title}">
    <div class="next-session-info">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 0.5rem;">
         <div class="session-date-badge">NEXT SESSION</div>
         ${renderAvatarStack(upcoming.session_signups)}
      </div>
      <h3 style="margin-top:0.5rem;">${title}</h3>
      <div class="next-session-meta">
        <span><i data-lucide="calendar"></i> ${new Date(upcoming.session_date).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}</span>
        <span><i data-lucide="clock"></i> ${new Date(upcoming.session_date).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      <p style="color:var(--text-secondary); margin-bottom: 1.5rem;">${upcoming.description || 'No description available.'}</p>
      <button class="btn-signup-hero ${isSignedUp ? 'success' : ''}" onclick="window.signupForSession('${upcoming.id}')">
        <i data-lucide="${isSignedUp ? 'user-check' : 'user-plus'}"></i> 
        ${isSignedUp ? 'Already Signed Up' : 'Sign Up Now'}
      </button>
    </div>
  `;
  if (window.lucide) window.lucide.createIcons();
}

window.openSessionDetail = async (sessionId) => {
  const session = sessions.find(s => s.id === sessionId);
  if (!session) return;

  currentSession = session;
  sessionModal.classList.remove('page-hidden');
  document.body.style.overflow = 'hidden';

  // Load comments, photos, signups
  const [comments, photos, signups, attendance] = await Promise.all([
    supabase.from('session_comments').select('*, profiles(full_name)').eq('session_id', sessionId).order('created_at', { ascending: false }),
    supabase.from('session_photos').select('*, profiles(full_name)').eq('session_id', sessionId).order('created_at', { ascending: false }),
    supabase.from('session_signups').select('*, profiles(full_name, id)').eq('session_id', sessionId),
    supabase.from('session_attendance').select('*, profiles(full_name, id)').eq('session_id', sessionId)
  ]);

  const isSignedUp = user && signups.data?.some(s => s.user_id === user.id);
  const isAttended = user && attendance.data?.some(a => a.user_id === user.id);
  const signupCount = signups.data?.length || 0;

  const poster = session.movie_id ? (session.movies?.poster_url || FALLBACK_IMAGE) : TBD_POSTER;
  const title = session.movie_id ? session.movies?.title : 'Film To Be Decided';

  sessionModalBody.innerHTML = `
    <div class="session-detail-layout">
      <div class="session-sidebar">
        <img src="${poster}" style="width:100%; border-radius:1.5rem; box-shadow:0 10px 30px rgba(0,0,0,0.5);" />
        <div style="margin-top: 2rem;">
          <h4 style="margin-bottom: 0.5rem; color:var(--text-secondary);">SESSION INFO</h4>
          <p><i data-lucide="calendar" style="width:14px; margin-right:5px;"></i> ${new Date(session.session_date).toLocaleDateString()}</p>
          <p><i data-lucide="map-pin" style="width:14px; margin-right:5px;"></i> ${session.location || 'Paral·lel Cinema'}</p>
        </div>
        
        <div style="margin-top: 2rem;">
          ${session.is_upcoming ? `
            <button class="submit-btn ${isSignedUp ? 'success' : ''}" onclick="window.signupForSession('${session.id}')">
              <i data-lucide="${isSignedUp ? 'user-check' : 'user-plus'}"></i> 
              ${isSignedUp ? 'Already Signed Up' : 'Sign Up for Session'}
            </button>
            <p style="text-align:center; margin-top:1rem; font-size:0.8rem; color:var(--text-secondary);">
              <i data-lucide="users" style="width:12px; height:12px; vertical-align:middle;"></i> ${signupCount} people interested
            </p>
          ` : `
            <div class="badge ${isAttended ? 'success' : 'muted'}" style="padding: 1rem; text-align:center; border-radius:1rem; background:rgba(255,255,255,0.05);">
              <i data-lucide="${isAttended ? 'check-circle' : 'info'}"></i>
              ${isAttended ? 'You Attended This Session' : 'This session has passed'}
            </div>
          `}
        </div>
      </div>

      <div class="session-main-info">
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <h2>${title}</h2>
          ${isAdmin ? `
            <button class="edit-profile-btn" onclick="window.showEditSessionModal('${session.id}')">
              <i data-lucide="edit"></i> Edit Session
            </button>
          ` : ''}
        </div>
        <p style="font-size: 1.1rem; color:var(--text-secondary); margin-bottom: 2rem;">${session.description || ''}</p>

        <div class="session-tabs">
          <button class="session-tab-btn active" onclick="window.switchSessionTab('comments')">Comments (${comments.data?.length || 0})</button>
          <button class="session-tab-btn" onclick="window.switchSessionTab('photos')">Gallery (${photos.data?.length || 0})</button>
          <button class="session-tab-btn" onclick="window.switchSessionTab('participants')">
            ${session.is_upcoming ? 'Interested' : 'Participants'} (${session.is_upcoming ? signupCount : attendance.data?.length || 0})
          </button>
        </div>

        <div id="sessionTabContent">
          <!-- Comments by default -->
          ${renderCommentsHTML(comments.data || [])}
        </div>
      </div>
    </div>
  `;
  
  if (window.lucide) window.lucide.createIcons();
};

window.closeSessionModal = () => {
  sessionModal.classList.add('page-hidden');
  document.body.style.overflow = '';
};

window.switchSessionTab = async (tab) => {
  const btns = document.querySelectorAll('.session-tab-btn');
  btns.forEach(b => b.classList.toggle('active', b.textContent.toLowerCase().includes(tab)));

  const content = document.getElementById('sessionTabContent');
  
  if (tab === 'comments') {
    const { data } = await supabase.from('session_comments').select('*, profiles(full_name)').eq('session_id', currentSession.id).order('created_at', { ascending: false });
    content.innerHTML = renderCommentsHTML(data || []);
  } else if (tab === 'photos') {
    const { data } = await supabase.from('session_photos').select('*, profiles(full_name)').eq('session_id', currentSession.id).order('created_at', { ascending: false });
    content.innerHTML = renderGalleryHTML(data || []);
  } else if (tab === 'participants') {
    const isUpcoming = currentSession.is_upcoming;
    const table = isUpcoming ? 'session_signups' : 'session_attendance';
    const { data } = await supabase.from(table).select('*, profiles(full_name)').eq('session_id', currentSession.id);
    
    content.innerHTML = `
      <div class="participants-list" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 1rem;">
        ${data?.length ? data.map(p => `
          <div class="participant-card" style="background:rgba(255,255,255,0.05); padding:1rem; border-radius:1rem; text-align:center;">
            <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(p.profiles.full_name)}&background=random" style="width:50px; height:50px; border-radius:50%; margin-bottom:0.5rem;" />
            <div style="font-weight:600; font-size:0.8rem;">${p.profiles.full_name}</div>
            ${isUpcoming ? '<div style="font-size:0.6rem; color:var(--text-secondary); margin-top:0.2rem;">Interested</div>' : ''}
          </div>
        `).join('') : `<div class="empty-state">No ${isUpcoming ? 'interest recorded' : 'participants'} yet.</div>`}
      </div>
    `;
  }
  if (window.lucide) window.lucide.createIcons();
};

function renderCommentsHTML(comments) {
  return `
    <div class="comments-section">
      ${user ? `
        <div class="comment-input-wrapper">
          <textarea id="newCommentText" placeholder="Share your thoughts about this movie..." rows="2"></textarea>
          <button class="submit-btn" style="width:auto; padding:0 1.5rem;" onclick="window.postComment()">
            <i data-lucide="send"></i>
          </button>
        </div>
      ` : '<p style="text-align:center; color:var(--text-secondary);">Sign in to leave a comment.</p>'}
      
      <div class="comments-list">
        ${comments.length ? comments.map(c => `
          <div class="comment-card">
            <div class="comment-header">
              <span class="comment-user">${c.profiles?.full_name || 'Anonymous'}</span>
              <span style="opacity:0.5;">${new Date(c.created_at).toLocaleDateString()}</span>
            </div>
            <div class="comment-body">${c.content}</div>
          </div>
        `).join('') : '<div class="empty-state">No comments yet.</div>'}
      </div>
    </div>
  `;
}

function renderGalleryHTML(photos) {
  return `
    <div class="gallery-section">
      <div class="photo-gallery">
        ${user ? `
          <div class="upload-photo-btn" onclick="window.triggerPhotoUpload()">
            <i data-lucide="camera" style="width:32px; height:32px;"></i>
            <span>Add Photo</span>
          </div>
        ` : ''}
        ${photos.map(p => `
          <div class="gallery-item" onclick="window.openFullPhoto('${p.photo_url}')">
            <img src="${p.photo_url}" loading="lazy" />
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

window.signupForSession = async (sessionId) => {
  if (!user) {
    window.navigateTo('auth');
    return;
  }

  const { data: existing } = await supabase.from('session_signups').select('*').match({ session_id: sessionId, user_id: user.id }).single();

  if (existing) {
    await supabase.from('session_signups').delete().match({ session_id: sessionId, user_id: user.id });
    showNotification('Sign up cancelled', 'warning');
  } else {
    await supabase.from('session_signups').insert([{ session_id: sessionId, user_id: user.id }]);
    showNotification('Signed up for the session!', 'success');
  }
  refreshData();
};

window.postComment = async () => {
  const text = document.getElementById('newCommentText').value.trim();
  if (!text) return;

  const { error } = await supabase.from('session_comments').insert([{
    session_id: currentSession.id,
    user_id: user.id,
    content: text
  }]);

  if (!error) {
    showNotification('Comment posted!');
    window.switchSessionTab('comments');
  }
};

window.triggerPhotoUpload = async () => {
  const url = window.prompt("Enter photo URL (implementing full upload in Supabase Storage requires more setup, so for now we use URLs):");
  if (!url) return;

  const { error } = await supabase.from('session_photos').insert([{
    session_id: currentSession.id,
    user_id: user.id,
    photo_url: url
  }]);

  if (!error) {
    showNotification('Photo added to gallery!');
    window.switchSessionTab('photos');
  }
};

/* --- Admin Session Logic --- */

window.showCreateSessionModal = () => {
  createSessionModal.classList.remove('page-hidden');
  
  // Reset form
  document.getElementById('sessionMovieSelect').value = "";
  document.getElementById('sessionDate').value = "";
  document.getElementById('sessionDescription').value = "";

  // Fill movie select with proposed movies
  sessionMovieSelect.innerHTML = `
    <option value="">-- To Be Decided --</option>
    ${proposedMovies.map(m => `
      <option value="${m.id}">${m.title}</option>
    `).join('')}
  `;
};

window.closeCreateSessionModal = () => {
  createSessionModal.classList.add('page-hidden');
};

window.handleCreateSession = async () => {
  const movieId = sessionMovieSelect.value;
  const date = document.getElementById('sessionDate').value;
  const desc = document.getElementById('sessionDescription').value;

  if (!date) {
    showNotification('Date is required', 'error');
    return;
  }

  const { error } = await supabase.from('sessions').insert([{
    movie_id: movieId || null,
    session_date: new Date(date).toISOString(),
    description: desc,
    is_upcoming: true
  }]);

  if (!error) {
    showNotification('Session created successfully!');
    window.closeCreateSessionModal();
    refreshData();
  } else {
    showNotification('Error creating session', 'error');
  }
};

async function updateAdminSessions() {
  if (!isAdmin || !adminSessionsList) return;

  adminSessionsList.innerHTML = sessions.map(session => {
    const title = session.movie_id ? session.movies?.title : 'TBD';
    
    return `
      <div class="admin-session-item">
        <div>
          <div style="font-weight:700;">${title}</div>
          <div style="font-size:0.8rem; opacity:0.6;">${new Date(session.session_date).toLocaleString()}</div>
        </div>
        <div class="admin-session-actions">
          <button class="btn-admin-action" onclick="window.showEditSessionModal('${session.id}')" title="Edit Session">
            <i data-lucide="edit"></i>
          </button>
          <button class="btn-admin-action" onclick="window.manageAttendance('${session.id}')" title="Mark Attendance">
            <i data-lucide="users"></i>
          </button>
          <button class="btn-admin-action delete" onclick="window.handleDeleteSession('${session.id}')" title="Delete Session">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
  if (window.lucide) window.lucide.createIcons();
}

window.handleDeleteSession = async (sessionId) => {
  if (!confirm('Are you sure you want to delete this session?')) return;

  const { error } = await supabase.from('sessions').delete().eq('id', sessionId);
  if (!error) {
    showNotification('Session deleted');
    refreshData();
  }
};

window.manageAttendance = async (sessionId) => {
  const session = sessions.find(s => s.id === sessionId);
  const { data: signups } = await supabase.from('session_signups').select('*, profiles(full_name, id)').eq('session_id', sessionId);
  const { data: attendance } = await supabase.from('session_attendance').select('user_id').eq('session_id', sessionId);
  
  const attendedSet = new Set(attendance?.map(a => a.user_id) || []);

  const html = `
    <div style="padding: 2rem;">
      <h3>Attendance: ${session.movies?.title}</h3>
      <p style="margin-bottom: 2rem;">Confirm who actually attended the session.</p>
      
      <div style="display:grid; gap:1rem;">
        ${signups?.length ? signups.map(s => `
          <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.05); padding:1rem; border-radius:1rem;">
            <span>${s.profiles.full_name}</span>
            <button class="btn-signup-hero ${attendedSet.has(s.user_id) ? 'success' : 'secondary'}" 
                    style="padding:0.5rem 1rem; font-size:0.8rem;"
                    onclick="window.toggleAttendance('${sessionId}', '${s.user_id}', this)">
              ${attendedSet.has(s.user_id) ? 'Confirmed' : 'Confirm Attendance'}
            </button>
          </div>
        `).join('') : '<p>No signups for this session yet.</p>'}
      </div>
      
      <button class="submit-btn" style="margin-top:2rem;" onclick="window.closeSessionModal()">Done</button>
    </div>
  `;

  sessionModalBody.innerHTML = html;
  sessionModal.classList.remove('page-hidden');
};

window.toggleAttendance = async (sessionId, userId, btn) => {
  const isConfirmed = btn.classList.contains('success');

  if (isConfirmed) {
    await supabase.from('session_attendance').delete().match({ session_id: sessionId, user_id: userId });
    btn.classList.remove('success');
    btn.classList.add('secondary');
    btn.textContent = 'Confirm Attendance';
  } else {
    await supabase.from('session_attendance').insert([{ session_id: sessionId, user_id: userId }]);
    btn.classList.remove('secondary');
    btn.classList.add('success');
    btn.textContent = 'Confirmed';
    
    const session = sessions.find(s => s.id === sessionId);
    const logData = {
      user_id: userId,
      action_type: "attendance",
      points: 50
    };
    if (session.movie_id) logData.movie_id = session.movie_id;
    await supabase.from("participation_log").insert([logData]);
  }
};
window.showEditSessionModal = (sessionId) => {
  const session = sessions.find(s => s.id === sessionId);
  if (!session) return;

  currentSession = session;
  createSessionModal.classList.remove('page-hidden');
  
  // Fill movie select
  sessionMovieSelect.innerHTML = `
    <option value="">-- To Be Decided --</option>
    ${proposedMovies.map(m => `
      <option value="${m.id}" ${m.id === session.movie_id ? 'selected' : ''}>${m.title}</option>
    `).join('')}
    ${session.movie_id && !proposedMovies.some(m => m.id === session.movie_id) ? `
      <option value="${session.movie_id}" selected>${session.movies?.title}</option>
    ` : ''}
  `;

  // Pre-fill date (convert ISO to datetime-local format)
  const date = new Date(session.session_date);
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  document.getElementById('sessionDate').value = localDate;
  
  document.getElementById('sessionDescription').value = session.description || '';
  
  // Update button text
  const submitBtn = createSessionModal.querySelector('.submit-btn');
  submitBtn.textContent = 'Update Session';
  submitBtn.onclick = () => window.handleUpdateSession(sessionId);
  
  createSessionModal.querySelector('h2').textContent = 'Edit Session';
};

window.handleUpdateSession = async (sessionId) => {
  const movieId = sessionMovieSelect.value;
  const date = document.getElementById('sessionDate').value;
  const desc = document.getElementById('sessionDescription').value;

  if (!date) {
    showNotification('Date is required', 'error');
    return;
  }

  const { error } = await supabase.from('sessions').update({
    movie_id: movieId || null,
    session_date: new Date(date).toISOString(),
    description: desc
  }).eq('id', sessionId);

  if (!error) {
    showNotification('Session updated successfully!');
    window.closeCreateSessionModal();
    refreshData();
  } else {
    showNotification('Error updating session', 'error');
  }
};

init();

function renderCemetery(droppedMovies) {
  const cemeteryGrid = document.getElementById('cemeteryGrid');
  if (!cemeteryGrid) return;
  
  if (droppedMovies.length === 0) {
    cemeteryGrid.innerHTML = '<div class="empty-state">The cemetery is empty. All proposed movies are still fighting!</div>';
    return;
  }

  cemeteryGrid.innerHTML = droppedMovies.map(movie => {
    return createMovieCardHTML(movie, { 
      context: 'cemetery', 
      showDelete: isAdmin // Only admins can truly delete from cemetery
    });
  }).join('');
  
  if (window.lucide) window.lucide.createIcons();
}

window.cleanupInactiveMovies = async (silent = false) => {
  if (!isAdmin) return;
  if (!silent) showNotification('Checking for inactive movies...', 'info');
  const fifteenDaysAgo = new Date();
  fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);
  const { data: moviesToClean, error: fetchErr } = await supabase
    .from('movies')
    .select('id, title, created_at, vote_count, is_dropped, is_seen')
    .eq('is_dropped', false)
    .eq('is_seen', false);
  if (fetchErr || !moviesToClean) return;
  const { data: allVotes, error: votesErr } = await supabase
    .from('votes')
    .select('movie_id, created_at');
  if (votesErr) return;
  const toDrop = moviesToClean.filter(m => {
    const proposalDate = new Date(m.created_at);
    const movieVotes = (allVotes || []).filter(v => v.movie_id === m.id);
    if (movieVotes.length === 0) {
      return proposalDate < fifteenDaysAgo;
    } else {
      const lastVoteDate = new Date(Math.max(...movieVotes.map(v => new Date(v.created_at))));
      return lastVoteDate < fifteenDaysAgo;
    }
  });
  if (toDrop.length === 0) {
    if (!silent) showNotification('All movies are active!', 'success');
    return;
  }
  const ids = toDrop.map(m => m.id);
  const { error: updateErr } = await supabase
    .from('movies')
    .update({ is_dropped: true })
    .in('id', ids);
  if (!updateErr) {
    if (!silent) showNotification(`Cleaned up ${toDrop.length} inactive movies`, 'success');
    refreshData();
  }
};

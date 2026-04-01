import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from "@google/generative-ai";

// Configuration
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const tmdbApiKey = import.meta.env.VITE_TMDB_API_KEY;
const geminiKey = import.meta.env.VITE_GEMINI_KEY;
const openaiKey = import.meta.env.VITE_OPENAI_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);
const openai = new OpenAI({ apiKey: openaiKey, dangerouslyAllowBrowser: true });
const genAI = geminiKey ? new GoogleGenerativeAI(geminiKey, { apiVersion: "v1" }) : null;

// State
let proposedMovies = [];
let seenMovies = [];
let userVotes = new Set(); // Set of movie IDs the user voted for
let user = null;
let userProfile = null; // Cache for profile data (name, avatar, role)
let isAdmin = false;
let currentView = 'home';
let genreMap = {}; // Map of genre ID to name

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
  explore: document.getElementById('exploreView')
};
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
  document.getElementById('exploreActor')
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

// Profile Edit Elements
const profileDisplay = document.getElementById('profileDisplay');
const profileEditForm = document.getElementById('profileEditForm');
const editName = document.getElementById('editName');
const editAvatar = document.getElementById('editAvatar');

// Fallback image helper
const FALLBACK_IMAGE = 'https://placehold.co/300x450/1a1a1f/94a3b8?text=Cinema+Poster';

// Initialization
async function init() {
  await fetchGenreMap();
  await checkUser();
  await refreshData();
  setupEventListeners();
  handleRouting();

  // Premium Preloader dismissal
  setTimeout(() => {
    const preloader = document.getElementById('preloader');
    if (preloader) {
      preloader.classList.add('fade-out');
      // Clean up after animation
      setTimeout(() => preloader.remove(), 800);
    }
  }, 1500); 
}

async function fetchGenreMap() {
  try {
    const url = `https://api.themoviedb.org/3/genre/movie/list?api_key=${tmdbApiKey}`;
    const resp = await fetch(url);
    const data = await resp.json();
    data.genres.forEach(g => {
      genreMap[g.id] = g.name;
      const option = document.createElement('option');
      option.value = g.id;
      option.textContent = g.name;
      exploreGenreSelect.appendChild(option);
    });
  } catch (e) {
    console.error('Error fetching genre map:', e);
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
}

async function refreshData() {
  const { data: movies, error } = await supabase
    .from('movies')
    .select('*')
    .order('created_at', { ascending: false });

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

  movies.forEach(m => {
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
  enrichMovieData(movies);

  // 1. TEMPORARY: Sanitization of corrupted vote counts from TMDB global data
  const corrupted = movies.filter(m => !m.is_seen && m.vote_count > 50);
  if (corrupted.length > 0) {
    console.log(`[Migration] Sanitizing ${corrupted.length} corrupted movie counts...`);
    supabase.from('movies').update({ vote_count: 0 }).in('id', corrupted.map(m => m.id)).then(() => {
      corrupted.forEach(m => m.vote_count = 0);
      renderProposals();
    });
  }

  proposedMovies = movies.filter(m => !m.is_seen);
  seenMovies = movies.filter(m => m.is_seen);

  renderProposals();
  renderHistory();
  if (currentView === 'profile') loadUserActivity();
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
      const baseUrl = `https://api.themoviedb.org/3/movie/${movie.tmdb_id}?api_key=${tmdbApiKey}`;
      const videosUrl = `${baseUrl}&append_to_response=videos,watch/providers`;
      
      const resp = await fetch(videosUrl);
      const data = await resp.json();
      
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
window.navigateTo = (view) => {
  window.location.hash = view;
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
  if (hash === 'explore') {
    // Initial icons check for explore view markers
  }
  
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

  const cardClass = context === 'history' ? 'movie-card seen' : 'movie-card';

  return `
    <div class="${cardClass}" data-id="${movie.id || ''}">
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

      ${showDelete ? `
        <button class="delete-movie-btn" onclick="window.deleteMovie('${movie.id}')" title="Remove movie">
          <i data-lucide="trash-2"></i>
        </button>
      ` : ''}

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
    userHeader.innerHTML = `
      <div class="user-profile" onclick="window.navigateTo('profile')">
        <img src="${avatar}" class="user-avatar" />
        <span>${name}</span>
      </div>
    `;
  } else {
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
  if (!user) return;
  
  // Admins can delete anything, users only their own
  const query = supabase.from('movies').delete().eq('id', movieId);
  if (!isAdmin) query.eq('proposed_by', user.id);

  const { error } = await query;
  if (error) {
    console.error('Error deleting movie:', error);
    showNotification('Action failed. You might not have permission.', 'error');
  } else {
    showNotification('Movie removed from lineup', 'success');
    await refreshData();
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
async function loadUserActivity() {
  if (!user) return;
  
  // Fetch latest profile data from the DB
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  
  const displayName = profile?.full_name || user.user_metadata?.full_name || user.email.split('@')[0];
  
  // Generate high-end initial-based avatar
  const displayAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=5850ec&color=fff&size=256&bold=true`;
  
  profileName.textContent = displayName;
  profileEmail.textContent = user.email;
  profileAvatar.src = displayAvatar;

  // Pre-fill edit form
  editName.value = displayName;
  const displayEmailInput = document.getElementById('displayEmail');
  if (displayEmailInput) displayEmailInput.value = user.email;

  const { data: proposals } = await supabase.from('movies').select('*').eq('proposed_by', user.id);
  const { data: votes } = await supabase.from('votes').select('movie_id, movies(*)').eq('user_id', user.id);

  countProposals.textContent = proposals?.length || 0;
  countVotes.textContent = votes?.length || 0;

  // Default view is proposals
  renderActivityGrid(proposals || []);
  
  // Set up tab switching for profile
  document.querySelectorAll('.activity-tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelector('.activity-tab.active').classList.remove('active');
      tab.classList.add('active');
      const view = tab.dataset.view;
      renderActivityGrid(view === 'myProposals' ? proposals : votes.map(v => v.movies));
    };
  });

  // ADMIN DASHBOARD logic
  if (isAdmin) {
    adminDashboard.classList.remove('page-hidden');
    await fetchUserList();
  } else {
    adminDashboard.classList.add('page-hidden');
  }

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

async function fetchUserList() {
  try {
    const { data: profiles, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
    
    if (error) throw error;

    adminUserCount.textContent = `${profiles?.length || 0} Users`;
    adminUserList.innerHTML = profiles.map(p => {
      const name = p.full_name || p.email.split('@')[0];
      const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=5850ec&color=fff&bold=true`;
      const date = p.created_at ? new Date(p.created_at).toLocaleDateString() : 'N/A';
      const roleLabel = p.role === 'admin' ? '<span style="color:var(--success); font-size: 0.7rem; font-weight:700;">ADMIN</span>' : '<span style="color:var(--text-secondary); font-size: 0.7rem;">USER</span>';
      
      return `
        <tr>
          <td>
            <div class="user-cell">
              <img src="${avatar}" alt="${p.full_name || 'User'}">
              <div style="display:flex; flex-direction:column;">
                <span class="user-name">${p.full_name || 'Anonymous User'}</span>
                ${roleLabel}
              </div>
            </div>
          </td>
          <td><span class="user-email">${p.email}</span></td>
          <td><span class="user-date">${date}</span></td>
        </tr>
      `;
    }).join('');

    if (window.lucide) window.lucide.createIcons();

  } catch (err) {
    console.error('Error fetching user list:', err);
    adminUserList.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:2rem; color:var(--text-secondary);">Unable to fetch user list. Ensure a 'profiles' table exists and is accessible.</td></tr>`;
  }
}

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
  if (!movies.length) {
    profileActivityGrid.innerHTML = '<div class="empty-state">Nothing to show here yet.</div>';
    return;
  }
  profileActivityGrid.innerHTML = movies.map(movie => {
    return createMovieCardHTML(movie, { 
      context: 'activity', 
      showDelete: false 
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

  const url = `https://api.themoviedb.org/3/search/movie?api_key=${tmdbApiKey}&query=${encodeURIComponent(query)}&include_adult=false`;
  try {
    const response = await fetch(url);
    const data = await response.json();
    

    // No restrictive filtering - just sort by popularity (desc) and take top 20
    const results = (data.results || [])
      .sort((a, b) => b.popularity - a.popularity)
      .slice(0, 20);

    const enrichedResults = await Promise.all(results.map(async movie => {
      const creditsUrl = `https://api.themoviedb.org/3/movie/${movie.id}/credits?api_key=${tmdbApiKey}`;
      try {
        const creditsResp = await fetch(creditsUrl);
        const creditsData = await creditsResp.json();
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
  const directorName = document.getElementById('exploreDirector').value.trim().toLowerCase();
  const genreId = exploreGenreSelect.value;
  const yearFrom = document.getElementById('exploreYearFrom').value;
  const yearTo = document.getElementById('exploreYearTo').value;
  const limitValue = document.getElementById('exploreLimit').value;
  const actorName = document.getElementById('exploreActor').value;
  const limit = parseInt(limitValue) || 20;

  exploreGrid.innerHTML = '<div class="loading-state">Scanning the cinematic multiverse...</div>';

  let discoverParams = new URLSearchParams({
    api_key: tmdbApiKey,
    sort_by: 'popularity.desc',
    include_adult: 'false'
  });

  if (genreId) discoverParams.append('with_genres', genreId);
  if (yearFrom) discoverParams.append('primary_release_date.gte', `${yearFrom}-01-01`);
  if (yearTo) discoverParams.append('primary_release_date.lte', `${yearTo}-12-31`);

  try {
    let results = [];
    let directorMatchedId = null;
    let actorMatchedId = null;
    
    // PATH A: Person-led pivot (Director or Actor)
    if (directorName || actorName) {
      // 1. Resolve Director if provided
      if (directorName) {
        const personPages = await Promise.all([
          fetch(`https://api.themoviedb.org/3/search/person?api_key=${tmdbApiKey}&query=${encodeURIComponent(directorName)}&page=1`).then(r => r.json()),
          fetch(`https://api.themoviedb.org/3/search/person?api_key=${tmdbApiKey}&query=${encodeURIComponent(directorName)}&page=2`).then(r => r.json())
        ]);
        const allMatches = personPages.flatMap(p => p.results || []);
        const directingMatches = allMatches.filter(p => p.known_for_department === 'Directing');
        let director = directingMatches.sort((a, b) => b.popularity - a.popularity)[0] || 
                       allMatches.sort((a, b) => b.popularity - a.popularity)[0];

        if (!director || director.popularity < 2) {
          const movieUrl = `https://api.themoviedb.org/3/search/movie?api_key=${tmdbApiKey}&query=${encodeURIComponent(directorName)}`;
          const movieResp = await fetch(movieUrl);
          const movieData = await movieResp.json();
          if (movieData.results?.length > 0) {
            const topMovie = movieData.results[0];
            const creditsUrl = `https://api.themoviedb.org/3/movie/${topMovie.id}/credits?api_key=${tmdbApiKey}`;
            const creditsResp = await fetch(creditsUrl);
            const creditsData = await creditsResp.json();
            const foundDirector = creditsData.crew?.find(p => p.job === 'Director' && normalize(p.name).includes(normalize(directorName)));
            if (foundDirector) director = foundDirector;
          }
        }
        if (director) {
          directorMatchedId = director.id;
          discoverParams.append('with_crew', director.id);
        }
      }

      // 2. Resolve Actor if provided
      if (actorName) {
        const actorResp = await fetch(`https://api.themoviedb.org/3/search/person?api_key=${tmdbApiKey}&query=${encodeURIComponent(actorName)}`);
        const actorData = await actorResp.json();
        const allActorMatches = actorData.results || [];
        const actingMatches = allActorMatches.filter(p => p.known_for_department === 'Acting');
        const actor = actingMatches.sort((a, b) => b.popularity - a.popularity)[0] || 
                      allActorMatches.sort((a, b) => b.popularity - a.popularity)[0];
        
        if (actor) {
          actorMatchedId = actor.id;
          discoverParams.append('with_cast', actor.id);
        }
      }

      const url = `https://api.themoviedb.org/3/discover/movie?${discoverParams.toString()}`;
      const resp = await fetch(url);
      const data = await resp.json();
      results = data.results || [];

    } else if (query) {
      // PATH B: Multipage Title Search (Best for Broad Keywords)
      const pagesToFetch = 3;
      const pages = await Promise.all(Array.from({ length: pagesToFetch }, (_, i) => 
        fetch(`https://api.themoviedb.org/3/search/movie?api_key=${tmdbApiKey}&query=${encodeURIComponent(query)}&page=${i+1}`).then(r => r.json())
      ));
      results = pages.flatMap(p => p.results || []);
    } else {
      // PATH C: Direct Filter Discovery
      const url = `https://api.themoviedb.org/3/discover/movie?${discoverParams.toString()}`;
      const resp = await fetch(url);
      const data = await resp.json();
      results = data.results || [];
    }

    // FINAL ENRICHMENT & CROSS-FILTERING (Dynamic limit from UI)
    const movieDetails = await Promise.all(results.slice(0, limit).map(async movie => {
      try {
        const baseUrl = `https://api.themoviedb.org/3/movie/${movie.id}?api_key=${tmdbApiKey}`;
        const detailUrl = `${baseUrl}&append_to_response=videos,watch/providers,credits`;
        
        const resp = await fetch(detailUrl);
        const detailData = await resp.json();
        
        const movieDirectors = detailData.credits?.crew?.filter(p => p.job === 'Director').map(d => d.name) || [];
        const movieYear = detailData.release_date ? parseInt(detailData.release_date.split('-')[0]) : null;
        const movieGenres = detailData.genres?.map(g => g.name) || [];

        // Client-side validation for filters (Enhanced Robustness)
        const normQuery = normalize(query);
        const normDirectorQuery = normalize(directorName);
        const normActorQuery = normalize(actorName);
        
        const matchesTitle = !query || normalize(detailData.title).includes(normQuery);
        
        // Match logic: If we resolved by ID, trust the ID. Otherwise, permissive string match.
        const matchesDirector = !directorName || (
          directorMatchedId 
            ? detailData.credits?.crew?.some(p => p.id === directorMatchedId && p.job === 'Director')
            : movieDirectors.some(d => normalize(d).includes(normDirectorQuery) || normDirectorQuery.includes(normalize(d)))
        );

        const matchesActor = !actorName || (
          actorMatchedId
            ? detailData.credits?.cast?.some(p => p.id === actorMatchedId)
            : detailData.credits?.cast?.some(p => normalize(p.name).includes(normActorQuery) || normActorQuery.includes(normalize(p.name)))
        );
        
        const matchesGenre = !genreId || detailData.genres?.some(g => g.id === parseInt(genreId));
        const matchesYearFrom = !yearFrom || (movieYear && movieYear >= parseInt(yearFrom));
        const matchesYearTo = !yearTo || (movieYear && movieYear <= parseInt(yearTo));

        if (matchesTitle && matchesDirector && matchesActor && matchesGenre && matchesYearFrom && matchesYearTo) {
          const trailer = detailData.videos?.results?.find(v => v.type === 'Trailer' && v.site === 'YouTube');
          return {
            ...detailData,
            director: movieDirectors.join(', ') || 'Unknown',
            genres: movieGenres,
            synopsis: detailData.overview,
            trailer_url: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
            watch_providers: detailData['watch/providers']?.results?.ES
          };
        }
      } catch (e) { return null; }
      return null;
    }));

    renderExploreResults(movieDetails.filter(Boolean).slice(0, 50));
  } catch (err) {
    console.error('Explore error:', err);
    exploreGrid.innerHTML = '<div class="empty-state">Error scanning the multiverse. Please try again.</div>';
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

    updateStatus(useWeb ? "Activating Satellite Search (Web Guided)..." : "Reasoning with Cinematic Bible (Fast Mode)...");
    
    let text = "";
    if (useWeb) {
      // --- GPT-5 RESPONSES API (Supports web_search) ---
      const resp = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${openaiKey}`
        },
        body: JSON.stringify({
          model: "gpt-5",
          tools: [{ type: "web_search" }],
          input: prompt
        }),
        signal: controller.signal
      });
      if (!resp.ok) throw new Error(`OpenAI Responses Error: ${resp.status}`);
      const data = await resp.json();
      
      console.group('%c 🕵️ AI Scout: GPT-5 Response Deck ', 'background: #312e81; color: #fff; border-radius: 4px; padding: 4px;');
      console.log('Raw Data:', data);
      text = data.output_text || "";
      console.log('Extracted Text:', text);
      console.groupEnd();
    } else {
      // --- GPT-4O-MINI CHAT API (Standard fast logic) ---
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }]
      }, { signal: controller.signal });
      
      console.group('%c 🕵️ AI Scout: Fast Reasoning Deck ', 'background: #1e1b4b; color: #fff; border-radius: 4px; padding: 4px;');
      text = completion.choices[0].message.content || "";
      console.log('Extracted Content:', text);
      console.groupEnd();
    }

    const jsonMatch = text.match(/\[.*\]/s);
    if (!jsonMatch) {
      console.error('Regex Fail: No JSON structure found in content.');
      throw new Error("Could not find movie list in AI response. See console for details.");
    }
    const titles = JSON.parse(jsonMatch[0]);

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
          // 1. Search for ID
          const searchUrl = `https://api.themoviedb.org/3/search/movie?api_key=${tmdbApiKey}&query=${encodeURIComponent(title)}`;
          const searchResp = await fetch(searchUrl);
          const searchData = await searchResp.json();
          const found = searchData.results[0];

          if (found && !renderedIds.has(found.id)) {
            // 2. Fetch Rich Details
            const baseUrl = `https://api.themoviedb.org/3/movie/${found.id}?api_key=${tmdbApiKey}`;
            const detailUrl = `${baseUrl}&append_to_response=videos,watch/providers,credits`;
            
            const detailResp = await fetch(detailUrl);
            const detailData = await detailResp.json();
            
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

  const card = el?.closest('.movie-card');

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
    // Unvote
    const { error } = await supabase.from('votes').delete().match({ user_id: user.id, movie_id: movieId });
    if (!error) {
      userVotes.delete(movieId);
      movie.vote_count = (movie.vote_count || 1) - 1;
      if (btn) btn.classList.remove('active');
      if (countEl) countEl.textContent = `${movie.vote_count} votes`;
    }
  } else {
    // Vote
    const { error } = await supabase.from('votes').insert([{ user_id: user.id, movie_id: movieId }]);
    if (!error) {
      userVotes.add(movieId);
      movie.vote_count = (movie.vote_count || 0) + 1;
      if (btn) btn.classList.add('active');
      if (countEl) countEl.textContent = `${movie.vote_count} votes`;
    }
  }
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

  document.getElementById('exploreClearBtn').onclick = () => {
    exploreInputs.forEach(input => {
      if (input.id === 'exploreLimit') {
        input.value = '20';
      } else {
        input.value = '';
      }
    });
    exploreGrid.innerHTML = '<div class="empty-state">Start searching to discover films.</div>';
  };
}

init();



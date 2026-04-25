import { FALLBACK_IMAGE, TBD_POSTER } from '../config/constants.js';

/**
 * Renders a stack of user avatars for session signups.
 * 
 * @param {Array} signups - List of session signups.
 * @param {number} limit - Maximum avatars to show.
 * @returns {string} HTML string for the avatar stack.
 */
export function renderAvatarStack(signups = [], limit = 3) {
  if (!signups || signups.length === 0) return '';
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

/**
 * Generates HTML for a session card.
 * 
 * @param {Object} session - Session data.
 * @param {Object} options - Configuration and user state.
 * @returns {string} HTML string for the session card.
 */
export function createSessionCardHTML(session, options = {}) {
  const { user = null } = options;
  const poster = session.movie_id ? (session.movies?.poster_url || FALLBACK_IMAGE) : TBD_POSTER;
  const title = session.movie_id ? session.movies?.title : 'Film To Be Decided';
  const isSignedUp = user && session.session_signups?.some(s => s.user_id === user.id);
  
  const displayKey = session.keyword && session.keyword.trim() !== "" ? session.keyword : 'TBD';
  const keywordDisplay = isSignedUp 
    ? `<div class="session-keyword-unlocked"><i data-lucide="key"></i> Code: <strong>${displayKey}</strong></div>`
    : `<div class="session-keyword-locked"><i data-lucide="lock"></i> Register to see keyword</div>`;

  return `
    <div class="session-card" onclick="window.viewSessionDetails('${session.id}')">
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
        <p style="color:var(--text-secondary); font-size: 0.85rem; line-height: 1.4; margin-top: 0.5rem; margin-bottom: 1rem;">
          ${session.description || 'Join us for this special screening!'}
        </p>
        ${keywordDisplay}
      </div>
    </div>
  `;
}

/**
 * Generates HTML for the next session hero section.
 * 
 * @param {Object} session - The upcoming session.
 * @param {Object} options - Configuration and user state.
 * @returns {string} HTML string for the hero.
 */
export function createSessionHeroHTML(session, options = {}) {
  const { user = null } = options;
  const poster = session.movie_id ? (session.movies?.poster_url || FALLBACK_IMAGE) : TBD_POSTER;
  const title = session.movie_id ? session.movies?.title : 'Film To Be Decided';
  const isSignedUp = user && session.session_signups?.some(s => s.user_id === user.id);
  
  const displayKey = session.keyword && session.keyword.trim() !== "" ? session.keyword : 'TBD';
  const keywordDisplay = isSignedUp 
    ? `<div class="hero-keyword-unlocked"><i data-lucide="key"></i> Secret Code: <strong>${displayKey}</strong></div>`
    : `<div class="hero-keyword-locked"><i data-lucide="lock"></i> Register to unlock secret code</div>`;

  return `
    <img src="${poster}" class="next-session-poster" alt="${title}">
    <div class="next-session-info">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 0.5rem;">
         <div class="session-date-badge">NEXT SESSION</div>
         ${renderAvatarStack(session.session_signups)}
      </div>
      <h3 style="margin-top:0.5rem;">${title}</h3>
      <div class="next-session-meta">
        <span><i data-lucide="calendar"></i> ${new Date(session.session_date).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}</span>
        <span><i data-lucide="clock"></i> ${new Date(session.session_date).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      <p style="color:var(--text-secondary); margin-bottom: 1.5rem;">${session.description || 'No description available.'}</p>
      
      ${keywordDisplay}

      <div style="display:flex; gap:0.75rem; margin-top: 1.5rem;">
        <button class="btn-signup-hero ${isSignedUp ? 'success' : ''}" onclick="window.signupForSession('${session.id}')" style="flex:1;">
          <i data-lucide="${isSignedUp ? 'user-check' : 'user-plus'}"></i> 
          ${isSignedUp ? 'Already Signed Up' : 'Sign Up Now'}
        </button>
        <button class="btn-signup-hero secondary" onclick="window.location.href='/next-session.html'" style="flex:1; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1);">
          <i data-lucide="info"></i> 
          View Details
        </button>
      </div>
    </div>
  `;
}

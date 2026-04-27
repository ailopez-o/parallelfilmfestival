import { createSessionCardHTML } from '../components/index.js';
import { FALLBACK_IMAGE, TBD_POSTER } from '../config/constants.js';
import { getUserDisplayName } from '../utils/index.js';

/**
 * Sessions View Module.
 * Manages the cinema sessions list and detailed session view.
 */
export const SessionsView = {
  /**
   * Renders the sessions grid.
   */
  renderSessions(sessions, container, state) {
    if (!container) return;
    if (sessions.length === 0) {
      container.innerHTML = '<div class="empty-state">No sessions scheduled yet.</div>';
      return;
    }

    container.innerHTML = sessions.map(session => 
      createSessionCardHTML(session, { user: state.user })
    ).join('');
  },

  /**
   * Renders skeletons for the sessions grid.
   */
  renderSkeletons(container, count = 3) {
    if (!container) return;
    container.innerHTML = Array(count).fill(0).map(() => `
      <div class="skeleton-card">
        <div class="skeleton skeleton-image"></div>
        <div class="skeleton skeleton-title"></div>
        <div class="skeleton skeleton-text"></div>
        <div class="skeleton skeleton-text-short"></div>
      </div>
    `).join('');
  },

  /**
   * Renders the session detail modal body.
   */
  renderDetail(session, data, state) {
    const { comments, photos, signups, attendance } = data;
    const { user, isAdmin } = state;

    const isSignedUp = user && signups.some(s => s.user_id === user.id);
    const isAttended = user && attendance.some(a => a.user_id === user.id);
    const signupCount = signups.length || 0;

    const poster = session.movie_id ? (session.movies?.poster_url || FALLBACK_IMAGE) : TBD_POSTER;
    const title = session.movie_id ? session.movies?.title : 'Film To Be Decided';

    return `
      <div class="session-detail-layout">
        <div class="session-sidebar">
          <img src="${poster}" class="session-sidebar-poster" style="width:100%; border-radius:1.5rem; box-shadow:0 10px 30px rgba(0,0,0,0.5);" />
          
          <div class="session-meta-info" style="margin-top: 2rem;">
            <div class="meta-item" style="margin-bottom:0.75rem; display:flex; align-items:center; gap:0.5rem; color:var(--text-secondary);">
              <i data-lucide="calendar" style="width:16px; color:var(--accent);"></i>
              <span>${new Date(session.session_date).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
            </div>
            <div class="meta-item" style="margin-bottom:0.75rem; display:flex; align-items:center; gap:0.5rem; color:var(--text-secondary);">
              <i data-lucide="map-pin" style="width:16px; color:var(--accent);"></i>
              <span>${session.location || 'Paral·lel Cinema'}</span>
            </div>
            <div class="meta-item" style="display:flex; align-items:center; gap:0.5rem; color:var(--text-secondary);">
              <i data-lucide="clock" style="width:16px; color:var(--accent);"></i>
              <span>${new Date(session.session_date).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>
          
          <div style="margin-top: 2rem;">
            ${session.is_upcoming ? `
              <button class="submit-btn ${isSignedUp ? 'success' : ''}" onclick="window.signupForSession('${session.id}')" style="width:100%;">
                <i data-lucide="${isSignedUp ? 'user-check' : 'user-plus'}"></i> 
                ${isSignedUp ? 'Already Signed Up' : 'Sign Up for Session'}
              </button>
              <div class="signup-count-label" style="text-align:center; margin-top:1rem; font-size:0.8rem; color:var(--text-secondary);">
                <i data-lucide="users" style="width:12px; height:12px; vertical-align:middle;"></i> ${signupCount} people interested
              </div>
            ` : `
              <div class="badge ${isAttended ? 'success' : 'muted'}" style="padding: 1rem; text-align:center; border-radius:1rem; background:rgba(255,255,255,0.05);">
                <i data-lucide="${isAttended ? 'check-circle' : 'info'}"></i>
                ${isAttended ? 'You Attended This Session' : 'This session has passed'}
              </div>
            `}
          </div>
        </div>

        <div class="session-main-info">
          <div class="session-header-row" style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:1rem;">
            <h2 style="margin:0; font-size:2.5rem;">${title}</h2>
            <div style="display:flex; gap:0.75rem;">
              ${isAdmin ? `
                <button class="edit-profile-btn" onclick="window.showEditSessionModal('${session.id}')">
                  <i data-lucide="edit"></i> Edit Session
                </button>
              ` : ''}
            </div>
          </div>
          <p class="session-description" style="font-size: 1.1rem; color:var(--text-secondary); line-height:1.6; margin-bottom: 2rem;">${session.description || 'No description provided for this session.'}</p>

          <div class="session-tabs">
            <button class="session-tab-btn active" data-tab="comments" onclick="window.switchSessionTab('comments')">Comments (${comments.length || 0})</button>
            <button class="session-tab-btn" data-tab="photos" onclick="window.switchSessionTab('photos')">Gallery (${photos.length || 0})</button>
            <button class="session-tab-btn" data-tab="participants" onclick="window.switchSessionTab('participants')">
              ${session.is_upcoming ? 'Interested' : 'Participants'} (${session.is_upcoming ? signupCount : (attendance?.length || 0)})
            </button>
          </div>

          <div id="sessionTabContent">
            ${this.renderCommentsHTML(comments)}
          </div>
        </div>
      </div>
    `;
  },

  /**
   * Renders a premium, cinematic landing page for the next session.
   */
  renderNextSessionPage(session, data, state) {
    const { comments, photos, signups } = data;
    const { user, isAdmin } = state;
    const isSignedUp = user && signups.some(s => s.user_id === user.id);
    const signupCount = signups.length || 0;

    const poster = session.movie_id ? (session.movies?.poster_url || FALLBACK_IMAGE) : TBD_POSTER;
    const title = session.movie_id ? session.movies?.title : 'Film To Be Decided';
    const releaseYear = session.movies?.release_date ? new Date(session.movies.release_date).getFullYear() : '';
    
    return `
      <div class="cinematic-view">
        <!-- BACKGROUND LAYER -->
        <div class="cinematic-bg" style="background-image: url('${poster}')"></div>
        <div class="cinematic-overlay"></div>

        <div class="cinematic-content container">
          <!-- HERO HEADER -->
          <div class="cinematic-hero">
            <div class="hero-left">
              <div class="cinematic-badge">NEXT EXPERIENCE</div>
              <h1 class="cinematic-title">${title} ${releaseYear ? `<span class="year">${releaseYear}</span>` : ''}</h1>
              <div class="cinematic-meta">
                <div class="meta-pill">
                   <i data-lucide="calendar"></i>
                   <span>${new Date(session.session_date).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}</span>
                </div>
                <div class="meta-pill">
                   <i data-lucide="clock"></i>
                   <span>${new Date(session.session_date).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div class="meta-pill">
                   <i data-lucide="map-pin"></i>
                   <span>${session.location || 'Paral·lel Cinema'}</span>
                </div>
              </div>
              <p class="cinematic-description">${session.description || 'Prepare for an unforgettable night of cinema at our festival.'}</p>
              
              <div class="hero-actions">
                <button class="cta-btn ${isSignedUp ? 'success' : ''}" onclick="window.signupForSession('${session.id}')">
                   <i data-lucide="${isSignedUp ? 'user-check' : 'ticket'}"></i>
                   ${isSignedUp ? 'Reserved Spot' : 'Get My Ticket Now'}
                </button>
                <div class="interest-stats">
                   <div class="avatar-group">
                     ${signups.slice(0, 4).map(s => `<img src="https://ui-avatars.com/api/?name=${encodeURIComponent(getUserDisplayName(s.profiles))}&background=random" />`).join('')}
                     ${signupCount > 4 ? `<div class="avatar-more">+${signupCount - 4}</div>` : ''}
                   </div>
                   <span>${signupCount} people are attending</span>
                </div>
              </div>
            </div>
            
            <div class="hero-right">
              <div class="cinematic-poster-frame">
                <img src="${poster}" class="cinematic-poster" />
                <div class="poster-glow"></div>
              </div>
            </div>
          </div>

          <!-- CONTENT TABS SECTION -->
          <div class="cinematic-details glass-card">
            <div class="cinematic-tabs">
              <button class="cinematic-tab active" data-tab="comments" onclick="window.switchSessionTab('comments')">
                 Discussion
              </button>
              <button class="cinematic-tab" data-tab="photos" onclick="window.switchSessionTab('photos')">
                 Gallery
              </button>
              <button class="cinematic-tab" data-tab="participants" onclick="window.switchSessionTab('participants')">
                 Who's Coming
              </button>
            </div>

            <div id="sessionTabContent" class="tab-fade-in">
              ${this.renderCommentsHTML(comments)}
            </div>
          </div>
        </div>
      </div>
    `;
  },

  /**
   * Renders the comments list HTML.
   */
  renderCommentsHTML(comments) {
    return `
      <div class="comments-section">
        <div class="comment-input-wrapper">
          <textarea id="sessionCommentInput" placeholder="Write a comment..." rows="1"></textarea>
          <button class="send-comment-btn" onclick="window.addSessionComment()">
            <i data-lucide="send"></i>
          </button>
        </div>
        <div class="comments-list">
          ${comments.length ? comments.map(c => {
            const userName = getUserDisplayName(c.profiles);
            const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(userName)}&background=random&size=64`;
            const date = new Date(c.created_at).toLocaleString('es-ES', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
            
            return `
              <div class="comment-item">
                <img src="${avatar}" class="comment-avatar" />
                <div class="comment-body">
                  <div class="comment-meta">
                    <span class="comment-author">${userName}</span>
                    <span class="comment-time">${date}</span>
                  </div>
                  <div class="comment-content">${c.content || ''}</div>
                </div>
              </div>
            `;
          }).join('') : '<div class="empty-state">No comments yet.</div>'}
        </div>
      </div>
    `;
  },

  /**
   * Renders the photo gallery HTML.
   */
  renderGalleryHTML(photos, user, isAdmin) {
    return `
      <div class="gallery-container">
        ${user ? `
          <div class="upload-zone">
            <i data-lucide="camera"></i>
            <span>Share your experience...</span>
            <input type="file" accept="image/*" onchange="window.addSessionPhoto(this)">
          </div>
        ` : ''}
        <div class="gallery-grid">
          ${photos.length ? photos.map(p => `
            <div class="gallery-item">
              <img src="${p.photo_url}" alt="Session photo" loading="lazy" onclick="window.openPhotoLightbox('${p.photo_url}')">
              <div class="photo-overlay" onclick="window.openPhotoLightbox('${p.photo_url}')">
                <i data-lucide="maximize-2"></i>
              </div>
              ${isAdmin ? `
                <button class="delete-photo-btn admin-force-show" onclick="window.deleteSessionPhoto('${p.id}', '${p.photo_url}')" title="Delete Photo">
                  <i data-lucide="trash-2"></i>
                </button>
              ` : ''}
            </div>
          `).join('') : '<p class="empty-state">No photos shared yet.</p>'}
        </div>
      </div>
    `;
  },

  /**
   * Renders the participants list HTML.
   */
  renderParticipantsHTML(data, isUpcoming) {
    return `
      <div class="participants-list" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 1rem;">
        ${data?.length ? data.map(p => {
          const userName = getUserDisplayName(p.profiles);
          return `
          <div class="participant-card" style="background:rgba(255,255,255,0.05); padding:1rem; border-radius:1rem; text-align:center;">
            <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(userName)}&background=random" style="width:50px; height:50px; border-radius:50%; margin-bottom:0.5rem;" />
            <div style="font-weight:600; font-size:0.8rem;">${userName}</div>
            ${isUpcoming ? '<div style="font-size:0.6rem; color:var(--text-secondary); margin-top:0.2rem;">Interested</div>' : ''}
          </div>
        `}).join('') : '<div class="empty-state">No participants yet.</div>'}
      </div>
    `;
  }
};

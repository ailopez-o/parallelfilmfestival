import { createSessionCardHTML } from '../components/index.js';
import { FALLBACK_IMAGE, TBD_POSTER } from '../config/constants.js';

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
            ${isAdmin ? `
              <button class="edit-profile-btn" onclick="window.showEditSessionModal('${session.id}')">
                <i data-lucide="edit"></i> Edit Session
              </button>
            ` : ''}
          </div>
          <p class="session-description" style="font-size: 1.1rem; color:var(--text-secondary); line-height:1.6; margin-bottom: 2rem;">${session.description || 'No description provided for this session.'}</p>

          <div class="session-tabs">
            <button class="session-tab-btn active" onclick="window.switchSessionTab('comments')">Comments (${comments.length || 0})</button>
            <button class="session-tab-btn" onclick="window.switchSessionTab('photos')">Gallery (${photos.length || 0})</button>
            <button class="session-tab-btn" onclick="window.switchSessionTab('participants')">
              ${session.is_upcoming ? 'Interested' : 'Participants'} (${session.is_upcoming ? signupCount : attendance.length || 0})
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
          ${comments.length ? comments.map(c => `
            <div class="comment-card">
              <div class="comment-header">
                <span class="comment-user">${c.profiles?.full_name || 'Anonymous'}</span>
                <span class="comment-date">${new Date(c.created_at).toLocaleString()}</span>
              </div>
              <div class="comment-text">${c.content || ''}</div>
            </div>
          `).join('') : '<div class="empty-state">No comments yet.</div>'}
        </div>
      </div>
    `;
  },

  /**
   * Renders the photo gallery HTML.
   */
  renderGalleryHTML(photos) {
    return `
      <div class="gallery-section">
        <div class="gallery-actions" style="margin-bottom:1.5rem;">
          <button class="auth-btn" onclick="document.getElementById('sessionPhotoInput').click()">
            <i data-lucide="image-plus"></i> Upload Photo
          </button>
          <input type="file" id="sessionPhotoInput" style="display:none" accept="image/*" onchange="window.addSessionPhoto(this)" />
        </div>
        <div class="photo-gallery">
          ${photos.length ? photos.map(p => `
            <div class="gallery-item">
              <img src="${p.photo_url}" alt="Session Photo" />
              <div class="photo-overlay">
                ${p.profiles?.full_name || 'Anonymous'}
              </div>
            </div>
          `).join('') : '<div class="empty-state">No photos yet.</div>'}
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
        ${data?.length ? data.map(p => `
          <div class="participant-card" style="background:rgba(255,255,255,0.05); padding:1rem; border-radius:1rem; text-align:center;">
            <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(p.profiles?.full_name || 'A')}&background=random" style="width:50px; height:50px; border-radius:50%; margin-bottom:0.5rem;" />
            <div style="font-weight:600; font-size:0.8rem;">${p.profiles?.full_name || 'Anonymous'}</div>
            ${isUpcoming ? '<div style="font-size:0.6rem; color:var(--text-secondary); margin-top:0.2rem;">Interested</div>' : ''}
          </div>
        `).join('') : '<div class="empty-state">No participants yet.</div>'}
      </div>
    `;
  }
};

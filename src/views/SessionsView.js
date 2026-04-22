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
      <div class="session-comments-section">
        <div class="comment-input-row">
          <input type="text" id="sessionCommentInput" placeholder="Write a comment..." />
          <button class="send-comment-btn" onclick="window.addSessionComment()">
            <i data-lucide="send"></i>
          </button>
        </div>
        <div class="comments-list">
          ${comments.length ? comments.map(c => `
            <div class="comment-card">
              <div class="comment-header">
                <span class="comment-author">${c.profiles.full_name}</span>
                <span class="comment-date">${new Date(c.created_at).toLocaleString()}</span>
              </div>
              <div class="comment-text">${c.comment}</div>
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
      <div class="session-gallery-section">
        <div class="gallery-upload-row">
          <button class="auth-btn" onclick="document.getElementById('sessionPhotoInput').click()">
            <i data-lucide="image-plus"></i> Upload Photo
          </button>
          <input type="file" id="sessionPhotoInput" style="display:none" accept="image/*" onchange="window.addSessionPhoto(this)" />
        </div>
        <div class="gallery-grid" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 1rem; margin-top: 1rem;">
          ${photos.length ? photos.map(p => `
            <div class="gallery-item" style="aspect-ratio: 1; border-radius: 1rem; overflow: hidden; position:relative;">
              <img src="${p.photo_url}" style="width:100%; height:100%; object-fit:cover;" />
              <div class="photo-overlay" style="position:absolute; bottom:0; left:0; right:0; padding:0.5rem; background:linear-gradient(transparent, rgba(0,0,0,0.8)); font-size:0.6rem; color:white;">
                ${p.profiles.full_name}
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
            <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(p.profiles.full_name)}&background=random" style="width:50px; height:50px; border-radius:50%; margin-bottom:0.5rem;" />
            <div style="font-weight:600; font-size:0.8rem;">${p.profiles.full_name}</div>
            ${isUpcoming ? '<div style="font-size:0.6rem; color:var(--text-secondary); margin-top:0.2rem;">Interested</div>' : ''}
          </div>
        `).join('') : '<div class="empty-state">No participants yet.</div>'}
      </div>
    `;
  }
};

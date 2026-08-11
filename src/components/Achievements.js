import { escapeHtml } from '../utils/index.js';

/**
 * Generates HTML for an achievement card.
 * 
 * @param {Object} achievement - Achievement data.
 * @returns {string} HTML string for the achievement card.
 */
export function createAchievementCardHTML(achievement) {
  return `
    <div class="achievement-card ${achievement.class} ${achievement.completed ? 'completed active' : 'locked'}">
      <i data-lucide="check-circle" class="completed-check"></i>
      <div class="achievement-header">
        <div class="medal-icon-wrapper">
          <i data-lucide="${achievement.icon}"></i>
        </div>
        <div class="achievement-info">
          <span class="achievement-name">${achievement.name}</span>
          <span class="achievement-desc">${achievement.desc}</span>
        </div>
      </div>
      
      <div class="achievement-progress-section">
        <div class="progress-label-row">
          <span>Progress</span>
          <span>${achievement.current} / ${achievement.target}</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width: ${achievement.progress}%"></div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Generates HTML for a timeline event item.
 * 
 * @param {Object} event - Event data object.
 * @param {Function} timeAgoFn - Utility function to format time.
 * @returns {string} HTML string for the timeline row.
 */
export function createTimelineItemHTML(event, timeAgoFn) {
  return `
    <tr class="timeline-row event-${event.type || 'info'}">
      <td>
        <div class="event-user-cell">
          <div class="event-icon-circle">
            <i data-lucide="${event.icon || 'star'}"></i>
          </div>
	          <div class="event-content">
	            <div class="event-message">
	              <span class="event-name">${escapeHtml(event.name || 'User')}</span> ${event.text}
	            </div>
            <div class="event-date">${timeAgoFn(event.date)}</div>
          </div>
        </div>
      </td>
    </tr>
  `;
}

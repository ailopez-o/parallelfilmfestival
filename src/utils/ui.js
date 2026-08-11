/**
 * Displays a toast notification to the user.
 * 
 * @param {string} message - The message to display.
 * @param {'success'|'warning'|'error'|'info'} type - The type of notification.
 */
export function showNotification(message, type = 'success') {
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
    error: 'alert-circle',
    info: 'info'
  };

  toast.innerHTML = `
    <div class="toast-icon">
      <i data-lucide="${icons[type]}"></i>
    </div>
    <span>${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);
  
  // Re-initialize Lucide icons for the new toast
  if (window.lucide) {
    window.lucide.createIcons();
  }

  // Auto remove after 3 seconds
  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 400);
  }, 3000);
}

/**
 * Escapes a value for safe HTML rendering.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Restricts URLs to safe browser protocols for href/src usage.
 *
 * @param {string} url
 * @param {string} fallback
 * @returns {string}
 */
export function sanitizeUrl(url, fallback = '') {
  if (typeof url !== 'string' || url.trim() === '') return fallback;

  try {
    const base = globalThis.location?.origin || 'https://example.invalid';
    const parsed = new URL(url, base);

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return fallback;
    }

    if (url.startsWith('/')) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }

    return parsed.toString();
  } catch {
    return fallback;
  }
}

/**
 * Displays a toast notification to the user.
 * 
 * @param {string} message - The message to display.
 * @param {'success'|'warning'|'error'} type - The type of notification.
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
    error: 'alert-circle'
  };

  toast.innerHTML = `
    <div class="toast-icon">
      <i data-lucide="${icons[type]}"></i>
    </div>
    <span>${message}</span>
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

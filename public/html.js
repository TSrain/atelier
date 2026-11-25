export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

export const hex = (value) => (/^#[0-9a-f]{6}$/i.test(value || '') ? value : '#cccccc');

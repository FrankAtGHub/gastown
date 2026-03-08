/**
 * CJS-compatible Tailwind color map for @field-ops/theme
 *
 * Maps semantic token names to CSS variables.
 * Tailwind generates classes like: bg-fo-background, text-fo-primary, etc.
 * Actual values come from CSS variables injected in input.css.
 */
const fieldOpsColors = {
  'background': 'var(--fo-background)',
  'background-secondary': 'var(--fo-background-secondary)',
  'background-tertiary': 'var(--fo-background-tertiary)',
  'card': 'var(--fo-card)',
  'card-hover': 'var(--fo-card-hover)',
  'text': 'var(--fo-text)',
  'text-secondary': 'var(--fo-text-secondary)',
  'text-muted': 'var(--fo-text-muted)',
  'text-inverse': 'var(--fo-text-inverse)',
  'border': 'var(--fo-border)',
  'border-light': 'var(--fo-border-light)',
  'success': 'var(--fo-success)',
  'success-bg': 'var(--fo-success-bg)',
  'warning': 'var(--fo-warning)',
  'warning-bg': 'var(--fo-warning-bg)',
  'error': 'var(--fo-error)',
  'error-bg': 'var(--fo-error-bg)',
  'info': 'var(--fo-info)',
  'info-bg': 'var(--fo-info-bg)',
  'primary': 'var(--fo-primary)',
  'primary-light': 'var(--fo-primary-light)',
  'primary-dark': 'var(--fo-primary-dark)',
  'input-bg': 'var(--fo-input-bg)',
  'input-border': 'var(--fo-input-border)',
  'input-text': 'var(--fo-input-text)',
  'placeholder': 'var(--fo-placeholder)',
};

module.exports = { fieldOpsColors };

// src/utils/passwordPolicy.js
export const PASSWORD_MIN_LENGTH = 8;

// Returns an error message string if the password is too weak, or null if it passes.
export function getPasswordPolicyError(password) {
  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (!/[a-z]/.test(password)) return 'Password must include at least one lowercase letter.';
  if (!/[A-Z]/.test(password)) return 'Password must include at least one uppercase letter.';
  if (!/[0-9]/.test(password)) return 'Password must include at least one number.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must include at least one special character.';
  return null;
}

export const PASSWORD_POLICY_HINT =
  `At least ${PASSWORD_MIN_LENGTH} characters, with uppercase, lowercase, a number, and a special character.`;

// Per-rule pass/fail list, for live "as you type" feedback next to a
// password field (rather than only telling the manager what's wrong after
// they hit submit).
export function getPasswordChecklist(password = '') {
  return [
    { label: `At least ${PASSWORD_MIN_LENGTH} characters`, passed: password.length >= PASSWORD_MIN_LENGTH },
    { label: 'One lowercase letter (a-z)', passed: /[a-z]/.test(password) },
    { label: 'One uppercase letter (A-Z)', passed: /[A-Z]/.test(password) },
    { label: 'One number (0-9)', passed: /[0-9]/.test(password) },
    { label: 'One special character (e.g. !@#$)', passed: /[^A-Za-z0-9]/.test(password) },
  ];
}

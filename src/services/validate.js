const { MIN_AGE_YEARS } = require('../config');
const { calculateAge } = require('./dates');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 254 && EMAIL_RE.test(email.trim());
}

// Kept deliberately simple (length + letter + number) so the requirement is
// easy to explain to every user, including those less used to password
// rules, while still ruling out very weak passwords.
function checkPasswordPolicy(password) {
  const errors = [];
  const value = typeof password === 'string' ? password : '';
  if (value.length < 10) errors.push('Password must be at least 10 characters long.');
  if (!/[a-zA-Z]/.test(value)) errors.push('Password must include at least one letter.');
  if (!/[0-9]/.test(value)) errors.push('Password must include at least one number.');
  return { valid: errors.length === 0, errors };
}

function isValidDob(dob) {
  const d = new Date(dob);
  return !Number.isNaN(d.getTime()) && d.getTime() < Date.now();
}

function isAdult(dob, now = new Date()) {
  return isValidDob(dob) && calculateAge(dob, now) >= MIN_AGE_YEARS;
}

function isNonEmptyString(value, maxLen = 200) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLen;
}

module.exports = { isValidEmail, checkPasswordPolicy, isValidDob, isAdult, isNonEmptyString };

const { addYears } = require('./engine');
const { LOCK_YEARS } = require('../config');

// Age in whole years, as of `atDate`. Used for the 18+ KYC gate.
function calculateAge(dob, atDate = new Date()) {
  const birth = new Date(dob);
  let age = atDate.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = atDate.getUTCMonth() - birth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && atDate.getUTCDate() < birth.getUTCDate())) {
    age--;
  }
  return age;
}

// Which year of the 3-year lock `now` falls in for a position opened at
// `openedAt`: 1, 2, or 3 while locked, LOCK_YEARS + 1 once matured.
function lockYearNumber(openedAt, now = new Date()) {
  const opened = new Date(openedAt);
  for (let year = 1; year <= LOCK_YEARS; year++) {
    if (now < addYears(opened, year)) return year;
  }
  return LOCK_YEARS + 1;
}

function isMatured(matures_at, now = new Date()) {
  return now >= new Date(matures_at);
}

function daysUntil(date, now = new Date()) {
  const ms = new Date(date).getTime() - now.getTime();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

module.exports = { calculateAge, lockYearNumber, isMatured, daysUntil };

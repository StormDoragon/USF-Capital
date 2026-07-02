// All money in this app is stored and manipulated as integer cents so we
// never accumulate floating-point drift on balances.

function dollarsToCents(dollars) {
  return Math.round(Number(dollars) * 100);
}

function centsToDollars(cents) {
  return cents / 100;
}

// Formats cents as a localized "$1,234.56" string.
function formatCents(cents) {
  const value = Number(cents) || 0;
  const dollars = value / 100;
  const sign = dollars < 0 ? '-' : '';
  const abs = Math.abs(dollars);
  return sign + '$' + abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function percentOfCents(cents, fraction) {
  return Math.round(cents * fraction);
}

function clampCents(cents, min, max) {
  return Math.max(min, Math.min(max, cents));
}

module.exports = { dollarsToCents, centsToDollars, formatCents, percentOfCents, clampCents };

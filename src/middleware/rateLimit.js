const rateLimit = require('express-rate-limit');

// The automated test suite drives many auth/money requests in quick
// succession from the same loopback address; rate limiting is only useful
// against real, uncontrolled traffic, so it's disabled under NODE_ENV=test.
const skipInTests = () => process.env.NODE_ENV === 'test';

// Strict: login, register, 2FA verification.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTests,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' }
});

// Looser: deposits, withdrawals, and other money-moving routes.
const moneyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTests,
  message: { error: 'Too many requests. Please slow down and try again shortly.' }
});

// Baseline: applied globally.
const baselineLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTests
});

module.exports = { authLimiter, moneyLimiter, baselineLimiter };

const express = require('express');

const { requireAuth, requireGuest, safeNextPath } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');
const { hashPassword, verifyPassword, verifyTotpToken } = require('../services/auth');
const { isValidEmail, checkPasswordPolicy, isNonEmptyString, isAdult } = require('../services/validate');
const { logEvent } = require('../services/audit');

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    const carry = { ip: req.session.ip, userAgent: req.session.userAgent };
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.ip = carry.ip;
      req.session.userAgent = carry.userAgent;
      resolve();
    });
  });
}

module.exports = function authRoutes(db) {
  const router = express.Router();

  // ---- Registration ----------------------------------------------------
  router.get('/register', requireGuest, (req, res) => {
    res.render('auth/register', { title: 'Create Your Account', errors: [], values: {} });
  });

  router.post('/register', requireGuest, authLimiter, async (req, res) => {
    const { fullName, email, password, confirmPassword } = req.body;
    const errors = [];

    if (!isNonEmptyString(fullName, 120)) errors.push('Please enter your full name.');
    if (!isValidEmail(email)) errors.push('Please enter a valid email address.');
    const policy = checkPasswordPolicy(password);
    if (!policy.valid) errors.push(...policy.errors);
    if (password !== confirmPassword) errors.push('Passwords do not match.');

    let existing = null;
    if (isValidEmail(email)) {
      existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim().toLowerCase());
      if (existing) errors.push('An account with that email already exists.');
    }

    if (errors.length > 0) {
      return res.status(400).render('auth/register', {
        title: 'Create Your Account',
        errors,
        values: { fullName, email }
      });
    }

    const passwordHash = await hashPassword(password);
    const info = db.prepare(`
      INSERT INTO users (email, password_hash, full_name)
      VALUES (?, ?, ?)
    `).run(email.trim().toLowerCase(), passwordHash, fullName.trim());

    logEvent(db, { userId: info.lastInsertRowid, eventType: 'account_created', req });

    await regenerateSession(req);
    req.session.userId = info.lastInsertRowid;
    req.session.flash = { type: 'success', message: 'Welcome to USF Capital! Let’s verify a few details before you invest.' };
    res.redirect('/kyc');
  });

  // ---- Login (with staged 2FA) ------------------------------------------
  router.get('/login', requireGuest, (req, res) => {
    res.render('auth/login', { title: 'Log In', errors: [], values: {}, next: req.query.next || '' });
  });

  router.post('/login', requireGuest, authLimiter, async (req, res) => {
    const { email, password } = req.body;
    const nextPath = safeNextPath(req.body.next);
    const genericError = 'Incorrect email or password.';

    if (!isValidEmail(email) || !isNonEmptyString(password, 200)) {
      return res.status(400).render('auth/login', { title: 'Log In', errors: [genericError], values: { email }, next: nextPath });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
    const passwordOk = user ? await verifyPassword(password, user.password_hash) : false;

    if (!user || !passwordOk) {
      logEvent(db, { userId: user ? user.id : null, eventType: 'login_failed', detail: email, req });
      return res.status(400).render('auth/login', { title: 'Log In', errors: [genericError], values: { email }, next: nextPath });
    }

    if (user.totp_enabled) {
      await regenerateSession(req);
      req.session.pending2faUserId = user.id;
      req.session.pending2faNext = nextPath;
      return res.redirect('/login/verify');
    }

    await regenerateSession(req);
    req.session.userId = user.id;
    logEvent(db, { userId: user.id, eventType: 'login_success', req });
    res.redirect(nextPath);
  });

  router.get('/login/verify', (req, res) => {
    if (!req.session.pending2faUserId) return res.redirect('/login');
    res.render('auth/login-verify', { title: 'Verify Your Identity', errors: [] });
  });

  router.post('/login/verify', authLimiter, (req, res) => {
    const userId = req.session.pending2faUserId;
    if (!userId) return res.redirect('/login');

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    const token = req.body.token;

    if (!user || !user.totp_enabled || !verifyTotpToken(user.totp_secret, token)) {
      logEvent(db, { userId, eventType: 'login_2fa_failed', req });
      return res.status(400).render('auth/login-verify', {
        title: 'Verify Your Identity',
        errors: ['That code was not correct. Please check your authenticator app and try again.']
      });
    }

    const nextPath = safeNextPath(req.session.pending2faNext);
    req.session.pending2faUserId = null;
    req.session.pending2faNext = null;

    regenerateSession(req).then(() => {
      req.session.userId = user.id;
      logEvent(db, { userId: user.id, eventType: 'login_2fa_success', req });
      res.redirect(nextPath);
    });
  });

  // ---- Logout -------------------------------------------------------------
  router.post('/logout', (req, res) => {
    const userId = req.session.userId;
    if (userId) logEvent(db, { userId, eventType: 'logout', req });
    req.session.destroy(() => {
      res.clearCookie('usf.sid');
      res.redirect('/');
    });
  });

  // ---- KYC ------------------------------------------------------------
  router.get('/kyc', requireAuth, (req, res) => {
    if (req.user.kyc_status === 'approved') return res.redirect('/dashboard');
    res.render('auth/kyc', { title: 'Verify Your Identity', errors: [], values: {} });
  });

  router.post('/kyc', requireAuth, authLimiter, (req, res) => {
    if (req.user.kyc_status === 'approved') return res.redirect('/dashboard');

    const { fullName, dob, country, idNumber } = req.body;
    const errors = [];
    if (!isNonEmptyString(fullName, 120)) errors.push('Please enter your full legal name.');
    if (!isNonEmptyString(country, 80)) errors.push('Please enter your country of residence.');
    if (!isNonEmptyString(idNumber, 40)) errors.push('Please enter an ID number (any digits — this is a demo, nothing is verified with a real registry).');

    const dobDate = new Date(dob);
    const dobValid = !Number.isNaN(dobDate.getTime()) && dobDate.getTime() < Date.now();
    if (!dobValid) errors.push('Please enter a valid date of birth.');

    if (errors.length > 0) {
      return res.status(400).render('auth/kyc', { title: 'Verify Your Identity', errors, values: { fullName, dob, country } });
    }

    const adult = isAdult(dob);
    const idMasked = 'XXXX-' + String(idNumber).slice(-4);
    const status = adult ? 'approved' : 'rejected';

    db.prepare(`
      INSERT INTO kyc_submissions (user_id, full_name, dob, country, id_number_masked, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.user.id, fullName.trim(), dob, country.trim(), idMasked, status);

    if (adult) {
      db.prepare('UPDATE users SET kyc_status = ? WHERE id = ?').run('approved', req.user.id);
      logEvent(db, { userId: req.user.id, eventType: 'kyc_approved', req });
      req.session.flash = { type: 'success', message: 'You’re verified! You can now open your first simulated investment.' };
      return res.redirect('/deposit');
    }

    logEvent(db, { userId: req.user.id, eventType: 'kyc_rejected_minor', req });
    return res.status(400).render('auth/kyc', {
      title: 'Verify Your Identity',
      errors: ['You must be 18 or older to open an account on this platform. This demo cannot be bypassed for minors.'],
      values: { fullName, dob, country }
    });
  });

  return router;
};

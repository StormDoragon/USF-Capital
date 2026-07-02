const express = require('express');

const { requireAuth } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');
const { hashPassword, verifyPassword, generateTotpSecret, verifyTotpToken, generateQrDataUrl } = require('../services/auth');
const { checkPasswordPolicy, isNonEmptyString } = require('../services/validate');
const { logEvent, listEvents } = require('../services/audit');

module.exports = function securityRoutes(db) {
  const router = express.Router();
  router.use(requireAuth);

  router.get('/', (req, res) => {
    res.render('dashboard/settings', { title: 'Security & Settings' });
  });

  // ---- Password ---------------------------------------------------------
  router.get('/password', (req, res) => {
    res.render('dashboard/settings-password', { title: 'Change Password', errors: [] });
  });

  router.post('/password', authLimiter, async (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const errors = [];

    const ok = isNonEmptyString(currentPassword, 200) && await verifyPassword(currentPassword, req.user.password_hash);
    if (!ok) errors.push('Your current password was not correct.');

    const policy = checkPasswordPolicy(newPassword);
    if (!policy.valid) errors.push(...policy.errors);
    if (newPassword !== confirmPassword) errors.push('New passwords do not match.');

    if (errors.length > 0) {
      return res.status(400).render('dashboard/settings-password', { title: 'Change Password', errors });
    }

    const newHash = await hashPassword(newPassword);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, req.user.id);

    // Sign every other device out for safety; keep this session active.
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND sid != ?').run(req.user.id, req.sessionID);

    logEvent(db, { userId: req.user.id, eventType: 'password_changed', req });
    req.session.flash = { type: 'success', message: 'Your password was updated. We signed out any other devices for your safety.' };
    res.redirect('/settings');
  });

  // ---- Two-factor authentication -----------------------------------------
  router.get('/2fa', (req, res) => {
    res.render('dashboard/settings-2fa', { title: 'Two-Factor Authentication', qrDataUrl: null, secret: null, errors: [] });
  });

  router.post('/2fa/enroll', authLimiter, async (req, res) => {
    if (req.user.totp_enabled) return res.redirect('/settings/2fa');
    const secret = generateTotpSecret(req.user.email);
    req.session.pendingTotpSecret = secret.base32;
    const qrDataUrl = await generateQrDataUrl(secret.otpauth_url);
    res.render('dashboard/settings-2fa', { title: 'Two-Factor Authentication', qrDataUrl, secret: secret.base32, errors: [] });
  });

  router.post('/2fa/verify', authLimiter, (req, res) => {
    const pendingSecret = req.session.pendingTotpSecret;
    if (!pendingSecret) return res.redirect('/settings/2fa');

    if (!verifyTotpToken(pendingSecret, req.body.token)) {
      return res.status(400).render('dashboard/settings-2fa', {
        title: 'Two-Factor Authentication',
        qrDataUrl: null,
        secret: pendingSecret,
        errors: ['That code was not correct. Please try again with the current code from your app.']
      });
    }

    db.prepare('UPDATE users SET totp_secret = ?, totp_enabled = 1 WHERE id = ?').run(pendingSecret, req.user.id);
    req.session.pendingTotpSecret = null;
    logEvent(db, { userId: req.user.id, eventType: '2fa_enabled', req });
    req.session.flash = { type: 'success', message: 'Two-factor authentication is now on. Your account is more secure.' };
    res.redirect('/settings');
  });

  router.post('/2fa/disable', authLimiter, async (req, res) => {
    const ok = isNonEmptyString(req.body.currentPassword, 200) && await verifyPassword(req.body.currentPassword, req.user.password_hash);
    if (!ok) {
      return res.status(400).render('dashboard/settings-2fa', {
        title: 'Two-Factor Authentication',
        qrDataUrl: null,
        secret: null,
        errors: ['Your current password was not correct.']
      });
    }
    db.prepare('UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?').run(req.user.id);
    logEvent(db, { userId: req.user.id, eventType: '2fa_disabled', req });
    req.session.flash = { type: 'success', message: 'Two-factor authentication was turned off.' };
    res.redirect('/settings');
  });

  // ---- Active sessions ----------------------------------------------------
  router.get('/sessions', (req, res) => {
    const sessions = db.prepare(`
      SELECT sid, ip, user_agent, created_at, last_seen_at FROM sessions
      WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC
    `).all(req.user.id, Date.now());
    res.render('dashboard/settings-sessions', { title: 'Active Sessions', sessions, currentSid: req.sessionID });
  });

  router.post('/sessions/:sid/revoke', authLimiter, (req, res) => {
    const { sid } = req.params;
    db.prepare('DELETE FROM sessions WHERE sid = ? AND user_id = ?').run(sid, req.user.id);
    logEvent(db, { userId: req.user.id, eventType: 'session_revoked', detail: sid, req });

    if (sid === req.sessionID) {
      return req.session.destroy(() => {
        res.clearCookie('usf.sid');
        res.redirect('/login');
      });
    }
    req.session.flash = { type: 'success', message: 'That session was signed out.' };
    res.redirect('/settings/sessions');
  });

  // ---- Audit log ----------------------------------------------------------
  router.get('/audit-log', (req, res) => {
    const events = listEvents(db, req.user.id, 100);
    res.render('dashboard/settings-audit-log', { title: 'Security Activity', events });
  });

  return router;
};

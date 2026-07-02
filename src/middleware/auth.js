function attachUser(db) {
  return function attachUserMiddleware(req, res, next) {
    if (req.session && req.session.userId) {
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
      if (user) {
        req.user = user;
        res.locals.user = {
          id: user.id,
          email: user.email,
          fullName: user.full_name,
          kycStatus: user.kyc_status,
          totpEnabled: !!user.totp_enabled,
          cashBalanceCents: user.cash_balance_cents
        };
      } else {
        req.session.userId = null;
      }
    }
    next();
  };
}

function requireAuth(req, res, next) {
  if (!req.user) {
    const next_ = encodeURIComponent(req.originalUrl || '/dashboard');
    return res.redirect('/login?next=' + next_);
  }
  next();
}

function requireGuest(req, res, next) {
  if (req.user) return res.redirect('/dashboard');
  next();
}

function requireKyc(req, res, next) {
  if (!req.user) return res.redirect('/login');
  if (req.user.kyc_status !== 'approved') return res.redirect('/kyc');
  next();
}

// Only allow same-site, non-protocol-relative relative paths for post-login
// redirects, so an attacker can't smuggle an open redirect via ?next=.
function safeNextPath(raw, fallback = '/dashboard') {
  if (typeof raw !== 'string' || raw.length === 0) return fallback;
  if (!raw.startsWith('/')) return fallback;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  if (raw.includes('://')) return fallback;
  return raw;
}

module.exports = { attachUser, requireAuth, requireGuest, requireKyc, safeNextPath };

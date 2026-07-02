const crypto = require('crypto');

const CSRF_COOKIE = 'csrf_token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Double-submit cookie CSRF protection: a random token lives in a readable
// (non-httpOnly) cookie and must be echoed back in every state-changing
// request, either as a hidden form field or an X-CSRF-Token header. An
// attacker on another origin can trigger the request but cannot read the
// cookie value to echo it back.
function ensureCsrfToken(req, res, next) {
  let token = req.cookies ? req.cookies[CSRF_COOKIE] : null;
  if (!token) {
    token = crypto.randomBytes(32).toString('hex');
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/'
    });
  }
  req.csrfToken = token;
  res.locals.csrfToken = token;
  next();
}

function timingSafeEqualStrings(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifyCsrfToken(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const cookieToken = req.cookies ? req.cookies[CSRF_COOKIE] : null;
  const submitted = (req.body && req.body._csrf) || req.get('x-csrf-token');

  if (!cookieToken || !submitted || !timingSafeEqualStrings(cookieToken, submitted)) {
    return res.status(403).render('error', {
      title: 'Security check failed',
      message: 'Your form session expired or failed a security check. Please go back and try again.',
      status: 403
    });
  }
  next();
}

module.exports = { ensureCsrfToken, verifyCsrfToken, CSRF_COOKIE };

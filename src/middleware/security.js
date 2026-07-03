const crypto = require('crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SENSITIVE_PATH_PREFIXES = [
  '/dashboard',
  '/settings',
  '/deposit',
  '/withdraw',
  '/kyc',
  '/api/portfolio'
];

function configureTrustProxy(app) {
  const trustKnownProxy = process.env.TRUST_PROXY === '1' || process.env.VERCEL === '1';
  app.set('trust proxy', trustKnownProxy ? 1 : false);
}

function requestId(req, res, next) {
  const incoming = req.get('x-request-id');
  const id = incoming && incoming.length <= 80 ? incoming : crypto.randomUUID();
  req.id = id;
  res.locals.requestId = id;
  res.setHeader('X-Request-ID', id);
  next();
}

function hardenedHeaders(req, res, next) {
  res.setHeader('Permissions-Policy', [
    'camera=()',
    'microphone=()',
    'geolocation=()',
    'payment=()',
    'usb=()',
    'interest-cohort=()'
  ].join(', '));
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Origin-Agent-Cluster', '?1');
  next();
}

function noStoreSensitiveRoutes(req, res, next) {
  const shouldNoStore = !!req.user || SENSITIVE_PATH_PREFIXES.some((prefix) => req.path.startsWith(prefix));
  if (shouldNoStore) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
  }
  next();
}

function sameOriginGuard(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite === 'cross-site') {
    return res.status(403).render('error', {
      title: 'Security check failed',
      message: 'This request came from another site and was blocked before it could change anything.',
      status: 403
    });
  }

  const origin = req.get('origin');
  if (!origin) return next();

  try {
    const originUrl = new URL(origin);
    const host = req.get('host');
    if (!host || originUrl.host !== host) {
      return res.status(403).render('error', {
        title: 'Security check failed',
        message: 'This request did not match the current site origin and was blocked.',
        status: 403
      });
    }
  } catch (err) {
    return res.status(403).render('error', {
      title: 'Security check failed',
      message: 'This request had an invalid origin and was blocked.',
      status: 403
    });
  }

  next();
}

module.exports = {
  configureTrustProxy,
  requestId,
  hardenedHeaders,
  noStoreSensitiveRoutes,
  sameOriginGuard
};

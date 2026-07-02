const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const session = require('express-session');

const SqliteSessionStore = require('./services/sessionStore');
const { ensureCsrfToken, verifyCsrfToken } = require('./middleware/csrf');
const { attachUser } = require('./middleware/auth');
const { baselineLimiter } = require('./middleware/rateLimit');

const marketingRoutes = require('./routes/marketing');
const authRoutes = require('./routes/auth');
const poolsRoutes = require('./routes/pools');
const portfolioRoutes = require('./routes/portfolio');
const securityRoutes = require('./routes/security');
const apiRoutes = require('./routes/api');

// Builds the Express app. `db` is a better-sqlite3 connection, `pools` is the
// (small, static-for-the-process-lifetime) list of pool rows.
function createApp(db, pools) {
  const app = express();

  app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.disable('x-powered-by');

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
        formAction: ["'self'"]
      }
    },
    hsts: process.env.NODE_ENV === 'production'
  }));

  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));

  app.use(express.urlencoded({ extended: false, limit: '20kb' }));
  app.use(express.json({ limit: '20kb' }));
  app.use(cookieParser());

  app.use(session({
    name: 'usf.sid',
    secret: process.env.SESSION_SECRET || 'dev-only-insecure-secret-change-me',
    store: new SqliteSessionStore(db),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000
    }
  }));

  // Fixation-resistant defaults: record ip/UA once per session so the
  // "active sessions" view has something to show even for very old sessions.
  app.use((req, res, next) => {
    if (req.session && !req.session.ip) {
      req.session.ip = req.ip;
      req.session.userAgent = req.get('user-agent') || null;
    }
    next();
  });

  app.use(baselineLimiter);
  app.use(ensureCsrfToken);
  app.use(attachUser(db));

  // Must run before verifyCsrfToken: a rejected CSRF check renders the error
  // page immediately, which needs these locals (path/pools/user/flash) set.
  app.use((req, res, next) => {
    res.locals.path = req.path;
    res.locals.pools = pools;
    res.locals.user = res.locals.user || null;
    res.locals.flash = (req.session && req.session.flash) || null;
    if (req.session) delete req.session.flash;
    next();
  });

  app.use(verifyCsrfToken);

  app.use('/', marketingRoutes(db, pools));
  app.use('/', authRoutes(db, pools));
  app.use('/pools', poolsRoutes(db, pools));
  app.use('/', portfolioRoutes(db, pools));
  app.use('/settings', securityRoutes(db, pools));
  app.use('/api', apiRoutes(db, pools));

  app.use((req, res) => {
    res.status(404).render('404', { title: 'Page not found' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (process.env.NODE_ENV !== 'test') {
      console.error(err);
    }
    const status = err.status || 500;
    res.status(status).render('error', {
      title: 'Something went wrong',
      message: status === 500
        ? "We hit an unexpected problem on our end. Nothing was lost — please try again in a moment."
        : (err.message || 'Something went wrong.'),
      status
    });
  });

  return app;
}

module.exports = { createApp };

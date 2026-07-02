// Vercel serverless entry point. Rewritten to from every path by vercel.json.
//
// Vercel functions only have a writable /tmp, and a fresh container may not
// share /tmp with the previous invocation, so persistence here is
// best-effort — fine for a demo. For durable state, run server.js instead.
require('dotenv').config();
const path = require('path');

if (!process.env.DB_PATH) {
  process.env.DB_PATH = path.join('/tmp', 'usf-capital.db');
}

const { getDb } = require('../db');
const { seed } = require('../db/seed');
const { createApp } = require('../src/app');
const engine = require('../src/services/engine');

const db = getDb();
seed();
const pools = db.prepare('SELECT * FROM pools ORDER BY sort_order').all();

// Catches up any gap since this container was last warm. Per-request
// freshness for a given user's positions is then handled by
// engine.ensureFreshTicks() inside the dashboard/portfolio routes, since
// there is no long-lived process here to run a setInterval tick loop.
engine.runCatchUp(db, pools);

const app = createApp(db, pools);

module.exports = app;

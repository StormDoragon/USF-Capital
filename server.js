require('dotenv').config();

const { getDb } = require('./db');
const { seed } = require('./db/seed');
const { createApp } = require('./src/app');
const engine = require('./src/services/engine');
const { TICK_INTERVAL_MS } = require('./src/config');

const db = getDb();
seed();
const pools = db.prepare('SELECT * FROM pools ORDER BY sort_order').all();

const startedTicks = engine.runCatchUp(db, pools);
if (startedTicks > 0) {
  console.log(`Caught up ${startedTicks} missed simulation tick(s) since last run.`);
}

const app = createApp(db, pools);

const tickTimer = setInterval(() => {
  try {
    engine.runTickCycle(db, pools);
  } catch (err) {
    console.error('Tick cycle failed:', err);
  }
}, TICK_INTERVAL_MS);
tickTimer.unref();

const port = process.env.PORT || 3000;
const server = app.listen(port, () => {
  console.log(`USF Capital (demo) listening on http://localhost:${port}`);
  console.log('This is a simulation. No real funds, no real investment products.');
});

function shutdown() {
  clearInterval(tickTimer);
  server.close(() => process.exit(0));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

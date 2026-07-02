const fs = require('fs');
const os = require('os');
const path = require('path');

// Points DB_PATH at a fresh throwaway SQLite file, initializes the schema
// and seeds the four pools. Safe to call repeatedly within one test file —
// db/index.js reopens automatically whenever DB_PATH changes.
function createTestDb() {
  const dbPath = path.join(
    os.tmpdir(),
    `usf-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
  process.env.DB_PATH = dbPath;

  const { getDb, closeDb } = require('../../db/index');
  const db = getDb();
  const { seed } = require('../../db/seed');
  seed();
  const pools = db.prepare('SELECT * FROM pools ORDER BY sort_order').all();

  function cleanup() {
    closeDb();
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      try { fs.unlinkSync(dbPath + suffix); } catch (err) { /* already gone */ }
    }
  }

  return { db, pools, dbPath, cleanup };
}

module.exports = { createTestDb };

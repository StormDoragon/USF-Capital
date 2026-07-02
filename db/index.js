const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

let dbInstance = null;
let dbPathUsed = null;

function resolveDbPath() {
  return process.env.DB_PATH || path.join(__dirname, '..', 'data', 'usf-capital.db');
}

function getDb() {
  const wantedPath = resolveDbPath();
  if (dbInstance && dbPathUsed === wantedPath) return dbInstance;
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }

  if (wantedPath !== ':memory:') {
    fs.mkdirSync(path.dirname(wantedPath), { recursive: true });
  }

  dbInstance = new Database(wantedPath);
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('foreign_keys = ON');

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  dbInstance.exec(schema);

  dbPathUsed = wantedPath;
  return dbInstance;
}

function closeDb() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    dbPathUsed = null;
  }
}

module.exports = { getDb, closeDb };

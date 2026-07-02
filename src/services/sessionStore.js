const session = require('express-session');

const Store = session.Store;

// A small express-session Store backed directly by our own SQLite database,
// storing ip/user-agent/last-seen alongside the serialized session so the
// "active sessions" settings page can list and revoke them individually.
class SqliteSessionStore extends Store {
  constructor(db, options = {}) {
    super(options);
    this.db = db;
    this.ttlMs = options.ttlMs || 24 * 60 * 60 * 1000;
  }

  get(sid, cb) {
    try {
      const row = this.db.prepare('SELECT data, expires_at FROM sessions WHERE sid = ?').get(sid);
      if (!row) return cb(null, null);
      if (row.expires_at < Date.now()) {
        this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
        return cb(null, null);
      }
      cb(null, JSON.parse(row.data));
    } catch (err) {
      cb(err);
    }
  }

  set(sid, sessionData, cb) {
    try {
      const expiresAt = sessionData.cookie && sessionData.cookie.expires
        ? new Date(sessionData.cookie.expires).getTime()
        : Date.now() + this.ttlMs;
      const now = Date.now();
      const userId = sessionData.userId || null;
      const ip = sessionData.ip || null;
      const userAgent = sessionData.userAgent || null;
      const data = JSON.stringify(sessionData);

      this.db.prepare(`
        INSERT INTO sessions (sid, user_id, data, expires_at, ip, user_agent, created_at, last_seen_at)
        VALUES (@sid, @userId, @data, @expiresAt, @ip, @userAgent, @now, @now)
        ON CONFLICT(sid) DO UPDATE SET
          user_id = excluded.user_id,
          data = excluded.data,
          expires_at = excluded.expires_at,
          ip = COALESCE(excluded.ip, sessions.ip),
          user_agent = COALESCE(excluded.user_agent, sessions.user_agent),
          last_seen_at = excluded.last_seen_at
      `).run({ sid, userId, data, expiresAt, ip, userAgent, now });
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  destroy(sid, cb) {
    try {
      this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  touch(sid, sessionData, cb) {
    try {
      const expiresAt = sessionData.cookie && sessionData.cookie.expires
        ? new Date(sessionData.cookie.expires).getTime()
        : Date.now() + this.ttlMs;
      this.db.prepare('UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE sid = ?')
        .run(expiresAt, Date.now(), sid);
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  all(cb) {
    try {
      const rows = this.db.prepare('SELECT data FROM sessions WHERE expires_at > ?').all(Date.now());
      cb(null, rows.map((r) => JSON.parse(r.data)));
    } catch (err) {
      cb(err);
    }
  }

  length(cb) {
    try {
      const row = this.db.prepare('SELECT COUNT(*) AS c FROM sessions WHERE expires_at > ?').get(Date.now());
      cb(null, row.c);
    } catch (err) {
      cb(err);
    }
  }

  clear(cb) {
    try {
      this.db.prepare('DELETE FROM sessions').run();
      cb(null);
    } catch (err) {
      cb(err);
    }
  }
}

module.exports = SqliteSessionStore;

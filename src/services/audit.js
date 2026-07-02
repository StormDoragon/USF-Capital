function logEvent(db, { userId = null, eventType, detail = null, req = null }) {
  const ip = req ? req.ip : null;
  const userAgent = req ? req.get('user-agent') || null : null;
  db.prepare(`
    INSERT INTO audit_log (user_id, event_type, detail, ip, user_agent)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, eventType, detail, ip, userAgent);
}

function listEvents(db, userId, limit = 50) {
  return db.prepare(`
    SELECT * FROM audit_log WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
  `).all(userId, limit);
}

module.exports = { logEvent, listEvents };

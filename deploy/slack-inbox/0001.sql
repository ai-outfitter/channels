CREATE TABLE IF NOT EXISTS slack_inbox_events (
  tenantId TEXT NOT NULL,
  bindingId TEXT NOT NULL,
  eventId TEXT NOT NULL,
  body TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  acknowledgedAt INTEGER,
  PRIMARY KEY (tenantId, bindingId, eventId)
) STRICT;
CREATE INDEX IF NOT EXISTS slack_inbox_pending ON slack_inbox_events(tenantId,bindingId,acknowledgedAt,createdAt);

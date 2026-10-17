CREATE TABLE IF NOT EXISTS resident_slack_events (
  organizationId TEXT NOT NULL,
  residentId TEXT NOT NULL,
  eventId TEXT NOT NULL,
  body TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  acknowledgedAt INTEGER,
  PRIMARY KEY (organizationId, residentId, eventId)
) STRICT;
CREATE INDEX IF NOT EXISTS resident_slack_pending ON resident_slack_events(organizationId,residentId,acknowledgedAt,createdAt);

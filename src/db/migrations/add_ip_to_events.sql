-- Add IP Address to Events Table
-- Date: 2026-05-21
-- Purpose: Permanently log IP addresses for all events to track abuse and gaming

BEGIN;

-- Add IP address column
ALTER TABLE events ADD COLUMN IF NOT EXISTS ip_address INET;

-- Add index for IP-based queries
CREATE INDEX IF NOT EXISTS idx_events_ip_address ON events(ip_address) WHERE ip_address IS NOT NULL;

-- Add index for finding suspicious activity (many events from same IP)
CREATE INDEX IF NOT EXISTS idx_events_ip_created ON events(ip_address, created_at DESC) WHERE ip_address IS NOT NULL;

-- Add comment
COMMENT ON COLUMN events.ip_address IS 'IP address of the client (stored permanently for abuse detection and analytics)';

COMMIT;

-- Verification query to find potential abuse
-- SELECT
--   ip_address,
--   COUNT(*) FILTER (WHERE event_name = 'conversion_completed') as conversions,
--   COUNT(*) as total_events,
--   MIN(created_at) as first_event,
--   MAX(created_at) as last_event,
--   EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at)))/60 as duration_minutes
-- FROM events
-- WHERE created_at >= CURRENT_DATE
--   AND ip_address IS NOT NULL
-- GROUP BY ip_address
-- HAVING COUNT(*) FILTER (WHERE event_name = 'conversion_completed') > 5
-- ORDER BY conversions DESC;

-- Add User Information to Events Table
-- Date: 2026-03-14
-- Purpose: Track which user performed each event for better analytics

BEGIN;

-- Add user identification columns
ALTER TABLE events ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE events ADD COLUMN IF NOT EXISTS user_email VARCHAR(255);

-- Add foreign key constraint (optional, allows NULL for anonymous users)
ALTER TABLE events ADD CONSTRAINT fk_events_user_id
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

-- Add indexes for efficient user-based queries
CREATE INDEX IF NOT EXISTS idx_events_user_id ON events(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_user_email ON events(user_email) WHERE user_email IS NOT NULL;

-- Add comments
COMMENT ON COLUMN events.user_id IS 'User ID if the event was performed by an authenticated user (NULL for anonymous users)';
COMMENT ON COLUMN events.user_email IS 'User email for quick identification in analytics (denormalized for performance)';

COMMIT;

-- Verification query
-- SELECT
--   event_name,
--   COUNT(*) as total,
--   COUNT(user_id) as authenticated,
--   COUNT(*) - COUNT(user_id) as anonymous
-- FROM events
-- GROUP BY event_name
-- ORDER BY total DESC;

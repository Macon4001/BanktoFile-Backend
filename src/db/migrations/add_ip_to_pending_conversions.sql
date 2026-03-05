-- Hotfix: Add client_ip column to pending_conversions table
-- This prevents infinite conversions by checking if IP already has a pending conversion

ALTER TABLE pending_conversions ADD COLUMN IF NOT EXISTS client_ip VARCHAR(45);

-- Add index for IP lookups
CREATE INDEX IF NOT EXISTS idx_pending_conversions_ip ON pending_conversions(client_ip) WHERE client_ip IS NOT NULL;

-- Add comment
COMMENT ON COLUMN pending_conversions.client_ip IS 'Client IP address to prevent duplicate pending conversions from same IP';

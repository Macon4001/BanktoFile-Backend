-- URGENT FIX: Enable UUID extension and fix ip_conversions table
-- Run this immediately in production to fix the IP rate limiting

-- Enable UUID extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Drop and recreate the table with proper UUID support
DROP TABLE IF EXISTS ip_conversions CASCADE;

CREATE TABLE ip_conversions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ip_address INET NOT NULL,
    conversion_date DATE NOT NULL DEFAULT CURRENT_DATE,
    conversion_count INTEGER NOT NULL DEFAULT 1,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- Unique constraint: one row per IP per day
    CONSTRAINT unique_ip_per_day UNIQUE (ip_address, conversion_date)
);

-- Create indexes for fast lookups
CREATE INDEX idx_ip_conversions_ip_date ON ip_conversions(ip_address, conversion_date);
CREATE INDEX idx_ip_conversions_date ON ip_conversions(conversion_date);

-- Trigger to auto-update updated_at
CREATE TRIGGER update_ip_conversions_updated_at
    BEFORE UPDATE ON ip_conversions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Verify it works by testing UUID generation
DO $$
BEGIN
    IF (SELECT uuid_generate_v4() IS NOT NULL) THEN
        RAISE NOTICE '✅ UUID extension is working correctly';
    END IF;
END $$;

-- Show table is ready
SELECT 'ip_conversions table is ready!' as status;

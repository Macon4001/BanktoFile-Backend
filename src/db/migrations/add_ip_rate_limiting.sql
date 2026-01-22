-- IP-based rate limiting table
-- Tracks conversions by IP address to prevent abuse

CREATE TABLE IF NOT EXISTS ip_conversions (
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

-- Function to clean up old IP conversion records (older than 30 days)
CREATE OR REPLACE FUNCTION cleanup_old_ip_conversions()
RETURNS void AS $$
BEGIN
    DELETE FROM ip_conversions
    WHERE conversion_date < CURRENT_DATE - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;

-- Comment on table
COMMENT ON TABLE ip_conversions IS 'Tracks daily conversion counts by IP address for rate limiting';
COMMENT ON COLUMN ip_conversions.ip_address IS 'IP address of the user (supports IPv4 and IPv6)';
COMMENT ON COLUMN ip_conversions.conversion_date IS 'Date of conversions (resets daily)';
COMMENT ON COLUMN ip_conversions.conversion_count IS 'Number of conversions from this IP today';

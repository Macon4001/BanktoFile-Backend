-- Email Gate Migration
-- Adds support for email capture before first download and UTM tracking
-- Run this migration: psql <database> -f add_email_gate.sql

-- Add UTM tracking fields to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS utm_source VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS utm_medium VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS utm_campaign VARCHAR(255);

-- Add first conversion tracking
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_conversion_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_gate_completed_at TIMESTAMP WITH TIME ZONE;

-- Create pending_conversions table to hold processed files before email capture
CREATE TABLE IF NOT EXISTS pending_conversions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_token VARCHAR(255) UNIQUE NOT NULL,
    file_name VARCHAR(500) NOT NULL,
    csv_data TEXT NOT NULL,
    xlsx_data TEXT, -- base64 encoded XLSX
    transactions JSONB NOT NULL, -- structured transaction data
    metadata JSONB, -- includes bank name, date range, transaction count, etc.

    -- Tracking
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
);

-- Indexes for pending_conversions
CREATE INDEX IF NOT EXISTS idx_pending_conversions_session ON pending_conversions(session_token);
CREATE INDEX IF NOT EXISTS idx_pending_conversions_expires ON pending_conversions(expires_at);

-- Indexes for UTM tracking queries
CREATE INDEX IF NOT EXISTS idx_users_utm_source ON users(utm_source) WHERE utm_source IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_utm_campaign ON users(utm_campaign) WHERE utm_campaign IS NOT NULL;

-- Comments for documentation
COMMENT ON COLUMN users.utm_source IS 'UTM source parameter from signup/conversion (e.g., google, facebook, email)';
COMMENT ON COLUMN users.utm_medium IS 'UTM medium parameter (e.g., cpc, email, social)';
COMMENT ON COLUMN users.utm_campaign IS 'UTM campaign parameter (e.g., spring_sale, launch_2024)';
COMMENT ON COLUMN users.first_conversion_at IS 'Timestamp of users first file conversion';
COMMENT ON COLUMN users.email_gate_completed_at IS 'Timestamp when user completed email gate (provided email for first download)';

COMMENT ON TABLE pending_conversions IS 'Stores processed conversion results before user provides email. Files expire after 24 hours.';
COMMENT ON COLUMN pending_conversions.session_token IS 'Unique session token identifying this pending conversion';
COMMENT ON COLUMN pending_conversions.csv_data IS 'Generated CSV content';
COMMENT ON COLUMN pending_conversions.xlsx_data IS 'Base64 encoded XLSX content';
COMMENT ON COLUMN pending_conversions.transactions IS 'Structured transaction data (JSON array)';
COMMENT ON COLUMN pending_conversions.metadata IS 'Conversion metadata: bank name, date range, transaction count, etc.';

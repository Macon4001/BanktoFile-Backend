-- PostgreSQL Database Schema for Bank Statement Converter
-- This schema supports user authentication, Stripe subscriptions, and conversion tracking

-- Enable UUID extension for generating unique IDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
-- Stores user account information, authentication data, and subscription details
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255), -- NULL for Google OAuth users
    name VARCHAR(255),

    -- Stripe integration fields
    stripe_customer_id VARCHAR(255) UNIQUE,
    subscription_id VARCHAR(255),
    subscription_status VARCHAR(50) CHECK (subscription_status IN ('active', 'canceled', 'past_due', 'trialing', 'incomplete', 'incomplete_expired', 'unpaid')),

    -- Plan and usage tracking
    plan VARCHAR(50) NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'starter', 'professional', 'enterprise')),
    pages_used_today INTEGER NOT NULL DEFAULT 0,
    daily_pages_limit INTEGER NOT NULL DEFAULT 3, -- Daily limit for free plan
    last_reset_date DATE DEFAULT CURRENT_DATE, -- Track when daily usage was last reset

    -- For paid plans - monthly tracking
    pages_used_monthly INTEGER NOT NULL DEFAULT 0,
    monthly_pages_limit INTEGER NOT NULL DEFAULT 50,

    -- Subscription period tracking
    current_period_start TIMESTAMP WITH TIME ZONE,
    current_period_end TIMESTAMP WITH TIME ZONE,

    -- OAuth providers
    google_id VARCHAR(255) UNIQUE, -- Google user ID for OAuth

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- Indexes for fast lookups
    CONSTRAINT users_email_key UNIQUE (email)
);

-- Create indexes for frequently queried fields
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_stripe_customer_id ON users(stripe_customer_id);
CREATE INDEX idx_users_google_id ON users(google_id);
CREATE INDEX idx_users_subscription_status ON users(subscription_status);
CREATE INDEX idx_users_plan ON users(plan);

-- Conversion logs table
-- Tracks all PDF/CSV conversion activity by users
CREATE TABLE conversion_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_name VARCHAR(500) NOT NULL,
    pages_converted INTEGER NOT NULL,
    conversion_type VARCHAR(50) CHECK (conversion_type IN ('pdf_to_csv', 'pdf_to_xlsx')),
    file_size_bytes BIGINT,

    -- Timestamps
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- Index for querying user's conversion history
    CONSTRAINT conversion_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create indexes for conversion logs
CREATE INDEX idx_conversion_logs_user_id ON conversion_logs(user_id);
CREATE INDEX idx_conversion_logs_timestamp ON conversion_logs(timestamp);
CREATE INDEX idx_conversion_logs_user_timestamp ON conversion_logs(user_id, timestamp DESC);

-- Subscription history table (optional, for tracking changes)
-- Useful for analytics and debugging subscription issues
CREATE TABLE subscription_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subscription_id VARCHAR(255) NOT NULL,
    event_type VARCHAR(100) NOT NULL, -- e.g., 'created', 'updated', 'canceled', 'renewed'
    old_plan VARCHAR(50),
    new_plan VARCHAR(50),
    old_status VARCHAR(50),
    new_status VARCHAR(50),
    stripe_event_id VARCHAR(255),
    metadata JSONB, -- Store additional Stripe webhook data

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes for subscription history
CREATE INDEX idx_subscription_history_user_id ON subscription_history(user_id);
CREATE INDEX idx_subscription_history_timestamp ON subscription_history(created_at);
CREATE INDEX idx_subscription_history_event_type ON subscription_history(event_type);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at on users table
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to reset daily page usage for free users
CREATE OR REPLACE FUNCTION reset_daily_usage()
RETURNS void AS $$
BEGIN
    UPDATE users
    SET pages_used_today = 0,
        last_reset_date = CURRENT_DATE,
        updated_at = NOW()
    WHERE last_reset_date < CURRENT_DATE
    AND plan = 'free';
END;
$$ LANGUAGE plpgsql;

-- Function to reset monthly page usage for paid plans (call this via cron job)
CREATE OR REPLACE FUNCTION reset_monthly_usage()
RETURNS void AS $$
BEGIN
    UPDATE users
    SET pages_used_monthly = 0,
        updated_at = NOW()
    WHERE current_period_end < NOW()
    AND subscription_status = 'active';
END;
$$ LANGUAGE plpgsql;

-- View for user statistics
CREATE OR REPLACE VIEW user_stats AS
SELECT
    u.id,
    u.email,
    u.name,
    u.plan,
    CASE WHEN u.plan = 'free' THEN u.pages_used_today ELSE u.pages_used_monthly END as pages_used,
    CASE WHEN u.plan = 'free' THEN u.daily_pages_limit ELSE u.monthly_pages_limit END as pages_limit,
    CASE
        WHEN u.plan = 'free' THEN ROUND((u.pages_used_today::numeric / NULLIF(u.daily_pages_limit, 0)) * 100, 2)
        ELSE ROUND((u.pages_used_monthly::numeric / NULLIF(u.monthly_pages_limit, 0)) * 100, 2)
    END as usage_percentage,
    COUNT(cl.id) as total_conversions,
    SUM(cl.pages_converted) as total_pages_converted,
    MAX(cl.timestamp) as last_conversion_at,
    u.last_reset_date,
    u.created_at,
    u.subscription_status
FROM users u
LEFT JOIN conversion_logs cl ON u.id = cl.user_id
GROUP BY u.id;

-- Sample data insert function (for testing)
CREATE OR REPLACE FUNCTION create_sample_user(
    p_email VARCHAR,
    p_password VARCHAR,
    p_name VARCHAR DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_user_id UUID;
    v_password_hash VARCHAR;
BEGIN
    -- Hash password (note: in production, hash on application side)
    -- This is just for testing purposes
    v_password_hash := crypt(p_password, gen_salt('bf'));

    INSERT INTO users (email, password_hash, name, plan, daily_pages_limit, monthly_pages_limit)
    VALUES (p_email, v_password_hash, COALESCE(p_name, split_part(p_email, '@', 1)), 'free', 3, 50)
    RETURNING id INTO v_user_id;

    RETURN v_user_id;
END;
$$ LANGUAGE plpgsql;

-- Comments on tables for documentation
COMMENT ON TABLE users IS 'Stores user account information, authentication, and subscription data';
COMMENT ON TABLE conversion_logs IS 'Tracks all PDF/CSV conversion activity';
COMMENT ON TABLE subscription_history IS 'Audit log for subscription changes and Stripe webhook events';

COMMENT ON COLUMN users.stripe_customer_id IS 'Stripe customer ID for payment processing';
COMMENT ON COLUMN users.subscription_id IS 'Current Stripe subscription ID';
COMMENT ON COLUMN users.google_id IS 'Google OAuth user ID (null for email/password users)';
COMMENT ON COLUMN users.pages_used_today IS 'Number of pages converted today (for free users)';
COMMENT ON COLUMN users.daily_pages_limit IS 'Daily page limit (primarily for free users - 3 pages/day)';
COMMENT ON COLUMN users.last_reset_date IS 'Date when daily usage was last reset';
COMMENT ON COLUMN users.pages_used_monthly IS 'Number of pages converted in current month (for paid users)';
COMMENT ON COLUMN users.monthly_pages_limit IS 'Monthly page limit (for paid plans)';
COMMENT ON COLUMN users.current_period_start IS 'Start of current subscription billing period';
COMMENT ON COLUMN users.current_period_end IS 'End of current subscription billing period';

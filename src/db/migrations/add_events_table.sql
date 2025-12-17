-- Events table for analytics tracking
-- Tracks user interactions and behavior across the application

CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id VARCHAR(255) NOT NULL,
    event_name VARCHAR(100) NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_event_name ON events(event_name);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_event_name_created_at ON events(event_name, created_at DESC);

-- Add comments for documentation
COMMENT ON TABLE events IS 'Tracks user interaction events for analytics and funnel analysis';
COMMENT ON COLUMN events.session_id IS 'Anonymous session identifier stored in browser sessionStorage';
COMMENT ON COLUMN events.event_name IS 'Type of event (e.g., page_view, upload_started, payment_completed)';
COMMENT ON COLUMN events.metadata IS 'Additional event data stored as JSON (errors, file info, etc.)';
COMMENT ON COLUMN events.created_at IS 'Timestamp when the event occurred';

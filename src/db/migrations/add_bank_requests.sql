-- Bank requests table
-- Stores user requests for adding support for new banks
-- This helps track demand for bank support and notify users when added

CREATE TABLE IF NOT EXISTS bank_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bank_name VARCHAR(255) NOT NULL,
    user_email VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'rejected')),

    -- Optional: link to user if they're logged in
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,

    -- Additional context
    notes TEXT, -- User can provide additional context
    admin_notes TEXT, -- Admin notes when processing

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Create indexes for fast lookups
CREATE INDEX idx_bank_requests_bank_name ON bank_requests(bank_name);
CREATE INDEX idx_bank_requests_user_email ON bank_requests(user_email);
CREATE INDEX idx_bank_requests_status ON bank_requests(status);
CREATE INDEX idx_bank_requests_created_at ON bank_requests(created_at DESC);
CREATE INDEX idx_bank_requests_user_id ON bank_requests(user_id);

-- Trigger to auto-update updated_at on bank_requests table
CREATE TRIGGER update_bank_requests_updated_at
    BEFORE UPDATE ON bank_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- View to see bank request statistics
CREATE OR REPLACE VIEW bank_request_stats AS
SELECT
    bank_name,
    COUNT(*) as request_count,
    COUNT(DISTINCT user_email) as unique_users,
    MIN(created_at) as first_request_at,
    MAX(created_at) as latest_request_at,
    COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count,
    COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_count
FROM bank_requests
GROUP BY bank_name
ORDER BY request_count DESC, latest_request_at DESC;

-- Comments for documentation
COMMENT ON TABLE bank_requests IS 'Stores user requests for adding support for new banks';
COMMENT ON COLUMN bank_requests.status IS 'Status of the request: pending, in_progress, completed, or rejected';
COMMENT ON COLUMN bank_requests.notes IS 'Additional context provided by the user';
COMMENT ON COLUMN bank_requests.admin_notes IS 'Internal notes added by admin when processing the request';

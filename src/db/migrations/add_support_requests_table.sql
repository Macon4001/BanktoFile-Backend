-- Support Requests Table Migration
-- Stores user support requests and error reports with Kanban status tracking

CREATE TABLE IF NOT EXISTS support_requests (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(255),
  issue_type VARCHAR(50) CHECK (issue_type IN ('general', 'upload_error', 'conversion_error', 'download_error', 'payment_error', 'other')),
  error_type VARCHAR(100),
  error_message TEXT,
  description TEXT NOT NULL,
  user_email VARCHAR(255) NOT NULL,
  context_data JSONB DEFAULT '{}',
  status VARCHAR(20) DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'resolved')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_support_requests_status ON support_requests(status);
CREATE INDEX IF NOT EXISTS idx_support_requests_created_at ON support_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_requests_issue_type ON support_requests(issue_type);
CREATE INDEX IF NOT EXISTS idx_support_requests_session_id ON support_requests(session_id);
CREATE INDEX IF NOT EXISTS idx_support_requests_email ON support_requests(user_email);

-- Create a function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_support_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER trigger_update_support_requests_updated_at
  BEFORE UPDATE ON support_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_support_requests_updated_at();

-- Comments for documentation
COMMENT ON TABLE support_requests IS 'Stores user support requests and error reports with Kanban status tracking';
COMMENT ON COLUMN support_requests.session_id IS 'Session identifier to correlate with analytics events';
COMMENT ON COLUMN support_requests.issue_type IS 'Category of the support request';
COMMENT ON COLUMN support_requests.error_type IS 'Technical error type/code if applicable';
COMMENT ON COLUMN support_requests.error_message IS 'Technical error message from the system';
COMMENT ON COLUMN support_requests.description IS 'User description of what they were attempting and what went wrong';
COMMENT ON COLUMN support_requests.user_email IS 'User email address for follow-up (required)';
COMMENT ON COLUMN support_requests.context_data IS 'Additional context: file metadata, browser info, page URL, etc.';
COMMENT ON COLUMN support_requests.status IS 'Kanban status: new, in_progress, or resolved';

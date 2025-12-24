-- Feedback Table Migration
-- Stores user feedback on conversion experiences

CREATE TABLE IF NOT EXISTS feedback (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(50),
  rating VARCHAR(10) CHECK (rating IN ('positive', 'negative')),
  comment TEXT,
  bank_name VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_rating ON feedback(rating);
CREATE INDEX IF NOT EXISTS idx_feedback_bank_name ON feedback(bank_name);

-- Comment on table for documentation
COMMENT ON TABLE feedback IS 'Stores user feedback on bank statement conversion experiences';
COMMENT ON COLUMN feedback.session_id IS 'Optional session identifier to track feedback context';
COMMENT ON COLUMN feedback.rating IS 'User rating: positive (thumbs up) or negative (thumbs down)';
COMMENT ON COLUMN feedback.comment IS 'Optional user comment providing additional context';
COMMENT ON COLUMN feedback.bank_name IS 'Optional bank name associated with the conversion';

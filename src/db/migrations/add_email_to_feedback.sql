-- Add email column to feedback table
-- Allows admins to contact users who provide feedback

ALTER TABLE feedback ADD COLUMN IF NOT EXISTS email VARCHAR(255) NOT NULL DEFAULT '';

-- Create index for efficient email lookups
CREATE INDEX IF NOT EXISTS idx_feedback_email ON feedback(email);

-- Comment on column for documentation
COMMENT ON COLUMN feedback.email IS 'Required user email for follow-up contact';

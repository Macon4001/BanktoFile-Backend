import pool from '../config/database';

interface CreateSupportRequestParams {
  sessionId?: string;
  issueType: 'general' | 'upload_error' | 'conversion_error' | 'download_error' | 'payment_error' | 'other';
  errorType?: string;
  errorMessage?: string;
  description: string;
  userEmail: string;
  contextData?: Record<string, unknown>;
}

interface UpdateStatusParams {
  id: number;
  status: 'new' | 'in_progress' | 'resolved';
}

interface SupportRequest {
  id: number;
  session_id: string | null;
  issue_type: string;
  error_type: string | null;
  error_message: string | null;
  description: string;
  user_email: string;
  context_data: Record<string, unknown>;
  status: 'new' | 'in_progress' | 'resolved';
  created_at: Date;
  updated_at: Date;
}

export const supportService = {
  /**
   * Create a new support request
   */
  async createSupportRequest(params: CreateSupportRequestParams): Promise<SupportRequest> {
    const {
      sessionId,
      issueType,
      errorType,
      errorMessage,
      description,
      userEmail,
      contextData = {},
    } = params;

    const query = `
      INSERT INTO support_requests (
        session_id,
        issue_type,
        error_type,
        error_message,
        description,
        user_email,
        context_data
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;

    const values = [
      sessionId || null,
      issueType,
      errorType || null,
      errorMessage || null,
      description,
      userEmail,
      JSON.stringify(contextData),
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  },

  /**
   * Get all support requests (for admin)
   */
  async getAllSupportRequests(): Promise<SupportRequest[]> {
    const query = `
      SELECT * FROM support_requests
      ORDER BY
        CASE status
          WHEN 'new' THEN 1
          WHEN 'in_progress' THEN 2
          WHEN 'resolved' THEN 3
        END,
        created_at DESC
    `;

    const result = await pool.query(query);
    return result.rows;
  },

  /**
   * Get support requests by status (for Kanban board)
   */
  async getSupportRequestsByStatus(status: 'new' | 'in_progress' | 'resolved'): Promise<SupportRequest[]> {
    const query = `
      SELECT * FROM support_requests
      WHERE status = $1
      ORDER BY created_at DESC
    `;

    const result = await pool.query(query, [status]);
    return result.rows;
  },

  /**
   * Get a single support request by ID
   */
  async getSupportRequestById(id: number): Promise<SupportRequest | null> {
    const query = `
      SELECT * FROM support_requests
      WHERE id = $1
    `;

    const result = await pool.query(query, [id]);
    return result.rows[0] || null;
  },

  /**
   * Update support request status
   */
  async updateStatus(params: UpdateStatusParams): Promise<SupportRequest> {
    const { id, status } = params;

    const query = `
      UPDATE support_requests
      SET status = $1
      WHERE id = $2
      RETURNING *
    `;

    const result = await pool.query(query, [status, id]);

    if (result.rows.length === 0) {
      throw new Error('Support request not found');
    }

    return result.rows[0];
  },

  /**
   * Get support requests by session ID (to correlate with analytics)
   */
  async getSupportRequestsBySession(sessionId: string): Promise<SupportRequest[]> {
    const query = `
      SELECT * FROM support_requests
      WHERE session_id = $1
      ORDER BY created_at DESC
    `;

    const result = await pool.query(query, [sessionId]);
    return result.rows;
  },

  /**
   * Get summary statistics
   */
  async getSummaryStats(): Promise<{
    total: number;
    new: number;
    in_progress: number;
    resolved: number;
    byIssueType: Record<string, number>;
  }> {
    const countQuery = `
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'new') as new,
        COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
        COUNT(*) FILTER (WHERE status = 'resolved') as resolved
      FROM support_requests
    `;

    const issueTypeQuery = `
      SELECT issue_type, COUNT(*) as count
      FROM support_requests
      GROUP BY issue_type
    `;

    const [countResult, issueTypeResult] = await Promise.all([
      pool.query(countQuery),
      pool.query(issueTypeQuery),
    ]);

    const byIssueType: Record<string, number> = {};
    issueTypeResult.rows.forEach((row) => {
      byIssueType[row.issue_type] = parseInt(row.count);
    });

    return {
      total: parseInt(countResult.rows[0].total),
      new: parseInt(countResult.rows[0].new),
      in_progress: parseInt(countResult.rows[0].in_progress),
      resolved: parseInt(countResult.rows[0].resolved),
      byIssueType,
    };
  },

  /**
   * Delete a support request (admin only, for cleanup)
   */
  async deleteSupportRequest(id: number): Promise<void> {
    const query = `
      DELETE FROM support_requests
      WHERE id = $1
    `;

    await pool.query(query, [id]);
  },
};

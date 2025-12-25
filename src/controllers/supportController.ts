import { Request, Response } from 'express';
import { supportService } from '../services/supportService.js';
import { sendSupportRequestEmail } from '../services/emailService.js';

/**
 * Create a new support request (public endpoint)
 */
export const createSupportRequest = async (req: Request, res: Response) => {
  try {
    const {
      sessionId,
      issueType,
      errorType,
      errorMessage,
      description,
      userEmail,
      contextData,
    } = req.body;

    // Validate required fields
    if (!description || !userEmail) {
      return res.status(400).json({
        error: 'Missing required fields: description and userEmail are required',
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(userEmail)) {
      return res.status(400).json({
        error: 'Invalid email format',
      });
    }

    // Validate issue type
    const validIssueTypes = ['general', 'upload_error', 'conversion_error', 'download_error', 'payment_error', 'other'];
    if (issueType && !validIssueTypes.includes(issueType)) {
      return res.status(400).json({
        error: 'Invalid issue type',
      });
    }

    // Create support request
    const supportRequest = await supportService.createSupportRequest({
      sessionId,
      issueType: issueType || 'general',
      errorType,
      errorMessage,
      description,
      userEmail,
      contextData,
    });

    // Send email notification to admin
    try {
      await sendSupportRequestEmail({
        id: supportRequest.id,
        issueType: supportRequest.issue_type,
        errorType: supportRequest.error_type || undefined,
        errorMessage: supportRequest.error_message || undefined,
        description: supportRequest.description,
        userEmail: supportRequest.user_email,
        sessionId: supportRequest.session_id || undefined,
        contextData: supportRequest.context_data,
      });
    } catch (emailError) {
      console.error('Failed to send support request email:', emailError);
      // Don't fail the request if email fails
    }

    res.status(201).json({
      success: true,
      supportRequest: {
        id: supportRequest.id,
        status: supportRequest.status,
        created_at: supportRequest.created_at,
      },
    });
  } catch (error) {
    console.error('Error creating support request:', error);
    res.status(500).json({
      error: 'Failed to create support request',
    });
  }
};

/**
 * Get all support requests (admin only)
 */
export const getAllSupportRequests = async (req: Request, res: Response) => {
  try {
    const supportRequests = await supportService.getAllSupportRequests();

    res.json({
      success: true,
      supportRequests,
    });
  } catch (error) {
    console.error('Error fetching support requests:', error);
    res.status(500).json({
      error: 'Failed to fetch support requests',
    });
  }
};

/**
 * Get support requests by status (admin only)
 */
export const getSupportRequestsByStatus = async (req: Request, res: Response) => {
  try {
    const { status } = req.params;

    if (!['new', 'in_progress', 'resolved'].includes(status)) {
      return res.status(400).json({
        error: 'Invalid status',
      });
    }

    const supportRequests = await supportService.getSupportRequestsByStatus(
      status as 'new' | 'in_progress' | 'resolved'
    );

    res.json({
      success: true,
      supportRequests,
    });
  } catch (error) {
    console.error('Error fetching support requests by status:', error);
    res.status(500).json({
      error: 'Failed to fetch support requests',
    });
  }
};

/**
 * Get a single support request by ID (admin only)
 */
export const getSupportRequestById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const supportRequest = await supportService.getSupportRequestById(parseInt(id));

    if (!supportRequest) {
      return res.status(404).json({
        error: 'Support request not found',
      });
    }

    res.json({
      success: true,
      supportRequest,
    });
  } catch (error) {
    console.error('Error fetching support request:', error);
    res.status(500).json({
      error: 'Failed to fetch support request',
    });
  }
};

/**
 * Update support request status (admin only)
 */
export const updateSupportRequestStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['new', 'in_progress', 'resolved'].includes(status)) {
      return res.status(400).json({
        error: 'Invalid status',
      });
    }

    const supportRequest = await supportService.updateStatus({
      id: parseInt(id),
      status,
    });

    res.json({
      success: true,
      supportRequest,
    });
  } catch (error) {
    console.error('Error updating support request status:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to update support request status',
    });
  }
};

/**
 * Get summary statistics (admin only)
 */
export const getSummaryStats = async (req: Request, res: Response) => {
  try {
    const stats = await supportService.getSummaryStats();

    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error('Error fetching summary stats:', error);
    res.status(500).json({
      error: 'Failed to fetch summary stats',
    });
  }
};

/**
 * Delete a support request (admin only)
 */
export const deleteSupportRequest = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await supportService.deleteSupportRequest(parseInt(id));

    res.json({
      success: true,
      message: 'Support request deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting support request:', error);
    res.status(500).json({
      error: 'Failed to delete support request',
    });
  }
};

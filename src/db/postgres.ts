import { Pool, QueryResult } from 'pg';

// Database interfaces matching the schema
export interface User {
  id: string;
  email: string;
  password_hash?: string;
  name?: string;
  stripe_customer_id?: string;
  subscription_id?: string;
  subscription_status?: 'active' | 'canceled' | 'past_due' | 'trialing' | 'incomplete' | 'incomplete_expired' | 'unpaid';
  plan: 'free' | 'starter' | 'professional' | 'enterprise';
  pages_used_today: number;
  daily_pages_limit: number;
  last_reset_date: string;
  pages_used_monthly: number;
  monthly_pages_limit: number;
  current_period_start?: Date;
  current_period_end?: Date;
  google_id?: string;
  picture?: string;
  created_at: Date;
  updated_at: Date;

  // Deprecated fields for backwards compatibility
  pagesUsed?: number;
  pagesLimit?: number;
  pagesUsedToday?: number;
  dailyPagesLimit?: number;
  pagesUsedMonthly?: number;
  monthlyPagesLimit?: number;
}

export interface ConversionLog {
  id: string;
  user_id: string;
  file_name: string;
  pages_converted: number;
  conversion_type?: 'pdf_to_csv' | 'pdf_to_xlsx';
  file_size_bytes?: number;
  timestamp: Date;
}

export interface BlogPost {
  id: string;
  title: string;
  slug: string;
  excerpt?: string;
  content: string;
  category?: string;
  read_time?: string;
  author_id?: string;
  featured_image_url?: string;
  published: boolean;
  published_at?: Date;
  meta_description?: string;
  meta_keywords?: string;
  created_at: Date;
  updated_at: Date;
}

export interface BlogImage {
  id: string;
  blog_post_id: string;
  url: string;
  alt_text?: string;
  file_name?: string;
  file_size_bytes?: number;
  mime_type?: string;
  created_at: Date;
}

export interface NewsletterSubscriber {
  id: string;
  email: string;
  active: boolean;
  subscribed_at: Date;
  unsubscribed_at?: Date;
}

export interface BankRequest {
  id: string;
  bank_name: string;
  user_email: string;
  status: 'pending' | 'in_progress' | 'completed' | 'rejected';
  user_id?: string | null;
  notes?: string | null;
  admin_notes?: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at?: Date | null;
}

export interface BankRequestStats {
  bank_name: string;
  request_count: number;
  unique_users: number;
  first_request_at: Date;
  latest_request_at: Date;
  pending_count: number;
  completed_count: number;
}

// Create connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test database connection
pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('❌ Unexpected error on idle client', err);
  process.exit(-1);
});

// Helper function to normalize user object for backwards compatibility
function normalizeUser(dbUser: any): User {
  return {
    ...dbUser,
    // Map snake_case DB fields to camelCase for backwards compatibility
    pagesUsed: dbUser.plan === 'free' ? dbUser.pages_used_today : dbUser.pages_used_monthly,
    pagesLimit: dbUser.plan === 'free' ? dbUser.daily_pages_limit : dbUser.monthly_pages_limit,
    pagesUsedToday: dbUser.pages_used_today,
    dailyPagesLimit: dbUser.daily_pages_limit,
    pagesUsedMonthly: dbUser.pages_used_monthly,
    monthlyPagesLimit: dbUser.monthly_pages_limit,
  };
}

class PostgresStore {
  // User methods
  async createUser(email: string, additionalFields: Partial<User> = {}): Promise<User> {
    const client = await pool.connect();
    try {
      const result = await client.query<User>(
        `INSERT INTO users (
          email,
          name,
          password_hash,
          google_id,
          plan,
          pages_used_today,
          daily_pages_limit,
          pages_used_monthly,
          monthly_pages_limit
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *`,
        [
          email,
          additionalFields.name || email.split('@')[0],
          additionalFields.password_hash || null,
          additionalFields.google_id || null,
          additionalFields.plan || 'free',
          0, // pages_used_today
          3, // daily_pages_limit for free users
          0, // pages_used_monthly
          50, // monthly_pages_limit
        ]
      );
      return normalizeUser(result.rows[0]);
    } finally {
      client.release();
    }
  }

  async getUserById(userId: string): Promise<User | undefined> {
    const client = await pool.connect();
    try {
      // First, reset daily usage if needed
      await client.query(
        `UPDATE users
         SET pages_used_today = 0, last_reset_date = CURRENT_DATE
         WHERE id = $1 AND plan = 'free' AND last_reset_date < CURRENT_DATE`,
        [userId]
      );

      const result = await client.query<User>(
        'SELECT * FROM users WHERE id = $1',
        [userId]
      );
      return result.rows[0] ? normalizeUser(result.rows[0]) : undefined;
    } finally {
      client.release();
    }
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const client = await pool.connect();
    try {
      // First, reset daily usage if needed
      await client.query(
        `UPDATE users
         SET pages_used_today = 0, last_reset_date = CURRENT_DATE
         WHERE email = $1 AND plan = 'free' AND last_reset_date < CURRENT_DATE`,
        [email]
      );

      const result = await client.query<User>(
        'SELECT * FROM users WHERE email = $1',
        [email]
      );
      return result.rows[0] ? normalizeUser(result.rows[0]) : undefined;
    } finally {
      client.release();
    }
  }

  async getUserByGoogleId(googleId: string): Promise<User | undefined> {
    const client = await pool.connect();
    try {
      const result = await client.query<User>(
        'SELECT * FROM users WHERE google_id = $1',
        [googleId]
      );
      return result.rows[0] ? normalizeUser(result.rows[0]) : undefined;
    } finally {
      client.release();
    }
  }

  async getUserByStripeCustomerId(customerId: string): Promise<User | undefined> {
    const client = await pool.connect();
    try {
      const result = await client.query<User>(
        'SELECT * FROM users WHERE stripe_customer_id = $1',
        [customerId]
      );
      return result.rows[0] ? normalizeUser(result.rows[0]) : undefined;
    } finally {
      client.release();
    }
  }

  async updateUser(userId: string, updates: Partial<User>): Promise<User | undefined> {
    const client = await pool.connect();
    try {
      // Build dynamic update query
      const fields: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      // Map camelCase to snake_case
      const fieldMapping: Record<string, string> = {
        name: 'name',
        password_hash: 'password_hash',
        stripe_customer_id: 'stripe_customer_id',
        subscription_id: 'subscription_id',
        subscription_status: 'subscription_status',
        plan: 'plan',
        pages_used_today: 'pages_used_today',
        daily_pages_limit: 'daily_pages_limit',
        pages_used_monthly: 'pages_used_monthly',
        monthly_pages_limit: 'monthly_pages_limit',
        current_period_start: 'current_period_start',
        current_period_end: 'current_period_end',
        google_id: 'google_id',
        picture: 'picture',
      };

      Object.entries(updates).forEach(([key, value]) => {
        const dbField = fieldMapping[key];
        if (dbField && value !== undefined) {
          fields.push(`${dbField} = $${paramIndex}`);
          values.push(value);
          paramIndex++;
        }
      });

      if (fields.length === 0) {
        return this.getUserById(userId);
      }

      values.push(userId);
      const query = `
        UPDATE users
        SET ${fields.join(', ')}, updated_at = NOW()
        WHERE id = $${paramIndex}
        RETURNING *
      `;

      const result = await client.query<User>(query, values);
      return result.rows[0] ? normalizeUser(result.rows[0]) : undefined;
    } finally {
      client.release();
    }
  }

  // Conversion logging
  async logConversion(
    userId: string,
    fileName: string,
    pagesConverted: number,
    conversionType: 'pdf_to_csv' | 'pdf_to_xlsx' = 'pdf_to_csv',
    fileSizeBytes?: number
  ): Promise<ConversionLog> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Insert conversion log
      const logResult = await client.query<ConversionLog>(
        `INSERT INTO conversion_logs (user_id, file_name, pages_converted, conversion_type, file_size_bytes)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [userId, fileName, pagesConverted, conversionType, fileSizeBytes]
      );

      // Update user's page usage
      const user = await client.query<User>(
        'SELECT plan FROM users WHERE id = $1',
        [userId]
      );

      if (user.rows[0]) {
        const { plan } = user.rows[0];
        if (plan === 'free') {
          await client.query(
            'UPDATE users SET pages_used_today = pages_used_today + $1 WHERE id = $2',
            [pagesConverted, userId]
          );
        } else {
          await client.query(
            'UPDATE users SET pages_used_monthly = pages_used_monthly + $1 WHERE id = $2',
            [pagesConverted, userId]
          );
        }
      }

      await client.query('COMMIT');
      return logResult.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getConversionLogs(userId: string): Promise<ConversionLog[]> {
    const client = await pool.connect();
    try {
      const result = await client.query<ConversionLog>(
        'SELECT * FROM conversion_logs WHERE user_id = $1 ORDER BY timestamp DESC',
        [userId]
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  // Check if user can convert
  async canConvert(userId: string, pagesNeeded: number): Promise<boolean> {
    const client = await pool.connect();
    try {
      // Reset daily usage if needed
      await client.query(
        `UPDATE users
         SET pages_used_today = 0, last_reset_date = CURRENT_DATE
         WHERE id = $1 AND plan = 'free' AND last_reset_date < CURRENT_DATE`,
        [userId]
      );

      const result = await client.query<User>(
        'SELECT plan, pages_used_today, daily_pages_limit, pages_used_monthly, monthly_pages_limit, subscription_status, current_period_end FROM users WHERE id = $1',
        [userId]
      );

      if (!result.rows[0]) return false;

      const user = result.rows[0];

      // Check subscription status for paid users
      if (user.plan !== 'free') {
        // Block users with past_due status (payment failed)
        if (user.subscription_status === 'past_due') {
          console.log(`User ${userId} blocked: subscription is past_due`);
          return false;
        }

        // Block canceled users who are past their period end
        if (user.subscription_status === 'canceled' && user.current_period_end) {
          const now = new Date();
          const periodEnd = new Date(user.current_period_end);
          if (now > periodEnd) {
            console.log(`User ${userId} blocked: canceled subscription period has ended`);
            return false;
          }
        }

        // Block other inactive statuses
        if (['incomplete', 'incomplete_expired', 'unpaid'].includes(user.subscription_status || '')) {
          console.log(`User ${userId} blocked: subscription status is ${user.subscription_status}`);
          return false;
        }
      }

      // Check page limits
      if (user.plan === 'free') {
        return (user.pages_used_today + pagesNeeded) <= user.daily_pages_limit;
      } else {
        return (user.pages_used_monthly + pagesNeeded) <= user.monthly_pages_limit;
      }
    } finally {
      client.release();
    }
  }

  // Reset usage (called when subscription renews)
  async resetUsage(userId: string): Promise<void> {
    const client = await pool.connect();
    try {
      const user = await client.query<User>(
        'SELECT plan FROM users WHERE id = $1',
        [userId]
      );

      if (user.rows[0]) {
        const { plan } = user.rows[0];
        if (plan === 'free') {
          await client.query(
            'UPDATE users SET pages_used_today = 0, last_reset_date = CURRENT_DATE WHERE id = $1',
            [userId]
          );
        } else {
          await client.query(
            'UPDATE users SET pages_used_monthly = 0 WHERE id = $1',
            [userId]
          );
        }
      }
    } finally {
      client.release();
    }
  }

  // Get all users (for admin)
  async getAllUsers(): Promise<User[]> {
    const client = await pool.connect();
    try {
      const result = await client.query<User>('SELECT * FROM users ORDER BY created_at DESC');
      return result.rows.map(normalizeUser);
    } finally {
      client.release();
    }
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
      return true;
    } catch (error) {
      console.error('Database health check failed:', error);
      return false;
    } finally {
      client.release();
    }
  }

  // Close pool (for graceful shutdown)
  async close(): Promise<void> {
    await pool.end();
  }

  // ============ Blog Post Methods ============

  // Get all published blog posts (with optional pagination)
  async getPublishedBlogPosts(limit?: number, offset?: number): Promise<BlogPost[]> {
    const client = await pool.connect();
    try {
      const query = `
        SELECT * FROM blog_posts
        WHERE published = true
        ORDER BY published_at DESC
        ${limit ? `LIMIT ${limit}` : ''}
        ${offset ? `OFFSET ${offset}` : ''}
      `;
      const result = await client.query<BlogPost>(query);
      return result.rows;
    } finally {
      client.release();
    }
  }

  // Get blog post by slug
  async getBlogPostBySlug(slug: string): Promise<BlogPost | undefined> {
    const client = await pool.connect();
    try {
      const result = await client.query<BlogPost>(
        'SELECT * FROM blog_posts WHERE slug = $1 AND published = true',
        [slug]
      );
      return result.rows[0];
    } finally {
      client.release();
    }
  }

  // Get blog post by ID (for admin)
  async getBlogPostById(id: string): Promise<BlogPost | undefined> {
    const client = await pool.connect();
    try {
      const result = await client.query<BlogPost>(
        'SELECT * FROM blog_posts WHERE id = $1',
        [id]
      );
      return result.rows[0];
    } finally {
      client.release();
    }
  }

  // Create a new blog post
  async createBlogPost(post: Omit<BlogPost, 'id' | 'created_at' | 'updated_at'>): Promise<BlogPost> {
    const client = await pool.connect();
    try {
      const result = await client.query<BlogPost>(
        `INSERT INTO blog_posts (
          title, slug, excerpt, content, category, read_time,
          author_id, featured_image_url, published, published_at,
          meta_description, meta_keywords
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *`,
        [
          post.title,
          post.slug,
          post.excerpt || null,
          post.content,
          post.category || null,
          post.read_time || null,
          post.author_id || null,
          post.featured_image_url || null,
          post.published,
          post.published_at || null,
          post.meta_description || null,
          post.meta_keywords || null,
        ]
      );
      return result.rows[0];
    } finally {
      client.release();
    }
  }

  // Update a blog post
  async updateBlogPost(id: string, updates: Partial<BlogPost>): Promise<BlogPost | undefined> {
    const client = await pool.connect();
    try {
      const fields: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      const fieldMapping: Record<string, string> = {
        title: 'title',
        slug: 'slug',
        excerpt: 'excerpt',
        content: 'content',
        category: 'category',
        read_time: 'read_time',
        author_id: 'author_id',
        featured_image_url: 'featured_image_url',
        published: 'published',
        published_at: 'published_at',
        meta_description: 'meta_description',
        meta_keywords: 'meta_keywords',
      };

      Object.entries(updates).forEach(([key, value]) => {
        const dbField = fieldMapping[key];
        if (dbField && value !== undefined) {
          fields.push(`${dbField} = $${paramIndex}`);
          values.push(value);
          paramIndex++;
        }
      });

      if (fields.length === 0) {
        return this.getBlogPostById(id);
      }

      values.push(id);
      const query = `
        UPDATE blog_posts
        SET ${fields.join(', ')}, updated_at = NOW()
        WHERE id = $${paramIndex}
        RETURNING *
      `;

      const result = await client.query<BlogPost>(query, values);
      return result.rows[0];
    } finally {
      client.release();
    }
  }

  // Delete a blog post
  async deleteBlogPost(id: string): Promise<boolean> {
    const client = await pool.connect();
    try {
      const result = await client.query(
        'DELETE FROM blog_posts WHERE id = $1',
        [id]
      );
      return (result.rowCount ?? 0) > 0;
    } finally {
      client.release();
    }
  }

  // ============ Newsletter Methods ============

  // Subscribe to newsletter
  async subscribeToNewsletter(email: string): Promise<NewsletterSubscriber> {
    const client = await pool.connect();
    try {
      // Try to reactivate if already exists
      const existing = await client.query<NewsletterSubscriber>(
        'SELECT * FROM newsletter_subscribers WHERE email = $1',
        [email]
      );

      if (existing.rows[0]) {
        // Reactivate if inactive
        if (!existing.rows[0].active) {
          const result = await client.query<NewsletterSubscriber>(
            `UPDATE newsletter_subscribers
             SET active = true, unsubscribed_at = NULL
             WHERE email = $1
             RETURNING *`,
            [email]
          );
          return result.rows[0];
        }
        return existing.rows[0];
      }

      // Create new subscriber
      const result = await client.query<NewsletterSubscriber>(
        'INSERT INTO newsletter_subscribers (email) VALUES ($1) RETURNING *',
        [email]
      );
      return result.rows[0];
    } finally {
      client.release();
    }
  }

  // Unsubscribe from newsletter
  async unsubscribeFromNewsletter(email: string): Promise<boolean> {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `UPDATE newsletter_subscribers
         SET active = false, unsubscribed_at = NOW()
         WHERE email = $1`,
        [email]
      );
      return (result.rowCount ?? 0) > 0;
    } finally {
      client.release();
    }
  }

  // Get all active newsletter subscribers
  async getNewsletterSubscribers(): Promise<NewsletterSubscriber[]> {
    const client = await pool.connect();
    try {
      const result = await client.query<NewsletterSubscriber>(
        'SELECT * FROM newsletter_subscribers WHERE active = true ORDER BY subscribed_at DESC'
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  // ===== Bank Request Methods =====

  // Create a new bank request
  async createBankRequest(data: {
    bankName: string;
    userEmail: string;
    notes?: string;
    userId?: string | null;
  }): Promise<string> {
    const client = await pool.connect();
    try {
      const result = await client.query<BankRequest>(
        `INSERT INTO bank_requests (bank_name, user_email, notes, user_id, status)
         VALUES ($1, $2, $3, $4, 'pending')
         RETURNING id`,
        [data.bankName, data.userEmail, data.notes || null, data.userId || null]
      );
      return result.rows[0].id;
    } finally {
      client.release();
    }
  }

  // Get all bank requests (optionally filter by status)
  async getBankRequests(status?: string): Promise<BankRequest[]> {
    const client = await pool.connect();
    try {
      let query = 'SELECT * FROM bank_requests';
      const params: string[] = [];

      if (status) {
        query += ' WHERE status = $1';
        params.push(status);
      }

      query += ' ORDER BY created_at DESC';

      const result = await client.query<BankRequest>(query, params);
      return result.rows;
    } finally {
      client.release();
    }
  }

  // Get bank request statistics
  async getBankRequestStats(): Promise<BankRequestStats[]> {
    const client = await pool.connect();
    try {
      const result = await client.query<BankRequestStats>(
        'SELECT * FROM bank_request_stats'
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  // Update bank request status
  async updateBankRequestStatus(
    id: string,
    status: string,
    adminNotes?: string
  ): Promise<void> {
    const client = await pool.connect();
    try {
      const completedAt = status === 'completed' ? 'NOW()' : 'NULL';

      await client.query(
        `UPDATE bank_requests
         SET status = $1, admin_notes = $2, completed_at = ${completedAt}, updated_at = NOW()
         WHERE id = $3`,
        [status, adminNotes || null, id]
      );
    } finally {
      client.release();
    }
  }

  // Get pending bank requests count
  async getPendingBankRequestsCount(): Promise<number> {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT COUNT(*) as count FROM bank_requests WHERE status = 'pending'`
      );
      return parseInt(result.rows[0].count);
    } finally {
      client.release();
    }
  }

  // Check if a bank has already been requested by this email
  async hasBankBeenRequested(bankName: string, userEmail: string): Promise<boolean> {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT COUNT(*) as count
         FROM bank_requests
         WHERE LOWER(bank_name) = LOWER($1)
         AND LOWER(user_email) = LOWER($2)`,
        [bankName, userEmail]
      );
      return parseInt(result.rows[0].count) > 0;
    } finally {
      client.release();
    }
  }
}

// Export singleton instance
export const db = new PostgresStore();
export { pool };

import { Pool } from 'pg';

// Database interfaces matching the schema
export interface User {
  id: string;
  email: string;
  password_hash?: string;
  name?: string;
  stripe_customer_id?: string;
  subscription_id?: string;
  subscription_status?: 'active' | 'canceled' | 'past_due' | 'trialing' | 'incomplete' | 'incomplete_expired' | 'unpaid';
  plan: 'free' | 'basic' | 'starter' | 'professional' | 'enterprise';
  pages_used_today: number;
  daily_pages_limit: number;
  last_reset_date: string;
  pages_used_monthly: number;
  monthly_pages_limit: number;
  files_used_monthly: number;
  monthly_files_limit: number;
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
  filesUsedMonthly?: number;
  monthlyFilesLimit?: number;
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
  category?: 'guides' | 'banks' | 'tips' | string;
  tags?: string[];
  read_time?: string;
  author?: string;
  author_id?: string;
  featured_image_url?: string;
  featured_image_alt?: string;
  featured_image_data?: Buffer; // Binary image data stored in PostgreSQL
  featured_image_filename?: string;
  featured_image_mimetype?: string;
  featured_image_size?: number;
  status: 'draft' | 'published';
  published: boolean; // Kept for backwards compatibility
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

export interface Feedback {
  id: number;
  session_id?: string | null;
  rating: 'positive' | 'negative';
  comment?: string | null;
  email?: string | null;
  bank_name?: string | null;
  created_at: Date;
}

export interface FeedbackSummary {
  positive_count: number;
  negative_count: number;
  total_count: number;
}

export interface IpConversion {
  id: string;
  ip_address: string;
  conversion_date: string;
  conversion_count: number;
  created_at: Date;
  updated_at: Date;
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
function normalizeUser(dbUser: User): User {
  // Debug logging to track file vs page counts
  if (dbUser.plan !== 'free') {
    console.log(`[normalizeUser] User ${dbUser.email} (${dbUser.plan}): files_used_monthly=${dbUser.files_used_monthly}, monthly_files_limit=${dbUser.monthly_files_limit}, pages_used_monthly=${dbUser.pages_used_monthly}`);
  }

  const normalized = {
    ...dbUser,
    // Map snake_case DB fields to camelCase for backwards compatibility
    // For paid users, show FILES used/limit. For free users, show pages (daily limit)
    pagesUsed: dbUser.plan === 'free' ? dbUser.pages_used_today : dbUser.files_used_monthly,
    pagesLimit: dbUser.plan === 'free' ? dbUser.daily_pages_limit : dbUser.monthly_files_limit,
    pagesUsedToday: dbUser.pages_used_today,
    dailyPagesLimit: dbUser.daily_pages_limit,
    pagesUsedMonthly: dbUser.pages_used_monthly,
    monthlyPagesLimit: dbUser.monthly_pages_limit,
    filesUsedMonthly: dbUser.files_used_monthly,
    monthlyFilesLimit: dbUser.monthly_files_limit,
  };

  console.log(`[normalizeUser] Computed pagesUsed=${normalized.pagesUsed}, pagesLimit=${normalized.pagesLimit}`);
  return normalized;
}

export class PostgresStore {
  // Singleton instance
  private static instance: PostgresStore;

  public static getInstance(): PostgresStore {
    if (!PostgresStore.instance) {
      PostgresStore.instance = new PostgresStore();
    }
    return PostgresStore.instance;
  }

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
          monthly_pages_limit,
          files_used_monthly,
          monthly_files_limit
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *`,
        [
          email,
          additionalFields.name || email.split('@')[0],
          additionalFields.password_hash || null,
          additionalFields.google_id || null,
          additionalFields.plan || 'free',
          0, // pages_used_today
          3, // daily_pages_limit for free users
          0, // pages_used_monthly (deprecated, kept for compatibility)
          50, // monthly_pages_limit (deprecated, kept for compatibility)
          0, // files_used_monthly
          90, // monthly_files_limit (3 files/day * 30 days for free users)
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
      const values: unknown[] = [];
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
        files_used_monthly: 'files_used_monthly',
        monthly_files_limit: 'monthly_files_limit',
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
          // Free users: increment pages used today (daily limit based on pages)
          await client.query(
            'UPDATE users SET pages_used_today = pages_used_today + $1 WHERE id = $2',
            [pagesConverted, userId]
          );
        } else {
          // Paid users: increment FILES used (monthly limit based on number of files, not pages)
          await client.query(
            'UPDATE users SET files_used_monthly = files_used_monthly + 1 WHERE id = $1',
            [userId]
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
        'SELECT plan, pages_used_today, daily_pages_limit, files_used_monthly, monthly_files_limit, subscription_status, current_period_end FROM users WHERE id = $1',
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

      // Check limits
      if (user.plan === 'free') {
        // Free users: check daily page limit
        return (user.pages_used_today + pagesNeeded) <= user.daily_pages_limit;
      } else {
        // Paid users: check monthly FILE limit (can they upload 1 more file?)
        return (user.files_used_monthly + 1) <= user.monthly_files_limit;
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
        const { plan} = user.rows[0];
        if (plan === 'free') {
          await client.query(
            'UPDATE users SET pages_used_today = 0, last_reset_date = CURRENT_DATE WHERE id = $1',
            [userId]
          );
        } else {
          await client.query(
            'UPDATE users SET files_used_monthly = 0 WHERE id = $1',
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

  // Get all blog posts including drafts (admin only)
  async getAllBlogPosts(limit?: number, offset?: number, status?: string): Promise<BlogPost[]> {
    const client = await pool.connect();
    try {
      const query = `
        SELECT * FROM blog_posts
        ${status ? 'WHERE status = $1' : ''}
        ORDER BY created_at DESC
        ${limit ? `LIMIT ${limit}` : ''}
        ${offset ? `OFFSET ${offset}` : ''}
      `;
      const params = status ? [status] : [];
      const result = await client.query<BlogPost>(query, params);
      return result.rows;
    } finally {
      client.release();
    }
  }

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
          title, slug, excerpt, content, category, tags, read_time,
          author, author_id, featured_image_url, featured_image_alt,
          featured_image_data, featured_image_filename, featured_image_mimetype, featured_image_size,
          status, published, published_at, meta_description
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        RETURNING *`,
        [
          post.title,
          post.slug,
          post.excerpt || null,
          post.content,
          post.category || null,
          post.tags || [],
          post.read_time || null,
          post.author || 'Michael',
          post.author_id || null,
          post.featured_image_url || null,
          post.featured_image_alt || null,
          post.featured_image_data || null,
          post.featured_image_filename || null,
          post.featured_image_mimetype || null,
          post.featured_image_size || null,
          post.status || 'draft',
          post.published || false,
          post.published_at || null,
          post.meta_description || null,
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
      const values: unknown[] = [];
      let paramIndex = 1;

      const fieldMapping: Record<string, string> = {
        title: 'title',
        slug: 'slug',
        excerpt: 'excerpt',
        content: 'content',
        category: 'category',
        tags: 'tags',
        read_time: 'read_time',
        author: 'author',
        author_id: 'author_id',
        featured_image_url: 'featured_image_url',
        featured_image_alt: 'featured_image_alt',
        featured_image_data: 'featured_image_data',
        featured_image_filename: 'featured_image_filename',
        featured_image_mimetype: 'featured_image_mimetype',
        featured_image_size: 'featured_image_size',
        status: 'status',
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

  // ===== Blog Image Methods =====

  // Save a blog image to the blog_images table
  async saveBlogImage(image: {
    filename: string;
    mimetype: string;
    size: number;
    data: Buffer;
  }): Promise<string> {
    const client = await pool.connect();
    try {
      const result = await client.query<{ id: string }>(
        `INSERT INTO blog_images (filename, mimetype, size, data)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [image.filename, image.mimetype, image.size, image.data]
      );
      return result.rows[0].id;
    } finally {
      client.release();
    }
  }

  // Get a blog image by ID
  async getBlogImage(id: string): Promise<{
    id: string;
    filename: string;
    mimetype: string;
    size: number;
    data: Buffer;
  } | null> {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT id, filename, mimetype, size, data
         FROM blog_images
         WHERE id = $1`,
        [id]
      );
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  // Delete a blog image by ID
  async deleteBlogImage(id: string): Promise<boolean> {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `DELETE FROM blog_images WHERE id = $1`,
        [id]
      );
      return (result.rowCount ?? 0) > 0;
    } finally {
      client.release();
    }
  }

  // ===== Feedback Methods =====

  // Create new feedback
  async createFeedback(data: {
    sessionId?: string | null;
    rating: 'positive' | 'negative';
    comment?: string | null;
    email?: string | null;
    bankName?: string | null;
  }): Promise<Feedback> {
    const client = await pool.connect();
    try {
      const result = await client.query<Feedback>(
        `INSERT INTO feedback (session_id, rating, comment, email, bank_name)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [data.sessionId || null, data.rating, data.comment || null, data.email || null, data.bankName || null]
      );
      return result.rows[0];
    } finally {
      client.release();
    }
  }

  // Get all feedback with optional date filtering
  async getAllFeedback(dateFilter?: 'today' | 'week' | 'all'): Promise<Feedback[]> {
    const client = await pool.connect();
    try {
      let query = 'SELECT * FROM feedback';
      const params: string[] = [];

      if (dateFilter === 'today') {
        query += ' WHERE created_at >= CURRENT_DATE';
      } else if (dateFilter === 'week') {
        query += ' WHERE created_at >= CURRENT_DATE - INTERVAL \'7 days\'';
      }

      query += ' ORDER BY created_at DESC';

      const result = await client.query<Feedback>(query, params);
      return result.rows;
    } finally {
      client.release();
    }
  }

  // Get feedback summary with counts
  async getFeedbackSummary(dateFilter?: 'today' | 'week' | 'all'): Promise<FeedbackSummary> {
    const client = await pool.connect();
    try {
      let query = `
        SELECT
          COUNT(*) FILTER (WHERE rating = 'positive') as positive_count,
          COUNT(*) FILTER (WHERE rating = 'negative') as negative_count,
          COUNT(*) as total_count
        FROM feedback
      `;

      if (dateFilter === 'today') {
        query += ' WHERE created_at >= CURRENT_DATE';
      } else if (dateFilter === 'week') {
        query += ' WHERE created_at >= CURRENT_DATE - INTERVAL \'7 days\'';
      }

      const result = await client.query<FeedbackSummary>(query);
      return result.rows[0] || { positive_count: 0, negative_count: 0, total_count: 0 };
    } finally {
      client.release();
    }
  }

  // Get recent feedback (last N items)
  async getRecentFeedback(limit: number = 20): Promise<Feedback[]> {
    const client = await pool.connect();
    try {
      const result = await client.query<Feedback>(
        'SELECT * FROM feedback ORDER BY created_at DESC LIMIT $1',
        [limit]
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  // ===== User Analytics Methods =====

  // Get user analytics data with stats
  async getUserAnalytics(options: {
    includeAnonymous?: boolean;
    plan?: string;
    subscriptionStatus?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{
    users: Array<User & {
      total_conversions: number;
      total_pages_converted: number;
      last_conversion_at: Date | null;
      usage_percentage: number;
    }>;
    total: number;
  }> {
    const client = await pool.connect();
    try {
      const { includeAnonymous = true, plan, subscriptionStatus, limit = 50, offset = 0 } = options;

      // Build WHERE clause conditions
      const conditions: string[] = [];
      const params: (string | number)[] = [];
      let paramIndex = 1;

      // Filter out anonymous users if requested
      if (!includeAnonymous) {
        conditions.push(`u.email NOT LIKE '%@anonymous.local'`);
      }

      // Filter by plan if provided
      if (plan) {
        conditions.push(`u.plan = $${paramIndex}`);
        params.push(plan);
        paramIndex++;
      }

      // Filter by subscription status if provided
      if (subscriptionStatus) {
        conditions.push(`u.subscription_status = $${paramIndex}`);
        params.push(subscriptionStatus);
        paramIndex++;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Get total count
      const countQuery = `
        SELECT COUNT(*) as count
        FROM users u
        ${whereClause}
      `;
      const countResult = await client.query(countQuery, params);
      const total = parseInt(countResult.rows[0].count);

      // Get users with stats
      params.push(limit);
      const limitParam = `$${paramIndex}`;
      paramIndex++;

      params.push(offset);
      const offsetParam = `$${paramIndex}`;

      const query = `
        SELECT
          u.id,
          u.email,
          u.name,
          u.plan,
          u.subscription_status,
          u.pages_used_today,
          u.daily_pages_limit,
          u.pages_used_monthly,
          u.monthly_pages_limit,
          u.files_used_monthly,
          u.monthly_files_limit,
          u.last_reset_date,
          u.created_at,
          u.current_period_start,
          u.current_period_end,
          COALESCE(COUNT(cl.id), 0)::integer as total_conversions,
          COALESCE(SUM(cl.pages_converted), 0)::integer as total_pages_converted,
          MAX(cl.timestamp) as last_conversion_at,
          CASE
            WHEN u.plan = 'free' THEN ROUND((u.pages_used_today::numeric / NULLIF(u.daily_pages_limit, 0)) * 100, 2)
            ELSE ROUND((u.pages_used_monthly::numeric / NULLIF(u.monthly_pages_limit, 0)) * 100, 2)
          END as usage_percentage
        FROM users u
        LEFT JOIN conversion_logs cl ON u.id = cl.user_id
        ${whereClause}
        GROUP BY u.id
        ORDER BY u.created_at DESC
        LIMIT ${limitParam} OFFSET ${offsetParam}
      `;

      const result = await client.query(query, params);

      return {
        users: result.rows,
        total,
      };
    } finally {
      client.release();
    }
  }

  // Get user analytics summary stats
  async getUserAnalyticsSummary(): Promise<{
    total_users: number;
    subscribed_users: number;
    free_users: number;
    anonymous_users: number;
    active_subscriptions: number;
    new_users_today: number;
    new_users_this_week: number;
    total_conversions: number;
    total_pages_converted: number;
    total_mrr: number;
  }> {
    const client = await pool.connect();
    try {
      // Plan pricing mapping
      const planPricing: Record<string, number> = {
        free: 0,
        basic: 20,
        starter: 40,
        professional: 60,
        enterprise: 99,
      };

      const result = await client.query(`
        SELECT
          COUNT(DISTINCT u.id)::integer as total_users,
          COUNT(DISTINCT CASE WHEN u.plan != 'free' THEN u.id END)::integer as subscribed_users,
          COUNT(DISTINCT CASE WHEN u.plan = 'free' THEN u.id END)::integer as free_users,
          COUNT(DISTINCT CASE WHEN u.email LIKE '%@anonymous.local' THEN u.id END)::integer as anonymous_users,
          COUNT(DISTINCT CASE WHEN u.subscription_status = 'active' THEN u.id END)::integer as active_subscriptions,
          COUNT(DISTINCT CASE WHEN u.created_at >= CURRENT_DATE THEN u.id END)::integer as new_users_today,
          COUNT(DISTINCT CASE WHEN u.created_at >= CURRENT_DATE - INTERVAL '7 days' THEN u.id END)::integer as new_users_this_week,
          COALESCE(COUNT(cl.id), 0)::integer as total_conversions,
          COALESCE(SUM(cl.pages_converted), 0)::integer as total_pages_converted
        FROM users u
        LEFT JOIN conversion_logs cl ON u.id = cl.user_id
      `);

      // Calculate MRR from plan distribution (excluding admin)
      const planResult = await client.query(`
        SELECT
          plan,
          COUNT(*)::integer as count
        FROM users
        WHERE email NOT LIKE '%@anonymous.local'
          AND email != 'macon4001@gmail.com'
          AND subscription_status = 'active'
        GROUP BY plan
      `);

      const totalMrr = planResult.rows.reduce((sum, row) => {
        return sum + ((planPricing[row.plan] || 0) * row.count);
      }, 0);

      return {
        ...result.rows[0],
        total_mrr: totalMrr,
      };
    } finally {
      client.release();
    }
  }

  // Get plan distribution stats
  async getPlanDistribution(): Promise<Array<{ plan: string; count: number; percentage: number; mrr: number }>> {
    const client = await pool.connect();
    try {
      // Plan pricing mapping
      const planPricing: Record<string, number> = {
        free: 0,
        basic: 20,
        starter: 40,
        professional: 60,
        enterprise: 99,
      };

      const result = await client.query(`
        SELECT
          plan,
          COUNT(*)::integer as count,
          ROUND((COUNT(*)::numeric / (SELECT COUNT(*) FROM users WHERE email NOT LIKE '%@anonymous.local' AND email != 'macon4001@gmail.com')) * 100, 2) as percentage
        FROM users
        WHERE email NOT LIKE '%@anonymous.local'
          AND email != 'macon4001@gmail.com'
        GROUP BY plan
        ORDER BY count DESC
      `);

      // Add MRR calculation
      return result.rows.map((row) => ({
        ...row,
        mrr: (planPricing[row.plan] || 0) * row.count,
      }));
    } finally {
      client.release();
    }
  }

  // Get MRR over time (last 30 days)
  async getMrrOverTime(days: number = 30): Promise<Array<{ date: string; mrr: number }>> {
    const client = await pool.connect();
    try {
      // Plan pricing mapping
      const planPricing: Record<string, number> = {
        free: 0,
        basic: 20,
        starter: 40,
        professional: 60,
        enterprise: 99,
      };

      // Generate a series of dates for the last N days
      const result = await client.query(`
        WITH RECURSIVE date_series AS (
          SELECT CURRENT_DATE - INTERVAL '${days - 1} days' AS date
          UNION ALL
          SELECT date + INTERVAL '1 day'
          FROM date_series
          WHERE date < CURRENT_DATE
        ),
        daily_plans AS (
          SELECT
            ds.date,
            u.plan,
            COUNT(DISTINCT u.id)::integer as user_count
          FROM date_series ds
          CROSS JOIN users u
          WHERE u.email != 'macon4001@gmail.com'
            AND u.email NOT LIKE '%@anonymous.local'
            AND u.subscription_status = 'active'
            AND u.created_at::date <= ds.date
            AND (u.current_period_end IS NULL OR u.current_period_end::date >= ds.date)
          GROUP BY ds.date, u.plan
        )
        SELECT
          date::text,
          plan,
          user_count
        FROM daily_plans
        ORDER BY date ASC, plan
      `);

      // Group by date and calculate MRR
      const mrrByDate: Record<string, number> = {};

      result.rows.forEach((row) => {
        const date = row.date;
        const plan = row.plan;
        const count = row.user_count;
        const planPrice = planPricing[plan] || 0;

        if (!mrrByDate[date]) {
          mrrByDate[date] = 0;
        }
        mrrByDate[date] += planPrice * count;
      });

      // Convert to array format
      return Object.entries(mrrByDate).map(([date, mrr]) => ({
        date,
        mrr,
      }));
    } finally {
      client.release();
    }
  }

  // ===== IP Rate Limiting Methods =====

  /**
   * Check if an IP address can perform a conversion today
   * Returns true if under the limit (3 conversions per day for anonymous users)
   */
  async canConvertByIp(ipAddress: string, dailyLimit: number = 3): Promise<boolean> {
    const client = await pool.connect();
    try {
      const result = await client.query<IpConversion>(
        `SELECT conversion_count FROM ip_conversions
         WHERE ip_address = $1 AND conversion_date = CURRENT_DATE`,
        [ipAddress]
      );

      if (!result.rows[0]) {
        // No record for today, they can convert
        return true;
      }

      // Check if under the limit
      return result.rows[0].conversion_count < dailyLimit;
    } finally {
      client.release();
    }
  }

  /**
   * Get the current conversion count for an IP address today
   */
  async getIpConversionCount(ipAddress: string): Promise<number> {
    const client = await pool.connect();
    try {
      const result = await client.query<IpConversion>(
        `SELECT conversion_count FROM ip_conversions
         WHERE ip_address = $1 AND conversion_date = CURRENT_DATE`,
        [ipAddress]
      );

      return result.rows[0]?.conversion_count || 0;
    } finally {
      client.release();
    }
  }

  /**
   * Increment the conversion count for an IP address
   * Uses upsert to create a new record or increment existing one
   */
  async incrementIpConversionCount(ipAddress: string): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO ip_conversions (ip_address, conversion_date, conversion_count)
         VALUES ($1, CURRENT_DATE, 1)
         ON CONFLICT (ip_address, conversion_date)
         DO UPDATE SET
           conversion_count = ip_conversions.conversion_count + 1,
           updated_at = NOW()`,
        [ipAddress]
      );
    } finally {
      client.release();
    }
  }

  /**
   * Clean up old IP conversion records (older than specified days)
   */
  async cleanupOldIpConversions(daysToKeep: number = 30): Promise<number> {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `DELETE FROM ip_conversions
         WHERE conversion_date < CURRENT_DATE - INTERVAL '${daysToKeep} days'`
      );
      return result.rowCount ?? 0;
    } finally {
      client.release();
    }
  }
}

// Export singleton instance
export const db = new PostgresStore();
export { pool };

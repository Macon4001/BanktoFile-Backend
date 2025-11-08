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
        'SELECT plan, pages_used_today, daily_pages_limit, pages_used_monthly, monthly_pages_limit FROM users WHERE id = $1',
        [userId]
      );

      if (!result.rows[0]) return false;

      const user = result.rows[0];
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
}

// Export singleton instance
export const db = new PostgresStore();
export { pool };

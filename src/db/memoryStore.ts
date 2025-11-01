// Simple in-memory database for development
// Replace with PostgreSQL, MongoDB, or another database in production

export interface User {
  id: string;
  email: string;
  stripeCustomerId?: string;
  subscriptionId?: string;
  subscriptionStatus?: 'active' | 'canceled' | 'past_due' | 'trialing';
  plan: 'free' | 'starter' | 'professional' | 'enterprise';

  // Daily tracking for free users
  pagesUsedToday: number;
  dailyPagesLimit: number;
  lastResetDate: string; // YYYY-MM-DD format

  // Monthly tracking for paid users
  pagesUsedMonthly: number;
  monthlyPagesLimit: number;

  // Deprecated but kept for backwards compatibility
  pagesUsed: number;
  pagesLimit: number;

  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversionLog {
  id: string;
  userId: string;
  fileName: string;
  pagesConverted: number;
  timestamp: Date;
}

class MemoryStore {
  private users: Map<string, User> = new Map();
  private conversionLogs: ConversionLog[] = [];

  // Helper to get today's date in YYYY-MM-DD format
  private getTodayString(): string {
    return new Date().toISOString().split('T')[0];
  }

  // User methods
  createUser(email: string): User {
    const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const today = this.getTodayString();
    const user: User = {
      id: userId,
      email,
      plan: 'free',

      // Daily limits for free users
      pagesUsedToday: 0,
      dailyPagesLimit: 3, // 3 pages per day for free users
      lastResetDate: today,

      // Monthly limits for paid users
      pagesUsedMonthly: 0,
      monthlyPagesLimit: 50,

      // Deprecated fields for backwards compatibility
      pagesUsed: 0,
      pagesLimit: 3,

      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.users.set(userId, user);
    return user;
  }

  getUserById(userId: string): User | undefined {
    const user = this.users.get(userId);
    if (user) {
      this.checkAndResetDaily(user);
    }
    return user;
  }

  // Check if daily reset is needed for free users
  private checkAndResetDaily(user: User): void {
    if (user.plan !== 'free') return;

    const today = this.getTodayString();
    if (user.lastResetDate !== today) {
      // Reset daily usage
      user.pagesUsedToday = 0;
      user.lastResetDate = today;
      user.pagesUsed = 0; // Also reset deprecated field
      user.updatedAt = new Date();
    }
  }

  getUserByEmail(email: string): User | undefined {
    const user = Array.from(this.users.values()).find(u => u.email === email);
    if (user) {
      this.checkAndResetDaily(user);
    }
    return user;
  }

  getUserByStripeCustomerId(customerId: string): User | undefined {
    return Array.from(this.users.values()).find(u => u.stripeCustomerId === customerId);
  }

  updateUser(userId: string, updates: Partial<User>): User | undefined {
    const user = this.users.get(userId);
    if (!user) return undefined;

    const updatedUser = {
      ...user,
      ...updates,
      updatedAt: new Date(),
    };
    this.users.set(userId, updatedUser);
    return updatedUser;
  }

  // Conversion logging
  logConversion(userId: string, fileName: string, pagesConverted: number): ConversionLog {
    const log: ConversionLog = {
      id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId,
      fileName,
      pagesConverted,
      timestamp: new Date(),
    };
    this.conversionLogs.push(log);

    // Update user's pages used
    const user = this.users.get(userId);
    if (user) {
      this.checkAndResetDaily(user);

      if (user.plan === 'free') {
        // Update daily usage for free users
        user.pagesUsedToday += pagesConverted;
        user.pagesUsed += pagesConverted; // Also update deprecated field
      } else {
        // Update monthly usage for paid users
        user.pagesUsedMonthly += pagesConverted;
        user.pagesUsed += pagesConverted; // Also update deprecated field
      }
      user.updatedAt = new Date();
    }

    return log;
  }

  getConversionLogs(userId: string): ConversionLog[] {
    return this.conversionLogs.filter(log => log.userId === userId);
  }

  // Check if user can convert (has pages remaining)
  canConvert(userId: string, pagesNeeded: number): boolean {
    const user = this.users.get(userId);
    if (!user) return false;

    this.checkAndResetDaily(user);

    if (user.plan === 'free') {
      // Check daily limit for free users
      return (user.pagesUsedToday + pagesNeeded) <= user.dailyPagesLimit;
    } else {
      // Check monthly limit for paid users
      return (user.pagesUsedMonthly + pagesNeeded) <= user.monthlyPagesLimit;
    }
  }

  // Reset usage for a user (call this when subscription renews)
  resetUsage(userId: string): void {
    const user = this.users.get(userId);
    if (user) {
      if (user.plan === 'free') {
        user.pagesUsedToday = 0;
      } else {
        user.pagesUsedMonthly = 0;
      }
      user.pagesUsed = 0; // Also reset deprecated field
      user.updatedAt = new Date();
    }
  }

  // Get all users (for admin purposes)
  getAllUsers(): User[] {
    return Array.from(this.users.values());
  }
}

// Export singleton instance
export const db = new MemoryStore();

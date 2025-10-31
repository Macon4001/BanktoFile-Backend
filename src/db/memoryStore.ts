// Simple in-memory database for development
// Replace with PostgreSQL, MongoDB, or another database in production

export interface User {
  id: string;
  email: string;
  stripeCustomerId?: string;
  subscriptionId?: string;
  subscriptionStatus?: 'active' | 'canceled' | 'past_due' | 'trialing';
  plan: 'free' | 'starter' | 'professional' | 'enterprise';
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

  // User methods
  createUser(email: string): User {
    const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const user: User = {
      id: userId,
      email,
      plan: 'free',
      pagesUsed: 0,
      pagesLimit: 50, // Free tier: 50 pages
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.users.set(userId, user);
    return user;
  }

  getUserById(userId: string): User | undefined {
    return this.users.get(userId);
  }

  getUserByEmail(email: string): User | undefined {
    return Array.from(this.users.values()).find(u => u.email === email);
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
      user.pagesUsed += pagesConverted;
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

    return (user.pagesUsed + pagesNeeded) <= user.pagesLimit;
  }

  // Reset usage for a user (call this when subscription renews)
  resetUsage(userId: string): void {
    const user = this.users.get(userId);
    if (user) {
      user.pagesUsed = 0;
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

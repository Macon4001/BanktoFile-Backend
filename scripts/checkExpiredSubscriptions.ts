import 'dotenv/config';
import { db } from '../src/db/postgres.js';
import { getFilesLimit } from '../src/config/stripe.js';

/**
 * Check for and downgrade users whose subscription periods have ended
 * This runs as a scheduled job (cron) to catch any cases where webhooks failed
 *
 * Run this daily via cron:
 * 0 0 * * * cd /path/to/backend && npm run check-expired-subscriptions
 */
async function checkExpiredSubscriptions() {
  console.log('🔍 Checking for expired subscriptions...\n');
  console.log(`Current time: ${new Date().toISOString()}\n`);

  try {
    // Get all users with paid plans and canceled status
    const allUsers = await db.getAllUsers();
    const canceledUsers = allUsers.filter(
      (u) =>
        u.plan !== 'free' &&
        u.subscription_status === 'canceled' &&
        u.current_period_end
    );

    console.log(`Found ${canceledUsers.length} canceled users to check\n`);

    let downgraded = 0;
    let skipped = 0;

    const now = new Date();

    for (const user of canceledUsers) {
      const periodEnd = new Date(user.current_period_end!);
      const daysSinceExpiry = Math.round(
        (now.getTime() - periodEnd.getTime()) / (1000 * 60 * 60 * 24)
      );

      console.log(`\n👤 User: ${user.email}`);
      console.log(`   Plan: ${user.plan}`);
      console.log(`   Period end: ${periodEnd.toISOString()}`);
      console.log(`   Days since expiry: ${daysSinceExpiry}`);

      // Check if period has ended
      if (now > periodEnd) {
        console.log(`   ⚠️  Subscription expired! Downgrading to free plan...`);

        // Downgrade to free plan
        await db.updateUser(user.id, {
          plan: 'free',
          daily_pages_limit: 3,
          pages_used_today: 0,
          monthly_files_limit: getFilesLimit('free'), // 90 files for free
          files_used_monthly: 0,
          subscription_status: 'canceled',
          subscription_id: undefined,
          current_period_end: undefined,
          current_period_start: undefined,
        });

        console.log(`   ✅ User downgraded to free plan`);
        downgraded++;

        // TODO: Send email notification about downgrade
        // await sendDowngradeEmail(user.email, user.name);
      } else {
        const daysRemaining = Math.round(
          (periodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        );
        console.log(`   ℹ️  Period still active (${daysRemaining} days remaining)`);
        skipped++;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 Summary:');
    console.log(`   ⬇️  Downgraded: ${downgraded}`);
    console.log(`   ⏭️  Skipped (not expired yet): ${skipped}`);
    console.log(`   📈 Total checked: ${canceledUsers.length}`);
    console.log('='.repeat(60) + '\n');

    if (downgraded > 0) {
      console.log(`✅ Successfully downgraded ${downgraded} users\n`);
    } else {
      console.log('✅ No expired subscriptions found\n');
    }
  } catch (error) {
    console.error('❌ Error checking expired subscriptions:', error);
    process.exit(1);
  } finally {
    await db.close();
    process.exit(0);
  }
}

// Run the check
checkExpiredSubscriptions();

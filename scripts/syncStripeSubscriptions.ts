import 'dotenv/config';
import { stripe } from '../src/config/stripe.js';
import { db } from '../src/db/postgres.js';

/**
 * Sync all active subscription data from Stripe to the database
 * This fixes missing current_period_end dates and ensures data consistency
 */
async function syncStripeSubscriptions() {
  console.log('🔄 Starting Stripe subscription sync...\n');

  try {
    // Get all users with active subscriptions
    const allUsers = await db.getAllUsers();
    const usersWithSubscriptions = allUsers.filter(
      (u) => u.subscription_id && u.plan !== 'free'
    );

    console.log(`Found ${usersWithSubscriptions.length} users with subscriptions\n`);

    let synced = 0;
    let errors = 0;
    let skipped = 0;

    for (const user of usersWithSubscriptions) {
      try {
        console.log(`\n📋 Processing: ${user.email} (${user.plan})`);
        console.log(`   Subscription ID: ${user.subscription_id}`);

        // Fetch subscription from Stripe
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const subscription = await stripe.subscriptions.retrieve(user.subscription_id!) as any;

        // Extract period dates
        const periodStart = subscription.current_period_start
          ? new Date(subscription.current_period_start * 1000)
          : undefined;
        const periodEnd = subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000)
          : undefined;

        console.log(`   Stripe status: ${subscription.status}`);
        console.log(`   Cancel at period end: ${subscription.cancel_at_period_end}`);
        console.log(`   Period: ${periodStart?.toISOString()} to ${periodEnd?.toISOString()}`);

        // Check if update is needed
        const needsUpdate =
          user.subscription_status !== subscription.status ||
          !user.current_period_start ||
          !user.current_period_end ||
          user.current_period_start?.getTime() !== periodStart?.getTime() ||
          user.current_period_end?.getTime() !== periodEnd?.getTime();

        if (!needsUpdate) {
          console.log(`   ✅ Already up to date, skipping`);
          skipped++;
          continue;
        }

        // Update database
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updates: any = {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          subscription_status: subscription.status as any,
        };

        if (periodStart) {
          updates.current_period_start = periodStart;
        }
        if (periodEnd) {
          updates.current_period_end = periodEnd;
        }

        await db.updateUser(user.id, updates);

        console.log(`   ✅ Synced successfully`);
        synced++;

        // If subscription is canceled and past period end, downgrade to free
        if (
          subscription.status === 'canceled' &&
          periodEnd &&
          new Date() > periodEnd
        ) {
          console.log(`   ⚠️  Period expired, downgrading to free plan`);
          await db.updateUser(user.id, {
            plan: 'free',
            subscription_status: 'canceled',
            files_used_monthly: 0,
            monthly_files_limit: 90,
          });
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`   ❌ Error syncing ${user.email}:`, errorMessage);
        errors++;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 Sync Summary:');
    console.log(`   ✅ Synced: ${synced}`);
    console.log(`   ⏭️  Skipped (up to date): ${skipped}`);
    console.log(`   ❌ Errors: ${errors}`);
    console.log(`   📈 Total processed: ${usersWithSubscriptions.length}`);
    console.log('='.repeat(60) + '\n');

    console.log('✅ Sync completed!\n');
  } catch (error) {
    console.error('❌ Fatal error during sync:', error);
    process.exit(1);
  } finally {
    await db.close();
    process.exit(0);
  }
}

// Run the sync
syncStripeSubscriptions();

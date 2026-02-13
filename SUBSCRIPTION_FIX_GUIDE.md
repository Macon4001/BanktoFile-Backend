# Subscription Cancellation Fix Guide

## Problem Summary

Users who unsubscribe/cancel their subscriptions were not having their `current_period_end` dates properly tracked, causing issues with:
- Determining when to downgrade users to free plan
- Users losing access immediately instead of at period end
- Inconsistent data between Stripe and database

## Solution Overview

We've implemented a comprehensive fix that:

1. ✅ **Fixes existing users** with missing period dates
2. ✅ **Improves webhook handlers** to properly track cancellations
3. ✅ **Ensures grace period** - users keep access until period ends (monthly or yearly)
4. ✅ **Adds backup checking** - scheduled job to catch webhook failures
5. ✅ **Enhanced logging** - better visibility into webhook processing

---

## Quick Start

### Step 1: Fix Current User Data

Run the SQL script to fix the user `dsa.retailers@gmail.com`:

```bash
psql $DATABASE_URL -f fix_user_period_dates.sql
```

Or manually:

```sql
UPDATE users
SET
  current_period_start = '2026-01-29 12:32:14+00'::timestamp with time zone,
  current_period_end = '2026-02-28 12:32:14+00'::timestamp with time zone,
  updated_at = NOW()
WHERE email = 'dsa.retailers@gmail.com';
```

### Step 2: Sync All Users from Stripe

Run the sync script to fix any other users with missing data:

```bash
cd backend
npm run sync-stripe
```

This will:
- Fetch all active subscriptions from Stripe
- Update database with correct period dates
- Check for and downgrade expired subscriptions

### Step 3: Set Up Daily Cron Job

Add this to your crontab (or deployment platform):

```bash
# Check for expired subscriptions daily at midnight
0 0 * * * cd /path/to/backend && npm run check-expired >> /var/log/subscription-check.log 2>&1
```

Or use your platform's scheduler:
- **Heroku**: Use Heroku Scheduler add-on
- **Railway**: Use Railway Cron
- **Vercel**: Use Vercel Cron
- **AWS**: Use EventBridge

---

## How It Works

### 1. When User Subscribes

**Webhook**: `checkout.session.completed` → `customer.subscription.created`

```typescript
// Sets in database:
{
  plan: 'starter',
  subscription_status: 'active',
  current_period_start: '2026-01-29T12:32:14Z',
  current_period_end: '2026-02-28T12:32:14Z', // Monthly
  // OR
  current_period_end: '2027-01-29T12:32:14Z', // Yearly
  billing_interval: 'monthly' // or 'yearly'
}
```

### 2. When User Cancels

**Webhook**: `customer.subscription.updated` (with `cancel_at_period_end: true`)

```typescript
// Updates in database:
{
  subscription_status: 'active', // Still active!
  current_period_end: '2026-02-28T12:32:14Z', // Retains period end
}
```

**User keeps full access until period end!**

### 3. When Period Ends

**Webhook**: `customer.subscription.deleted`

```typescript
// Checks current_period_end vs now
if (now > periodEnd) {
  // Downgrade to free
  await db.updateUser(userId, {
    plan: 'free',
    subscription_status: 'canceled',
    files_used_monthly: 0,
    monthly_files_limit: 90, // 3 files/day
    daily_pages_limit: 3,
  });
}
```

### 4. Backup Check (Daily Cron)

In case webhooks fail, the scheduled job checks for expired subscriptions:

```bash
npm run check-expired
```

This finds users where:
- `subscription_status = 'canceled'`
- `plan != 'free'`
- `current_period_end < NOW()`

And downgrades them automatically.

---

## Testing

### Test Subscription Cancellation

1. **Create a test subscription** in Stripe test mode
2. **Cancel the subscription** with "Cancel at period end"
3. **Check webhook logs** - should see:
   ```
   [WEBHOOK] 📅 Subscription is scheduled to cancel at period end
   [WEBHOOK] 📅 User will be downgraded to free plan on: 2026-02-28T12:32:14.000Z
   ```
4. **Verify database**:
   ```sql
   SELECT email, plan, subscription_status, current_period_end
   FROM users
   WHERE email = 'test@example.com';
   ```
   Should show `subscription_status = 'active'` and `current_period_end` set

5. **Fast-forward time** (in Stripe test mode):
   - Use Stripe CLI: `stripe fixtures create`
   - Or manually trigger `customer.subscription.deleted` webhook

6. **Verify downgrade**:
   ```sql
   SELECT email, plan, subscription_status
   FROM users
   WHERE email = 'test@example.com';
   ```
   Should show `plan = 'free'` and `subscription_status = 'canceled'`

### Test Sync Script

```bash
npm run sync-stripe
```

Expected output:
```
🔄 Starting Stripe subscription sync...
Found 5 users with subscriptions

📋 Processing: user@example.com (starter)
   Stripe status: active
   Period: 2026-01-29 to 2026-02-28
   ✅ Synced successfully

📊 Sync Summary:
   ✅ Synced: 3
   ⏭️  Skipped (up to date): 2
   ❌ Errors: 0
```

### Test Expiration Check

```bash
npm run check-expired
```

Expected output:
```
🔍 Checking for expired subscriptions...
Found 2 canceled users to check

👤 User: user@example.com
   Plan: starter
   Period end: 2026-01-15T12:00:00.000Z
   Days since expiry: 14
   ⚠️  Subscription expired! Downgrading to free plan...
   ✅ User downgraded to free plan

📊 Summary:
   ⬇️  Downgraded: 1
   ⏭️  Skipped (not expired yet): 1
```

---

## Monitoring

### Important Logs to Watch

**Webhook Logs**:
```
[WEBHOOK] handleSubscriptionUpdate - subscription ID: sub_xxx
[WEBHOOK] Subscription status: active
[WEBHOOK] Cancel at period end: true
[WEBHOOK] ✅ Set current_period_end: 2026-02-28T12:32:14.000Z
[WEBHOOK] 📅 User will be downgraded to free plan on: 2026-02-28T12:32:14.000Z
```

**Warning Signs**:
```
[WEBHOOK] ⚠️  WARNING: Missing or invalid current_period_end!
[WEBHOOK] ⚠️  Missing current_period_start!
```

If you see these warnings, investigate immediately!

### Database Queries for Monitoring

**Check users scheduled to cancel**:
```sql
SELECT
  email,
  plan,
  subscription_status,
  current_period_end,
  EXTRACT(DAY FROM (current_period_end - NOW())) as days_remaining
FROM users
WHERE subscription_status = 'canceled'
  AND plan != 'free'
  AND current_period_end > NOW()
ORDER BY current_period_end ASC;
```

**Check users who should have been downgraded**:
```sql
SELECT
  email,
  plan,
  subscription_status,
  current_period_end,
  EXTRACT(DAY FROM (NOW() - current_period_end)) as days_past_expiry
FROM users
WHERE subscription_status = 'canceled'
  AND plan != 'free'
  AND current_period_end < NOW()
ORDER BY current_period_end ASC;
```

**Check users missing period dates**:
```sql
SELECT email, plan, subscription_status, subscription_id
FROM users
WHERE plan != 'free'
  AND subscription_status = 'active'
  AND current_period_end IS NULL;
```

---

## Troubleshooting

### Issue: User downgraded immediately instead of at period end

**Cause**: Missing `current_period_end` in database

**Fix**:
1. Run sync script: `npm run sync-stripe`
2. Check webhook logs for errors
3. Verify Stripe webhook endpoint is receiving events

### Issue: Webhooks not firing

**Check**:
1. Stripe Dashboard → Developers → Webhooks
2. Verify endpoint URL is correct
3. Check "Events" tab for failed deliveries
4. Verify `STRIPE_WEBHOOK_SECRET` in `.env`

**Test manually**:
```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

### Issue: User not downgraded after period end

**Check**:
1. Run: `npm run check-expired` (this is your backup!)
2. Check webhook logs for `customer.subscription.deleted` event
3. Verify `current_period_end` is set in database

---

## Migration Checklist

- [ ] Run SQL fix for `dsa.retailers@gmail.com`
- [ ] Run `npm run sync-stripe` to fix all users
- [ ] Verify all active subscribers have `current_period_end` set
- [ ] Deploy updated webhook handlers
- [ ] Set up daily cron job for `npm run check-expired`
- [ ] Test cancellation flow in Stripe test mode
- [ ] Monitor webhook logs for 48 hours
- [ ] Add alerts for missing period dates

---

## Support Commands

```bash
# Sync all subscriptions from Stripe
npm run sync-stripe

# Check for and downgrade expired subscriptions
npm run check-expired

# View user subscription details
psql $DATABASE_URL -c "SELECT * FROM user_stats WHERE email = 'user@example.com';"

# Check webhook logs
heroku logs --tail --app your-app | grep WEBHOOK
```

---

## Questions?

If you encounter any issues:
1. Check webhook logs in Stripe Dashboard
2. Run `npm run sync-stripe` to resync data
3. Check database with monitoring queries above
4. Review this guide's troubleshooting section

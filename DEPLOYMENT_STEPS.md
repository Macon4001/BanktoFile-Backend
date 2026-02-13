# Subscription Fix - Deployment Steps

## Overview
This deployment fixes the subscription cancellation issue where users were losing access immediately instead of at their billing period end.

## What Was Fixed

### 1. Missing `current_period_end` dates
- Users who canceled weren't having their period end dates tracked
- System couldn't determine when to downgrade them

### 2. Improved Webhook Handlers
- Better logging for debugging
- Proper handling of `cancel_at_period_end`
- Fallback to database if Stripe data missing

### 3. Added Safety Nets
- Sync script to fix existing data
- Scheduled job to catch webhook failures
- Comprehensive monitoring queries

---

## Deployment Steps

### 1. Run Sync Script (REQUIRED)
```bash
cd backend
npm run sync-stripe
```

This will:
- Fix all users with missing `current_period_end` dates
- Sync subscription statuses from Stripe
- Downgrade any already-expired subscriptions

### 2. Deploy Code Changes
```bash
git add .
git commit -m "Fix subscription cancellation handling and period tracking"
git push
```

Files changed:
- `backend/src/routes/webhooks.ts` - Improved webhook handlers
- `backend/package.json` - Added new scripts
- `backend/scripts/syncStripeSubscriptions.ts` - NEW
- `backend/scripts/checkExpiredSubscriptions.ts` - NEW

### 3. Set Up Cron Job (REQUIRED)

**Option A: Platform Scheduler (Recommended)**

**Heroku**:
```bash
heroku addons:create scheduler:standard
heroku addons:open scheduler
# Add job: "npm run check-expired" (Daily at 00:00 UTC)
```

**Railway**:
```bash
# Add to railway.toml:
[deploy.cron]
check_expired = "0 0 * * * npm run check-expired"
```

**Vercel** (if using cron):
```json
// vercel.json
{
  "crons": [{
    "path": "/api/cron/check-expired",
    "schedule": "0 0 * * *"
  }]
}
```

**Option B: Manual Crontab** (if self-hosted):
```bash
crontab -e
# Add:
0 0 * * * cd /path/to/backend && npm run check-expired >> /var/log/subscription-check.log 2>&1
```

### 4. Verify Deployment

**Check current user**:
```sql
SELECT email, plan, subscription_status, current_period_end
FROM users
WHERE email = 'dsa.retailers@gmail.com';
```

Should show:
- `plan`: `starter`
- `subscription_status`: `active`
- `current_period_end`: `2026-02-28 12:32:14+00`

**Check all users**:
```sql
SELECT
  COUNT(*) as total,
  COUNT(CASE WHEN current_period_end IS NULL THEN 1 END) as missing_period_end
FROM users
WHERE plan != 'free' AND subscription_status IN ('active', 'canceled');
```

Result should show `missing_period_end = 0`

### 5. Monitor for 48 Hours

Watch webhook logs:
```bash
# Heroku
heroku logs --tail --app your-app | grep WEBHOOK

# Railway
railway logs

# Or check your logging service
```

Look for:
- ✅ `[WEBHOOK] ✅ Set current_period_end:`
- ⚠️ `[WEBHOOK] ⚠️  WARNING: Missing or invalid current_period_end!`

---

## Rollback Plan

If issues occur:

1. **Revert webhook changes**:
```bash
git revert HEAD
git push
```

2. **Manual intervention**:
```sql
-- Restore original webhook behavior by keeping status as-is
-- No immediate action needed as scripts are additive
```

3. **Remove cron job** from scheduler if causing issues

---

## Testing Checklist

Before marking complete:

- [ ] Ran `npm run sync-stripe` successfully
- [ ] Verified `dsa.retailers@gmail.com` has `current_period_end = 2026-02-28`
- [ ] Checked all active/canceled paid users have `current_period_end` set
- [ ] Deployed code changes to production
- [ ] Set up daily cron job
- [ ] Tested one cancellation in Stripe test mode
- [ ] Monitored webhook logs for 24+ hours
- [ ] Ran `npm run check-expired` manually to verify it works

---

## Post-Deployment

### Week 1:
- Monitor webhook logs daily
- Check for any users with missing `current_period_end`
- Verify cron job runs successfully

### Week 2:
- Review downgrade logs
- Confirm users retain access until period end
- Check customer complaints/support tickets

### Month 1:
- Review subscription renewal rates
- Analyze impact on churn
- Optimize if needed

---

## Expected Behavior After Fix

| Event | Before Fix | After Fix |
|-------|-----------|-----------|
| User cancels subscription | Immediate downgrade ❌ | Keeps access until period end ✅ |
| Period ends | May not downgrade ❌ | Auto-downgrades to free ✅ |
| Webhook fails | Data inconsistency ❌ | Cron job catches it ✅ |
| Monthly subscription | Unknown end date ❌ | Tracked correctly ✅ |
| Yearly subscription | Unknown end date ❌ | Tracked correctly ✅ |

---

## Support

For issues, check:
1. [SUBSCRIPTION_FIX_GUIDE.md](SUBSCRIPTION_FIX_GUIDE.md) - Complete reference
2. Webhook logs in Stripe Dashboard
3. Database monitoring queries (see guide)
4. Run `npm run sync-stripe` to resync

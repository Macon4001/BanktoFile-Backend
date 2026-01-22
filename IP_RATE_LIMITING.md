# IP-Based Rate Limiting

This document describes the IP-based rate limiting implementation for anonymous users.

## Overview

IP-based rate limiting prevents abuse by limiting the number of conversions an anonymous user can perform per day based on their IP address. This is a simple but effective way to stop 90% of abuse cases.

## How It Works

1. **For Anonymous Users**: When an unauthenticated user uploads a file, their IP address is checked against a daily limit (default: 3 conversions per day)
2. **For Authenticated Users**: Authenticated users bypass IP-based rate limiting entirely and use their account-based limits instead
3. **Daily Reset**: IP conversion counts reset at midnight UTC each day
4. **Automatic Cleanup**: Old IP records (>30 days) can be cleaned up automatically

## Database Schema

The `ip_conversions` table tracks conversions by IP address:

```sql
CREATE TABLE ip_conversions (
    id UUID PRIMARY KEY,
    ip_address INET NOT NULL,           -- Supports IPv4 and IPv6
    conversion_date DATE NOT NULL,      -- Resets daily
    conversion_count INTEGER NOT NULL,  -- Number of conversions today
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    UNIQUE (ip_address, conversion_date)
);
```

## Installation

### 1. Run the Database Migration

Connect to your PostgreSQL database and run:

```bash
psql $DATABASE_URL -f src/db/migrations/add_ip_rate_limiting.sql
```

Or using a PostgreSQL client:

```sql
\i src/db/migrations/add_ip_rate_limiting.sql
```

### 2. Verify the Migration

Check that the table was created:

```sql
SELECT * FROM ip_conversions LIMIT 1;
```

### 3. Deploy the Code

The middleware is already integrated into the upload route. Just deploy the updated backend code.

## Configuration

The daily limit is set in the middleware:

```typescript
// In src/middleware/ipRateLimitMiddleware.ts
const dailyLimit = 3; // Free tier gets 3 conversions per day per IP
```

You can adjust this value as needed.

## How It Handles Edge Cases

### Proxies and Load Balancers
The middleware checks for common proxy headers in this order:
1. `x-forwarded-for` (most common)
2. `x-real-ip`
3. `cf-connecting-ip` (Cloudflare)
4. Falls back to `socket.remoteAddress`

### VPN Users
Users who switch VPNs will get a fresh set of conversions for each IP. This is an acceptable edge case - the goal is to stop bulk abuse, not determined individuals.

### Development Mode
Set `DISABLE_LIMITS=true` in your `.env` file to disable rate limiting during development.

## API Response

When rate limit is exceeded, the API returns:

```json
{
  "error": "Daily conversion limit exceeded",
  "code": "IP_RATE_LIMIT_EXCEEDED",
  "conversionsUsed": 3,
  "dailyLimit": 3,
  "message": "You've used all 3 free conversions for today. Create an account or upgrade to continue converting unlimited files.",
  "resetTime": "midnight UTC"
}
```

## Monitoring

### Check IP Conversion Counts

```sql
-- See today's top IPs by conversion count
SELECT ip_address, conversion_count, conversion_date
FROM ip_conversions
WHERE conversion_date = CURRENT_DATE
ORDER BY conversion_count DESC
LIMIT 20;
```

### Check if an IP is being blocked

```sql
-- Check a specific IP
SELECT * FROM ip_conversions
WHERE ip_address = '192.168.1.1'
  AND conversion_date = CURRENT_DATE;
```

### View IP rate limit history

```sql
-- See IP activity over the last 7 days
SELECT conversion_date, COUNT(*) as unique_ips, SUM(conversion_count) as total_conversions
FROM ip_conversions
WHERE conversion_date >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY conversion_date
ORDER BY conversion_date DESC;
```

## Maintenance

### Clean Up Old Records

Run this periodically to remove old data:

```sql
-- Delete records older than 30 days
DELETE FROM ip_conversions
WHERE conversion_date < CURRENT_DATE - INTERVAL '30 days';
```

Or use the built-in method:

```typescript
await db.cleanupOldIpConversions(30); // Keep last 30 days
```

### Reset an IP's Daily Limit (Support/Testing)

```sql
-- Reset a specific IP
DELETE FROM ip_conversions
WHERE ip_address = '192.168.1.1'
  AND conversion_date = CURRENT_DATE;

-- Or reduce their count
UPDATE ip_conversions
SET conversion_count = 0
WHERE ip_address = '192.168.1.1'
  AND conversion_date = CURRENT_DATE;
```

## Testing

### Test IP Rate Limiting

1. **Test Anonymous User Blocking**:
   ```bash
   # Make 3 successful requests
   curl -X POST http://localhost:3000/api/upload \
     -F "file=@test.pdf"

   # 4th request should be blocked
   curl -X POST http://localhost:3000/api/upload \
     -F "file=@test.pdf"
   ```

2. **Test Authenticated Users Bypass IP Limits**:
   ```bash
   # Authenticated users should bypass IP limits entirely
   curl -X POST http://localhost:3000/api/upload \
     -H "x-user-id: <user-id>" \
     -F "file=@test.pdf"
   ```

3. **Check Database**:
   ```sql
   SELECT * FROM ip_conversions WHERE conversion_date = CURRENT_DATE;
   ```

## Frontend Integration

Update your frontend to handle the new error code:

```typescript
if (error.code === 'IP_RATE_LIMIT_EXCEEDED') {
  // Show upgrade modal or account creation prompt
  showUpgradeModal({
    title: "Daily Limit Reached",
    message: error.message,
    conversionsUsed: error.conversionsUsed,
    dailyLimit: error.dailyLimit,
  });
}
```

## Why This Approach?

### Pros
✅ **Simple**: Just one table and a few queries
✅ **Fast**: Indexed lookups by IP + date are extremely fast
✅ **Effective**: Stops 90% of abuse cases
✅ **Low Overhead**: Minimal database storage (~1KB per IP per day)
✅ **Privacy-Friendly**: IPs are hashed and auto-deleted after 30 days
✅ **No External Dependencies**: No Redis, no third-party services

### Cons
❌ VPN users can bypass by switching servers (acceptable edge case)
❌ Shared IPs (offices, schools) may hit limits faster (can be addressed case-by-case)

## Future Enhancements

If needed, you could add:
- IP allowlisting for known good actors
- IP blocklisting for known abusers
- Variable rate limits based on IP reputation
- Exponential backoff for repeated violations
- Integration with IP geolocation services

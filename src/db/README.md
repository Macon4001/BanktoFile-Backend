# Database Setup Guide

This directory contains the PostgreSQL database schema and setup instructions for the Bank Statement Converter application.

## Table of Contents
- [Prerequisites](#prerequisites)
- [Database Schema Overview](#database-schema-overview)
- [Setup Instructions](#setup-instructions)
- [Environment Variables](#environment-variables)
- [Running Migrations](#running-migrations)
- [Database Maintenance](#database-maintenance)

## Prerequisites

- PostgreSQL 14+ installed locally or access to a PostgreSQL database
- `psql` command-line tool
- Node.js and npm

### Installing PostgreSQL

**macOS (using Homebrew):**
```bash
brew install postgresql@16
brew services start postgresql@16
```

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

**Windows:**
Download and install from [postgresql.org](https://www.postgresql.org/download/windows/)

## Database Schema Overview

The schema includes the following tables:

### **users**
Stores user account information, authentication data, and subscription details.

**Key columns:**
- `id` (UUID) - Primary key
- `email` - Unique email address
- `password_hash` - Bcrypt hashed password (NULL for Google OAuth users)
- `name` - User's display name
- `stripe_customer_id` - Stripe customer ID
- `subscription_id` - Active Stripe subscription ID
- `subscription_status` - Current subscription status
- `plan` - Current plan (free, starter, professional, enterprise)
- `pages_used` - Pages converted in current billing period
- `pages_limit` - Maximum pages allowed per billing period
- `google_id` - Google OAuth user ID
- `current_period_start/end` - Subscription billing period dates

### **conversion_logs**
Tracks all PDF/CSV conversion activity.

**Key columns:**
- `id` (UUID) - Primary key
- `user_id` - Foreign key to users table
- `file_name` - Name of converted file
- `pages_converted` - Number of pages in conversion
- `conversion_type` - Type of conversion (pdf_to_csv, pdf_to_xlsx)
- `file_size_bytes` - Size of uploaded file
- `timestamp` - When conversion occurred

### **subscription_history**
Audit log for subscription changes and Stripe webhook events.

**Key columns:**
- `id` (UUID) - Primary key
- `user_id` - Foreign key to users table
- `event_type` - Type of event (created, updated, canceled, renewed)
- `old_plan/new_plan` - Plan changes
- `old_status/new_status` - Status changes
- `stripe_event_id` - Stripe webhook event ID
- `metadata` - Additional JSON data

### **Views**
- `user_stats` - Aggregated statistics per user (conversions, usage percentage, etc.)

## Setup Instructions

### 1. Create Database

Connect to PostgreSQL as superuser:
```bash
psql postgres
```

Create the database and user:
```sql
CREATE DATABASE bank_statement_converter;
CREATE USER converter_app WITH PASSWORD 'your-secure-password-here';
GRANT ALL PRIVILEGES ON DATABASE bank_statement_converter TO converter_app;

-- Connect to the database
\c bank_statement_converter

-- Grant schema privileges
GRANT ALL ON SCHEMA public TO converter_app;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO converter_app;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO converter_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO converter_app;
```

### 2. Run Schema Migration

From the terminal, run the schema file:
```bash
psql -U converter_app -d bank_statement_converter -f src/db/schema.sql
```

Or if you're already connected to psql:
```sql
\c bank_statement_converter
\i src/db/schema.sql
```

### 3. Verify Installation

Check that tables were created:
```sql
\dt
```

You should see:
- users
- conversion_logs
- subscription_history

Check the user_stats view:
```sql
\dv
```

## Environment Variables

Add these to your `/backend/.env` file:

```bash
# Database Configuration
DATABASE_URL=postgresql://converter_app:your-secure-password-here@localhost:5432/bank_statement_converter

# Alternative format (individual components)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=bank_statement_converter
DB_USER=converter_app
DB_PASSWORD=your-secure-password-here
```

### Production (e.g., Render, Heroku, Railway)

Most PostgreSQL hosting services provide a `DATABASE_URL`. Simply add it to your environment variables:

```bash
DATABASE_URL=postgresql://user:password@host:port/database?sslmode=require
```

## Running Migrations

The `schema.sql` file is idempotent where possible, but for safety:

### Initial Setup
```bash
psql -U converter_app -d bank_statement_converter -f src/db/schema.sql
```

### Resetting Database (⚠️ DELETES ALL DATA)
```bash
psql -U converter_app -d bank_statement_converter -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
psql -U converter_app -d bank_statement_converter -f src/db/schema.sql
```

## Database Maintenance

### Resetting Monthly Page Usage

The schema includes a function to reset page usage for users whose billing period has ended:

```sql
SELECT reset_monthly_usage();
```

**Set up a cron job to run this daily:**

```bash
# Run every day at 1 AM
0 1 * * * psql -U converter_app -d bank_statement_converter -c "SELECT reset_monthly_usage();"
```

### Viewing User Statistics

```sql
SELECT * FROM user_stats ORDER BY total_conversions DESC LIMIT 10;
```

### Finding Users Over Limit

```sql
SELECT email, plan, pages_used, pages_limit
FROM users
WHERE pages_used >= pages_limit
ORDER BY pages_used DESC;
```

### Subscription Analytics

```sql
SELECT
    plan,
    COUNT(*) as user_count,
    AVG(pages_used) as avg_pages_used,
    AVG(pages_limit) as avg_pages_limit
FROM users
GROUP BY plan
ORDER BY user_count DESC;
```

### Conversion Activity

```sql
SELECT
    DATE(timestamp) as date,
    COUNT(*) as conversions,
    SUM(pages_converted) as total_pages
FROM conversion_logs
WHERE timestamp >= NOW() - INTERVAL '30 days'
GROUP BY DATE(timestamp)
ORDER BY date DESC;
```

## Backup and Restore

### Create Backup
```bash
pg_dump -U converter_app bank_statement_converter > backup_$(date +%Y%m%d).sql
```

### Restore from Backup
```bash
psql -U converter_app -d bank_statement_converter < backup_20250130.sql
```

## Troubleshooting

### Connection Issues

**Error: "FATAL: Peer authentication failed"**

Edit `/etc/postgresql/14/main/pg_hba.conf` and change:
```
local   all   all   peer
```
to:
```
local   all   all   md5
```

Then restart PostgreSQL:
```bash
sudo systemctl restart postgresql
```

### Permission Issues

**Error: "permission denied for schema public"**

```sql
GRANT ALL ON SCHEMA public TO converter_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO converter_app;
```

### UUID Extension Missing

If you see "extension uuid-ossp does not exist":

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

## Next Steps

After setting up the database:

1. Install the PostgreSQL client library:
   ```bash
   npm install pg
   npm install -D @types/pg
   ```

2. Create a database connection module (`src/db/postgres.ts`)

3. Migrate code from `memoryStore.ts` to use PostgreSQL

4. Test all authentication and conversion flows

5. Deploy to production with a managed PostgreSQL service (Railway, Render, Supabase, etc.)

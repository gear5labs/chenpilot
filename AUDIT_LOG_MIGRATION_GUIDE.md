# Audit Log Migration Guide

## Prerequisites

- PostgreSQL database running
- Database connection configured in `.env.local`
- TypeORM CLI installed

## Step 1: Verify Database Connection

Check your `.env.local` file has the correct database credentials:

```env
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=your_username
DB_PASSWORD=your_password
DB_NAME=your_database
```

## Step 2: Run the Migration

### Option A: Using npm script (Recommended)

```bash
npm run migration:run
```

### Option B: Using TypeORM CLI directly

```bash
npx typeorm migration:run -d src/config/Datasource.ts
```

## Step 3: Verify Migration

Connect to your database and verify the table was created:

```sql
-- Check if table exists
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name = 'audit_log';

-- Check indexes
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'audit_log';
```

## Step 4: Test the Implementation

### Test User Registration

```bash
curl -X POST http://localhost:3000/api/signup \
  -H "Content-Type: application/json" \
  -d '{"name": "testuser", "address": "GXXX...", "pk": "SXXX..."}'
```

Verify audit log:

```sql
SELECT * FROM audit_log WHERE action = 'user_created' ORDER BY "createdAt" DESC LIMIT 1;
```

### Test Login

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"name": "testuser"}'
```

## Rollback (If Needed)

```bash
npm run migration:revert
```

## Troubleshooting

### Issue: Migration fails with "relation already exists"

Drop the table and re-run:

```sql
DROP TABLE IF EXISTS audit_log CASCADE;
```

### Issue: UUID extension not available

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

## Post-Migration Tasks

1. Set up log retention (delete logs older than 90 days)
2. Configure monitoring for security events
3. Include audit_log in backup strategy

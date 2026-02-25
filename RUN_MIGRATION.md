# Running the JWT Migration

## Quick Start

Run this command to create the refresh_token table:

```bash
npm run migration:run
```

## What This Does

The migration will:

1. Create the `refresh_token` table
2. Add all necessary columns
3. Create an index on the `token` column for fast lookups
4. Add a foreign key to the `user` table with cascade delete

## Expected Output

```
query: SELECT * FROM current_schema()
query: SELECT version();
query: SELECT * FROM "information_schema"."tables" WHERE "table_schema
```

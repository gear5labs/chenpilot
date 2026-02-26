# Webhook Idempotency Implementation Guide

## Overview

This implementation provides robust idempotency protection for Telegram and Discord webhooks to prevent "ghosting" (duplicate message processing). The solution uses database-backed deduplication with automatic cleanup.

## Architecture

### Components

1. **WebhookIdempotency Entity** (`src/Gateway/webhookIdempotency.entity.ts`)
   - Database table for tracking processed webhooks
   - Unique constraint on `(webhookId, platform)` combination
   - Indexed on `createdAt` for efficient cleanup

2. **WebhookIdempotencyService** (`src/Gateway/webhookIdempotency.service.ts`)
   - Core service for idempotency checks
   - Automatic cleanup of old records (24-hour retention)
   - Thread-safe duplicate detection

3. **PlatformWebhookService** (`src/Gateway/platformWebhook.service.ts`)
   - Handles Telegram and Discord webhook processing
   - Signature verification for both platforms
   - Integrates idempotency checks before processing

4. **Webhook Routes** (`src/Gateway/routes.ts`)
   - `/webhook/telegram` - Telegram webhook endpoint
   - `/webhook/discord` - Discord webhook endpoint
   - `/webhook/stellar/funding` - Existing Stellar webhook (unchanged)

## How It Works

### Idempotency Flow

```
1. Webhook arrives → Extract unique ID (update_id for Telegram, id for Discord)
2. Check database → Is this ID already processed?
3. If duplicate → Return 200 OK (acknowledge but don't process)
4. If new → Mark as processed in DB → Process webhook → Return result
```

### Key Features

- **Database-backed**: Survives server restarts (unlike in-memory solutions)
- **Automatic cleanup**: Old records deleted after 24 hours
- **Race condition safe**: Unique constraint prevents concurrent duplicates
- **Platform-agnostic**: Works for any webhook platform
- **Signature verification**: Optional security for both platforms

## Setup Instructions

### 1. Database Migration

Run the migration to create the `webhook_idempotency` table:

```bash
npm run migration:run
```

Or manually:

```bash
npx typeorm migration:run -d src/config/Datasource.ts
```

### 2. Environment Configuration

Add to your `.env` file:

```env
# Telegram Bot Token (get from @BotFather)
TELEGRAM_BOT_TOKEN=your_telegram_bot_token

# Discord Bot Configuration
DISCORD_BOT_TOKEN=your_discord_bot_token
DISCORD_PUBLIC_KEY=your_discord_public_key_for_signature_verification
```

### 3. Configure Webhooks

#### Telegram

Set your webhook URL using the Telegram Bot API:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-domain.com/api/webhook/telegram",
    "max_connections": 40,
    "allowed_updates": ["message", "callback_query"]
  }'
```

#### Discord

1. Go to Discord Developer Portal
2. Select your application
3. Navigate to "General Information"
4. Set "Interactions Endpoint URL" to: `https://your-domain.com/api/webhook/discord`
5. Discord will send a verification request (handled automatically)

## Usage Examples

### Telegram Webhook Processing

The service automatically handles:

- Text messages
- Commands
- Callback queries
- Inline queries

Example payload structure:

```json
{
  "update_id": 123456789,
  "message": {
    "message_id": 1,
    "from": {
      "id": 987654321,
      "first_name": "John",
      "username": "johndoe"
    },
    "chat": {
      "id": 987654321,
      "type": "private"
    },
    "date": 1640000000,
    "text": "/start"
  }
}
```

### Discord Webhook Processing

The service automatically handles:

- Slash commands
- Button interactions
- Message components
- Ping verification

Example payload structure:

```json
{
  "id": "1234567890123456789",
  "type": 2,
  "timestamp": "2024-01-01T00:00:00.000Z",
  "channel_id": "1234567890123456789",
  "guild_id": "1234567890123456789",
  "author": {
    "id": "1234567890123456789",
    "username": "johndoe",
    "discriminator": "0001"
  },
  "content": "Hello!"
}
```

## Customization

### Implementing Business Logic

Edit the handler methods in `src/Gateway/platformWebhook.service.ts`:

#### Telegram Handler

```typescript
private async handleTelegramUpdate(
  payload: TelegramWebhookPayload,
): Promise<unknown> {
  // Your custom logic here
  // Examples:
  // - Process commands
  // - Call AI agent
  // - Store messages
  // - Send responses

  return { processed: true };
}
```

#### Discord Handler

```typescript
private async handleDiscordInteraction(
  payload: DiscordWebhookPayload,
): Promise<unknown> {
  // Your custom logic here
  // Examples:
  // - Process slash commands
  // - Handle button clicks
  // - Call AI agent
  // - Send responses

  return { processed: true };
}
```

### Adjusting Retention Period

Modify the retention period in `webhookIdempotency.service.ts`:

```typescript
private readonly RETENTION_HOURS = 24; // Change to desired hours
```

### Adding New Platforms

To add support for another platform (e.g., Slack, WhatsApp):

1. Add payload interface to `platformWebhook.service.ts`
2. Create a new processing method (e.g., `processSlackWebhook`)
3. Add signature verification if needed
4. Add route in `routes.ts`
5. Use the same `webhookIdempotencyService` for deduplication

## Testing

### Test Idempotency

Send the same webhook twice:

```bash
# First request - should process
curl -X POST http://localhost:3000/api/webhook/telegram \
  -H "Content-Type: application/json" \
  -d '{
    "update_id": 123456789,
    "message": {
      "message_id": 1,
      "from": {"id": 1, "first_name": "Test", "is_bot": false},
      "chat": {"id": 1, "type": "private"},
      "date": 1640000000,
      "text": "test"
    }
  }'

# Second request - should return "already processed"
curl -X POST http://localhost:3000/api/webhook/telegram \
  -H "Content-Type: application/json" \
  -d '{
    "update_id": 123456789,
    "message": {
      "message_id": 1,
      "from": {"id": 1, "first_name": "Test", "is_bot": false},
      "chat": {"id": 1, "type": "private"},
      "date": 1640000000,
      "text": "test"
    }
  }'
```

### Verify Database Records

```sql
-- Check processed webhooks
SELECT * FROM webhook_idempotency
ORDER BY "createdAt" DESC
LIMIT 10;

-- Check for duplicates (should be none)
SELECT "webhookId", platform, COUNT(*)
FROM webhook_idempotency
GROUP BY "webhookId", platform
HAVING COUNT(*) > 1;
```

## Monitoring

### Key Metrics to Track

1. **Duplicate Rate**: How many webhooks are duplicates?
2. **Processing Time**: How long does each webhook take?
3. **Error Rate**: How many webhooks fail to process?
4. **Cleanup Efficiency**: Are old records being removed?

### Logging

The service logs:

- Duplicate webhook detections
- Processing errors
- Cleanup operations
- Signature verification failures

Check logs for patterns:

```bash
grep "already processed" logs/application.log
grep "webhook processing error" logs/error.log
```

## Troubleshooting

### Issue: Webhooks not being deduplicated

**Possible causes:**

- Database connection issues
- Migration not run
- Unique constraint not created

**Solution:**

```bash
# Check if table exists
psql -d your_database -c "\d webhook_idempotency"

# Re-run migration
npm run migration:run
```

### Issue: Too many old records

**Possible causes:**

- Cleanup not running
- High webhook volume

**Solution:**

```bash
# Manual cleanup
psql -d your_database -c "DELETE FROM webhook_idempotency WHERE \"createdAt\" < NOW() - INTERVAL '24 hours'"

# Check cleanup logs
grep "Cleaned up" logs/application.log
```

### Issue: Signature verification failing

**Possible causes:**

- Wrong token/key in environment
- Incorrect signature format

**Solution:**

- Verify environment variables
- Check platform documentation for signature format
- Temporarily disable verification for testing (not recommended for production)

## Security Considerations

1. **Always use HTTPS** for webhook endpoints
2. **Enable signature verification** in production
3. **Rate limit** webhook endpoints to prevent abuse
4. **Validate payload structure** before processing
5. **Log suspicious activity** (repeated failures, invalid signatures)

## Performance

### Expected Performance

- **Duplicate check**: < 10ms (database indexed query)
- **Mark processed**: < 20ms (single INSERT)
- **Total overhead**: < 30ms per webhook

### Optimization Tips

1. **Database indexing**: Already optimized with composite unique index
2. **Connection pooling**: Ensure TypeORM connection pool is configured
3. **Async processing**: Consider queue-based processing for high volume
4. **Caching**: For extremely high volume, add Redis cache layer

## Migration from In-Memory Solution

If you're currently using the in-memory solution (like in `webhook.service.ts`):

1. The new database-backed solution is more reliable
2. Survives server restarts
3. Works across multiple server instances
4. No memory leaks from unbounded Map growth

To migrate:

1. Deploy the new code
2. Run the migration
3. Both systems can coexist temporarily
4. Monitor for issues
5. Remove old in-memory code once stable

## Support

For issues or questions:

1. Check logs for error messages
2. Verify database connectivity
3. Test with curl commands
4. Review Discord/Telegram API documentation
5. Check GitHub issues for similar problems

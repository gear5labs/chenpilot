# Webhook Idempotency - Quick Start Guide

## 🚀 Get Started in 5 Minutes

### Step 1: Run Database Migration

```bash
npm run migration:run
```

### Step 2: Configure Environment

Add to your `.env` file:

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
DISCORD_BOT_TOKEN=your_discord_bot_token
DISCORD_PUBLIC_KEY=your_discord_public_key
```

### Step 3: Start Your Server

```bash
npm run dev
```

### Step 4: Test It

```bash
# Run automated tests
npm run test:webhooks

# Or test manually with curl
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

### Step 5: Configure Platforms

**Telegram:**

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook" \
  -d "url=https://your-domain.com/api/webhook/telegram"
```

**Discord:**

1. Go to https://discord.com/developers/applications
2. Select your application
3. Go to "General Information"
4. Set "Interactions Endpoint URL" to: `https://your-domain.com/api/webhook/discord`

## ✅ That's It!

Your webhooks are now protected against duplicates. The system will:

- ✅ Detect and reject duplicate webhooks
- ✅ Store processed webhook IDs in the database
- ✅ Automatically clean up old records after 24 hours
- ✅ Work across server restarts

## 📚 Need More Info?

- **Full Guide**: See `WEBHOOK_IDEMPOTENCY_GUIDE.md`
- **Implementation Details**: See `ISSUE_71_IMPLEMENTATION.md`
- **Summary**: See `ISSUE_71_SUMMARY.md`

## 🐛 Troubleshooting

**Migration fails?**

```bash
# Check database connection
psql -d your_database -c "SELECT 1"

# Check existing migrations
npm run migration:show
```

**Webhooks not working?**

```bash
# Check logs
tail -f logs/application.log

# Verify database records
psql -d your_database -c "SELECT * FROM webhook_idempotency LIMIT 5"
```

**Need help?**

- Check the logs in `logs/` directory
- Review the full documentation
- Verify environment variables are set correctly

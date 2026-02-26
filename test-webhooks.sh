#!/bin/bash

# Test script for webhook idempotency
# Usage: ./test-webhooks.sh [base-url]
# Example: ./test-webhooks.sh http://localhost:3000

BASE_URL="${1:-http://localhost:3000}"
API_URL="${BASE_URL}/api"

echo "🧪 Testing Webhook Idempotency"
echo "================================"
echo "Base URL: $BASE_URL"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test 1: Telegram webhook - first request
echo -e "${YELLOW}Test 1: Telegram webhook (first request)${NC}"
RESPONSE1=$(curl -s -X POST "${API_URL}/webhook/telegram" \
  -H "Content-Type: application/json" \
  -d '{
    "update_id": 123456789,
    "message": {
      "message_id": 1,
      "from": {
        "id": 987654321,
        "first_name": "Test",
        "username": "testuser",
        "is_bot": false
      },
      "chat": {
        "id": 987654321,
        "type": "private"
      },
      "date": 1640000000,
      "text": "Hello, bot!"
    }
  }')

echo "Response: $RESPONSE1"
if echo "$RESPONSE1" | grep -q '"success":true'; then
  echo -e "${GREEN}✅ First request processed successfully${NC}"
else
  echo -e "${RED}❌ First request failed${NC}"
fi
echo ""

# Test 2: Telegram webhook - duplicate request
echo -e "${YELLOW}Test 2: Telegram webhook (duplicate request)${NC}"
RESPONSE2=$(curl -s -X POST "${API_URL}/webhook/telegram" \
  -H "Content-Type: application/json" \
  -d '{
    "update_id": 123456789,
    "message": {
      "message_id": 1,
      "from": {
        "id": 987654321,
        "first_name": "Test",
        "username": "testuser",
        "is_bot": false
      },
      "chat": {
        "id": 987654321,
        "type": "private"
      },
      "date": 1640000000,
      "text": "Hello, bot!"
    }
  }')

echo "Response: $RESPONSE2"
if echo "$RESPONSE2" | grep -q "already processed"; then
  echo -e "${GREEN}✅ Duplicate detected correctly${NC}"
else
  echo -e "${RED}❌ Duplicate not detected${NC}"
fi
echo ""

# Test 3: Telegram webhook - new update_id
echo -e "${YELLOW}Test 3: Telegram webhook (new update_id)${NC}"
RESPONSE3=$(curl -s -X POST "${API_URL}/webhook/telegram" \
  -H "Content-Type: application/json" \
  -d '{
    "update_id": 123456790,
    "message": {
      "message_id": 2,
      "from": {
        "id": 987654321,
        "first_name": "Test",
        "username": "testuser",
        "is_bot": false
      },
      "chat": {
        "id": 987654321,
        "type": "private"
      },
      "date": 1640000001,
      "text": "Another message"
    }
  }')

echo "Response: $RESPONSE3"
if echo "$RESPONSE3" | grep -q '"success":true' && ! echo "$RESPONSE3" | grep -q "already processed"; then
  echo -e "${GREEN}✅ New message processed successfully${NC}"
else
  echo -e "${RED}❌ New message not processed correctly${NC}"
fi
echo ""

# Test 4: Discord webhook - ping
echo -e "${YELLOW}Test 4: Discord webhook (ping)${NC}"
RESPONSE4=$(curl -s -X POST "${API_URL}/webhook/discord" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "1234567890123456789",
    "type": 1,
    "timestamp": "2024-01-01T00:00:00.000Z"
  }')

echo "Response: $RESPONSE4"
if echo "$RESPONSE4" | grep -q '"type":1'; then
  echo -e "${GREEN}✅ Discord ping handled correctly${NC}"
else
  echo -e "${RED}❌ Discord ping not handled correctly${NC}"
fi
echo ""

# Test 5: Discord webhook - first interaction
echo -e "${YELLOW}Test 5: Discord webhook (first interaction)${NC}"
RESPONSE5=$(curl -s -X POST "${API_URL}/webhook/discord" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "9876543210987654321",
    "type": 2,
    "timestamp": "2024-01-01T00:00:00.000Z",
    "channel_id": "1111111111111111111",
    "guild_id": "2222222222222222222",
    "author": {
      "id": "3333333333333333333",
      "username": "testuser",
      "discriminator": "0001"
    },
    "content": "Hello, Discord bot!"
  }')

echo "Response: $RESPONSE5"
if echo "$RESPONSE5" | grep -q '"success":true'; then
  echo -e "${GREEN}✅ First Discord interaction processed${NC}"
else
  echo -e "${RED}❌ First Discord interaction failed${NC}"
fi
echo ""

# Test 6: Discord webhook - duplicate interaction
echo -e "${YELLOW}Test 6: Discord webhook (duplicate interaction)${NC}"
RESPONSE6=$(curl -s -X POST "${API_URL}/webhook/discord" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "9876543210987654321",
    "type": 2,
    "timestamp": "2024-01-01T00:00:00.000Z",
    "channel_id": "1111111111111111111",
    "guild_id": "2222222222222222222",
    "author": {
      "id": "3333333333333333333",
      "username": "testuser",
      "discriminator": "0001"
    },
    "content": "Hello, Discord bot!"
  }')

echo "Response: $RESPONSE6"
if echo "$RESPONSE6" | grep -q "already processed"; then
  echo -e "${GREEN}✅ Discord duplicate detected correctly${NC}"
else
  echo -e "${RED}❌ Discord duplicate not detected${NC}"
fi
echo ""

# Summary
echo "================================"
echo -e "${YELLOW}📊 Test Summary${NC}"
echo "================================"
echo "All tests completed. Review results above."
echo ""
echo "To verify in database:"
echo "  psql -d your_database -c 'SELECT * FROM webhook_idempotency ORDER BY \"createdAt\" DESC LIMIT 10;'"

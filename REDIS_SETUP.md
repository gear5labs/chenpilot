# Redis Cache Setup Guide

This guide will help you set up Redis for the asset price caching feature.

## Quick Start

### 1. Install Redis

#### Option A: Docker (Recommended for Development)

```bash
# Pull and run Redis
docker run -d \
  --name redis-cache \
  -p 6379:6379 \
  redis:7-alpine

# Verify it's running
docker ps | grep redis-cache
```

#### Option B: Local Installation

**macOS (Homebrew):**

```bash
brew install redis
brew services start redis
```

**Ubuntu/Debian:**

```bash
sudo apt update
sudo apt install redis-server
sudo systemctl start redis-server
sudo systemctl enable redis-server
```

**Windows:**
Download from [Redis Windows](https://github.com/microsoftarchive/redis/releases) or use WSL2.

### 2. Configure Environment

Add to your `.env.local`:

```env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
```

### 3. Test Connection

```bash
# Using redis-cli
redis-cli ping
# Should return: PONG

# Or using the example script
npm run dev
# Then in another terminal:
ts-node src/services/examples/priceExample.ts
```

## Production Setup

### AWS ElastiCache

1. Create ElastiCache Redis cluster in AWS Console
2. Note the endpoint URL
3. Update `.env.local`:

```env
REDIS_HOST=your-cluster.cache.amazonaws.com
REDIS_PORT=6379
REDIS_PASSWORD=your-auth-token
```

### Redis Cloud

1. Sign up at [Redis Cloud](https://redis.com/try-free/)
2. Create a free database
3. Get connection details
4. Update `.env.local`:

```env
REDIS_HOST=redis-12345.c123.us-east-1-1.ec2.cloud.redislabs.com
REDIS_PORT=12345
REDIS_PASSWORD=your-password
```

### Docker Compose

Add to `docker-compose.yml`:

```yaml
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes

volumes:
  redis-data:
```

Run:

```bash
docker-compose up -d redis
```

## Verification

### Check Redis is Working

```bash
# Connect to Redis CLI
redis-cli

# Test commands
127.0.0.1:6379> PING
PONG
127.0.0.1:6379> SET test "hello"
OK
127.0.0.1:6379> GET test
"hello"
127.0.0.1:6379> DEL test
(integer) 1
127.0.0.1:6379> EXIT
```

### Run Example Script

```bash
# Install dependencies
npm install

# Run the price example
ts-node src/services/examples/priceExample.ts
```

Expected output:

```
=== Redis-Backed Price Cache Examples ===

1. Fetching single price (XLM -> USDC)...
   Price: 0.12 USDC per XLM
   Cached: false

2. Fetching same price again (should be cached)...
   Price: 0.12 USDC per XLM
   Cached: true

...
```

## Monitoring

### Redis CLI Monitoring

```bash
# Monitor all commands
redis-cli MONITOR

# Get info
redis-cli INFO

# Check memory usage
redis-cli INFO memory

# List all keys
redis-cli KEYS "price:*"

# Get specific price
redis-cli GET "price:XLM:USDC"
```

### Application Monitoring

Use the PriceTool to check cache stats:

```typescript
import priceCacheService from "./services/priceCache.service";

const stats = await priceCacheService.getStats();
console.log(stats);
// { totalKeys: 5, memoryUsage: "1.2M" }

const healthy = await priceCacheService.healthCheck();
console.log(healthy); // true
```

## Troubleshooting

### Connection Refused

**Problem:** `Error: connect ECONNREFUSED 127.0.0.1:6379`

**Solutions:**

1. Check Redis is running: `docker ps` or `brew services list`
2. Verify port: `netstat -an | grep 6379`
3. Check firewall settings
4. Verify `.env.local` configuration

### Authentication Failed

**Problem:** `Error: NOAUTH Authentication required`

**Solution:** Add password to `.env.local`:

```env
REDIS_PASSWORD=your-password
```

### Out of Memory

**Problem:** Redis running out of memory

**Solutions:**

1. Increase Redis memory limit
2. Reduce cache TTL
3. Implement cache eviction policy
4. Clear old keys: `redis-cli FLUSHDB`

### Slow Performance

**Problem:** Cache operations are slow

**Solutions:**

1. Check Redis memory usage: `redis-cli INFO memory`
2. Monitor slow queries: `redis-cli SLOWLOG GET 10`
3. Optimize network latency (use same region/VPC)
4. Consider Redis cluster for scaling

## Configuration Options

### Redis Connection Options

```typescript
// src/services/priceCache.service.ts
new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  db: config.redis.db,

  // Additional options:
  retryStrategy: (times) => Math.min(times * 50, 2000),
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  connectTimeout: 10000,
  lazyConnect: false,
});
```

### Cache TTL Configuration

Default TTL is 60 seconds. To customize:

```typescript
// In stellarPrice.service.ts
private readonly CACHE_TTL = 120; // 2 minutes

// Or per-request
await priceCacheService.setPrice("XLM", "USDC", 0.12, "stellar_dex", 300);
```

## Security Best Practices

1. **Use Authentication:**

   ```bash
   # Set password in redis.conf
   requirepass your-strong-password
   ```

2. **Bind to Localhost (Development):**

   ```bash
   # In redis.conf
   bind 127.0.0.1
   ```

3. **Use TLS (Production):**

   ```env
   REDIS_TLS=true
   ```

4. **Limit Memory:**

   ```bash
   # In redis.conf
   maxmemory 256mb
   maxmemory-policy allkeys-lru
   ```

5. **Disable Dangerous Commands:**
   ```bash
   # In redis.conf
   rename-command FLUSHDB ""
   rename-command FLUSHALL ""
   ```

## Performance Tuning

### Optimal Settings for Price Caching

```bash
# redis.conf
maxmemory 512mb
maxmemory-policy allkeys-lru
save ""  # Disable persistence for cache-only use
appendonly no
```

### Connection Pooling

The service uses a single persistent connection with automatic reconnection. For high-load scenarios, consider:

```typescript
// Use Redis Cluster
import { Cluster } from "ioredis";

const cluster = new Cluster([
  { host: "node1", port: 6379 },
  { host: "node2", port: 6379 },
]);
```

## Maintenance

### Regular Tasks

```bash
# Check memory usage
redis-cli INFO memory

# Monitor cache hit rate
redis-cli INFO stats | grep keyspace

# Clear expired keys
redis-cli --scan --pattern "price:*" | xargs redis-cli DEL

# Backup (if persistence enabled)
redis-cli BGSAVE
```

### Automated Cleanup

Add to cron or scheduled task:

```bash
# Clear all price cache daily at 3 AM
0 3 * * * redis-cli --scan --pattern "price:*" | xargs redis-cli DEL
```

## Next Steps

1. ✅ Redis installed and running
2. ✅ Environment configured
3. ✅ Connection verified
4. 🔄 Run example script
5. 🔄 Test with your application
6. 🔄 Monitor performance
7. 🔄 Set up production Redis

## Support

- Redis Documentation: https://redis.io/docs/
- ioredis Documentation: https://github.com/redis/ioredis
- Project Issues: [GitHub Issues](https://github.com/gear5labs/chenpilot/issues)

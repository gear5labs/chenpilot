# Redis-Backed Price Cache

This module implements a Redis-backed caching layer for Stellar asset prices, reducing latency for pricing-related operations.

## Architecture

### Components

1. **PriceCacheService** (`priceCache.service.ts`)
   - Low-level Redis cache operations
   - Key-value storage with TTL support
   - Batch operations for multiple prices
   - Cache statistics and health monitoring

2. **StellarPriceService** (`stellarPrice.service.ts`)
   - High-level price fetching from Stellar DEX
   - Automatic cache integration
   - Path-finding for optimal swap routes
   - Orderbook depth analysis

3. **HorizonOperationStreamerService** (`horizonOperationStreamer.service.ts`)
   - Streams Stellar Horizon operations in real time
   - Detects large transfer/payment operations above a configured threshold
   - Emits backend alert callbacks for downstream processing

4. **PriceTool** (`../Agents/tools/price.ts`)
   - Agent-facing tool for price queries
   - Multiple operations: single price, batch prices, orderbook, stats
   - User-friendly interface for AI agents

## Features

### Caching Strategy

- **Default TTL**: 60 seconds (configurable)
- **Cache Key Format**: `price:{FROM_ASSET}:{TO_ASSET}`
- **Case-Insensitive**: Asset symbols normalized to uppercase
- **Automatic Expiration**: Redis handles TTL automatically

### Performance Benefits

- **Reduced Latency**: Cached prices return in <5ms vs 200-500ms for DEX queries
- **Lower API Load**: Reduces calls to Stellar Horizon API
- **Batch Operations**: Efficient multi-get for multiple price pairs
- **Connection Pooling**: Persistent Redis connection with retry logic

### Supported Assets

- XLM (Stellar Lumens)
- USDC (Circle USD Coin)
- USDT (Tether USD)

## Configuration

### Environment Variables

Add to `.env.local`:

```env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# Horizon operation alert streamer
STELLAR_ALERT_STREAM_ENABLED=true
STELLAR_ALERT_MIN_AMOUNT=1000
STELLAR_ALERT_STREAM_RECONNECT_MS=5000
```

## Horizon Operation Stream Alerts

The backend starts a Horizon operation stream on server boot and emits alerts when
large operations are detected.

### Alert Trigger Rules

- `payment`: compares `amount`
- `create_account`: compares `starting_balance`
- `path_payment_strict_send`: compares `source_amount`
- `path_payment_strict_receive`: compares `destination_amount`

If the amount is `>= STELLAR_ALERT_MIN_AMOUNT`, a large-operation alert is emitted.

### Runtime Behavior

- Stream starts with cursor `now` to avoid replaying historical operations
- Uses automatic reconnect when stream errors occur
- Logs each detected alert with operation metadata

### Redis Setup

#### Local Development (Docker)

```bash
docker run -d --name redis-cache -p 6379:6379 redis:7-alpine
```

#### Production

Use a managed Redis service:

- AWS ElastiCache
- Redis Cloud
- Azure Cache for Redis
- Google Cloud Memorystore

## Usage

### Direct Service Usage

```typescript
import stellarPriceService from "./services/stellarPrice.service";

// Get single price
const quote = await stellarPriceService.getPrice("XLM", "USDC", 100);
console.log(`Price: ${quote.price}, Cached: ${quote.cached}`);

// Get multiple prices
const quotes = await stellarPriceService.getPrices([
  { from: "XLM", to: "USDC", amount: 100 },
  { from: "USDC", to: "USDT", amount: 50 },
]);

// Get orderbook depth
const orderbook = await stellarPriceService.getOrderbookDepth("XLM", "USDC");
console.log(`Best bid: ${orderbook.bids[0].price}`);
```

### Agent Tool Usage

The PriceTool is automatically available to AI agents:

```typescript
// Agent query examples:
"What's the current price of XLM in USDC?";
"Get price for 100 XLM to USDT";
"Show me the orderbook for XLM/USDC";
"Get cache statistics";
```

### Integration with Swap Tool

The SwapTool automatically uses cached prices:

```typescript
import { swapTool } from "./Agents/tools/swap";

// Swap operation will check cache first
const result = await swapTool.execute(
  {
    from: "XLM",
    to: "USDC",
    amount: 100,
  },
  userId
);
```

## API Reference

### PriceCacheService

#### `getPrice(fromAsset: string, toAsset: string): Promise<PriceData | null>`

Retrieve cached price for asset pair.

#### `setPrice(fromAsset: string, toAsset: string, price: number, source: string, ttl?: number): Promise<void>`

Cache a price with optional TTL.

#### `getPrices(pairs: Array<{from: string, to: string}>): Promise<Map<string, PriceData | null>>`

Batch retrieve multiple prices.

#### `invalidatePrice(fromAsset: string, toAsset: string): Promise<void>`

Remove cached price.

#### `clearAll(): Promise<void>`

Clear all cached prices.

#### `getStats(): Promise<{totalKeys: number, memoryUsage: string}>`

Get cache statistics.

#### `healthCheck(): Promise<boolean>`

Check Redis connection health.

### StellarPriceService

#### `getPrice(fromAsset: string, toAsset: string, amount?: number): Promise<PriceQuote>`

Get price quote with automatic caching.

#### `getPrices(pairs: Array<{from: string, to: string, amount?: number}>): Promise<PriceQuote[]>`

Get multiple price quotes.

#### `getOrderbookDepth(fromAsset: string, toAsset: string, limit?: number): Promise<Orderbook>`

Get orderbook bids and asks.

#### `invalidatePrice(fromAsset: string, toAsset: string): Promise<void>`

Invalidate cached price.

## Monitoring

### Cache Statistics

```typescript
import priceCacheService from "./services/priceCache.service";

const stats = await priceCacheService.getStats();
console.log(`Total cached prices: ${stats.totalKeys}`);
console.log(`Memory usage: ${stats.memoryUsage}`);

const healthy = await priceCacheService.healthCheck();
console.log(`Redis status: ${healthy ? "connected" : "disconnected"}`);
```

### Logging

The services use Winston logger for monitoring:

- Cache hits/misses
- Price fetches from DEX
- Redis connection events
- Error tracking

## Testing

Run tests:

```bash
npm test tests/unit/price_cache.test.ts
npm test tests/unit/stellar_price.test.ts
```

## Performance Metrics

### Latency Comparison

- **Cached Price**: ~2-5ms
- **DEX Query**: ~200-500ms
- **Improvement**: 40-100x faster

### Cache Hit Rates

- Expected: 70-90% for active trading pairs
- Depends on TTL and query patterns

## Error Handling

### Redis Connection Failures

- Automatic retry with exponential backoff
- Graceful degradation (falls back to direct DEX queries)
- Connection health monitoring

### Price Fetch Errors

- Detailed error messages for liquidity issues
- Trustline validation
- Balance checks

## Future Enhancements

1. **Multiple Price Sources**
   - CoinGecko API integration
   - CoinMarketCap integration
   - Price aggregation from multiple sources

2. **Advanced Caching**
   - Predictive cache warming
   - Cache hit rate tracking
   - Dynamic TTL based on volatility

3. **Price Alerts**
   - WebSocket price updates
   - Threshold-based notifications
   - Historical price tracking

4. **Analytics**
   - Price history storage
   - Volatility calculations
   - Volume-weighted average price (VWAP)

## Troubleshooting

### Redis Connection Issues

```bash
# Check Redis is running
docker ps | grep redis

# Test connection
redis-cli ping

# Check logs
docker logs redis-cache
```

### Cache Not Working

1. Verify Redis configuration in `.env.local`
2. Check Redis connection in logs
3. Test health check endpoint
4. Verify TTL settings

### Price Fetch Failures

1. Check Stellar network status
2. Verify asset codes and issuers
3. Check liquidity for asset pair
4. Review Horizon API rate limits

## License

MIT

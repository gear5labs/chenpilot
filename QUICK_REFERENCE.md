# Quick Reference: Quote Fees and Lifetime Display

## What Changed?

The swap tool now shows users **fees** and **quote expiration time** before they confirm a swap.

## User Sees Before Confirmation

```
Swap: 100 XLM → USDC
Expected Output: 12.34 USDC
Price: 0.1234 XLM/USDC

→ Quote Expires In: 25 seconds (expires at 2024-11-19T10:30:00.000Z)
→ Network Fee: 0.00001 XLM
```

## For Developers

### New Result Fields

```typescript
{
  quoteLifetime: {
    deadline: 1732000000,              // Unix seconds
    expiresAt: "2024-11-19...",        // ISO 8601
    secondsRemaining: 25               // Human-readable
  },
  materialFees: {
    network: "0.00001 XLM",            // Always BASE_FEE
    total: "0.00001 XLM"               // Always BASE_FEE
  }
}
```

### Implementation Locations

| File | Change |
|------|--------|
| `src/Agents/tools/swap.ts` | Added `stroopsToXlm()` method, two new result fields |
| `tests/unit/swapQuoteDisplay.test.ts` | 17 unit tests for fees and lifetime |
| `tests/unit/swapQuotePreConfirmation.test.ts` | 20 integration tests |
| `src/Agents/tools/SWAP_QUOTE_DISPLAY.md` | Complete documentation |

### How to Display in Chat

The result includes everything needed:

```typescript
const result = await swapTool.execute(payload, userId);
// result.data.quoteLifetime.expiresAt
// result.data.quoteLifetime.secondsRemaining
// result.data.materialFees.network
// result.data.materialFees.total
```

### Key Numbers

| Metric | Value |
|--------|-------|
| Minimum quote TTL | 1 second |
| Default quote TTL | 30 seconds |
| Multi-hop TTL | 120 seconds |
| Network fee | 100 stroops = 0.00001 XLM |
| XLM decimals | 7 |

### Code References

**Fee Conversion**:
```typescript
const stroopsToXlm = (stroops: number) => stroops / 10_000_000;
// 100 stroops → 0.00001 XLM
```

**Deadline Calculation**:
```typescript
const deadline = Math.floor(Date.now() / 1000) + 30;
const secondsRemaining = Math.max(0, deadline - Math.floor(Date.now() / 1000));
```

**ISO 8601 Format**:
```typescript
new Date(deadline * 1000).toISOString()
// "2024-11-19T10:30:00.000Z"
```

## Testing

Run the new tests:
```bash
npm test -- swapQuoteDisplay.test.ts --run
npm test -- swapQuotePreConfirmation.test.ts --run
```

## Backward Compatibility

✓ Fully backward compatible
- Existing clients continue to work
- New fields are additive
- No breaking changes

## Security

✓ Fail-closed gates
- Expired quotes rejected before submission
- Drifted quotes detected before execution
- User must approve fresh quote if conditions change

## Next Steps

**To integrate into chat UI:**
1. Read `quoteLifetime` and `materialFees` from result
2. Display both before showing confirmation button
3. Allow user to cancel or confirm with full knowledge of fees/deadline
4. On confirmation, send `approvedDigest` with request

**Example:**
```
User sees: "Fees: 0.00001 XLM | Expires in: 25 seconds"
User clicks: "Approve & Execute"
System sends: { approvedDigest, deadline, ... }
```

## Documentation

- **Full docs**: `src/Agents/tools/SWAP_QUOTE_DISPLAY.md`
- **Implementation**: `SWAP_FEES_DISPLAY_SUMMARY.md`
- **Checklist**: `IMPLEMENTATION_CHECKLIST.md`

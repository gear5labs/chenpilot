# Swap Tool — Quote Lifetime and Material Fees Display

## Problem
Users should see quote lifetime and material fees **before** confirming a swap transaction in chat. This ensures informed consent and prevents unintended execution of swaps with expired quotes or unexpected costs.

## Solution
The `SwapTool.execute()` now includes two new fields in the success result that are displayed to users before confirmation:

### New Fields in Result

#### 1. `quoteLifetime`
Displays the validity window of the quote with multiple perspectives:

```typescript
quoteLifetime: {
  deadline: 1732000000,                           // Unix-epoch seconds
  expiresAt: "2024-11-19T10:30:00.000Z",         // ISO 8601 datetime
  secondsRemaining: 25                            // Human-readable countdown
}
```

**Usage**: Users can see when their quote expires and how much time remains before they must confirm or request a fresh quote.

#### 2. `materialFees`
Displays transaction fees in user-friendly format:

```typescript
materialFees: {
  network: "0.00001 XLM",    // Stellar BASE_FEE (100 stroops)
  total: "0.00001 XLM"       // Total fees for this swap
}
```

**Usage**: Users can see the exact cost before confirming the transaction.

## Implementation Details

### Fee Calculation
- **Network fee**: Always `StellarSdk.BASE_FEE` (100 stroops = 0.00001 XLM)
- **Conversion**: Stroops → XLM using `stroopsToXlm()` helper (1 XLM = 10,000,000 stroops)
- **Formatting**: Uses `formatAmount()` utility with 7 decimal places (XLM precision)

### Lifetime Calculation
- **Deadline**: Set at quote generation time + DEFAULT_QUOTE_TTL_SEC (30 seconds)
- **Remaining time**: Calculated from current time to deadline, with floor at 0
- **ISO format**: Generated from deadline timestamp for compatibility with ISO 8601 parsers

### Code Changes
```typescript
// In SwapTool.executeWithLock(), after quote generation:
const quoteDeadline = payload.deadline ?? 
  Math.floor(Date.now() / 1000) + this.DEFAULT_QUOTE_TTL_SEC;

// In success result:
return this.createSuccessResult("swap", {
  // ... existing fields ...
  quoteLifetime: {
    deadline: quoteDeadline,
    expiresAt: new Date(quoteDeadline * 1000).toISOString(),
    secondsRemaining: Math.max(0, quoteDeadline - Math.floor(Date.now() / 1000)),
  },
  materialFees: {
    network: formatAmount(this.stroopsToXlm(StellarSdk.BASE_FEE), 
      { currencyCode: "XLM", maxDecimals: 7 }),
    total: formatAmount(this.stroopsToXlm(StellarSdk.BASE_FEE), 
      { currencyCode: "XLM", maxDecimals: 7 }),
  },
});
```

## Supported Behavior

### Success Path
1. User requests swap in chat
2. Tool generates quote with deadline
3. **User sees**: amount, fees, quote lifetime, risk analysis
4. User confirms swap
5. Transaction executes with approved digest
6. Result includes successful execution details

### Failure Cases

#### Quote Expired
- User takes >30 seconds to confirm
- `validateQuoteCommitment()` throws `QuoteExpiredError`
- Recommendation: Request fresh quote with new deadline

#### Quote Drifted
- Market prices change between quote and execution
- `validateQuoteCommitment()` throws `QuoteDriftError`
- Recommendation: User approves fresh quote

#### High Risk
- Flash loan attack or sandwich attack risk detected
- Swap blocked with risk analysis details
- User can adjust amount or wait for liquidity conditions to improve

## Compatibility

### Backward Compatibility
- **Fully compatible**: Existing tools and APIs unaffected
- New fields are **additive** to the success result
- Clients that ignore these fields continue to work
- Clients that show these fields provide better UX

### Supported Quote TTLs
- **Default (DEX swaps)**: 30 seconds
- **Multi-hop routes**: 120 seconds
- **Custom**: Caller can override via `payload.deadline`

## Testing

### Unit Tests
- **Quote Lifetime**: Deadline calculation, ISO format, secondsRemaining
- **Material Fees**: Stroop-to-XLM conversion, formatting, precision
- **Acceptance Criteria**: Both fields present and formatted correctly

### Integration Tests
- Pre-confirmation display requirements
- Fee transparency
- Lifetime transparency
- User confirmation flow
- Failure cases and boundary conditions

**Run tests**:
```bash
npm test -- swapQuoteDisplay.test.ts --run
npm test -- swapQuotePreConfirmation.test.ts --run
```

## Security Considerations

### Fail-Closed Gates
- Quote validation happens **immediately before submission**
- Expired or drifted quotes are rejected before on-chain execution
- User must approve a fresh quote if conditions change

### No Silent Failures
- Fees are always shown (never hidden or rounded away)
- Deadlines are always absolute and transparent
- Risk analysis is always included with fees

### User Consent
- Fees and lifetime are shown before approval
- User explicitly confirms understanding of fees
- Digest includes fee commitment for cryptographic verification

## Operational Notes

### Fee Consistency
- Fees remain constant regardless of swap amount (network fee is per-transaction)
- Fees may increase if network congestion causes fee-bump
- Future DEX fees (not network fees) would be shown here

### Deadline Precision
- All times use Unix-epoch seconds (integer, not milliseconds)
- ISO 8601 timestamps use UTC (Z suffix)
- Client should refresh quote if secondsRemaining < 5

### Integration with Approval
The approval flow now incorporates fee awareness:
1. **Simulation phase**: Quote generated with deadline
2. **Presentation phase**: Fees and lifetime shown to user
3. **Approval phase**: User explicitly confirms fees and deadline
4. **Execution phase**: Fresh quote validation ensures terms haven't drifted
5. **Finalization phase**: User sees final receipt with actual fees

## References

- **Quote Commitment**: `src/domain/quotes/quoteCommitment.ts`
- **Quote Validation**: `validateQuoteCommitment()` in quoteCommitment.ts
- **Formatting**: `src/utils/SecuritySensitiveFormatter.ts`
- **Tool Result**: `src/Agents/registry/ToolMetadata.ts` (ToolResult interface)

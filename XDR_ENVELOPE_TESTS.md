# XDR Envelope Builder Tests - Implementation Guide

## Overview

Comprehensive test suite for verifying backend XDR envelope building for complex multi-operation Stellar transactions.

## Test File Location

`tests/unit/xdr_envelope_builder.test.ts`

## Test Coverage

### 1. Multi-Operation Transaction Building
- **Multiple Payment Operations**: Verifies XDR envelope generation with 3+ payment operations
- **Mixed Operation Types**: Tests payment, changeTrust, and other operation combinations
- **Path Payment Operations**: Tests both pathPaymentStrictSend and pathPaymentStrictReceive

### 2. XDR Envelope Signature Handling
- **Single Signature**: Validates single signer XDR envelope
- **Multiple Signatures**: Tests multi-sig scenarios with 3+ signers
- **Signature Preservation**: Ensures signatures survive XDR serialization/deserialization

### 3. XDR Envelope with Memos
- **Text Memo**: Tests text memo encoding in XDR
- **Hash Memo**: Tests 32-byte hash memo encoding
- **ID Memo**: Tests numeric ID memo encoding

### 4. Complex Multi-Operation Scenarios
- **Account Creation Flow**: createAccount + changeTrust + payment (3 operations)
- **Atomic Swap**: Bidirectional payment operations between two parties
- **Liquidity Pool Operations**: changeTrust + liquidityPoolDeposit
- **Account Management**: Multiple setOptions operations for signers and thresholds
- **Offer Management**: manageSellOffer + manageBuyOffer + createPassiveSellOffer

### 5. XDR Envelope Fee and Timeout Handling
- **Custom Fee**: Tests non-default fee settings
- **Custom Timeout**: Tests various timeout configurations
- **Proportional Fees**: Validates fee calculation for multiple operations

### 6. XDR Envelope Validation
- **Decode/Re-encode**: Ensures XDR round-trip consistency
- **Hash Consistency**: Validates transaction hash stability
- **Maximum Operations**: Tests 100-operation transaction (Stellar limit)

### 7. XDR Envelope with Claimable Balances
- **Claimable Balance Creation**: Tests createClaimableBalance with multiple claimants
- **Predicate Handling**: Tests time-based claim predicates

### 8. XDR Envelope Network Compatibility
- **Testnet**: Validates testnet network passphrase
- **Mainnet**: Validates mainnet network passphrase

## Running the Tests

### Prerequisites
```bash
npm install
```

### Run All XDR Tests
```bash
npm test -- tests/unit/xdr_envelope_builder.test.ts
```

### Run with Coverage
```bash
npm test -- tests/unit/xdr_envelope_builder.test.ts --coverage
```

### Run Specific Test Suite
```bash
npm test -- tests/unit/xdr_envelope_builder.test.ts -t "Multi-Operation Transaction Building"
```

## Test Architecture

### Key Components Tested
1. **TransactionBuilder**: Core Stellar SDK transaction builder
2. **Operation Types**: All major Stellar operation types
3. **XDR Serialization**: toXDR() method validation
4. **XDR Deserialization**: Transaction reconstruction from XDR
5. **Signature Management**: Multi-sig coordination
6. **Network Passphrases**: Testnet and mainnet compatibility

### Test Patterns
- Each test creates fresh keypairs to avoid state pollution
- Tests verify both XDR generation and reconstruction
- Operation counts and types are explicitly validated
- Signature counts are verified for multi-sig scenarios

## Integration with Existing Codebase

### Related Services
- `src/services/multisigCoordinationService.ts` - Multi-sig XDR handling
- `src/Agents/tools/swap.ts` - Single operation transaction building
- `src/services/sorobanService.ts` - Soroban contract transactions

### Mock Dependencies
- Uses real Stellar SDK (not mocked) for authentic XDR generation
- Mocks TypeORM DataSource to avoid database connections
- Follows existing test patterns from `tests/stellar.mock.ts`

## Expected Test Results

All tests should pass with:
- ✓ 30+ test cases
- 100% coverage of XDR envelope building scenarios
- Validation of complex multi-operation transactions
- Network compatibility verification

## Key Validations

### XDR Envelope Structure
```typescript
const xdr = transaction.toXDR();
expect(xdr).toBeDefined();
expect(typeof xdr).toBe("string");
expect(xdr.length).toBeGreaterThan(0);
```

### Transaction Reconstruction
```typescript
const reconstructed = new StellarSdk.Transaction(xdr, networkPassphrase);
expect(reconstructed.source).toBe(sourceKeypair.publicKey());
expect(reconstructed.operations).toHaveLength(expectedCount);
```

### Signature Verification
```typescript
expect(reconstructed.signatures).toHaveLength(expectedSignerCount);
```

## Troubleshooting

### Common Issues

1. **Missing Dependencies**
   ```bash
   npm install @stellar/stellar-sdk@^14.4.3
   ```

2. **TypeORM Mock Errors**
   - Ensure DataSource mock is at top of test file
   - Check jest.config.js setupFilesAfterEnv

3. **Network Passphrase Errors**
   - Use StellarSdk.Networks.TESTNET or StellarSdk.Networks.PUBLIC
   - Ensure consistency between build and reconstruction

## Future Enhancements

- Add tests for Soroban contract invocation XDR
- Add tests for sponsored operations
- Add tests for fee bump transactions
- Add performance benchmarks for large transactions
- Add tests for transaction envelope v1 vs v0

## References

- [Stellar SDK Documentation](https://stellar.github.io/js-stellar-sdk/)
- [XDR Specification](https://developers.stellar.org/docs/encyclopedia/xdr)
- [Transaction Guide](https://developers.stellar.org/docs/encyclopedia/transactions)

# Quick Start: Running XDR Envelope Tests

## Installation

If you haven't installed dependencies yet:

```bash
npm install
```

## Run the XDR Envelope Tests

**IMPORTANT**: These tests require the REAL Stellar SDK (not mocked). The global jest setup mocks Stellar SDK for other tests, which causes conflicts.

### Option 1: Run with custom jest config (recommended)
```bash
npx jest tests/unit/xdr_envelope_builder.test.ts --no-coverage --setupFilesAfterEnv ./tests/setup.ts
```

### Option 2: Temporarily disable stellar mock
Comment out the stellar.mock.ts line in jest.config.js, run tests, then uncomment it.

### Option 2: Run with verbose output
```bash
npm test -- tests/unit/xdr_envelope_builder.test.ts --verbose
```

### Option 3: Run with coverage report
```bash
npm test -- tests/unit/xdr_envelope_builder.test.ts --coverage
```

### Option 4: Run in watch mode (for development)
```bash
npm run test:watch -- tests/unit/xdr_envelope_builder.test.ts
```

## Expected Output

You should see approximately 30+ passing tests organized into these suites:

```
XDR Envelope Builder - Complex Multi-Operation Transactions
  ✓ Multi-Operation Transaction Building (8 tests)
  ✓ XDR Envelope Signature Handling (2 tests)
  ✓ XDR Envelope with Memos (3 tests)
  ✓ Complex Multi-Operation Scenarios (5 tests)
  ✓ XDR Envelope Fee and Timeout Handling (3 tests)
  ✓ XDR Envelope Validation (3 tests)
  ✓ XDR Envelope with Claimable Balances (1 test)
  ✓ XDR Envelope Network Compatibility (2 tests)

Test Suites: 1 passed, 1 total
Tests:       30+ passed, 30+ total
```

## What These Tests Verify

### 1. XDR Generation
- Transactions can be serialized to XDR format
- XDR strings are valid and non-empty
- Multiple operations are properly encoded

### 2. XDR Reconstruction
- XDR can be decoded back to Transaction objects
- All transaction properties are preserved
- Operation order and types are maintained

### 3. Multi-Operation Support
- Up to 100 operations per transaction
- Mixed operation types in single transaction
- Complex workflows (account creation, swaps, liquidity pools)

### 4. Signature Handling
- Single and multi-signature support
- Signatures survive serialization
- Multi-sig coordination works correctly

### 5. Network Compatibility
- Testnet transactions work correctly
- Mainnet transactions work correctly
- Network passphrases are properly encoded

## Troubleshooting

### Error: "Cannot find module '@stellar/stellar-sdk'"
```bash
npm install @stellar/stellar-sdk@^14.4.3
```

### Error: "Preset ts-jest not found"
```bash
npm install --save-dev ts-jest @types/jest
```

### Error: "jest is not recognized"
Make sure you're using npm scripts:
```bash
npm test  # NOT: jest
```

### Tests timeout
Increase timeout in jest.config.js:
```javascript
testTimeout: 60000  // 60 seconds
```

## Test File Location

The test file is located at:
```
tests/unit/xdr_envelope_builder.test.ts
```

## Integration with CI/CD

Add to your CI pipeline:

```yaml
# .github/workflows/test.yml
- name: Run XDR Envelope Tests
  run: npm test -- tests/unit/xdr_envelope_builder.test.ts --ci
```

## Next Steps

After running these tests successfully:

1. Review the test output to ensure all scenarios pass
2. Check coverage report to identify any gaps
3. Integrate with your existing test suite
4. Add to CI/CD pipeline for continuous validation
5. Consider adding more edge cases based on your specific use cases

## Support

For issues or questions:
- Check XDR_ENVELOPE_TESTS.md for detailed documentation
- Review existing test patterns in tests/unit/
- Consult Stellar SDK documentation: https://stellar.github.io/js-stellar-sdk/

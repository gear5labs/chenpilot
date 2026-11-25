# Recipient Allowlist Policy

The `RecipientAllowlistPolicy` class enforces that a payment's recipient is present in a user's saved allowlist immediately before execution.

## Usage

```ts
import { RecipientAllowlistPolicy } from "./recipientAllowlistPolicy";

const policy = new RecipientAllowlistPolicy(provider);
await policy.enforce(userId, paymentExecution);
```

## Failure Cases
- Missing recipient in payment execution requirement.
- Recipient address not found in the configured allowlist provider.

# Audit Log Quick Start Guide

## Installation

1. Run the migration:

```bash
npm run migration:run
```

2. Import in your code:

```typescript
import { auditLogService } from "./AuditLog/auditLog.service";
import { AuditAction, AuditSeverity } from "./AuditLog/auditLog.entity";
```

## Common Use Cases

### 1. Log User Action

```typescript
await auditLogService.log({
  userId: user.id,
  action: AuditAction.TRADE_CONFIRMED,
  severity: AuditSeverity.INFO,
  metadata: { tradeId: "123", amount: 100 },
});
```

### 2. Log from Express Route

```typescript
router.post("/action", async (req, res) => {
  await auditLogService.logFromRequest(req, AuditAction.TRADE_INITIATED, {
    severity: AuditSeverity.INFO,
    metadata: {
      /* your data */
    },
  });
});
```

### 3. Log Failed Action

```typescript
try {
  await performAction();
} catch (error) {
  await auditLogService.log({
    userId: user.id,
    action: AuditAction.TRADE_FAILED,
    severity: AuditSeverity.ERROR,
    success: false,
    errorMessage: error.message,
  });
}
```

### 4. Use Middleware

```typescript
import { auditLogMiddleware } from "./AuditLog/auditLog.middleware";

router.post(
  "/trade",
  authenticateToken,
  auditLogMiddleware(AuditAction.TRADE_INITIATED),
  tradeHandler
);
```

### 5. Query Logs

```typescript
// Get user's logs
const { logs, total } = await auditLogService.getUserAuditLogs(userId, 50, 0);

// Get failed auth attempts
const failed = await auditLogService.getFailedAuthAttempts(userId, 24);

// Get security events
const events = await auditLogService.getSecurityEvents(24, 100);
```

## Available Actions

### Authentication

- `LOGIN_SUCCESS`, `LOGIN_FAILED`, `LOGOUT`
- `TOKEN_REFRESH`
- `PASSWORD_RESET_REQUEST`, `PASSWORD_RESET_SUCCESS`
- `EMAIL_VERIFICATION_SENT`, `EMAIL_VERIFICATION_SUCCESS`

### User Management

- `USER_CREATED`, `USER_UPDATED`, `USER_DELETED`

### Trading

- `TRADE_INITIATED`, `TRADE_CONFIRMED`, `TRADE_FAILED`
- `SWAP_EXECUTED`
- `TRANSFER_INITIATED`, `TRANSFER_COMPLETED`

### Wallet

- `WALLET_FUNDED`, `WALLET_DEPLOYED`

### Security

- `UNAUTHORIZED_ACCESS`, `PERMISSION_DENIED`, `SUSPICIOUS_ACTIVITY`

### Data

- `DATA_EXPORT`, `SENSITIVE_DATA_ACCESS`

## Severity Levels

- `INFO` - Normal operations
- `WARNING` - Potential issues
- `ERROR` - Errors
- `CRITICAL` - Critical security events

## API Endpoints

```bash
# Get all logs (admin)
GET /api/audit/logs?action=login_failed&limit=50

# Get user logs
GET /api/audit/user/:userId?limit=20

# Get security events (admin)
GET /api/audit/security-events?hours=24

# Get failed auth (admin)
GET /api/audit/failed-auth?userId=xxx&hours=24
```

## Best Practices

1. ✅ Always log security-critical actions
2. ✅ Use appropriate severity levels
3. ✅ Include relevant metadata
4. ✅ Don't log sensitive data (passwords, tokens)
5. ✅ Use async logging (don't block)
6. ✅ Set up log retention policies
7. ✅ Monitor critical events

## Example: Complete Trade Flow

```typescript
router.post("/trade", authenticateToken, async (req, res) => {
  const { amount, asset } = req.body;

  // Log initiation
  await auditLogService.logFromRequest(req, AuditAction.TRADE_INITIATED, {
    userId: req.user.userId,
    metadata: { amount, asset },
  });

  try {
    const trade = await tradeService.execute(amount, asset);

    // Log success
    await auditLogService.logFromRequest(req, AuditAction.TRADE_CONFIRMED, {
      userId: req.user.userId,
      metadata: { tradeId: trade.id, amount, asset },
    });

    return res.json({ success: true, trade });
  } catch (error) {
    // Log failure
    await auditLogService.logFromRequest(req, AuditAction.TRADE_FAILED, {
      userId: req.user.userId,
      severity: AuditSeverity.ERROR,
      success: false,
      errorMessage: error.message,
      metadata: { amount, asset },
    });

    return res.status(500).json({ success: false, message: error.message });
  }
});
```

## Need Help?

See full documentation: `src/AuditLog/README.md`

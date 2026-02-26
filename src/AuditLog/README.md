# Audit Log System

A comprehensive audit logging system for tracking critical user actions and security events.

## Overview

The audit logging system provides:

- Automatic logging of authentication events (login, logout, password reset)
- Trade and transaction confirmation logging
- Security event tracking
- User activity monitoring
- Queryable audit trail with filtering and pagination

## Features

### Tracked Actions

#### Authentication

- `LOGIN_SUCCESS` - Successful user login
- `LOGIN_FAILED` - Failed login attempt
- `LOGOUT` - User logout
- `TOKEN_REFRESH` - JWT token refresh
- `PASSWORD_RESET_REQUEST` - Password reset initiated
- `PASSWORD_RESET_SUCCESS` - Password successfully reset
- `PASSWORD_RESET_FAILED` - Failed password reset
- `EMAIL_VERIFICATION_SENT` - Email verification sent
- `EMAIL_VERIFICATION_SUCCESS` - Email verified

#### User Management

- `USER_CREATED` - New user registration
- `USER_UPDATED` - User profile updated
- `USER_DELETED` - User account deleted

#### Trading/Transactions

- `TRADE_INITIATED` - Trade started
- `TRADE_CONFIRMED` - Trade confirmed
- `TRADE_FAILED` - Trade failed
- `SWAP_EXECUTED` - Token swap executed
- `TRANSFER_INITIATED` - Transfer started
- `TRANSFER_COMPLETED` - Transfer completed

#### Wallet

- `WALLET_FUNDED` - Wallet received funds
- `WALLET_DEPLOYED` - Wallet deployed

#### Security

- `UNAUTHORIZED_ACCESS` - Unauthorized access attempt
- `PERMISSION_DENIED` - Permission denied
- `SUSPICIOUS_ACTIVITY` - Suspicious activity detected

#### Data Access

- `DATA_EXPORT` - Data exported
- `SENSITIVE_DATA_ACCESS` - Sensitive data accessed

### Severity Levels

- `INFO` - Normal operations
- `WARNING` - Potential issues (e.g., failed login)
- `ERROR` - Errors that occurred
- `CRITICAL` - Critical security events

## Usage

### Basic Logging

```typescript
import { auditLogService } from "../AuditLog/auditLog.service";
import { AuditAction, AuditSeverity } from "../AuditLog/auditLog.entity";

// Log a simple action
await auditLogService.log({
  userId: "user-id",
  action: AuditAction.LOGIN_SUCCESS,
  severity: AuditSeverity.INFO,
  metadata: { username: "john_doe" },
});
```

### Logging from Express Request

```typescript
// Automatically extracts IP, user agent, and user ID from request
await auditLogService.logFromRequest(req, AuditAction.TRADE_CONFIRMED, {
  severity: AuditSeverity.INFO,
  metadata: {
    tradeId: "trade-123",
    amount: 100,
    asset: "XLM",
  },
});
```

### Using Middleware

```typescript
import { auditLogMiddleware } from "../AuditLog/auditLog.middleware";

// Automatically log all requests to this endpoint
router.post(
  "/trade",
  authenticateToken,
  auditLogMiddleware(AuditAction.TRADE_INITIATED),
  async (req, res) => {
    // Your handler
  }
);
```

### Querying Audit Logs

```typescript
// Get user's audit logs
const { logs, total } = await auditLogService.getUserAuditLogs(
  userId,
  50, // limit
  0 // offset
);

// Get failed auth attempts
const failedAttempts = await auditLogService.getFailedAuthAttempts(
  userId,
  24 // hours
);

// Get security events
const securityEvents = await auditLogService.getSecurityEvents(
  24, // hours
  100 // limit
);

// Custom query
const { logs, total } = await auditLogService.query({
  userId: "user-id",
  action: AuditAction.LOGIN_FAILED,
  severity: AuditSeverity.WARNING,
  startDate: new Date("2024-01-01"),
  endDate: new Date("2024-12-31"),
  success: false,
  limit: 50,
  offset: 0,
});
```

## API Endpoints

### GET /api/audit/logs

Get audit logs (admin only)

**Query Parameters:**

- `userId` - Filter by user ID
- `action` - Filter by action type
- `severity` - Filter by severity (info, warning, error, critical)
- `startDate` - Start date filter (ISO 8601)
- `endDate` - End date filter (ISO 8601)
- `success` - Filter by success status (true/false)
- `limit` - Number of logs to return (default: 50)
- `offset` - Offset for pagination (default: 0)

**Example:**

```bash
GET /api/audit/logs?action=login_failed&severity=warning&limit=100
```

### GET /api/audit/user/:userId

Get audit logs for a specific user

**Parameters:**

- `userId` - User ID (path parameter)

**Query Parameters:**

- `limit` - Number of logs to return (default: 50)
- `offset` - Offset for pagination (default: 0)

**Authorization:** User can access their own logs, admins can access any user's logs

**Example:**

```bash
GET /api/audit/user/123e4567-e89b-12d3-a456-426614174000?limit=20
```

### GET /api/audit/security-events

Get recent security events (admin only)

**Query Parameters:**

- `hours` - Number of hours to look back (default: 24)
- `limit` - Maximum number of events (default: 100)

**Example:**

```bash
GET /api/audit/security-events?hours=48&limit=50
```

### GET /api/audit/failed-auth

Get failed authentication attempts (admin only)

**Query Parameters:**

- `userId` - Filter by user ID (optional)
- `hours` - Number of hours to look back (default: 24)

**Example:**

```bash
GET /api/audit/failed-auth?hours=24
```

## Database Schema

The `audit_log` table includes:

- `id` - UUID primary key
- `userId` - User ID (nullable, indexed)
- `action` - Action type (indexed)
- `severity` - Severity level (indexed)
- `ipAddress` - IP address of the request
- `userAgent` - User agent string
- `resource` - Resource accessed (e.g., endpoint path)
- `metadata` - JSONB field for additional context
- `errorMessage` - Error message if applicable
- `success` - Boolean indicating success/failure
- `createdAt` - Timestamp (indexed)

### Indexes

For optimal query performance:

- `(userId, createdAt)` - User activity queries
- `(action, createdAt)` - Action-based queries
- `(severity, createdAt)` - Security event queries
- `createdAt` - Time-based queries
- `userId` - User lookups

## Integration Examples

### Login Handler

```typescript
router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  const user = await userService.authenticate(username, password);

  if (!user) {
    // Log failed attempt
    await auditLogService.logFromRequest(req, AuditAction.LOGIN_FAILED, {
      severity: AuditSeverity.WARNING,
      success: false,
      metadata: { username, reason: "Invalid credentials" },
    });

    return res.status(401).json({ message: "Invalid credentials" });
  }

  // Log successful login
  await auditLogService.logFromRequest(req, AuditAction.LOGIN_SUCCESS, {
    userId: user.id,
    severity: AuditSeverity.INFO,
    metadata: { username, role: user.role },
  });

  // Generate tokens and respond
});
```

### Trade Confirmation

```typescript
router.post("/trade/confirm", authenticateToken, async (req, res) => {
  const { tradeId } = req.body;

  try {
    const trade = await tradeService.confirmTrade(tradeId);

    // Log successful trade confirmation
    await auditLogService.logFromRequest(req, AuditAction.TRADE_CONFIRMED, {
      userId: req.user.userId,
      severity: AuditSeverity.INFO,
      metadata: {
        tradeId,
        amount: trade.amount,
        asset: trade.asset,
        price: trade.price,
      },
    });

    return res.json({ success: true, trade });
  } catch (error) {
    // Log failed trade
    await auditLogService.logFromRequest(req, AuditAction.TRADE_FAILED, {
      userId: req.user.userId,
      severity: AuditSeverity.ERROR,
      success: false,
      errorMessage: error.message,
      metadata: { tradeId },
    });

    throw error;
  }
});
```

## Maintenance

### Log Retention

Delete old logs to manage database size:

```typescript
// Delete logs older than 90 days
const deletedCount = await auditLogService.deleteOldLogs(90);
console.log(`Deleted ${deletedCount} old audit logs`);
```

### Scheduled Cleanup

Add to your cron jobs or scheduled tasks:

```typescript
// Run daily at midnight
cron.schedule("0 0 * * *", async () => {
  await auditLogService.deleteOldLogs(90);
});
```

## Security Considerations

1. **Access Control**: Audit log endpoints are protected with authentication and role-based access control
2. **Sensitive Data**: Avoid logging sensitive data like passwords or tokens in metadata
3. **IP Tracking**: IP addresses are logged for security analysis
4. **Immutability**: Audit logs should not be modified after creation
5. **Retention**: Implement appropriate retention policies based on compliance requirements

## Migration

Run the migration to create the audit_log table:

```bash
npm run migration:run
```

Or manually:

```bash
npx typeorm migration:run -d src/config/Datasource.ts
```

## Testing

```typescript
import { auditLogService } from "../AuditLog/auditLog.service";
import { AuditAction, AuditSeverity } from "../AuditLog/auditLog.entity";

describe("Audit Log Service", () => {
  it("should create audit log", async () => {
    const log = await auditLogService.log({
      userId: "test-user",
      action: AuditAction.LOGIN_SUCCESS,
      severity: AuditSeverity.INFO,
      metadata: { test: true },
    });

    expect(log.id).toBeDefined();
    expect(log.action).toBe(AuditAction.LOGIN_SUCCESS);
  });

  it("should query user logs", async () => {
    const { logs, total } = await auditLogService.getUserAuditLogs("test-user");

    expect(Array.isArray(logs)).toBe(true);
    expect(typeof total).toBe("number");
  });
});
```

## Best Practices

1. **Log Important Actions**: Focus on security-critical and business-critical events
2. **Include Context**: Use metadata to provide relevant context
3. **Appropriate Severity**: Use correct severity levels for proper alerting
4. **Don't Block**: Audit logging should not block main operations (use async)
5. **Monitor Failures**: Track failed audit log writes separately
6. **Regular Review**: Periodically review audit logs for security analysis
7. **Compliance**: Ensure logging meets regulatory requirements (GDPR, SOC2, etc.)

# Large Tool Response Handling

## Overview

This document describes the response size validation and handling system for tool responses in the agent framework. Large tool responses can overwhelm the agent's context window and degrade performance. This system provides configurable truncation and rejection mechanisms to manage response sizes.

## Supported Behavior

### Truncation Mode (Default)

When a tool response exceeds the configured size limit:

1. **Response Preservation**: The response structure is preserved by selectively truncating string values and limiting array sizes.
2. **Partial Results**: The agent continues execution with the truncated data instead of failing.
3. **Metadata Tracking**: The result includes metadata indicating truncation (`handled: "truncated"`).
4. **Transparency**: An optional truncation notice is added to the response metadata.

**Use Case**: Tools returning large datasets (search results, logs, historical data) where partial results are acceptable.

### Rejection Mode

When a tool response exceeds the configured size limit:

1. **Error Conversion**: The successful response is converted to an error status.
2. **Error Code**: Returns error code `RESPONSE_SIZE_EXCEEDED` for downstream handling.
3. **Execution Stop**: The agent sees this as a tool failure and may retry or skip the step.
4. **Metadata**: Rejection reason and original size are included for debugging.

**Use Case**: Security-sensitive operations where incomplete responses are unacceptable (auth checks, compliance queries).

## Configuration

### Global Configuration

Add to `config/config.ts`:

```typescript
{
  agent: {
    responseSize: {
      mode: "truncate", // "truncate" or "reject"
    },
  },
}
```

### Risk-Based Limits

Response size limits are automatically determined by the tool's risk level:

- **Low-risk tools** (read-only, public data): 32 KB
- **Medium-risk tools** (data modification): 16 KB
- **High-risk tools** (security-sensitive): 8 KB

Custom limits per tool can be enforced by tool authors in validation logic.

## API Usage

### For Tool Developers

No changes needed. Response size validation is automatic and transparent:

```typescript
// Tool execute function
execute: async (payload: ToolPayload, userId: string) => {
  const data = await fetchLargeDataset();
  return {
    action: "my_tool",
    status: "success",
    data: data, // Automatically validated and potentially truncated
  };
};
```

### For Agent Developers

Check response size metadata in results:

```typescript
const result = await toolRegistry.executeTool("my_tool", payload, userId);

if (result.responseSizeMetadata?.handled === "truncated") {
  logger.info("Response was truncated", {
    originalSize: result.responseSizeMetadata.originalLength,
  });
} else if (result.responseSizeMetadata?.handled === "rejected") {
  logger.warn("Response was rejected due to size", {
    reason: result.error,
  });
}
```

## Failure Cases

### Response Exceeds Limit (Truncate Mode)

```
Input: { data: "x" * 100,000 characters }
Limit: 16,384 characters
Output: { data: "x" * ~8000 chars, _truncation_notice: "..." }
Result: success status, responseSizeMetadata.handled = "truncated"
```

### Response Exceeds Limit (Reject Mode)

```
Input: { data: "x" * 100,000 characters }
Limit: 16,384 characters
Output: (unchanged)
Result: error status, errorCode = "RESPONSE_SIZE_EXCEEDED"
```

### Response Within Limit

```
Input: { data: "small result" }
Limit: 16,384 characters
Output: (unchanged)
Result: success status, responseSizeMetadata = undefined
```

## Technical Details

### Truncation Algorithm

1. **String Values**: Truncated to character budget proportionally.
2. **Arrays**: Limited in item count based on estimated item size.
3. **Nested Objects**: Recursively truncated with per-level budgets.
4. **Primitive Values**: Preserved as-is (numbers, booleans, null).

### Size Calculation

Sizes are calculated as JSON string length in characters:

```typescript
const size = JSON.stringify(data).length;
```

This includes:
- String content (with escaping)
- JSON structural characters (quotes, braces, commas)
- Primitive values as strings

### Compatibility

- **Framework**: Works with any tool returning `ToolResult` with data.
- **Context**: Integrates with TrustZone context segmentation (per-provenance limits also apply).
- **LLM**: Reduces token usage by limiting large responses before LLM consumption.

## Logging

### Truncation Logging

```json
{
  "level": "warn",
  "message": "Tool response truncated due to size",
  "toolName": "my_tool",
  "userId": "user-123",
  "originalSize": 100000,
  "truncatedSize": 15000,
  "limit": 16384
}
```

### Rejection Logging

```json
{
  "level": "warn",
  "message": "Tool response rejected: exceeded size limit",
  "toolName": "my_tool",
  "userId": "user-123",
  "originalSize": 100000,
  "limit": 8192,
  "mode": "reject"
}
```

## Error Codes

| Error Code | Meaning | Recovery |
|-----------|---------|----------|
| `RESPONSE_SIZE_EXCEEDED` | Response rejected due to size (reject mode) | Retry with smaller payload or use truncate mode |

## Examples

### Example 1: Search Tool Returning Many Results

```typescript
// Tool returns 1000 search results (200 KB)
// High-risk tool with 8 KB limit
// Mode: truncate

// Result after validation:
{
  status: "success",
  data: {
    results: [/* ~20 results instead of 1000 */],
    _truncation_notice: "Response was truncated from X characters to Y character limit"
  },
  responseSizeMetadata: {
    originalLength: 204800,
    wasProcessed: true,
    handled: "truncated"
  }
}
```

### Example 2: Security-Sensitive Authentication Check

```typescript
// Tool attempts to return 500 KB of audit logs
// High-risk tool with 8 KB limit
// Mode: reject

// Result after validation:
{
  action: "auth_check",
  status: "error",
  error: "Response from tool 'auth_check' exceeded maximum size of 8192 characters",
  errorCategory: "EXECUTION",
  errorCode: "RESPONSE_SIZE_EXCEEDED",
  responseSizeMetadata: {
    originalLength: 512000,
    wasProcessed: true,
    handled: "rejected"
  }
}
```

## Testing

Comprehensive test coverage includes:

- **Truncation mode**: Success, truncation, nested objects, arrays, special characters
- **Rejection mode**: Success, rejection, error messages
- **Boundary conditions**: Exact limit, one character over, empty data, deeply nested
- **Data types**: Primitives, nested objects, mixed arrays, special characters
- **Integration**: Risk-level mapping, metadata inclusion, logging

Run tests:

```bash
npm test -- ResponseSizeValidator.test.ts
npm test -- ToolRegistry.ResponseSize.test.ts
```

## Migration Guide

### From Previous Behavior

Previous behavior: Large responses passed through without size limits.

**New behavior**: Large responses are automatically truncated (default) or rejected based on configuration.

**Migration steps**:

1. **For tools returning large data**: Monitor logs for truncation warnings and adjust if needed.
2. **For agents consuming results**: Check `responseSizeMetadata` to handle truncated data gracefully.
3. **For high-risk operations**: Consider switching to reject mode in configuration.

## Performance Considerations

- **Truncation Cost**: O(n) where n is response size (JSON serialization and string slicing).
- **Impact**: <10ms for typical responses; <100ms for 1 MB+ responses.
- **Context Savings**: Prevents LLM context overflow, reducing token usage by 50-90% for large results.

## Security Considerations

- **DoS Prevention**: Prevents memory exhaustion from tools returning unbounded data.
- **Context Injection**: Truncation prevents prompt injection via oversized untrusted responses.
- **Audit Trail**: All truncations/rejections are logged for compliance.

## See Also

- `ResponseSizeValidator.ts` - Implementation
- `ToolRegistry.ts` - Integration point
- `ToolMetadata.ts` - Response size metadata definition
- `TrustZone.ts` - Per-provenance size limits (complementary system)

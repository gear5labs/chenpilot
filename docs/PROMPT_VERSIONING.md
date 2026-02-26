# Prompt Versioning & A/B Testing System

A minimal system for versioning and A/B testing AI agent prompts to improve accuracy.

## Features

- **Version Management**: Create and manage multiple versions of prompts
- **A/B Testing**: Weighted distribution for testing multiple prompt variants
- **Metrics Tracking**: Track success rates, response times, and performance
- **Comparison**: Compare performance between different prompt versions

## Database Schema

### PromptVersion
- `id`: UUID
- `name`: Prompt identifier
- `type`: Prompt type (intent, validation, response)
- `content`: Prompt text
- `version`: Version string
- `isActive`: Whether this version is active
- `weight`: Weight for A/B testing (default: 50)

### PromptMetric
- `id`: UUID
- `promptVersionId`: Reference to prompt version
- `userId`: User who triggered the prompt
- `success`: Whether the prompt execution succeeded
- `responseTime`: Time taken in milliseconds
- `metadata`: Additional context (JSON)

## API Endpoints

### Create Prompt Version
```bash
POST /api/prompts/versions
{
  "name": "intent-v2",
  "type": "intent",
  "content": "Your prompt text...",
  "version": "2.0",
  "weight": 50
}
```

### Activate Version
```bash
PATCH /api/prompts/versions/:id/activate
```

### Deactivate Version
```bash
PATCH /api/prompts/versions/:id/deactivate
```

### Update Weight
```bash
PATCH /api/prompts/versions/:id/weight
{
  "weight": 75
}
```

### List Versions
```bash
GET /api/prompts/versions?type=intent
```

### Get Metrics
```bash
GET /api/prompts/versions/:id/metrics
```

### Compare Versions
```bash
GET /api/prompts/compare/:id1/:id2
```

## Usage

### 1. Run Migration
```bash
npm run migration:run
```

### 2. Create Prompt Versions
```bash
curl -X POST http://localhost:3000/api/prompts/versions \
  -H "Content-Type: application/json" \
  -d '{
    "name": "intent-baseline",
    "type": "intent",
    "content": "...",
    "version": "1.0",
    "weight": 50
  }'
```

### 3. Activate for A/B Testing
```bash
curl -X PATCH http://localhost:3000/api/prompts/versions/{id}/activate
```

### 4. Monitor Metrics
```bash
curl http://localhost:3000/api/prompts/versions/{id}/metrics
```

## How It Works

1. **Selection**: When a prompt is needed, the system selects from active versions based on weights
2. **Execution**: The selected prompt is used for the AI agent
3. **Tracking**: Success/failure and response time are automatically tracked
4. **Analysis**: Compare metrics to determine which version performs better

## A/B Testing Strategy

- Start with equal weights (50/50) for two versions
- Collect metrics over time
- Adjust weights based on performance
- Deactivate underperforming versions
- Iterate with new versions

## Example Workflow

```typescript
// System automatically selects prompt version
const prompt = await promptGenerator.generateIntentPrompt();

// Metrics are tracked automatically
// - Success: Did the workflow execute?
// - Response time: How long did it take?
// - User context: Which user triggered it?

// Compare versions
const comparison = await promptVersionManager.compareVersions(
  "version-a-id",
  "version-b-id"
);
console.log(comparison.winner); // "version1" or "version2"
```

## Metrics

Each prompt version tracks:
- **Total executions**: Number of times used
- **Success rate**: Percentage of successful executions
- **Average response time**: Mean execution time
- **User distribution**: Which users used this version

## Best Practices

1. Test one change at a time
2. Collect sufficient data before making decisions (minimum 100 executions)
3. Use descriptive version names and numbers
4. Document what changed between versions
5. Monitor metrics regularly
6. Gradually shift traffic to winning versions

# Scheduled Jobs Example

A comprehensive job scheduling system demonstrating recurring tasks, job queues, retries, and metrics using dotdo Durable Objects.

## Features

This example demonstrates:

- **Fluent Scheduling DSL**: `$.every.day.at6am()`, `$.every.Monday.at9am()`
- **Cron-style Schedules**: Standard cron expressions
- **Job Execution**: Timeout handling, retry with backoff
- **Job History**: Track all executions with status
- **Metrics**: Success rates, durations, trends
- **Webhooks**: Notify external services on job events
- **Reports**: Automatic daily/weekly/monthly reports
- **Manual Triggers**: Run jobs on demand

## Key dotdo Concepts

### Fluent Scheduler DSL

```typescript
// Every minute
this.$.every.minute(async () => {
  await this.checkScheduledJobs()
})

// Every hour
this.$.every.hour(async () => {
  await this.aggregateMetrics()
})

// Every day at specific time
this.$.every.day.atmidnight(async () => {
  await this.cleanupOldRuns()
})

this.$.every.day.at6am(async () => {
  await this.sendDailyDigest()
})

// Specific day of week
this.$.every.Monday.at9am(async () => {
  await this.sendWeeklyReport()
})

// Monthly
this.$.every.month(async () => {
  await this.sendMonthlyStats()
})
```

### Job Event Handling

```typescript
// Track job lifecycle
this.$.on.Job.started(async (event) => {
  const { jobId, runId, jobName } = event.payload
  await this.notifyWebhooks('job.started', { jobId, runId })
})

this.$.on.Job.completed(async (event) => {
  const { jobId, duration } = event.payload
  await this.updateMetrics(jobId, 'success', duration)
})

this.$.on.Job.failed(async (event) => {
  const { jobId, error, attempt, willRetry } = event.payload
  await this.notifyWebhooks('job.failed', { jobId, error })
})
```

### Durable Execution with Retries

```typescript
const retryPolicy = {
  maxAttempts: 3,
  backoffMs: 1000,
  backoffMultiplier: 2,
  maxBackoffMs: 60000,
}

// Execute with automatic retries
const result = await this.executeJob(job, config, 'schedule')
```

### Metrics Collection

```typescript
// Stored per job, per day
interface JobMetrics {
  $type: 'JobMetrics'
  jobId: string
  period: string // "2024-01-15"
  totalRuns: number
  successfulRuns: number
  failedRuns: number
  avgDuration: number
  minDuration: number
  maxDuration: number
}
```

## API Endpoints

### Jobs

| Method | Path | Description |
|--------|------|-------------|
| GET | `/jobs` | List all jobs with stats |
| POST | `/jobs` | Create a new job |
| GET | `/jobs/:id` | Get job details |
| PATCH | `/jobs/:id` | Update job configuration |
| DELETE | `/jobs/:id` | Delete a job |
| POST | `/jobs/:id/trigger` | Trigger job manually |
| GET | `/jobs/:id/runs` | Get job execution history |
| GET | `/jobs/:id/metrics` | Get job metrics |

### Runs

| Method | Path | Description |
|--------|------|-------------|
| GET | `/runs/:id` | Get run details |
| POST | `/runs/:id/cancel` | Cancel running job |

### Webhooks

| Method | Path | Description |
|--------|------|-------------|
| GET | `/webhooks` | List webhooks |
| POST | `/webhooks` | Create webhook |
| DELETE | `/webhooks/:id` | Delete webhook |

### Reports

| Method | Path | Description |
|--------|------|-------------|
| GET | `/reports` | List report configs |
| POST | `/reports` | Create report config |

### Metrics & Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/metrics` | Get overall metrics |
| GET | `/health` | Health check |

## Usage Examples

### Create a Scheduled Job

```bash
curl -X POST http://localhost:8793/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Daily Cleanup",
    "description": "Remove old temporary files",
    "schedule": "0 0 * * *",
    "handler": "cleanup",
    "config": {
      "daysToKeep": 30
    },
    "retryPolicy": {
      "maxAttempts": 3,
      "backoffMs": 1000,
      "backoffMultiplier": 2,
      "maxBackoffMs": 60000
    },
    "timeout": 60000
  }'
```

### List Jobs with Stats

```bash
curl http://localhost:8793/jobs
```

Response:
```json
{
  "data": [
    {
      "$id": "job-abc123",
      "name": "Daily Cleanup",
      "schedule": "0 0 * * *",
      "handler": "cleanup",
      "enabled": true,
      "lastRun": {
        "$id": "run-xyz789",
        "status": "completed",
        "duration": 1234,
        "startedAt": "2024-01-15T00:00:00Z"
      },
      "stats": {
        "last24h": {
          "runs": 1,
          "failures": 0
        }
      }
    }
  ]
}
```

### Trigger Job Manually

```bash
curl -X POST http://localhost:8793/jobs/job-abc123/trigger \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "daysToKeep": 7
    },
    "metadata": {
      "triggeredBy": "admin"
    }
  }'
```

Response:
```json
{
  "$id": "run-new456",
  "jobId": "job-abc123",
  "jobName": "Daily Cleanup",
  "status": "running",
  "startedAt": "2024-01-15T14:30:00Z",
  "attempt": 1,
  "triggeredBy": "manual"
}
```

### View Job Runs

```bash
curl "http://localhost:8793/jobs/job-abc123/runs?limit=10&status=failed"
```

### Get Job Metrics

```bash
curl "http://localhost:8793/jobs/job-abc123/metrics?days=7"
```

Response:
```json
{
  "data": [
    {
      "jobId": "job-abc123",
      "period": "2024-01-15",
      "totalRuns": 24,
      "successfulRuns": 23,
      "failedRuns": 1,
      "avgDuration": 1500,
      "minDuration": 1200,
      "maxDuration": 2100
    }
  ]
}
```

### Create Webhook

```bash
curl -X POST http://localhost:8793/webhooks \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Slack Notifications",
    "url": "https://hooks.slack.com/services/...",
    "events": ["job.failed", "job.timeout"],
    "secret": "webhook-secret"
  }'
```

### Create Report Configuration

```bash
curl -X POST http://localhost:8793/reports \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Weekly Job Summary",
    "description": "Summary of all job executions",
    "schedule": "0 9 * * 1",
    "type": "weekly_digest",
    "recipients": ["team@example.com"]
  }'
```

### Health Check

```bash
curl http://localhost:8793/health
```

Response:
```json
{
  "status": "healthy",
  "jobs": {
    "total": 5,
    "enabled": 4
  },
  "lastHour": {
    "runs": 12,
    "failures": 1
  }
}
```

## Built-in Handlers

| Handler | Description | Config Options |
|---------|-------------|----------------|
| `cleanup` | Remove old job runs | `daysToKeep` |
| `sync` | Sync data between systems | (custom) |
| `report` | Generate and send reports | (custom) |
| `healthcheck` | Run health checks | (custom) |
| `backup` | Backup data | (custom) |

## Adding Custom Handlers

```typescript
// In SchedulerDO.ts, add to runHandler:
case 'my_custom_handler':
  return this.handlerMyCustom(config)

// Implement the handler
private async handlerMyCustom(
  config?: Record<string, unknown>
): Promise<{ result: unknown }> {
  // Your custom logic here
  const apiUrl = config?.apiUrl as string
  const response = await fetch(apiUrl)
  return { result: await response.json() }
}
```

## Running Locally

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test
```

## Project Structure

```
examples/scheduled-jobs/
  SchedulerDO.ts      # Main Durable Object implementation
  types.ts            # TypeScript type definitions
  index.ts            # Worker entrypoint
  wrangler.jsonc      # Cloudflare configuration
  package.json        # Package configuration
  README.md           # This file
```

## Architecture

```
Scheduled Trigger ($.every or Cron)
         |
         v
+---------------------+
|   Worker (index)    |
|   Route by ns       |
+---------------------+
         |
         v
+---------------------+
|    SchedulerDO      |
|  - things           |  <-- Job, JobRun, JobMetrics
|  - $.every          |  <-- Fluent scheduling
|  - executeJob()     |  <-- Timeout, retry logic
+---------------------+
         |
    +----+----+
    |         |
    v         v
+-------+  +----------+
| Job   |  | Webhooks |
|Handler|  | Metrics  |
+-------+  +----------+
```

## Schedule Formats

### Cron Expressions

```
* * * * *     Every minute
0 * * * *     Every hour
0 0 * * *     Every day at midnight
0 9 * * 1     Every Monday at 9am
0 0 1 * *     First day of month
```

### $.every Patterns

```typescript
$.every.minute          // Every minute
$.every.hour            // Every hour
$.every.day.atmidnight  // Every day at 00:00
$.every.day.at6am       // Every day at 06:00
$.every.day.at6pm       // Every day at 18:00
$.every.Monday.at9am    // Every Monday at 09:00
$.every.Friday.at5pm    // Every Friday at 17:00
$.every.month           // First of every month
```

## Retry Behavior

When a job fails, the retry policy determines:

1. **Max attempts**: Total tries before giving up
2. **Initial backoff**: Wait time before first retry
3. **Backoff multiplier**: How much to increase wait time
4. **Max backoff**: Maximum wait time between retries

Example with defaults:
- Attempt 1 fails -> Wait 1s -> Attempt 2
- Attempt 2 fails -> Wait 2s -> Attempt 3
- Attempt 3 fails -> Job marked as failed

## Production Considerations

- **Cron parsing**: Use a proper cron library for production
- **Timezone handling**: Implement proper timezone support
- **Job isolation**: Run jobs in separate workers for isolation
- **Dead letter queue**: Handle permanently failed jobs
- **Concurrency**: Limit concurrent job executions
- **Monitoring**: Integrate with Prometheus/Grafana
- **Alerting**: Set up alerts for high failure rates
- **Distributed locks**: Prevent duplicate executions across DOs

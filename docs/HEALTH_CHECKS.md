# Health Check Endpoints and Readiness Probes

This document provides comprehensive documentation for dotdo's health check endpoints, readiness probes, and best practices for production monitoring.

## Table of Contents

1. [Overview](#1-overview)
2. [Built-in Endpoints](#2-built-in-endpoints)
3. [Response Formats](#3-response-formats)
4. [Configuration](#4-configuration)
5. [Kubernetes/Container Probes](#5-kubernetescontainer-probes)
6. [Advanced Health Checks](#6-advanced-health-checks)
7. [Graceful Degradation](#7-graceful-degradation)
8. [Monitoring Integration](#8-monitoring-integration)
9. [Best Practices](#9-best-practices)

---

## 1. Overview

dotdo provides built-in health check endpoints that follow industry best practices for container orchestration and load balancer integration. These endpoints enable:

- **Liveness probes**: Determine if the process is running
- **Readiness probes**: Determine if the service can accept traffic
- **Detailed health reports**: Monitor dependencies and system status

### Endpoint Summary

| Endpoint | Purpose | Use Case |
|----------|---------|----------|
| `GET /health` | Liveness check | Load balancer health checks, uptime monitoring |
| `GET /ready` | Readiness check | Traffic routing decisions, startup probes |
| `GET /` | API discovery | HATEOAS navigation, includes health link |

---

## 2. Built-in Endpoints

### 2.1 Liveness Endpoint: `/health`

The `/health` endpoint indicates whether the service process is alive and responsive. It returns immediately without checking downstream dependencies.

**Request:**

```bash
curl https://api.example.com/health
```

**Response:**

```json
{
  "status": "ok",
  "service": "dotdo-api",
  "timestamp": "2026-01-21T15:30:00.000Z",
  "uptime": 3600
}
```

**HTTP Status Codes:**

| Status | Meaning |
|--------|---------|
| `200 OK` | Service is alive and responsive |

**When to use:**

- Load balancer health checks
- Container liveness probes
- Simple uptime monitoring
- Quick service availability checks

### 2.2 Readiness Endpoint: `/ready`

The `/ready` endpoint indicates whether the service is ready to accept traffic. It checks all registered dependencies before responding.

**Request:**

```bash
curl https://api.example.com/ready
```

**Response (Ready):**

```json
{
  "status": "ready",
  "service": "dotdo-api",
  "timestamp": "2026-01-21T15:30:00.000Z",
  "checks": {
    "api": true,
    "database": true,
    "cache": true
  }
}
```

**Response (Not Ready):**

```json
{
  "status": "not_ready",
  "service": "dotdo-api",
  "timestamp": "2026-01-21T15:30:00.000Z",
  "checks": {
    "api": true,
    "database": false,
    "cache": true
  }
}
```

**HTTP Status Codes:**

| Status | Meaning |
|--------|---------|
| `200 OK` | Service is ready to accept traffic |
| `503 Service Unavailable` | Service is not ready (one or more dependencies failed) |

**When to use:**

- Kubernetes readiness probes
- Blue-green deployment verification
- Graceful startup/shutdown handling
- Traffic routing decisions

### 2.3 API Root with Health Link

The root endpoint (`/`) includes a HATEOAS link to the health check endpoint:

**Request:**

```bash
curl https://api.example.com/
```

**Response:**

```json
{
  "name": "dotdo API",
  "version": "1.0.0",
  "description": "Self-describing HATEOAS API",
  "_links": {
    "self": {
      "href": "https://api.example.com/",
      "rel": "self",
      "method": "GET"
    },
    "health": {
      "href": "https://api.example.com/health",
      "rel": "health",
      "method": "GET",
      "title": "Health check endpoint"
    }
  }
}
```

---

## 3. Response Formats

### 3.1 Health Response Interface

```typescript
interface HealthResponse {
  /** Always "ok" when healthy */
  status: 'ok'

  /** Service name identifier */
  service: string

  /** ISO 8601 timestamp */
  timestamp: string

  /** Process uptime in seconds (if available) */
  uptime?: number
}
```

### 3.2 Readiness Response Interface

```typescript
interface ReadinessResponse {
  /** "ready" or "not_ready" */
  status: 'ready' | 'not_ready'

  /** Service name identifier */
  service: string

  /** ISO 8601 timestamp */
  timestamp: string

  /** Individual dependency check results */
  checks: Record<string, boolean>
}
```

### 3.3 Detailed Health Report Interface

For advanced monitoring, dotdo provides a detailed health report:

```typescript
interface HealthReport {
  /** Overall system status */
  status: 'healthy' | 'degraded' | 'unhealthy'

  /** Individual service health checks */
  services: HealthCheckResult[]

  /** Report timestamp */
  timestamp: number

  /** Counts by status */
  healthyCount: number
  degradedCount: number
  unhealthyCount: number

  /** Uptime percentage based on recent checks */
  uptimePercentage: number
}

interface HealthCheckResult {
  /** Service/DO name */
  name: string

  /** Current health status */
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown'

  /** Last check timestamp */
  lastCheck: number

  /** Last successful check timestamp */
  lastSuccess: number | null

  /** Response time of last check (ms) */
  latencyMs: number | null

  /** Error message if unhealthy */
  error?: string

  /** Circuit breaker state if applicable */
  circuitState?: 'closed' | 'open' | 'half_open'
}
```

---

## 4. Configuration

### 4.1 Basic API Configuration

Health endpoints are automatically included when using `createAPI()`:

```typescript
import { createAPI } from '@dotdo/api'

const api = createAPI({
  basePath: '/api/v1'
})

// Health endpoints available at:
// - /api/v1/health
// - /api/v1/ready
```

### 4.2 Custom Service Name

```typescript
import { createAPI } from '@dotdo/api'
import { HealthService } from '@dotdo/api/services'

// Create custom health service
const healthService = new HealthService({
  serviceName: 'my-custom-service'
})

// Use in API
const api = createAPI()
```

### 4.3 Adding Custom Dependencies

Register dependencies that should be checked during readiness:

```typescript
import { HealthService, HealthDependency } from '@dotdo/api/services'

const healthService = new HealthService({
  serviceName: 'dotdo-api',
  dependencies: [
    {
      name: 'database',
      check: async () => {
        // Perform database connectivity check
        try {
          await db.query('SELECT 1')
          return true
        } catch {
          return false
        }
      }
    },
    {
      name: 'cache',
      check: async () => {
        // Perform cache connectivity check
        try {
          await cache.ping()
          return true
        } catch {
          return false
        }
      }
    },
    {
      name: 'external-api',
      check: async () => {
        // Check external service availability
        try {
          const response = await fetch('https://api.external.com/health')
          return response.ok
        } catch {
          return false
        }
      }
    }
  ]
})
```

### 4.4 Dynamic Dependency Registration

```typescript
// Register dependency at runtime
healthService.registerDependency({
  name: 'stripe',
  check: async () => {
    const response = await fetch('https://api.stripe.com/healthcheck')
    return response.ok
  }
})
```

### 4.5 Middleware Skip Paths

Health endpoints are automatically skipped by various middleware:

```typescript
const api = createAPI({
  auth: {
    enabled: true,
    skipPaths: ['/health', '/ready']  // Added automatically
  },
  rateLimit: {
    enabled: true,
    skipPaths: ['/health', '/ready']  // Added automatically
  },
  bodyLimit: {
    enabled: true,
    skipPaths: ['/health', '/ready']  // Added automatically
  }
})
```

---

## 5. Kubernetes/Container Probes

### 5.1 Kubernetes Pod Configuration

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: dotdo-api
spec:
  containers:
  - name: api
    image: your-registry/dotdo-api:latest
    ports:
    - containerPort: 8080

    # Liveness probe - restart container if unhealthy
    livenessProbe:
      httpGet:
        path: /health
        port: 8080
      initialDelaySeconds: 10
      periodSeconds: 15
      timeoutSeconds: 5
      failureThreshold: 3
      successThreshold: 1

    # Readiness probe - remove from service if not ready
    readinessProbe:
      httpGet:
        path: /ready
        port: 8080
      initialDelaySeconds: 5
      periodSeconds: 10
      timeoutSeconds: 5
      failureThreshold: 3
      successThreshold: 1

    # Startup probe - give time for initialization
    startupProbe:
      httpGet:
        path: /health
        port: 8080
      initialDelaySeconds: 0
      periodSeconds: 5
      timeoutSeconds: 5
      failureThreshold: 30
      successThreshold: 1
```

### 5.2 Docker Compose Health Checks

```yaml
version: '3.8'
services:
  api:
    image: dotdo-api:latest
    ports:
      - "8080:8080"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```

### 5.3 AWS ECS Task Definition

```json
{
  "containerDefinitions": [
    {
      "name": "dotdo-api",
      "image": "your-registry/dotdo-api:latest",
      "portMappings": [
        {
          "containerPort": 8080,
          "protocol": "tcp"
        }
      ],
      "healthCheck": {
        "command": ["CMD-SHELL", "curl -f http://localhost:8080/health || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 60
      }
    }
  ]
}
```

### 5.4 AWS Application Load Balancer

```json
{
  "TargetGroup": {
    "HealthCheckEnabled": true,
    "HealthCheckPath": "/health",
    "HealthCheckProtocol": "HTTP",
    "HealthCheckPort": "traffic-port",
    "HealthyThresholdCount": 2,
    "UnhealthyThresholdCount": 3,
    "HealthCheckTimeoutSeconds": 5,
    "HealthCheckIntervalSeconds": 30,
    "Matcher": {
      "HttpCode": "200"
    }
  }
}
```

### 5.5 Cloudflare Load Balancing

For Cloudflare Workers with health checks:

```typescript
// In your worker
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'dotdo-api',
    timestamp: new Date().toISOString(),
    region: c.req.header('CF-Ray')?.split('-')[1] ?? 'unknown'
  })
})
```

Configure in Cloudflare Dashboard:

1. Go to **Traffic** > **Load Balancing**
2. Create a health check monitor:
   - Type: HTTP
   - Path: `/health`
   - Expected codes: 200
   - Interval: 60 seconds
   - Timeout: 5 seconds

---

## 6. Advanced Health Checks

### 6.1 Health Checker for DOs

Use the `HealthChecker` class for monitoring Durable Objects:

```typescript
import { createHealthChecker, type HealthCheckConfig } from '@dotdo/do'

const healthChecker = createHealthChecker({
  intervalMs: 30000,           // Check every 30 seconds
  timeoutMs: 5000,             // 5 second timeout per check
  unhealthyThreshold: 3,       // Mark unhealthy after 3 failures
  healthyThreshold: 2,         // Mark healthy after 2 successes
  degradedLatencyMs: 1000,     // Mark degraded if latency > 1s
})

// Register services to monitor
healthChecker.register('user-service')
healthChecker.register('order-service')

// Perform health check with custom function
const result = await healthChecker.check('user-service', async () => {
  const start = Date.now()
  try {
    const response = await stub.fetch('https://do/ping')
    return {
      healthy: response.ok,
      latencyMs: Date.now() - start
    }
  } catch (error) {
    return {
      healthy: false,
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
})

// Get overall health report
const report = healthChecker.getReport()
console.log(report)
// {
//   status: 'healthy',
//   services: [...],
//   timestamp: 1705851234567,
//   healthyCount: 2,
//   degradedCount: 0,
//   unhealthyCount: 0,
//   uptimePercentage: 99.5
// }
```

### 6.2 Custom Health Check Endpoint

Create a detailed health endpoint with dependency checks:

```typescript
import { Hono } from 'hono'
import { createHealthChecker } from '@dotdo/do'

const app = new Hono()
const healthChecker = createHealthChecker()

// Simple liveness
app.get('/health', (c) => c.json({ status: 'ok' }))

// Simple readiness
app.get('/livez', (c) => c.text('OK'))

// Detailed readiness with checks
app.get('/readyz', async (c) => {
  const checks = {
    database: await checkDatabase(),
    cache: await checkCache(),
    external: await checkExternalService()
  }

  const allHealthy = Object.values(checks).every(Boolean)
  return c.text(allHealthy ? 'OK' : 'NOT READY', allHealthy ? 200 : 503)
})

// Comprehensive health report
app.get('/health/detailed', async (c) => {
  // Check all registered services
  await Promise.all([
    healthChecker.check('database'),
    healthChecker.check('cache'),
    healthChecker.check('external')
  ])

  const report = healthChecker.getReport()
  const statusCode = report.status === 'healthy' ? 200 :
                     report.status === 'degraded' ? 200 : 503

  return c.json(report, statusCode)
})
```

### 6.3 Health Check with Circuit Breaker Integration

```typescript
import {
  createGracefulDegradationHandler,
  type HealthCheckResult
} from '@dotdo/do'

const handler = createGracefulDegradationHandler({
  healthCheckConfig: {
    intervalMs: 30000,
    unhealthyThreshold: 3
  },
  circuitBreakerConfig: {
    failureThreshold: 5,
    resetTimeoutMs: 30000
  }
})

// Health check includes circuit breaker state
app.get('/health/service/:name', async (c) => {
  const name = c.req.param('name')

  const result = await handler.checkHealth(name, async () => {
    const start = Date.now()
    const response = await env.DO.get(env.DO.idFromName(name))
      .fetch('https://do/ping')

    return {
      healthy: response.ok,
      latencyMs: Date.now() - start
    }
  })

  return c.json({
    name: result.name,
    status: result.status,
    latencyMs: result.latencyMs,
    circuitState: result.circuitState,
    lastSuccess: result.lastSuccess,
    error: result.error
  })
})
```

---

## 7. Graceful Degradation

### 7.1 Degradation Status

dotdo provides comprehensive degradation reporting:

```typescript
import {
  createEnhancedGracefulDegradationHandler,
  type DegradationStatus
} from '@dotdo/do'

const handler = createEnhancedGracefulDegradationHandler({
  queueWritesOnFailure: true,
  addStatusHeaders: true
})

// Get degradation status for a namespace
const status = handler.getDegradationStatus('user-service')
// {
//   mode: 'normal' | 'circuit_open' | 'degraded' | 'write_queued' | 'stale_data' | 'unavailable',
//   accepting: true,
//   writesQueued: false,
//   pendingWrites: 0,
//   mayServeStale: false,
//   estimatedRecoveryMs: null,
//   circuitState: 'closed',
//   healthStatus: 'healthy',
//   message: 'System operating normally',
//   timestamp: 1705851234567
// }
```

### 7.2 Degradation Headers

When `addStatusHeaders` is enabled, responses include degradation information:

```
X-Degradation-Mode: normal
X-Degradation-Accepting: true
X-Degradation-Writes-Queued: false
X-Degradation-Pending-Writes: 0
X-Degradation-May-Serve-Stale: false
X-Circuit-State: closed
X-Health-Status: healthy
```

### 7.3 Monitoring Degradation

```typescript
// Endpoint to check overall system degradation
app.get('/health/degradation', (c) => {
  const report = handler.getHealthReport()

  return c.json({
    overall: report.status,
    services: report.services.map(s => ({
      name: s.name,
      status: s.status,
      circuitState: s.circuitState
    })),
    degradation: report.degradation,
    writeQueue: handler.getWriteQueueStats()
  })
})
```

---

## 8. Monitoring Integration

### 8.1 Prometheus Metrics

Expose health metrics in Prometheus format:

```typescript
app.get('/metrics', async (c) => {
  const report = healthChecker.getReport()
  const queueStats = writeQueue.getStats()

  const metrics = `
# HELP service_health_status Health status of services (1=healthy, 0.5=degraded, 0=unhealthy)
# TYPE service_health_status gauge
${report.services.map(s =>
  `service_health_status{service="${s.name}"} ${s.status === 'healthy' ? 1 : s.status === 'degraded' ? 0.5 : 0}`
).join('\n')}

# HELP service_health_latency_ms Last health check latency in milliseconds
# TYPE service_health_latency_ms gauge
${report.services.filter(s => s.latencyMs !== null).map(s =>
  `service_health_latency_ms{service="${s.name}"} ${s.latencyMs}`
).join('\n')}

# HELP system_uptime_percentage System uptime percentage
# TYPE system_uptime_percentage gauge
system_uptime_percentage ${report.uptimePercentage}

# HELP write_queue_pending Number of pending writes in queue
# TYPE write_queue_pending gauge
write_queue_pending ${queueStats.pending}

# HELP write_queue_failed Number of failed writes
# TYPE write_queue_failed counter
write_queue_failed ${queueStats.failed}
`.trim()

  return c.text(metrics, 200, {
    'Content-Type': 'text/plain; version=0.0.4'
  })
})
```

### 8.2 DataDog Integration

```typescript
import { datadogLogs } from '@datadog/browser-logs'

// Report health status to DataDog
async function reportHealthToDataDog() {
  const report = healthChecker.getReport()

  datadogLogs.logger.info('Health check report', {
    status: report.status,
    healthyCount: report.healthyCount,
    degradedCount: report.degradedCount,
    unhealthyCount: report.unhealthyCount,
    uptimePercentage: report.uptimePercentage,
    services: report.services.map(s => ({
      name: s.name,
      status: s.status,
      latencyMs: s.latencyMs
    }))
  })
}
```

### 8.3 Axiom Integration

```typescript
async function reportHealthToAxiom(env: Env) {
  const report = healthChecker.getReport()

  await fetch(`https://api.axiom.co/v1/datasets/${env.AXIOM_DATASET}/ingest`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.AXIOM_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify([{
      _time: new Date().toISOString(),
      type: 'health_check',
      status: report.status,
      services: report.services,
      uptimePercentage: report.uptimePercentage
    }])
  })
}
```

### 8.4 Uptime Monitoring Services

Configure external uptime monitors to check your health endpoints:

**Pingdom/UptimeRobot:**

- URL: `https://api.example.com/health`
- Method: GET
- Expected status: 200
- Check interval: 1-5 minutes
- Alert threshold: 2-3 consecutive failures

**Better Uptime:**

```bash
# Heartbeat endpoint for Better Uptime
curl -X POST https://betteruptime.com/api/v1/heartbeat/YOUR_HEARTBEAT_ID
```

---

## 9. Best Practices

### 9.1 Liveness vs Readiness

| Aspect | Liveness (`/health`) | Readiness (`/ready`) |
|--------|---------------------|---------------------|
| Purpose | Is the process alive? | Can it serve traffic? |
| Dependencies | None | Check all critical deps |
| Response time | Immediate (<10ms) | May take longer |
| Failure action | Restart container | Remove from load balancer |
| Check frequency | Every 15-30 seconds | Every 10-15 seconds |

### 9.2 Health Check Implementation Guidelines

1. **Keep liveness checks fast**: The `/health` endpoint should return immediately without external calls.

2. **Include all critical dependencies in readiness**: If your service can't function without a dependency, check it in `/ready`.

3. **Set appropriate timeouts**: Health check timeouts should be shorter than the check interval.

4. **Use circuit breakers**: Prevent cascading failures by not checking dependencies that are known to be down.

5. **Log health check failures**: Track when and why health checks fail for debugging.

```typescript
// Good: Fast liveness check
app.get('/health', (c) => c.json({ status: 'ok' }))

// Good: Thorough readiness check with timeout
app.get('/ready', async (c) => {
  const timeout = 5000 // 5 seconds

  const checks = await Promise.race([
    checkAllDependencies(),
    new Promise(resolve => setTimeout(() => resolve({ timeout: true }), timeout))
  ])

  if (checks.timeout) {
    return c.json({ status: 'not_ready', error: 'timeout' }, 503)
  }

  const ready = Object.values(checks).every(Boolean)
  return c.json({ status: ready ? 'ready' : 'not_ready', checks }, ready ? 200 : 503)
})
```

### 9.3 Graceful Shutdown

Handle shutdown gracefully by failing readiness before liveness:

```typescript
let isShuttingDown = false

process.on('SIGTERM', () => {
  isShuttingDown = true

  // Allow time for load balancer to remove from pool
  setTimeout(() => {
    process.exit(0)
  }, 30000) // 30 second grace period
})

app.get('/ready', (c) => {
  if (isShuttingDown) {
    return c.json({ status: 'not_ready', reason: 'shutting_down' }, 503)
  }
  // ... normal readiness check
})

app.get('/health', (c) => {
  // Still return healthy during shutdown
  // Let readiness handle traffic routing
  return c.json({ status: 'ok' })
})
```

### 9.4 Health Check Security

1. **Don't expose sensitive information**: Health endpoints should not reveal internal details.

2. **Skip authentication for health endpoints**: Load balancers need to access them without credentials.

3. **Consider rate limiting**: Prevent abuse while allowing legitimate monitoring.

```typescript
const api = createAPI({
  auth: {
    enabled: true,
    skipPaths: ['/health', '/ready', '/livez', '/readyz']
  },
  rateLimit: {
    enabled: true,
    skipPaths: ['/health', '/ready'],  // Skip for monitoring
    tiers: {
      monitoring: {
        requestsPerWindow: 1000,
        windowMs: 60000
      }
    }
  }
})
```

### 9.5 Testing Health Endpoints

```typescript
import { describe, it, expect } from 'vitest'
import { createAPI } from '@dotdo/api'

describe('Health Endpoints', () => {
  const app = createAPI()

  it('should return 200 for /health', async () => {
    const res = await app.request('http://localhost/health')
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.service).toBeDefined()
    expect(body.timestamp).toBeDefined()
  })

  it('should return valid ISO timestamp', async () => {
    const res = await app.request('http://localhost/health')
    const body = await res.json()

    const timestamp = new Date(body.timestamp)
    expect(timestamp.toISOString()).toBe(body.timestamp)
  })

  it('should return 200 for /ready when all deps healthy', async () => {
    const res = await app.request('http://localhost/ready')
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.status).toBe('ready')
    expect(body.checks).toBeDefined()
  })

  it('should return 503 for /ready when deps unhealthy', async () => {
    // Mock a failing dependency
    // ...

    const res = await app.request('http://localhost/ready')
    expect(res.status).toBe(503)

    const body = await res.json()
    expect(body.status).toBe('not_ready')
  })
})
```

---

## Quick Reference

### Endpoints

| Endpoint | Method | Status Codes | Purpose |
|----------|--------|--------------|---------|
| `/health` | GET | 200 | Liveness probe |
| `/ready` | GET | 200, 503 | Readiness probe |
| `/livez` | GET | 200 | Kubernetes liveness |
| `/readyz` | GET | 200, 503 | Kubernetes readiness |

### Response Examples

**Healthy:**
```json
{"status": "ok", "service": "dotdo-api", "timestamp": "2026-01-21T15:30:00.000Z"}
```

**Ready:**
```json
{"status": "ready", "service": "dotdo-api", "timestamp": "2026-01-21T15:30:00.000Z", "checks": {"api": true}}
```

**Not Ready:**
```json
{"status": "not_ready", "service": "dotdo-api", "timestamp": "2026-01-21T15:30:00.000Z", "checks": {"api": true, "database": false}}
```

### Kubernetes Probe Configuration

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 15

readinessProbe:
  httpGet:
    path: /ready
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 10
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-21 | Initial release |

---

## Related Documentation

- [Production Deployment Guide](./DEPLOYMENT.md) - Full deployment documentation
- [Observability Guide](./OBSERVABILITY.md) - Logging and monitoring
- [Error Handling Guide](./ERROR_HANDLING.md) - Error response patterns

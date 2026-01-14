# dotdo Helm Chart

Helm chart for deploying stateless Durable Objects on Kubernetes.

## Overview

This chart deploys dotdo as stateless pods with:
- Consistent hash routing at the ingress level
- Horizontal Pod Autoscaling (HPA)
- Cross-pod RPC communication
- External state storage (libSQL/Turso)
- Linkerd service mesh integration
- Prometheus metrics

## Prerequisites

- Kubernetes 1.23+
- Helm 3.8+
- NGINX Ingress Controller (or similar)
- libSQL/Turso database
- (Optional) Linkerd service mesh
- (Optional) Prometheus Operator

## Installation

### Quick Start

```bash
# Add secrets first
kubectl create secret generic dotdo-secrets \
  --from-literal=turso-token=YOUR_TOKEN \
  --from-literal=r2-access-key=YOUR_KEY \
  --from-literal=r2-secret-key=YOUR_SECRET

# Install with existing secret
helm install dotdo ./deploy/helm/dotdo \
  --set secrets.create=false \
  --set secrets.existingSecret=dotdo-secrets \
  --set env.TURSO_URL=libsql://your-db.turso.io
```

### Production Installation

```bash
helm install dotdo ./deploy/helm/dotdo \
  -f values-production.yaml \
  --set secrets.tursoToken=$TURSO_TOKEN \
  --set secrets.r2AccessKey=$R2_ACCESS_KEY \
  --set secrets.r2SecretKey=$R2_SECRET_KEY \
  --set env.TURSO_URL=$TURSO_URL
```

### Fly.io Hybrid

```bash
helm install dotdo ./deploy/helm/dotdo \
  -f values-fly.yaml \
  --set env.TURSO_URL=$TURSO_URL
```

## Configuration

### Key Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `replicaCount` | Number of pod replicas | `3` |
| `image.repository` | Container image repository | `ghcr.io/dot-do/dotdo` |
| `image.tag` | Container image tag | `latest` |
| `service.port` | HTTP service port | `8787` |
| `service.rpcPort` | RPC service port | `8788` |
| `ingress.enabled` | Enable ingress | `true` |
| `autoscaling.enabled` | Enable HPA | `true` |
| `autoscaling.minReplicas` | Minimum replicas | `2` |
| `autoscaling.maxReplicas` | Maximum replicas | `100` |
| `linkerd.enabled` | Enable Linkerd injection | `true` |
| `prometheus.enabled` | Enable Prometheus metrics | `true` |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `TURSO_URL` | libSQL/Turso connection URL |
| `R2_ENDPOINT` | R2-compatible storage endpoint |
| `R2_BUCKET` | Storage bucket name |
| `REDIS_URL` | Redis URL for cross-pod communication |
| `DO_MAX_CONCURRENT` | Max concurrent DO instances per pod |
| `DO_IDLE_TIMEOUT` | DO idle timeout in milliseconds |

### Secrets

Secrets can be created by the chart or use an existing secret:

```yaml
# Create new secret
secrets:
  create: true
  tursoToken: "your-token"
  r2AccessKey: "your-key"
  r2SecretKey: "your-secret"

# Use existing secret
secrets:
  create: false
  existingSecret: "my-dotdo-secrets"
```

Expected secret keys:
- `turso-token`
- `r2-access-key`
- `r2-secret-key`
- `redis-password`
- `api-key`

## Architecture

### Stateless Design

Unlike traditional Durable Objects that run on Cloudflare's edge:

1. **Pods are stateless** - All persistent state lives in libSQL/Turso
2. **Consistent hash routing** - Ingress routes DO requests to the same pod when possible
3. **Cross-pod RPC** - DOs can communicate across pods via the headless service

### Routing Strategy

The ingress uses consistent hash routing based on:
1. `X-DO-ID` header (preferred)
2. Request URI (fallback)

```yaml
ingress:
  annotations:
    nginx.ingress.kubernetes.io/upstream-hash-by: "$http_x_do_id$request_uri"
```

This ensures the same DO ID typically routes to the same pod, improving cache locality.

### Service Mesh

With Linkerd enabled:
- mTLS between all pods
- Service discovery via headless service
- HTTP/2 for efficient RPC

## Scaling

### Horizontal Pod Autoscaling

HPA scales based on:
- CPU utilization (default: 70%)
- Memory utilization (default: 80%)
- Custom metrics (optional):
  - Active DO instances
  - Requests per second

```yaml
autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 100
  customMetrics:
    enabled: true
    activeDoInstances:
      targetAverageValue: "1000"
```

### Pod Disruption Budget

Ensures availability during updates:

```yaml
podDisruptionBudget:
  enabled: true
  minAvailable: 1
```

## Monitoring

### Prometheus Metrics

Metrics are exposed at `/metrics` and include:
- `dotdo_active_instances` - Active DO instances
- `dotdo_requests_total` - Total requests
- `dotdo_request_duration_seconds` - Request latency

### ServiceMonitor

If using Prometheus Operator:

```yaml
prometheus:
  serviceMonitor:
    enabled: true
    interval: 30s
```

## Troubleshooting

### Check Pod Status

```bash
kubectl get pods -l app.kubernetes.io/name=dotdo
kubectl describe pod <pod-name>
```

### View Logs

```bash
kubectl logs -l app.kubernetes.io/name=dotdo -f
```

### Check HPA Status

```bash
kubectl get hpa dotdo
kubectl describe hpa dotdo
```

### Linkerd Dashboard

```bash
linkerd viz dashboard
```

## Upgrading

```bash
helm upgrade dotdo ./deploy/helm/dotdo -f values-production.yaml
```

## Uninstalling

```bash
helm uninstall dotdo
```

## Values Files

- `values.yaml` - Default values
- `values-production.yaml` - Production configuration
- `values-fly.yaml` - Fly.io hybrid deployment

## Contributing

See [CONTRIBUTING.md](https://github.com/dot-do/dotdo/blob/main/CONTRIBUTING.md)

## License

MIT

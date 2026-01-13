# Deployment Options

dotdo runs natively on Cloudflare Workers with Durable Objects, but also supports stateless deployment to other platforms via external state management.

## Quick Comparison

| Platform | Cold Start | State | Best For |
|----------|------------|-------|----------|
| **Cloudflare Workers** | 0ms | Native DO + SQLite | Production (native) |
| **Docker** | N/A | Turso + R2/MinIO | Self-hosted, dev |
| **Kubernetes** | ~1s | Turso + S3 | Enterprise, hybrid |
| **fly.io** | ~300ms | Turso + R2 | Global edge, cost-effective |
| **Vercel Edge** | ~500ms | Turso | Jamstack, existing Vercel |

## Architecture

All non-Cloudflare deployments follow the same stateless pattern:

```
                     ┌─────────────────────────────────────────┐
                     │           Stateless Compute             │
                     │  (Docker / K8s / fly.io / Vercel Edge)  │
                     └──────────────────┬──────────────────────┘
                                        │
              ┌─────────────────────────┼─────────────────────────┐
              │                         │                         │
              ▼                         ▼                         ▼
    ┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
    │     Turso       │      │   R2 / S3       │      │     Redis       │
    │    (libSQL)     │      │   (Iceberg)     │      │   (optional)    │
    │                 │      │                 │      │                 │
    │  • DO state     │      │  • Blobs        │      │  • Cross-pod    │
    │  • SQLite data  │      │  • Artifacts    │      │    routing      │
    │  • Consistency  │      │  • Analytics    │      │  • Pub/sub      │
    └─────────────────┘      └─────────────────┘      └─────────────────┘
```

### State Management

- **Turso/libSQL**: Replaces DO's built-in SQLite. Globally distributed with edge replicas.
- **ConsistencyGuard**: Fencing tokens ensure single-writer semantics per DO ID.
- **R2/S3**: Object storage for blobs and Iceberg-formatted analytics data.

## Storage Options

### Object Storage

| Provider | Protocol | Use Case |
|----------|----------|----------|
| Cloudflare R2 | S3-compatible | Production (native integration) |
| AWS S3 | S3 | Enterprise, existing AWS |
| MinIO | S3-compatible | Self-hosted, development |
| Tigris | S3-compatible | fly.io native |

### Iceberg Support

dotdo uses [Apache Iceberg](https://iceberg.apache.org/) format for analytics-ready data:

```
R2/S3 Bucket
├── metadata/
│   └── v1.metadata.json
├── manifests/
│   ├── manifest-list.avro
│   └── manifest-*.avro
└── data/
    └── ns=payments.do/type=Event/
        └── data-*.parquet
```

**Benefits:**
- Point lookups: 50-150ms (direct Iceberg navigation)
- Analytics: Full SQL via R2 SQL, DuckDB, or Spark
- Time travel: Query historical snapshots
- Schema evolution: Add columns without rewriting data

**Implementation:** See `db/iceberg/` for direct navigation and `db/compat/sql/duckdb-wasm/iceberg/` for DuckDB integration.

## Platform Guides

### [Docker](./docker/)

Self-hosted deployment with Docker Compose. Includes:
- Multi-stage production builds
- Local Turso + MinIO for development
- Traefik reverse proxy with TLS
- Docker Swarm support

```bash
cd deploy/docker
docker-compose up
```

### [Kubernetes / Helm](./helm/dotdo/)

Production-grade Kubernetes deployment:
- Horizontal Pod Autoscaling (2-100 replicas)
- Linkerd service mesh with mTLS
- Consistent hash routing for DO affinity
- Prometheus metrics + ServiceMonitor
- Pod disruption budgets

```bash
helm install dotdo ./deploy/helm/dotdo \
  --set env.TURSO_URL=$TURSO_URL \
  --set secrets.tursoToken=$TURSO_TOKEN
```

### [fly.io](./fly/)

Global edge deployment with automatic scaling:
- 30+ regions worldwide
- ~300ms cold starts
- Auto-stop/start for cost efficiency
- Multi-region with `fly scale count`

```bash
cd deploy/fly
fly launch --no-deploy
fly secrets set TURSO_URL=... TURSO_TOKEN=...
fly deploy
```

### [Vercel Edge](./vercel/)

Edge functions with Turso backend:
- ~500ms cold starts
- ConsistencyGuard for single-writer guarantees
- Middleware support (CORS, auth, rate limiting)
- Path and header-based DO routing

```typescript
import { edgeRouter } from 'dotdo/deploy/vercel'
export default edgeRouter({ classes: { Business, Agent } })
```

## Not Yet Implemented

| Platform | Status | Notes |
|----------|--------|-------|
| Bun | Not started | Native Bun runtime |
| AWS Lambda | Not started | Needs CDK/SAM adapter |
| Azure Functions | Not started | |
| GCP Cloud Run | Not started | |
| Deno Deploy | Not started | |

## Environment Variables

Common across all platforms:

| Variable | Required | Description |
|----------|----------|-------------|
| `TURSO_URL` | Yes | libSQL/Turso connection URL |
| `TURSO_TOKEN` | Yes | Turso authentication token |
| `R2_ENDPOINT` | No | S3-compatible endpoint |
| `R2_ACCESS_KEY_ID` | No | S3 access key |
| `R2_SECRET_ACCESS_KEY` | No | S3 secret key |
| `R2_BUCKET` | No | Bucket for Iceberg data |

## Choosing a Platform

**Use Cloudflare Workers when:**
- You want 0ms cold starts and native DO guarantees
- Your workload fits Workers limits (128MB memory, 30s CPU)
- You want the simplest deployment

**Use Docker/Kubernetes when:**
- You need self-hosted or on-prem deployment
- You have specific compliance requirements
- You need more memory/CPU than Workers provides

**Use fly.io when:**
- You want global edge deployment without Cloudflare
- Cost efficiency matters (pay-per-use)
- You need container flexibility with edge benefits

**Use Vercel Edge when:**
- You're already on Vercel
- Your app is primarily Jamstack/Next.js
- You want simple deployment with `vercel deploy`

## Related

- [db/iceberg/](../db/iceberg/) - Direct Iceberg navigation
- [db/README.md](../db/README.md) - Database architecture
- [CLAUDE.md](../CLAUDE.md) - Development guide

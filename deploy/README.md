# Deploy Anywhere

**One codebase. Any platform. Zero database credentials.**

```bash
do login                    # Get JWT from oauth.do
do deploy --platform=fly    # Ship to fly.io
do deploy --platform=render # Ship to Render
do deploy --platform=k8s    # Ship to Kubernetes
```

Your Durable Object code runs unchanged on Cloudflare, Docker, Kubernetes, fly.io, Vercel, Render, or Railway. State persists to Iceberg snapshots on R2—authorized by the JWT you already have.

## The Problem We Solved

Traditional multi-platform deployment requires:
- Separate database credentials per environment
- Different state management patterns per platform
- Complex migration scripts between providers
- Vendor lock-in through proprietary storage

**dotdo's approach:** Your JWT from `do login` authorizes R2 storage access. No database credentials. No connection strings. No vendor lock-in. The same DO class works everywhere.

## Quick Comparison

| Platform | Cold Start | State | Best For |
|----------|------------|-------|----------|
| **Cloudflare Workers** | 0ms | Native SQLite + Iceberg backup | Production (native) |
| **Docker** | N/A | Iceberg on R2/MinIO | Self-hosted, dev |
| **Kubernetes** | ~1s | Iceberg on R2/S3 | Enterprise, hybrid |
| **fly.io** | ~300ms | Iceberg on R2 | Global edge, cost-effective |
| **Vercel Edge** | ~500ms | Iceberg on R2 | Jamstack, existing Vercel |
| **Render** | ~500ms | Iceberg on R2 | Simple PaaS deployment |
| **Railway** | ~500ms | Iceberg on R2 | Developer-friendly PaaS |

## Architecture

All deployments use the same state persistence pattern:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              do login                                     │
│                                  │                                        │
│                                  ▼                                        │
│                         ┌───────────────┐                                 │
│                         │   oauth.do    │                                 │
│                         │  (WorkOS)     │                                 │
│                         └───────┬───────┘                                 │
│                                 │                                         │
│                    JWT { org_id, tenant_id, storage_claims }              │
│                                 │                                         │
└─────────────────────────────────┼─────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Any Compute Platform                              │
│   (Cloudflare / Docker / K8s / fly.io / Vercel / Render / Railway)      │
│                                                                          │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │  DOBase                                                          │   │
│   │  ├── loadFromIceberg()   ←── Cold start: restore from R2        │   │
│   │  ├── saveToIceberg()     ←── Checkpoint: persist to R2          │   │
│   │  ├── acquireFencingToken() ←── Single-writer guarantee          │   │
│   │  └── configureIceberg({ autoCheckpoint: true })                  │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                  │                                       │
└──────────────────────────────────┼───────────────────────────────────────┘
                                   │
              JWT authorizes path: r2://{bucket}/{org}/{tenant}/do/{id}/
                                   │
                                   ▼
                    ┌─────────────────────────────────┐
                    │      Cloudflare R2              │
                    │      (Iceberg V2 Format)        │
                    │                                 │
                    │  • $0 egress (forever)          │
                    │  • Parquet data files           │
                    │  • Time-travel snapshots        │
                    │  • Analytics-ready              │
                    └─────────────────────────────────┘
```

### How It Works

1. **`do login`** authenticates via WorkOS AuthKit, returns a JWT with storage claims
2. **JWT authorizes R2 paths** — no separate credentials needed
3. **On cold start**, `loadFromIceberg()` restores state from the latest snapshot
4. **During execution**, `saveToIceberg()` checkpoints state (auto or manual)
5. **Fencing tokens** ensure single-writer semantics across instances

## Storage: Simple by Default, Flexible When Needed

### The Simple Path (Recommended)

Run `do login` and you're done. Your JWT authorizes writes to our managed R2 bucket. No credentials to manage, no buckets to provision.

```bash
do login                  # Authenticates, stores JWT locally
do deploy                 # Deploys with storage already configured
```

### Bring Your Own Storage

Need data residency compliance? Want to use existing infrastructure? Provide your own S3-compatible storage or Iceberg catalog.

```bash
# Use your own S3-compatible bucket
do config set storage.endpoint https://s3.eu-west-1.amazonaws.com
do config set storage.bucket my-company-dotdo
do config set storage.accessKeyId $AWS_ACCESS_KEY_ID
do config set storage.secretAccessKey $AWS_SECRET_ACCESS_KEY

# Or point to an existing Iceberg catalog
do config set iceberg.catalog https://my-catalog.example.com
do config set iceberg.warehouse s3://my-warehouse/
```

### Supported Storage Backends

| Provider | Protocol | Best For |
|----------|----------|----------|
| **Cloudflare R2** (default) | S3-compatible | Zero config, $0 egress |
| **AWS S3** | S3 | Enterprise, existing AWS infrastructure |
| **MinIO** | S3-compatible | Self-hosted, air-gapped environments |
| **Tigris** | S3-compatible | fly.io native integration |
| **Google Cloud Storage** | S3-compatible mode | Existing GCP infrastructure |
| **Backblaze B2** | S3-compatible | Cost-optimized storage |

### Iceberg Format

All state persists as [Apache Iceberg](https://iceberg.apache.org/) V2 snapshots—an open table format designed for analytics:

```
r2://{bucket}/{org}/{tenant}/do/{do-id}/
├── snapshots/
│   ├── seq-1-{uuid}/
│   │   ├── metadata.json        # Iceberg V2 metadata
│   │   ├── manifests/           # Avro manifest files
│   │   └── data/
│   │       ├── things.parquet
│   │       ├── relationships.parquet
│   │       ├── actions.parquet
│   │       └── events.parquet
│   ├── seq-2-{uuid}/
│   └── latest                   # Pointer to current snapshot
└── lock                         # Fencing token for consistency
```

**Why Iceberg?**
- **Point lookups**: 50-150ms via direct manifest navigation
- **Analytics-ready**: Query with DuckDB, Spark, Trino, or any Iceberg-compatible engine
- **Time travel**: Restore to any previous snapshot
- **Schema evolution**: Add columns without rewriting data
- **No vendor lock-in**: Your data is portable Parquet files

**Implementation:** See `objects/persistence/iceberg-state.ts` for the adapter and `db/iceberg/` for direct navigation.

## Platform Guides

Every platform uses the same deployment flow:

```bash
do login                              # Get JWT (once)
do deploy --platform=<platform>       # Deploy
```

### [Docker](./docker/)

Self-hosted deployment with Docker Compose:
- Multi-stage production builds
- MinIO for local S3-compatible storage
- Traefik reverse proxy with TLS
- Docker Swarm support

```bash
do login
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
do login
helm install dotdo ./deploy/helm/dotdo \
  --set env.WORKOS_AUTH_DOMAIN=https://auth.yourdomain.com
```

### [fly.io](./fly/)

Global edge deployment with automatic scaling:
- 30+ regions worldwide
- ~300ms cold starts
- Auto-stop/start for cost efficiency
- Multi-region with `fly scale count`

```bash
do login
cd deploy/fly
fly launch --no-deploy
fly secrets set JWT_TOKEN="$(do token)"
fly deploy
```

### [Vercel Edge](./vercel/)

Edge functions with Iceberg state:
- ~500ms cold starts
- Fencing tokens for single-writer guarantees
- Middleware support (CORS, auth, rate limiting)
- Path and header-based DO routing

```bash
do login
vercel env add JWT_TOKEN
vercel deploy
```

### [Render](./render/)

Simple PaaS deployment:
- Automatic deploys from Git
- Free tier available
- Managed TLS

```bash
do login
# Add JWT_TOKEN to Render dashboard
# Connect your Git repo
```

### [Railway](./railway/)

Developer-friendly PaaS:
- One-click deploys
- Preview environments
- Usage-based pricing

```bash
do login
railway login
railway up
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

### Required (JWT-based auth)

| Variable | Description |
|----------|-------------|
| `WORKOS_AUTH_DOMAIN` | Your WorkOS AuthKit domain (e.g., `https://auth.yourdomain.com`) |
| `JWT_TOKEN` | JWT from `do login` (or use `do token` to retrieve) |

### Optional (Bring Your Own Storage)

| Variable | Description |
|----------|-------------|
| `R2_ENDPOINT` | S3-compatible endpoint URL |
| `R2_ACCESS_KEY_ID` | S3 access key |
| `R2_SECRET_ACCESS_KEY` | S3 secret key |
| `R2_BUCKET` | Bucket name for Iceberg data |
| `ICEBERG_CATALOG` | External Iceberg catalog URL |
| `ICEBERG_WAREHOUSE` | Iceberg warehouse path |

## Choosing a Platform

**Cloudflare Workers** — The native choice
- 0ms cold starts, native DO guarantees
- Best performance, simplest deployment
- Workers limits: 128MB memory, 30s CPU

**Docker / Kubernetes** — Full control
- Self-hosted, on-prem, air-gapped
- Compliance requirements (HIPAA, SOC2)
- Unlimited memory/CPU

**fly.io** — Edge without Cloudflare
- 30+ global regions
- Pay-per-use, auto-stop/start
- Container flexibility

**Vercel Edge** — For Vercel shops
- Tight Next.js integration
- Existing Vercel infrastructure
- Simple `vercel deploy`

**Render / Railway** — Quick starts
- Git-based deploys
- Free tiers for experimentation
- Minimal configuration

## Migration: Moving Between Platforms

Your data is portable. Moving from one platform to another is straightforward:

```bash
# Export current state (optional - data already in R2)
do snapshot export --output=backup.tar.gz

# Deploy to new platform
do deploy --platform=railway

# State automatically loads from Iceberg on first request
```

Since all platforms use the same Iceberg snapshots on R2, there's no data migration. Your new deployment reads from the same storage your old deployment wrote to.

## Technical Details

### StatelessDOState

For non-Cloudflare platforms, `StatelessDOState` implements the `DurableObjectState` interface using in-memory SQLite (sql.js) with Iceberg persistence:

```typescript
// Your DO code works unchanged
export class MyDO extends DOBase {
  async fetch(request: Request) {
    // SQLite operations work normally
    await this.things.create({ id: '1', type: 'Widget' })
    return new Response('OK')
  }
}
```

On Cloudflare, `DOBase` uses native attached SQLite. On other platforms, it uses `StatelessDOState` with automatic Iceberg load/save. Same code, same behavior.

### Auto-Checkpoint

Configure automatic checkpointing to balance durability and performance:

```typescript
this.configureIceberg({
  autoCheckpoint: true,
  checkpointIntervalMs: 60000,      // Every 60 seconds
  minChangesBeforeCheckpoint: 10,   // Only if 10+ changes pending
})
```

### Fencing Tokens

Distributed deployments (multiple pods, replicas) use fencing tokens for single-writer semantics:

```typescript
const token = await this.acquireFencingToken()
// ... perform writes ...
await this.releaseFencingToken(token)
```

The token is stored in R2. If another instance tries to acquire while you hold it, they'll get an error. This prevents split-brain scenarios.

## Related

- [objects/persistence/iceberg-state.ts](../objects/persistence/iceberg-state.ts) — IcebergStateAdapter
- [lib/storage/authorized-r2.ts](../lib/storage/authorized-r2.ts) — JWT-authorized R2 client
- [lib/auth/jwt-storage-claims.ts](../lib/auth/jwt-storage-claims.ts) — JWT claims extraction
- [db/iceberg/](../db/iceberg/) — Direct Iceberg navigation
- [db/README.md](../db/README.md) — Database architecture
- [CLAUDE.md](../CLAUDE.md) — Development guide

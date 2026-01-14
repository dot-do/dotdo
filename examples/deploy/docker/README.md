# Docker Deployment for dotdo

This directory contains Docker configuration for running stateless Durable Objects on workerd/miniflare with external state management (libSQL/Turso + R2/S3).

## Architecture

```
                                 +------------------+
                                 |    Traefik       |
                                 |  (Reverse Proxy) |
                                 +--------+---------+
                                          |
                    +---------------------+---------------------+
                    |                     |                     |
           +--------v--------+   +--------v--------+   +--------v--------+
           |    dotdo-app    |   |    dotdo-app    |   |    dotdo-app    |
           |   (workerd)     |   |   (workerd)     |   |   (workerd)     |
           +--------+--------+   +--------+--------+   +--------+--------+
                    |                     |                     |
                    +---------------------+---------------------+
                                          |
                    +---------------------+---------------------+
                    |                                           |
           +--------v--------+                         +--------v--------+
           |     Turso       |                         |   R2 / MinIO    |
           |    (libSQL)     |                         |    (Iceberg)    |
           +-----------------+                         +-----------------+
```

## Quick Start

### Local Development

```bash
# Start the full development stack
docker-compose up

# Start in background
docker-compose up -d

# View logs
docker-compose logs -f app

# Stop all services
docker-compose down

# Stop and remove volumes
docker-compose down -v
```

The development stack includes:
- **app** - dotdo with hot reload (port 8787)
- **turso-local** - Local libSQL server (port 8080)
- **minio** - S3-compatible storage (API: 9000, Console: 9001)
- **traefik** - Reverse proxy (HTTP: 80, Dashboard: 8081)

Access points:
- Application: http://localhost:8787
- MinIO Console: http://localhost:9001 (minioadmin/minioadmin)
- Traefik Dashboard: http://localhost:8081

### Production Deployment

1. Create environment file:

```bash
cp .env.example .env.prod
# Edit .env.prod with your values
```

2. Deploy:

```bash
docker-compose -f docker-compose.prod.yml up -d
```

## Environment Variables

### Required for Production

| Variable | Description | Example |
|----------|-------------|---------|
| `TURSO_URL` | libSQL/Turso connection URL | `libsql://mydb-org.turso.io` |
| `TURSO_TOKEN` | Turso authentication token | `eyJhbGc...` |
| `R2_ENDPOINT` | R2 or S3-compatible endpoint | `https://account.r2.cloudflarestorage.com` |
| `R2_ACCESS_KEY_ID` | S3 access key | `AKIAIOSFODNN7EXAMPLE` |
| `R2_SECRET_ACCESS_KEY` | S3 secret key | `wJalrXUtnFEMI/K7MDENG/...` |
| `R2_BUCKET` | Bucket name for Iceberg data | `dotdo-iceberg` |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | `production` |
| `PORT` | Application port | `8787` |
| `LOG_LEVEL` | Logging verbosity | `info` |
| `DOMAIN` | Production domain | `dotdo.local` |
| `REPLICAS` | Number of app replicas | `2` |
| `ACME_EMAIL` | Email for Let's Encrypt | `admin@dotdo.dev` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OpenTelemetry endpoint | - |

## Building Images

### Production Build

```bash
# Build production image
docker build -t dotdo:latest -f deploy/docker/Dockerfile .

# Build with specific tag
docker build -t dotdo:v1.0.0 -f deploy/docker/Dockerfile .

# Push to registry
docker tag dotdo:latest ghcr.io/dot-do/dotdo:latest
docker push ghcr.io/dot-do/dotdo:latest
```

### Development Build

```bash
# Build development image
docker build -t dotdo:dev -f deploy/docker/Dockerfile.dev .
```

## Image Size

The production image uses multi-stage builds to minimize size:

| Stage | Purpose | Included |
|-------|---------|----------|
| deps | Install prod dependencies | node_modules (prod only) |
| builder | Build application | Full toolchain + dev deps |
| runtime | Final image | Minimal runtime + app |

Target: **< 500MB** (actual size depends on dependencies)

## Health Checks

The application exposes a health endpoint at `/health`:

```bash
# Check health
curl http://localhost:8787/health

# Expected response
{"status": "ok", "timestamp": "2026-01-11T..."}
```

Docker health checks are configured with:
- Interval: 30s
- Timeout: 5s
- Retries: 3
- Start period: 10s (prod) / 5s (dev)

## Networking

### Local Development

```
dotdo-network (bridge)
  |
  +-- app (8787)
  +-- turso-local (8080, 5001)
  +-- minio (9000, 9001)
  +-- traefik (80, 443, 8081)
```

### Production

Traefik handles:
- TLS termination (Let's Encrypt)
- HTTP to HTTPS redirect
- Sticky sessions for DO affinity
- Health check routing

## Scaling

### Horizontal Scaling

```bash
# Scale to 3 replicas
docker-compose -f docker-compose.prod.yml up -d --scale app=3
```

### With Docker Swarm

```bash
# Initialize swarm
docker swarm init

# Deploy stack
docker stack deploy -c docker-compose.prod.yml dotdo

# Scale service
docker service scale dotdo_app=5
```

## Troubleshooting

### Container won't start

```bash
# Check logs
docker-compose logs app

# Check health
docker inspect --format='{{json .State.Health}}' dotdo-app | jq
```

### Connection to Turso fails

```bash
# Test connection from container
docker exec -it dotdo-app wget -O- http://turso-local:8080/health

# Check environment
docker exec -it dotdo-app printenv | grep TURSO
```

### MinIO bucket not created

```bash
# Manually create bucket
docker exec -it dotdo-minio-setup mc mb myminio/dotdo-iceberg
```

### Hot reload not working

```bash
# Ensure volumes are mounted correctly
docker-compose down
docker-compose up --build
```

## Security

- Non-root user (`dotdo:1001`) in production
- Read-only Docker socket mount for Traefik
- No secrets in image layers
- TLS by default in production
- Basic auth on Traefik dashboard

## Files

| File | Purpose |
|------|---------|
| `Dockerfile` | Production multi-stage build |
| `Dockerfile.dev` | Development with hot reload |
| `docker-compose.yml` | Local development stack |
| `docker-compose.prod.yml` | Production deployment |
| `.dockerignore` | Build context exclusions |

## Related

- [Helm Charts](../helm/) - Kubernetes deployment
- [fly.io](../fly/) - Fly.io deployment
- [AWS CDK](../aws/) - AWS deployment

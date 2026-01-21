# Deployment Examples

This directory contains example deployment configurations for dotdo applications.

## Important Context

**dotdo is designed for Cloudflare Workers with Durable Objects.** Unlike traditional applications, dotdo runs on Cloudflare's edge infrastructure with SQLite-backed Durable Objects for state management. This architecture means:

1. **Primary deployment target is Cloudflare Workers** - Use `wrangler deploy`
2. **Docker/Kubernetes are for CI/CD orchestration**, not running the application
3. **No server management required** - Cloudflare handles scaling, distribution, and failover

## Directory Contents

```
deployment/
├── README.md                    # This file
├── docker/                      # Docker configurations
│   ├── Dockerfile.ci           # CI/CD container with wrangler
│   ├── Dockerfile.dev          # Local development container
│   └── docker-compose.yml      # Local dev environment
├── kubernetes/                  # Kubernetes configurations
│   ├── deployment-job.yaml     # CI/CD deployment job
│   ├── secret.yaml             # Secret template
│   └── cronjob.yaml            # Scheduled deployments
├── github-actions/             # GitHub Actions workflows
│   ├── deploy.yml              # Production deployment
│   ├── preview.yml             # PR preview deployments
│   └── scheduled-deploy.yml    # Scheduled deployments
└── wrangler/                   # Wrangler configuration examples
    ├── wrangler.production.jsonc
    ├── wrangler.staging.jsonc
    └── wrangler.dev.jsonc
```

## Quick Start

### Deploy to Cloudflare Workers (Recommended)

```bash
# Install dependencies
npm install

# Deploy to production
npx wrangler deploy

# Deploy to staging
npx wrangler deploy --env staging
```

### Local Development with Docker

```bash
cd docker
docker-compose up
```

### CI/CD with GitHub Actions

Copy the workflows from `github-actions/` to your `.github/workflows/` directory.

## Deployment Methods Comparison

| Method | Use Case | Complexity |
|--------|----------|------------|
| `wrangler deploy` | Direct deployment | Low |
| GitHub Actions | Automated CI/CD | Medium |
| Docker + Wrangler | Containerized CI/CD | Medium |
| Kubernetes Jobs | Enterprise CI/CD orchestration | High |

## Environment Configuration

### Required Secrets

Set these via `wrangler secret put <NAME>`:

```bash
wrangler secret put BETTER_AUTH_SECRET
wrangler secret put ENCRYPTION_KEY
```

### Optional Secrets

```bash
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put OPENAI_API_KEY
wrangler secret put ANTHROPIC_API_KEY
```

## Multi-Environment Setup

See the `wrangler/` directory for environment-specific configurations:

- **Production**: `wrangler.production.jsonc` - Full production settings with custom domains
- **Staging**: `wrangler.staging.jsonc` - Staging environment for testing
- **Development**: `wrangler.dev.jsonc` - Local development settings

## See Also

- [DEPLOYMENT.md](/docs/DEPLOYMENT.md) - Comprehensive deployment guide
- [HEALTH_CHECKS.md](/docs/HEALTH_CHECKS.md) - Health check configuration
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)

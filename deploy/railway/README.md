# Railway Deployment

Deploy dotdo to [Railway](https://railway.app) as a Docker-based service.

## Prerequisites

```bash
# Login to get JWT
do login
```

## Quick Deploy

### Via Railway Dashboard

1. Create a new project on Railway
2. Connect your GitHub repository
3. Railway will auto-detect `railway.json`
4. Set environment variables in the Railway dashboard

### Via CLI

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login

# Initialize project
railway init

# Deploy
railway up
```

## Environment Variables

Set these in the Railway dashboard or via CLI:

```bash
railway variables set WORKOS_AUTH_DOMAIN=your-auth-domain.workos.com
railway variables set JWT_TOKEN=$(cat ~/.dotdo/jwt)
```

| Variable | Required | Description |
|----------|----------|-------------|
| `WORKOS_AUTH_DOMAIN` | Yes | WorkOS auth domain for JWT validation |
| `JWT_TOKEN` | Yes | JWT from `do login` for R2 storage access |
| `R2_ENDPOINT` | No | Custom S3-compatible endpoint |
| `R2_BUCKET` | No | Custom bucket for Iceberg data |
| `OPENAI_API_KEY` | No | OpenAI API key for AI features |
| `ANTHROPIC_API_KEY` | No | Anthropic API key for AI features |

## Configuration

The `railway.json` configures:
- Docker-based builds using `deploy/docker/Dockerfile`
- Health check at `/health`
- Automatic restart on failure (max 3 retries)

## Storage

For production, use Cloudflare R2 or AWS S3 by setting `R2_ENDPOINT` and `R2_BUCKET`. The JWT from `do login` authorizes access to your storage.

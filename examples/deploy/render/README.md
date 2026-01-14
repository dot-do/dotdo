# Render Deployment

Deploy dotdo to [Render](https://render.com) as a Docker-based web service.

## Prerequisites

```bash
# Login to get JWT
do login
```

## Quick Deploy

### Via Render Dashboard

1. Connect your GitHub repository to Render
2. Select "Blueprint" deployment
3. Point to `deploy/render/render.yaml`
4. Set environment variables:
   - `WORKOS_AUTH_DOMAIN`: Your WorkOS auth domain
   - `JWT_TOKEN`: JWT from `do login`

### Via CLI

```bash
# Install Render CLI
brew install render

# Deploy
render blueprint apply
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `WORKOS_AUTH_DOMAIN` | Yes | WorkOS auth domain for JWT validation |
| `JWT_TOKEN` | Yes | JWT from `do login` for R2 storage access |
| `R2_ENDPOINT` | No | Custom S3-compatible endpoint |
| `R2_BUCKET` | No | Custom bucket for Iceberg data |
| `OPENAI_API_KEY` | No | OpenAI API key for AI features |
| `ANTHROPIC_API_KEY` | No | Anthropic API key for AI features |

## Scaling

The service is configured to auto-scale:
- Min instances: 1
- Max instances: 10
- Target CPU: 70%
- Target Memory: 80%

Adjust in `render.yaml` or Render dashboard as needed.

## Storage

For production, use Cloudflare R2 or AWS S3. The MinIO service in the blueprint is suspended by default and should only be used for development.

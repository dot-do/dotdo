# fly.io Deployment for dotdo

Deploy dotdo stateless Durable Objects to fly.io for global edge deployment with fast cold starts and easy scaling.

## Why fly.io?

- **Global Edge Deployment**: Deploy to 30+ regions worldwide
- **Fast Cold Starts**: Machines start in ~300ms
- **Auto-scaling**: Scale to zero when idle, scale up on demand
- **Built-in DNS & TLS**: Automatic HTTPS with custom domains
- **Cost Effective**: Pay only for what you use

## Prerequisites

1. **fly.io CLI**: Install the fly CLI
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```

2. **fly.io Account**: Sign up and authenticate
   ```bash
   fly auth signup  # or fly auth login
   ```

3. **Turso Database**: Set up a Turso database for state persistence
   ```bash
   # Install Turso CLI
   curl -sSfL https://get.tur.so/install.sh | sh

   # Create database
   turso db create dotdo
   turso db show dotdo --url  # Get TURSO_URL
   turso db tokens create dotdo  # Get TURSO_TOKEN
   ```

## Quick Start

### 1. Create the App

```bash
cd deploy/fly
fly launch --no-deploy
```

This creates the app on fly.io without deploying yet.

### 2. Set Required Secrets

```bash
# Required: Database connection
fly secrets set TURSO_URL=libsql://your-db.turso.io
fly secrets set TURSO_TOKEN=your-turso-token

# Optional: R2 Storage (for file attachments)
fly secrets set R2_ACCESS_KEY=your-r2-access-key
fly secrets set R2_SECRET_KEY=your-r2-secret-key
fly secrets set R2_ENDPOINT=https://your-account.r2.cloudflarestorage.com

# Optional: AI providers
fly secrets set OPENAI_API_KEY=sk-...
fly secrets set ANTHROPIC_API_KEY=sk-ant-...
```

### 3. Deploy

```bash
# Using the deployment script (recommended)
chmod +x fly-deploy.sh
./fly-deploy.sh

# Or deploy directly
fly deploy
```

### 4. Verify Deployment

```bash
# Check app status
fly status

# Check health endpoint
curl https://dotdo.fly.dev/api/health

# View logs
fly logs
```

## Multi-Region Scaling

Scale to multiple regions for global low-latency:

```bash
# Scale primary region (US East)
fly scale count 2 --region iad

# Scale to Europe
fly scale count 2 --region lhr

# Scale to Asia
fly scale count 2 --region nrt

# Scale to Australia
fly scale count 2 --region syd
```

### Available Regions

| Code | Location | Recommended For |
|------|----------|-----------------|
| `iad` | Ashburn, Virginia | US East Coast |
| `lax` | Los Angeles | US West Coast |
| `lhr` | London | Europe |
| `fra` | Frankfurt | Europe |
| `nrt` | Tokyo | Asia Pacific |
| `sin` | Singapore | Southeast Asia |
| `syd` | Sydney | Australia |
| `gru` | Sao Paulo | South America |

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TURSO_URL` | Yes | Turso/LibSQL database URL |
| `TURSO_TOKEN` | Yes | Turso authentication token |
| `R2_ACCESS_KEY` | No | Cloudflare R2 access key |
| `R2_SECRET_KEY` | No | Cloudflare R2 secret key |
| `R2_ENDPOINT` | No | R2 endpoint URL |
| `OPENAI_API_KEY` | No | OpenAI API key |
| `ANTHROPIC_API_KEY` | No | Anthropic API key |

### VM Configuration

Default VM configuration in `fly.toml`:

```toml
[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"
  cpu_kind = "shared"
  cpus = 1
```

For higher workloads:

```bash
# Upgrade to dedicated CPU
fly scale vm dedicated-cpu-1x

# Increase memory
fly scale memory 1024
```

### Auto-scaling

The app is configured to auto-scale:

- `min_machines_running = 2`: Always keep 2 machines running
- `auto_stop_machines = "suspend"`: Suspend idle machines
- `auto_start_machines = true`: Start machines on incoming requests

Adjust these in `fly.toml` as needed.

## Custom Domain

```bash
# Add custom domain
fly certs add api.yourdomain.com

# Verify DNS
fly certs show api.yourdomain.com
```

Add DNS records as instructed by fly.io.

## Monitoring

### Logs

```bash
# Stream logs
fly logs

# View specific instance
fly logs --instance <instance-id>
```

### Metrics

Access built-in metrics dashboard:

```bash
fly dashboard
```

### Health Checks

The app exposes a health endpoint at `/api/health`:

```bash
curl https://dotdo.fly.dev/api/health
# {"status":"ok","timestamp":"2024-01-15T10:30:00.000Z"}
```

## Troubleshooting

### Deployment Fails

1. Check build logs:
   ```bash
   fly logs --instance builder
   ```

2. Verify secrets are set:
   ```bash
   fly secrets list
   ```

3. Try a fresh deploy:
   ```bash
   fly deploy --force
   ```

### Health Checks Failing

1. Check application logs:
   ```bash
   fly logs
   ```

2. SSH into the machine:
   ```bash
   fly ssh console
   ```

3. Test health endpoint locally:
   ```bash
   fly proxy 8787:8787
   curl http://localhost:8787/api/health
   ```

### High Latency

1. Check machine placement:
   ```bash
   fly status
   ```

2. Add machines closer to users:
   ```bash
   fly scale count 2 --region <region>
   ```

3. Enable HTTP/2:
   Already enabled via `h2_backend = true` in `fly.toml`.

## Cost Optimization

- Use `auto_stop_machines = "suspend"` to pause idle machines
- Start with `shared-cpu-1x` and scale up as needed
- Monitor usage with `fly billing` and `fly dashboard`
- Use regional deployments strategically based on user location

## Comparison with Cloudflare Workers

| Feature | fly.io | Cloudflare Workers |
|---------|--------|-------------------|
| Cold Start | ~300ms | 0ms |
| Execution Model | Container | V8 Isolate |
| Memory | Up to 8GB | 128MB |
| CPU Time | Unlimited | 30s (paid) |
| Durable Objects | Emulated | Native |
| Best For | Stateless compute | Edge-native apps |

Use fly.io when you need:
- More memory or CPU time
- Container-based workloads
- Specific runtime requirements
- Cost-effective scaling

## Files

```
deploy/fly/
  fly.toml          # Main fly.io configuration
  Dockerfile        # Multi-stage Docker build
  .dockerignore     # Files to exclude from build
  fly-deploy.sh     # Deployment automation script
  README.md         # This file
```

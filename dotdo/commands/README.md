# dotdo Commands

This directory contains the implementation of CLI commands for the dotdo package.

## Available Commands

### deploy

Deploys your dotdo project to Cloudflare Workers.

**Usage:**

```bash
dotdo deploy [options]
```

**Options:**

- `-e, --env <environment>` - Environment to deploy to (staging, production, etc.)
- `--dry-run` - Show what would be deployed without actually deploying
- `--name <name>` - Override the worker name
- `--minify` - Minify the deployed script
- `--config <path>` - Path to wrangler.toml configuration file
- `--rollback <version>` - Rollback to a specific deployment version
- `--skip-build` - Skip the build step before deployment

**Features:**

1. **Build Before Deploy**: Automatically validates your deployment with a dry-run build before deploying
2. **Authentication**: Integrates with oauth.do for secure authentication (sets DO_TOKEN)
3. **Environment Selection**: Deploy to different environments (staging, production, etc.)
4. **Secret Management**: Automatically injects DO_TOKEN and DO_API_URL environment variables
5. **Rollback Support**: Easily rollback to previous deployment versions
6. **Wrangler Integration**: Seamlessly wraps wrangler deploy with enhanced features

**Examples:**

```bash
# Deploy to production (default)
dotdo deploy

# Deploy to staging environment
dotdo deploy --env staging

# Deploy with minification
dotdo deploy --minify

# Dry run to see what would be deployed
dotdo deploy --dry-run

# Deploy with custom worker name
dotdo deploy --name my-worker-v2

# Deploy with custom config
dotdo deploy --config wrangler.production.toml

# Rollback to a previous version
dotdo deploy --rollback abc123def

# Skip build validation (faster, but risky)
dotdo deploy --skip-build
```

**Implementation Details:**

- Uses `bunx wrangler deploy` under the hood
- Authenticates via oauth.do (or mock authentication in development)
- Passes through all unknown options to wrangler
- Provides helpful error messages for common issues
- Returns exit code 0 on success, non-zero on failure

**Testing:**

The deploy command is fully tested with 31 test cases covering:
- Module exports
- Authentication flow
- Build-before-deploy logic
- Wrangler command spawning
- Argument forwarding
- Deployment results
- Console output
- Environment variables
- Rollback support
- Error handling

Run tests with:

```bash
npx vitest run dotdo/tests/deploy.test.ts
```

**Architecture:**

The deploy command follows a modular architecture:

1. **Authentication** - Ensures user is logged in via oauth.do
2. **Build Phase** - Validates deployment with `wrangler deploy --dry-run`
3. **Deploy Phase** - Executes actual deployment with `wrangler deploy`
4. **Rollback Path** - Alternative path for rolling back deployments

```
run() → ensureLoggedIn() → buildProject() → wrangler deploy
                         ↘ rollback()
```

**Environment Variables:**

- `DO_TOKEN` - Authentication token (set automatically via oauth.do)
- `DO_API_URL` - Custom API URL (optional, for self-hosted workers.do)

**Exit Codes:**

- `0` - Success
- `1` - Build failure, deployment failure, or error
- `>1` - Other errors (passed through from wrangler)

# dotdo CLI

Self-contained CLI for Durable Objects development. Single binary that includes the full DO runtime for local development.

## Installation

### Quick Install (Recommended)

Download the pre-built binary for your platform:

```bash
# macOS (Apple Silicon)
curl -fsSL https://dotdo.dev/cli/dotdo-darwin-arm64 -o /usr/local/bin/dotdo
chmod +x /usr/local/bin/dotdo

# macOS (Intel)
curl -fsSL https://dotdo.dev/cli/dotdo-darwin-x64 -o /usr/local/bin/dotdo
chmod +x /usr/local/bin/dotdo

# Linux (x64)
curl -fsSL https://dotdo.dev/cli/dotdo-linux-x64 -o /usr/local/bin/dotdo
chmod +x /usr/local/bin/dotdo

# Linux (ARM)
curl -fsSL https://dotdo.dev/cli/dotdo-linux-arm64 -o /usr/local/bin/dotdo
chmod +x /usr/local/bin/dotdo
```

### Build from Source

Requires [Bun](https://bun.sh) >= 1.1.0:

```bash
cd cli
bun install
bun run build:local
./dotdo --help
```

Build for all platforms:

```bash
bun run build:all
# Outputs to cli/dist/
```

## Usage

### Development

```bash
# Start local development server
dotdo dev

# Custom port
dotdo dev --port 3000

# With Cloudflare Tunnel (public URL)
dotdo dev --tunnel

# Without state persistence
dotdo dev --no-persist
```

### Durable Object Operations

```bash
# List all DO instances
dotdo do list

# Show DO state
dotdo do show <id>

# Show with storage data
dotdo do show <id> --storage

# Create snapshot
dotdo do save <id>
dotdo do save <id> --label "before-migration"

# List snapshots
dotdo do snapshots <id>

# Restore from snapshot
dotdo do restore <id> <snapshot-id> --force

# Clone DO
dotdo do clone <source-id> <target-id>

# Delete DO
dotdo do delete <id> --force
```

### Deployment

```bash
# Deploy to Cloudflare Workers (default)
dotdo deploy

# Deploy to Vercel
dotdo deploy --target vercel

# Deploy to Fly.io
dotdo deploy --target fly

# Deploy to all configured targets
dotdo deploy --all

# Dry run
dotdo deploy --dry-run
```

### Tunnel

```bash
# Start tunnel only (without dev server)
dotdo tunnel

# Custom port
dotdo tunnel --port 3000

# Named tunnel (requires CF auth)
dotdo tunnel --name myapp
```

### Other Commands

```bash
# Initialize new project
dotdo init

# Build project
dotdo build

# Stream production logs
dotdo logs
```

## Configuration

The CLI reads configuration from multiple sources (in order of priority):

1. Environment variables
2. `dotdo.config.ts`
3. `package.json` `dotdo` field
4. `wrangler.toml` / `wrangler.jsonc`

### dotdo.config.ts

```typescript
import type { DotdoConfig } from 'dotdo/cli'

export default {
  // Project settings
  name: 'my-app',
  entryPoint: 'index.ts',
  port: 8787,

  // Cloudflare settings
  compatibilityDate: '2024-01-01',
  compatibilityFlags: ['nodejs_compat'],

  // Persistence
  persist: true, // or path: '.dotdo/data'

  // Deploy targets
  deploy: {
    cloudflare: true,
    vercel: false,
    fly: false,
  },
} satisfies DotdoConfig
```

### Environment Variables

```bash
DOTDO_PORT=8787
DOTDO_HOST=localhost
CLOUDFLARE_ACCOUNT_ID=...
```

## Directory Structure

```
cli/
├── main.ts               # Entry point
├── build.ts              # Build script
├── package.json          # Dependencies
├── commands/
│   ├── dev-local.ts      # dotdo dev
│   ├── do-ops.ts         # dotdo do:*
│   ├── tunnel.ts         # dotdo tunnel
│   └── deploy-multi.ts   # dotdo deploy
├── runtime/
│   ├── miniflare-adapter.ts
│   ├── do-registry.ts
│   └── embedded-db.ts
└── utils/
    ├── config.ts
    └── logger.ts
```

## Requirements

- Bun >= 1.1.0 (for development/building)
- The compiled binary runs standalone (no Bun required)

### Binary Size

The self-contained binary is approximately 55-60 MB depending on the platform. This includes the embedded Bun runtime which enables standalone execution without requiring Bun to be installed on the target system.

## Platform Support

| Platform       | Architecture | Status |
| -------------- | ------------ | ------ |
| macOS          | ARM64 (M1+)  | ✅     |
| macOS          | x64          | ✅     |
| Linux          | x64          | ✅     |
| Linux          | ARM64        | ✅     |
| Windows        | x64          | ✅     |

## Development

```bash
# Run CLI in development
bun run main.ts dev

# Run tests
bun test

# Type check
bun run typecheck
```

## License

MIT

# Primitive Git Ops

**Git without servers. Git without VMs.**

A demonstration of git operations running in a V8 isolate using Durable Object SQLite storage.

## Features

- **Repository Operations**: Init, clone, status
- **Staging/Commits**: Add, commit, log, diff
- **Branching**: Branches, checkout, merge
- **Remote Operations**: Sync, push
- **File Operations**: Read, write, delete files
- **High-Level Workflows**: Deploy feature, review PR, merge PR

## Key dotdo Patterns

### Scheduled Sync

```typescript
// Sync fork every hour
this.$.every.hour(async () => {
  await this.syncWithUpstream()
})

// Daily backup at 3am
this.$.every.day.at('3am')(async () => {
  await this.createBackup()
})
```

### Event-Driven Git

```typescript
this.$.on.Git.pushed(async (event) => {
  const { branch, commit } = event.payload
  // Trigger CI/CD pipeline
})

this.$.on.Git.merged(async (event) => {
  const { prNumber, targetBranch } = event.payload
  // Notify team, update dashboard
})
```

## API Endpoints

### Repository Operations

| Method | Path | Description |
|--------|------|-------------|
| POST | `/init` | Initialize repository |
| POST | `/clone` | Clone from URL |
| GET | `/status` | Get repository status |

### Staging and Commits

| Method | Path | Description |
|--------|------|-------------|
| POST | `/add` | Stage files |
| POST | `/commit` | Create commit |
| GET | `/log` | View commit history |
| GET | `/diff` | View changes |

### Branching

| Method | Path | Description |
|--------|------|-------------|
| GET | `/branches` | List branches |
| POST | `/checkout` | Switch/create branch |
| POST | `/merge` | Merge branch |

### Remote Operations

| Method | Path | Description |
|--------|------|-------------|
| POST | `/sync` | Pull from remote |
| POST | `/push` | Push to remote |

### File Operations

| Method | Path | Description |
|--------|------|-------------|
| GET | `/files/*` | Read file |
| PUT | `/files/*` | Write file |
| DELETE | `/files/*` | Delete file |
| GET | `/tree` | List directory |

### High-Level Workflows

| Method | Path | Description |
|--------|------|-------------|
| POST | `/deploy/:feature` | Deploy feature with PR |
| POST | `/review/:pr` | Run code review |
| POST | `/merge-pr/:pr` | Merge pull request |
| POST | `/sync-fork` | Sync fork with upstream |

## Usage Example

```bash
# Initialize repo
curl -X POST http://localhost:8787/init

# Create a file
curl -X PUT http://localhost:8787/files/src/index.ts \
  -H "Content-Type: application/json" \
  -d '{"content": "export const hello = \"world\""}'

# Add and commit
curl -X POST http://localhost:8787/add \
  -H "Content-Type: application/json" \
  -d '{"paths": ["src/index.ts"]}'

curl -X POST http://localhost:8787/commit \
  -H "Content-Type: application/json" \
  -d '{"message": "feat: add hello world", "author": "Agent <agent@dotdo.dev>"}'

# Deploy a feature (creates branch, applies changes, opens PR)
curl -X POST http://localhost:8787/deploy/dark-mode \
  -H "Content-Type: application/json" \
  -d '{
    "changes": [
      {"path": "src/theme.ts", "content": "export const dark = {}"},
      {"path": "src/App.tsx", "content": "// updated"}
    ]
  }'
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     GitOpsDO (V8 Isolate)                   │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   things    │  │   events    │  │    refs     │         │
│  │  (files)    │  │  (commits)  │  │  (branches) │         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘         │
│         │                │                │                 │
│         └────────────────┼────────────────┘                 │
│                          │                                  │
│               ┌──────────┴──────────┐                      │
│               │   SQLite (DO State) │                      │
│               └─────────────────────┘                      │
└─────────────────────────────────────────────────────────────┘
```

## Why This Matters

| Metric | Traditional CI/CD | gitx (DO) |
|--------|-------------------|-----------|
| Cold start | 10-60 seconds | 0ms |
| Memory | 512MB - 4GB | 128MB |
| Cost | $50-500/mo | Pay-per-request |
| Scale | 10-100 concurrent | Unlimited |
| Global | Single region | 300+ cities |

## Running Locally

```bash
npm install
npm run dev
npm test
```

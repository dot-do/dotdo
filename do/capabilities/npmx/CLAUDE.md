# npmx.do - NPM/NPX for Edge Runtimes

## What is npmx?

Edge-native package management - run `npm install` and `npx` commands without Node.js. Uses fsx.do for all filesystem operations (fsx handles tiered storage automatically).

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        npmx.do                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  Registry   │  │  Resolver   │  │      Runner         │ │
│  │  - fetch    │  │  - semver   │  │  - npm run          │ │
│  │  - metadata │  │  - tree     │  │  - npx exec         │ │
│  │  - extract  │  │  - lockfile │  │  - scripts          │ │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘ │
└─────────┼────────────────┼────────────────────┼────────────┘
          │                │                    │
          ▼                ▼                    ▼
┌─────────────────────────────────────────────────────────────┐
│                        fsx.do                               │
│         (handles all storage - SQLite hot, R2 cold)         │
│                                                             │
│   /node_modules/lodash/...     → SQLite (frequently used)   │
│   /cache/lodash-4.17.21.tgz    → R2 (large, cold)          │
└─────────────────────────────────────────────────────────────┘
```

## Key Design Decisions

### 1. fsx.do Handles All Storage
- npmx writes to fsx like a normal filesystem
- fsx auto-tiers: small/hot files → SQLite, large/cold → R2
- No R2 logic in npmx - clean separation of concerns
- Deduplication handled by fsx content-addressable storage

### 2. ESM-First Package Loading
- Use esm.sh/skypack for ESM-compatible packages (no install needed)
- Dynamic import() instead of require() where possible
- Fall back to full extraction for complex packages

### 3. Dependency Resolution
- Full semver resolution like npm
- Lock file support (package-lock.json)
- Workspace/monorepo support

### 4. Script Execution
- Parse package.json scripts
- Environment variable injection
- PATH includes node_modules/.bin
- Integration with bashx.do

## Commands

```bash
# Package installation
npm install lodash
npm install lodash@4.17.21
npm install -D vitest

# Script running
npm run build
npm run test -- --watch
npm start

# Direct execution
npx cowsay hello
npx create-next-app@latest my-app
npx -p typescript tsc --init

# Publishing (future)
npm publish
npm version patch
```

## Integration with bashx

bashx routes npm/npx commands to npmx.do:

```typescript
// In bashx tiered-executor
case 'npm':
case 'npx':
  return this.npmx.execute(command, args)
```

## Project Structure

```
core/                  # Pure library with ZERO Cloudflare dependencies
├── index.ts           # Main exports (semver, resolver, pkg, tarball)
├── package.json       # Published as @dotdo/npmx
├── semver/            # npm-compatible semantic versioning
│   ├── index.ts       # Re-exports all semver functions
│   ├── parse.ts       # Version parsing, SemVer class
│   ├── compare.ts     # Comparison functions (lt, gt, eq, etc.)
│   ├── range.ts       # Range resolution (satisfies, maxSatisfying)
│   └── types.ts       # Type definitions
├── resolver/          # Dependency tree resolution
│   ├── index.ts       # Re-exports, DependencyTreeBuilder
│   ├── tree.ts        # Tree building with circular detection
│   ├── hoisting.ts    # npm-style dependency hoisting
│   ├── lockfile.ts    # package-lock.json v3 generation
│   └── types.ts       # Type definitions
├── package/           # package.json handling
│   └── index.ts       # Parse, validate, resolve exports
└── tarball/           # Tarball extraction and creation
    ├── index.ts       # Re-exports all tarball functions
    ├── decompress.ts  # Gzip compression/decompression
    ├── tar.ts         # USTAR/PAX header parsing
    ├── extract.ts     # Tarball extraction
    ├── create.ts      # Tarball creation
    ├── integrity.ts   # SRI hash calculation
    └── types.ts       # Type definitions

cli/                   # CLI commands (uses core/)
src/                   # Cloudflare-specific implementation
test/                  # Test files
```

## Testing

```bash
npm test              # Watch mode
npm run test:run      # Single run
npm run typecheck     # Type checking
```

## Issue Tracking

Uses **bd** (beads) for TDD workflow:
```bash
bd ready              # Find work
bd show <id>          # View details
bd update <id> --status in_progress
bd close <id>
bd sync
```

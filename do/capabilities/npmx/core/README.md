# @dotdo/npmx

NPM package management for edge runtimes. Semver resolution, dependency trees, tarball extraction, and lockfile generation - all without Node.js.

> This is the same as the root package - npmx is a pure library with no Cloudflare-specific code.

## Installation

```bash
npm install @dotdo/npmx
```

## Features

- **Semver** - Full npm-compatible semantic versioning
- **Dependency Resolution** - Build and hoist dependency trees
- **Tarball Handling** - Extract and create npm packages
- **Lockfile** - Generate package-lock.json v3 format
- **Package Parsing** - Read package.json exports and metadata

## Usage

```typescript
import { semver, resolveDependencies, extractTarball } from '@dotdo/npmx'

// Semver
semver.satisfies('1.2.3', '^1.0.0')  // true

// Resolve tree
const tree = await resolveDependencies({ dependencies: { 'lodash': '^4' } })

// Extract tarball
const files = await extractTarball(buffer)
```

See the [main README](../README.md) for full API documentation.

## License

MIT

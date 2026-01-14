# @dotdo/npmx

NPM package management for edge runtimes. Semver resolution, dependency trees, tarball extraction, and lockfile generation - all without Node.js.

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
- **Managed Service** - Full npm/npx operations via `npmx.do`

## Usage

### Library Usage

```typescript
import {
  semver,
  resolveDependencies,
  extractTarball,
  generateLockfile
} from '@dotdo/npmx'

// Semver operations
semver.satisfies('1.2.3', '^1.0.0')  // true
semver.maxSatisfying(['1.0.0', '1.5.0', '2.0.0'], '^1.0.0')  // '1.5.0'
semver.gt('2.0.0', '1.0.0')  // true

// Resolve dependencies
const tree = await resolveDependencies({
  dependencies: {
    'lodash': '^4.17.0',
    'express': '^4.18.0'
  }
})

// Extract tarball
const files = await extractTarball(tarballBuffer)
// Map<string, Uint8Array>

// Generate lockfile
const lockfile = generateLockfile(tree)
```

### Managed Service (npmx.do)

The managed service provides npm/npx operations via HTTP API:

```typescript
// Get package info
const res = await fetch('https://npmx.do/info/lodash')
const pkg = await res.json()
// { name: 'lodash', version: '4.17.21', ... }

// Search packages
const res = await fetch('https://npmx.do/search?q=express')
const { results } = await res.json()

// Install packages
await fetch('https://npmx.do/install', {
  method: 'POST',
  body: JSON.stringify({
    packages: [{ name: 'lodash' }, { name: 'express', version: '^4.18' }]
  })
})

// Execute npx command
const res = await fetch('https://npmx.do/exec', {
  method: 'POST',
  body: JSON.stringify({
    command: 'cowsay',
    args: ['hello']
  })
})
const { stdout } = await res.json()

// Run package.json script
await fetch('https://npmx.do/run', {
  method: 'POST',
  body: JSON.stringify({ script: 'build' })
})
```

### RPC API

```typescript
// Generic RPC endpoint
await fetch('https://npmx.do/rpc', {
  method: 'POST',
  body: JSON.stringify({
    method: 'install',
    params: { packages: [{ name: 'lodash' }] }
  })
})
```

## Subpath Exports

```typescript
import { parse, satisfies, gt, lt, eq, maxSatisfying } from '@dotdo/npmx/semver'
import { resolve, hoist, DependencyTree } from '@dotdo/npmx/resolver'
import { extract, create, verify } from '@dotdo/npmx/tarball'
import { parsePackageJson, resolveExports } from '@dotdo/npmx/package'
```

## API

### Semver (`@dotdo/npmx/semver`)

- `parse(version: string): SemVer`
- `satisfies(version: string, range: string): boolean`
- `maxSatisfying(versions: string[], range: string): string | null`
- `gt(a: string, b: string): boolean`
- `lt(a: string, b: string): boolean`
- `eq(a: string, b: string): boolean`
- `compare(a: string, b: string): -1 | 0 | 1`

### Resolver (`@dotdo/npmx/resolver`)

- `resolveDependencies(pkg: PackageJson): Promise<DependencyTree>`
- `hoistDependencies(tree: DependencyTree): HoistedTree`
- `detectCircular(tree: DependencyTree): CircularDep[]`

### Tarball (`@dotdo/npmx/tarball`)

- `extractTarball(data: Uint8Array): Promise<Map<string, Uint8Array>>`
- `createTarball(files: Map<string, Uint8Array>): Promise<Uint8Array>`
- `verifyIntegrity(data: Uint8Array, sri: string): boolean`

### Package (`@dotdo/npmx/package`)

- `parsePackageJson(content: string): PackageJson`
- `resolveExports(pkg: PackageJson, subpath: string): string`
- `getMainEntry(pkg: PackageJson): string`

### HTTP Endpoints (npmx.do)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/info/:package` | GET | Get package metadata |
| `/search?q=query` | GET | Search packages |
| `/list` | GET | List installed packages |
| `/install` | POST | Install packages |
| `/exec` | POST | Execute npx command |
| `/run` | POST | Run package.json script |
| `/rpc` | POST | Generic RPC endpoint |

## Related

- [fsx.do](https://fsx.do) - Filesystem for storage
- [bashx.do](https://bashx.do) - Shell execution
- [pyx.do](https://pyx.do) - Python execution

## License

MIT

# API Versioning and Compatibility Contracts

This document establishes the versioning and compatibility contracts for all public APIs in the dotdo ecosystem. These contracts ensure predictable, stable APIs for consumers while allowing the project to evolve.

## Table of Contents

1. [Semantic Versioning Policy](#semantic-versioning-policy)
2. [API Stability Levels](#api-stability-levels)
3. [Breaking Change Guidelines](#breaking-change-guidelines)
4. [Deprecation Process](#deprecation-process)
5. [Package Versioning](#package-versioning)
6. [HTTP API Versioning](#http-api-versioning)
7. [RPC Protocol Versioning](#rpc-protocol-versioning)
8. [Migration Support](#migration-support)

---

## Semantic Versioning Policy

All packages in the dotdo monorepo follow [Semantic Versioning 2.0.0](https://semver.org/) with the format `MAJOR.MINOR.PATCH`:

### Version Components

| Component | When to Increment | Example |
|-----------|-------------------|---------|
| **MAJOR** | Breaking changes to public API | `1.0.0` -> `2.0.0` |
| **MINOR** | New features, backward-compatible | `1.0.0` -> `1.1.0` |
| **PATCH** | Bug fixes, backward-compatible | `1.0.0` -> `1.0.1` |

### Pre-release Versions

Pre-release versions use suffixes:

- **Alpha** (`1.0.0-alpha.1`): Early development, API may change significantly
- **Beta** (`1.0.0-beta.1`): Feature-complete, API stabilizing
- **RC** (`1.0.0-rc.1`): Release candidate, API frozen

### Version 0.x.x

During initial development (versions `0.x.x`):

- Minor version bumps MAY include breaking changes
- Patch versions are still backward-compatible bug fixes
- APIs marked as `@experimental` may change without version bumps

---

## API Stability Levels

All public APIs are classified into stability levels, indicated by JSDoc tags:

### Stable (`@stable` or no tag)

```typescript
/**
 * Creates a new Thing in the store.
 *
 * @stable
 * @since 1.0.0
 */
export function createThing(input: ThingInput): Promise<Thing>
```

- **Guarantee**: No breaking changes without major version bump
- **Deprecation**: Minimum 2 minor versions before removal
- **Support**: Full documentation and migration guides

### Beta (`@beta`)

```typescript
/**
 * Generates TypeScript types from schema definitions.
 *
 * @beta
 * @since 1.2.0
 */
export function generateTypes(options: TypeGenOptions): TypeGenResult
```

- **Guarantee**: May have breaking changes in minor versions
- **Deprecation**: Minimum 1 minor version before removal
- **Support**: Documentation provided, migration assistance best-effort

### Experimental (`@experimental`)

```typescript
/**
 * AI-powered schema inference from sample data.
 *
 * @experimental
 * @since 1.3.0
 */
export function inferSchema(samples: unknown[]): Schema
```

- **Guarantee**: May change or be removed without notice
- **Deprecation**: None required
- **Support**: Limited documentation, no migration guarantees

### Internal (`@internal`)

```typescript
/**
 * Internal helper for SQL query building.
 *
 * @internal
 */
export function buildWhereClause(conditions: WhereConditions): string
```

- **Guarantee**: None - may change at any time
- **Usage**: Should not be used outside the package
- **Note**: Exported for technical reasons but not part of public API

---

## Breaking Change Guidelines

### What Constitutes a Breaking Change

The following changes require a **major version bump**:

#### Type Signature Changes

```typescript
// BREAKING: Changing parameter types
// Before
function createThing(data: ThingInput): Promise<Thing>
// After
function createThing(data: ThingInput, options: CreateOptions): Promise<Thing>

// ACCEPTABLE: Adding optional parameters
function createThing(data: ThingInput, options?: CreateOptions): Promise<Thing>
```

#### Return Type Changes

```typescript
// BREAKING: Narrowing return type
// Before
function getThing(id: string): Promise<Thing | null>
// After
function getThing(id: string): Promise<Thing>  // throws instead of null

// ACCEPTABLE: Widening return type (adding properties)
// Before
interface Thing { id: string; name: string }
// After
interface Thing { id: string; name: string; createdAt?: number }
```

#### Behavioral Changes

```typescript
// BREAKING: Changing default behavior
// Before: Returns empty array for no results
function findThings(query: Query): Promise<Thing[]>
// After: Throws NotFoundError for no results
function findThings(query: Query): Promise<Thing[]>
```

#### Removed or Renamed Exports

```typescript
// BREAKING: Removing exports
export { createThing }  // was: export { createThing, makeThing }

// BREAKING: Renaming exports
export { createEntity as createThing }  // was: export { createThing }
```

### What Is NOT a Breaking Change

- Adding new optional parameters with sensible defaults
- Adding new properties to return types
- Adding new exports
- Bug fixes that align behavior with documentation
- Performance improvements
- Adding new stability levels (beta -> stable)

### Breaking Change Process

1. **Proposal**: Create an issue with `[breaking]` label
2. **RFC Period**: Minimum 2 weeks for community feedback
3. **Deprecation**: Add `@deprecated` to affected APIs
4. **Migration Guide**: Document migration path
5. **Implementation**: Make change in next major version

---

## Deprecation Process

### Deprecation Timeline

| API Stability | Minimum Deprecation Period |
|---------------|---------------------------|
| Stable        | 2 minor versions (minimum 3 months) |
| Beta          | 1 minor version (minimum 6 weeks) |
| Experimental  | None required |

### Deprecation Marking

```typescript
/**
 * Creates a Thing using the legacy API.
 *
 * @deprecated Use `createThing()` instead. Will be removed in v3.0.0.
 * @since 1.0.0
 * @see {@link createThing} for the recommended alternative
 */
export function makeThing(data: ThingInput): Promise<Thing> {
  console.warn('makeThing is deprecated. Use createThing instead.')
  return createThing(data)
}
```

### Deprecation Warnings

Deprecated APIs should:

1. Log a warning on first use (once per process)
2. Include the alternative in the warning message
3. Reference the version when removal is planned
4. Continue to function correctly

```typescript
let warned = false

/** @deprecated Use createThing instead. Removal planned for v3.0.0. */
export function makeThing(data: ThingInput): Promise<Thing> {
  if (!warned) {
    console.warn(
      '[dotdo] makeThing() is deprecated and will be removed in v3.0.0. ' +
      'Use createThing() instead. See https://dotdo.dev/migration/makething'
    )
    warned = true
  }
  return createThing(data)
}
```

### Deprecation Announcement

Deprecations are announced through:

1. **CHANGELOG.md**: Listed in "Deprecated" section
2. **Release Notes**: Highlighted with migration path
3. **Documentation**: API docs updated with deprecation notice
4. **TypeScript**: `@deprecated` JSDoc tag for IDE warnings

---

## Package Versioning

### Monorepo Package Versions

All workspace packages are versioned together:

| Package | Version | Notes |
|---------|---------|-------|
| `dotdo` | `x.y.z` | Main package, re-exports all |
| `@dotdo/do` | `x.y.z` | Durable Object core |
| `@dotdo/db` | `x.y.z` | Database layer |
| `@dotdo/rpc` | `x.y.z` | RPC communication |
| `@dotdo/api` | `x.y.z` | HTTP API layer |
| `@dotdo/ai` | `x.y.z` | AI routing |
| `@dotdo/auth` | `x.y.z` | Authentication |
| `@dotdo/mcp` | `x.y.z` | MCP tools |

### Version Lock

- All packages share the same version number
- A breaking change in ANY package bumps ALL package major versions
- This ensures compatibility across the ecosystem

### Peer Dependencies

Packages specify peer dependencies for external libraries:

```json
{
  "peerDependencies": {
    "hono": "^4.0.0",
    "jose": "^6.0.0"
  }
}
```

---

## HTTP API Versioning

### URL Path Versioning

The HTTP API uses URL path versioning:

```
https://api.dotdo.dev/v1/things
https://api.dotdo.dev/v2/things
```

### Version Lifecycle

| Version | Status | Support |
|---------|--------|---------|
| `v1` | Current | Full support |
| `v2` | Future | In development |
| `v0` | Deprecated | Bug fixes only, removal TBD |

### API Version Headers

Clients can specify version via header:

```http
GET /things HTTP/1.1
Host: api.dotdo.dev
Accept: application/json
X-API-Version: 2024-01-15
```

Date-based versions (`YYYY-MM-DD`) allow pinning to a specific API snapshot.

### Backward Compatibility

- New fields added to responses are always optional
- Existing fields are never removed within a major version
- New required request fields require a new API version

---

## RPC Protocol Versioning

### Protocol Version Header

RPC requests include a protocol version:

```typescript
interface RPCRequest {
  jsonrpc: '2.0'
  method: string
  params?: unknown[]
  id: string | number
  // Protocol extensions
  'x-dotdo-version'?: string  // e.g., '1.0.0'
}
```

### Backward Compatibility

The RPC layer maintains backward compatibility through:

1. **Method Aliasing**: Old method names redirect to new implementations
2. **Parameter Coercion**: Old parameter formats automatically converted
3. **Response Shaping**: Responses shaped to match client's expected version

```typescript
// Server handles both old and new method names
rpcServer.method('createThing', handler)
rpcServer.alias('makeThing', 'createThing')  // deprecated alias
```

### WebSocket Protocol Versioning

WebSocket connections negotiate protocol version during handshake:

```typescript
// Client sends version in connection URL
ws://api.dotdo.dev/ws?protocol=1

// Or via subprotocol
new WebSocket(url, ['dotdo-v1', 'dotdo-v2'])
```

---

## Migration Support

### Migration Guides

Every breaking change includes a migration guide in `/docs/migrations/`:

```
docs/migrations/
  v1-to-v2.md
  v2-to-v3.md
  makething-to-creatething.md
```

### Codemods

For common migrations, we provide automated codemods:

```bash
# Run migration codemod
npx @dotdo/codemod v1-to-v2 ./src

# Preview changes without applying
npx @dotdo/codemod v1-to-v2 ./src --dry-run
```

### Version Compatibility Matrix

| dotdo Version | Node.js | Wrangler | Hono | Breaking From |
|---------------|---------|----------|------|---------------|
| 3.x | 20+ | 4.x | 4.x | 2.x |
| 2.x | 18+ | 3.x | 4.x | 1.x |
| 1.x | 18+ | 3.x | 3.x | - |

### Long-Term Support (LTS)

Major versions receive LTS support:

| Version | Release | Active Support | Security Support |
|---------|---------|----------------|------------------|
| 3.x | Current | 18 months | 24 months |
| 2.x | Previous | 6 months | 18 months |
| 1.x | Legacy | Ended | 6 months |

---

## JSDoc Tag Reference

Use these JSDoc tags consistently across the codebase:

```typescript
/**
 * Brief description of the API.
 *
 * Detailed description with usage examples.
 *
 * @stable - API stability level (stable, beta, experimental, internal)
 * @since 1.0.0 - Version when API was introduced
 * @deprecated Use alternative instead. Removal in vX.0.0.
 * @see {@link OtherAPI} - Related APIs
 * @example
 * ```typescript
 * const thing = await createThing({ name: 'Example' })
 * ```
 */
export function createThing(input: ThingInput): Promise<Thing>
```

### Tag Definitions

| Tag | Purpose | Example |
|-----|---------|---------|
| `@stable` | Marks API as stable | `@stable` |
| `@beta` | Marks API as beta | `@beta` |
| `@experimental` | Marks API as experimental | `@experimental` |
| `@internal` | Marks API as internal | `@internal` |
| `@since` | Version when introduced | `@since 1.2.0` |
| `@deprecated` | Marks API as deprecated | `@deprecated Use X instead` |
| `@see` | Links to related APIs | `@see {@link createThing}` |

---

## Enforcement

### CI/CD Checks

The following checks run in CI:

1. **API Extraction**: `api-extractor` validates public API surface
2. **Breaking Change Detection**: Compares against baseline API report
3. **Deprecation Linting**: Ensures deprecated APIs have warnings
4. **Version Consistency**: Validates all packages have same version

### Review Requirements

Breaking changes require:

- [ ] RFC issue with `[breaking]` label
- [ ] Approval from 2+ maintainers
- [ ] Migration guide written
- [ ] Changelog entry
- [ ] Documentation updated

---

## Questions?

For questions about API versioning or compatibility:

1. Check existing [GitHub Discussions](https://github.com/dotdo/dotdo/discussions)
2. Open a new discussion with the `api-versioning` tag
3. Join the `#api-design` channel on Discord

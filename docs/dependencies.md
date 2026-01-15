# dotdo Dependencies

This document catalogs all dependencies across the dotdo monorepo, explaining their purpose and whether they are required or optional.

## Overview

The dotdo project is organized as a pnpm workspace monorepo with the following structure:

- **Root package** (`dotdo`) - Main runtime/framework
- **Core package** (`@dotdo/core`) - Foundational DO runtime
- **Published packages** (`packages/*`) - Client SDK, React bindings, utilities
- **Capabilities** (`do/capabilities/*`) - Extended primitives (fsx, gitx, bashx)
- **AI primitives** (`ai/primitives/*`) - AI-related packages (submodule)

---

## Root Package (`dotdo`)

### Required Runtime Dependencies

These dependencies are essential for the core functionality:

| Package | Version | Purpose |
|---------|---------|---------|
| `hono` | ^4.11.4 | HTTP framework for the Worker layer |
| `drizzle-orm` | ^0.45.1 | SQL ORM for SQLite storage in Durable Objects |
| `zod` | ^4.3.5 | Runtime type validation and schema definition |
| `capnweb` | ^0.4.0 | Cap'n Web RPC protocol implementation |
| `xstate` | ^5.25.0 | State machine library for workflow orchestration |
| `jose` | ^6.1.3 | JWT/JWS/JWE handling for authentication |
| `sqids` | ^0.3.0 | Short unique ID generation |
| `commander` | ^14.0.2 | CLI argument parsing |
| `@dotdo/core` | workspace:* | Internal core DO runtime |

### UI/Frontend Dependencies

Required for the app and dashboard:

| Package | Version | Purpose |
|---------|---------|---------|
| `react` | ^19.2.3 | UI framework |
| `react-dom` | ^19.2.3 | React DOM renderer |
| `@tanstack/react-router` | ^1.149.3 | Routing |
| `@tanstack/react-start` | ^1.149.4 | SSR/Start framework |
| `lucide-react` | ^0.562.0 | Icon library |
| `@radix-ui/*` | various | Accessible UI primitives |
| `class-variance-authority` | ^0.7.1 | Variant-based styling |
| `clsx` | ^2.1.1 | Conditional classnames |
| `tailwind-merge` | ^3.4.0 | Tailwind class merging |
| `tw-animate-css` | ^1.4.0 | Animation utilities |
| `react-hook-form` | ^7.71.1 | Form handling |
| `recharts` | ^3.6.0 | Charts and data visualization |

### Documentation Dependencies

Used for documentation site:

| Package | Version | Purpose |
|---------|---------|---------|
| `fumadocs-core` | ^16.4.7 | Documentation framework |
| `fumadocs-mdx` | ^14.2.5 | MDX support |
| `fumadocs-openapi` | ^10.2.4 | OpenAPI docs generation |
| `fumadocs-typescript` | ^5.0.1 | TypeScript docs |
| `fumadocs-ui` | ^16.4.7 | Documentation UI components |
| `mdxui` | ^2.1.1 | MDX UI components |
| `@mdxui/*` | various | Marketing/dashboard components |

### Data Format Dependencies

For various data serialization needs:

| Package | Version | Purpose |
|---------|---------|---------|
| `ajv` | ^8.17.1 | JSON Schema validation |
| `ajv-formats` | ^3.0.1 | Format validators for AJV |
| `apache-arrow` | ^21.1.0 | Columnar data format |
| `avsc` | ^5.7.9 | Avro serialization |
| `parquet-wasm` | ^0.7.1 | Parquet file format |

### Database/Query Engine Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@clickhouse/client-web` | ^1.8.0 | ClickHouse for analytics |
| `@duckdb/duckdb-wasm` | 1.33.1-dev18.0 | In-browser SQL analytics |
| `@electric-sql/pglite` | ^0.3.14 | Embedded PostgreSQL |
| `chdb` | ^1.3.0 | ClickHouse embedded |

### Authentication

| Package | Version | Purpose |
|---------|---------|---------|
| `better-auth` | ^1.4.12 | Authentication framework |
| `@better-auth/stripe` | ^1.4.12 | Stripe integration for auth |

### Terminal/Shell

| Package | Version | Purpose |
|---------|---------|---------|
| `@xterm/xterm` | ^6.0.0 | Terminal emulator |
| `@xterm/addon-attach` | ^0.12.0 | WebSocket attachment |
| `@xterm/addon-fit` | ^0.11.0 | Terminal sizing |

### Workspace Dependencies

Internal workspace packages:

| Package | Version | Purpose |
|---------|---------|---------|
| `business-as-code` | workspace:* | Business primitives |
| `digital-tools` | workspace:* | Tool definitions |
| `digital-workers` | workspace:* | Worker/Agent types |

### Development Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | ^5.7.0 | TypeScript compiler |
| `vitest` | ^3.2.4 | Test framework |
| `vite` | ^7.0.0 | Build tool |
| `wrangler` | ^4.59.1 | Cloudflare Workers CLI |
| `@cloudflare/workers-types` | ^4.20260114.0 | Workers type definitions |
| `@cloudflare/vitest-pool-workers` | ^0.12.3 | Workers test pool |
| `@cloudflare/vite-plugin` | ^1.20.3 | Vite plugin for Workers |
| `eslint` | ^9.39.2 | Linting |
| `prettier` | ^3.7.4 | Code formatting |
| `@playwright/test` | ^1.57.0 | E2E testing |
| `drizzle-kit` | ^0.31.8 | Drizzle migrations |
| `tailwindcss` | ^4.1.0 | CSS framework |
| `@changesets/cli` | ^2.29.8 | Version management |
| `typedoc` | ^0.28.16 | API documentation |
| `madge` | ^8.0.0 | Circular dependency detection |
| `tsd` | ^0.33.0 | Type testing |

---

## Core Package (`@dotdo/core`)

### Required Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `drizzle-orm` | ^0.45.0 | SQL ORM for DO storage |

### Peer Dependencies

| Package | Version | Required | Purpose |
|---------|---------|----------|---------|
| `@cloudflare/workers-types` | ^4.0.0 | Yes | Type definitions for Workers runtime |

---

## Published Packages

### `@dotdo/client`

RPC client for connecting to Durable Objects.

| Package | Version | Type | Purpose |
|---------|---------|------|---------|
| `capnweb` | ^0.4.0 | Required | Cap'n Web RPC protocol |

### `@dotdo/react`

React bindings for dotdo.

| Package | Version | Type | Purpose |
|---------|---------|------|---------|
| `@dotdo/client` | >=0.3.0 | Peer (required) | DO client SDK |
| `react` | >=18.0.0 | Peer (required) | React framework |
| `zod` | >=3.0.0 | Peer (optional) | Schema validation |

### `@dotdo/business-as-code`

Business primitives (Organization, Company, etc.).

| Package | Version | Type | Purpose |
|---------|---------|------|---------|
| `zod` | ^3.24.0 | Required | Schema definitions |

### `@dotdo/digital-tools`

Tool, Integration, and Capability types.

| Package | Version | Type | Purpose |
|---------|---------|------|---------|
| `zod` | ^3.24.0 | Required | Schema definitions |

### `@dotdo/digital-workers`

Worker, Agent, and Human types.

| Package | Version | Type | Purpose |
|---------|---------|------|---------|
| `zod` | >=3.0.0 | Peer (optional) | Schema validation |

### `@dotdo/rpc`

Universal SDK wrapper for RPC.

No runtime dependencies - pure TypeScript types.

### `@dotdo/path-utils`

POSIX-style path utilities.

No runtime dependencies - zero-dependency utility library.

### `@dotdo/worker-types`

Shared TypeScript interfaces.

No runtime dependencies - types only.

### `@dotdo/worker-helpers`

Worker utility functions.

No runtime dependencies - types only (uses devDeps for types).

---

## CLI Package (`@dotdo/cli`)

### Required Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `commander` | ^14.0.2 | CLI argument parsing |
| `ink` | ^6.6.0 | React-based terminal UI |
| `react` | ^19.2.3 | For Ink components |
| `miniflare` | ^3.20241205.0 | Local DO simulation |
| `oauth.do` | ^0.1.15 | OAuth client |

### Peer Dependencies

| Package | Version | Required | Purpose |
|---------|---------|----------|---------|
| `better-sqlite3` | ^11.0.0 | Optional | Native SQLite for local dev |

---

## Capability Submodules

### `fsx.do` (Filesystem)

| Package | Version | Type | Purpose |
|---------|---------|------|---------|
| `hono` | ^4.11.3 | Required | HTTP routing |
| `miniflare` | ^3.20241106.0 | Required | Local simulation |
| `pako` | ^2.1.0 | Required | Compression |
| `@mdxui/*` | various | Required | UI components |
| `@opentui/*` | various | Required | Terminal UI |
| `react` | ^18.2.0 | Required | For UI |

### `gitx.do` (Git)

| Package | Version | Type | Purpose |
|---------|---------|------|---------|
| `fsx.do` | ^0.1.0 | Required | Filesystem layer |
| `hono` | ^4.11.3 | Required | HTTP routing |
| `miniflare` | ^3.20241106.0 | Required | Local simulation |
| `pako` | ^2.1.0 | Required | Compression |
| `@icons-pack/react-simple-icons` | ^13.8.0 | Required | Icons |
| `@mdxui/*` | various | Required | UI components |
| `@opentui/*` | various | Required | Terminal UI |
| `react` | ^18.2.0 | Required | For UI |

### `bashx.do` (Bash)

| Package | Version | Type | Purpose |
|---------|---------|------|---------|
| `fsx.do` | 0.1.0 | Required | Filesystem layer |
| `hono` | ^4.11.3 | Required | HTTP routing |
| `fflate` | ^0.8.2 | Required | Fast compression |
| `pako` | ^2.1.0 | Required | Compression |
| `dotdo` | file:../dotdo | Required | Core framework |
| `drizzle-orm` | >=0.30.0 | Peer (optional) | Database |
| `mcp.do` | * | Peer (optional) | MCP integration |
| `rpc.do` | * | Peer (optional) | RPC layer |

---

## App Package (`dotdo-app`)

Private package for the frontend application.

| Package | Version | Type | Purpose |
|---------|---------|------|---------|
| `react` | ^19.2.3 | Required | UI framework |
| `react-dom` | ^19.2.3 | Required | DOM renderer |
| `@tanstack/react-router` | ^1.144.0 | Required | Routing |
| `@tanstack/react-start` | ^1.145.5 | Required | SSR |
| `@tanstack/react-form` | ^1.27.7 | Required | Forms |
| `@tanstack/react-table` | ^8.21.3 | Required | Data tables |
| `@dotdo/react` | workspace:* | Required | DO bindings |
| `@radix-ui/react-slot` | ^1.2.4 | Required | UI primitives |
| `zod` | ^3.23.0 | Required | Validation |

---

## Dependency Categories Summary

### Zero-Dependency Packages

These packages have no runtime dependencies (types/utilities only):

- `@dotdo/rpc`
- `@dotdo/path-utils`
- `@dotdo/worker-types`
- `@dotdo/worker-helpers`

### Minimal Dependencies (1-2)

- `@dotdo/core` - Only `drizzle-orm`
- `@dotdo/client` - Only `capnweb`
- `@dotdo/business-as-code` - Only `zod`
- `@dotdo/digital-tools` - Only `zod`

### Optional Peer Dependencies

These are not required but enhance functionality:

| Package | Used By | Purpose |
|---------|---------|---------|
| `zod` | `@dotdo/react`, `@dotdo/digital-workers` | Runtime validation |
| `better-sqlite3` | `@dotdo/cli` | Native SQLite |
| `drizzle-orm` | `bashx.do` | Database layer |
| `mcp.do` | `bashx.do` | MCP protocol |
| `rpc.do` | `bashx.do` | RPC layer |

---

## pnpm Overrides

The root `package.json` includes these pnpm overrides:

```json
{
  "overrides": {
    "esbuild": ">=0.25.0",
    "@smithy/config-resolver": ">=4.4.0"
  }
}
```

**Purpose:**
- `esbuild` - Ensures consistent bundler version across packages
- `@smithy/config-resolver` - Fixes AWS SDK compatibility

---

## Ignored Built Dependencies

```json
{
  "ignoredBuiltDependencies": ["sharp", "workerd"]
}
```

**Purpose:**
- `sharp` - Image processing (optional, platform-specific)
- `workerd` - Cloudflare runtime (installed separately by wrangler)

---

## Engine Requirements

| Engine | Version | Notes |
|--------|---------|-------|
| Node.js | >=18.0.0 | Required for all packages |
| Bun | >=1.1.0 | Optional, used by CLI |
| pnpm | 9.0.0 | Package manager (ai/primitives) |

---

## Version Policy

- **Workspace packages** use `workspace:*` for internal dependencies
- **Peer dependencies** use flexible ranges (e.g., `>=3.0.0`)
- **Runtime dependencies** pin to major.minor (e.g., `^4.11.4`)
- **Dev dependencies** use caret ranges for automatic updates

---

## Adding Dependencies

When adding new dependencies:

1. **Prefer peer dependencies** for libraries consumers may already have
2. **Mark as optional** when the feature works without it
3. **Use workspace protocol** for internal packages
4. **Add to this document** with purpose explanation
5. **Run typecheck** to ensure compatibility

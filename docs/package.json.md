# Root package.json Dependencies Reference

This document provides inline documentation for dependencies in the root `package.json`.

## Dependencies

### Core Runtime (Required)

```jsonc
{
  // Internal workspace packages
  "@dotdo/core": "workspace:*",           // Foundational DO runtime (required)
  "business-as-code": "workspace:*",      // Business primitives (Organization, Company)
  "digital-tools": "workspace:*",         // Tool/Integration type definitions
  "digital-workers": "workspace:*",       // Worker/Agent type definitions

  // HTTP & RPC Layer
  "hono": "^4.11.4",                      // Fast HTTP framework for Workers (required)
  "capnweb": "^0.4.0",                    // Cap'n Web RPC protocol (required for DO RPC)
  "@hono/zod-openapi": "^1.2.0",          // OpenAPI schema generation from Zod

  // Database & ORM
  "drizzle-orm": "^0.45.1",               // SQL ORM for SQLite in DOs (required)

  // Validation & Types
  "zod": "^4.3.5",                        // Runtime validation (required)
  "ajv": "^8.17.1",                       // JSON Schema validation
  "ajv-formats": "^3.0.1",                // Format validators for AJV

  // State Management
  "xstate": "^5.25.0",                    // State machines for workflows

  // Authentication
  "better-auth": "^1.4.12",               // Auth framework
  "@better-auth/stripe": "^1.4.12",       // Stripe integration for auth
  "jose": "^6.1.3",                       // JWT/JWS/JWE handling

  // CLI
  "commander": "^14.0.2",                 // CLI argument parsing
  "bun": "^1.3.6",                        // Bun runtime (for CLI)

  // Utilities
  "sqids": "^0.3.0",                      // Short unique ID generation
}
```

### Data Format Dependencies

```jsonc
{
  // Columnar/Analytics
  "apache-arrow": "^21.1.0",              // Arrow columnar format
  "parquet-wasm": "^0.7.1",               // Parquet file format (WASM)
  "avsc": "^5.7.9",                       // Avro serialization

  // Query Engines
  "@clickhouse/client-web": "^1.8.0",     // ClickHouse analytics
  "@duckdb/duckdb-wasm": "1.33.1-dev18.0", // In-browser SQL (DuckDB)
  "@electric-sql/pglite": "^0.3.14",      // Embedded PostgreSQL
  "chdb": "^1.3.0",                       // ClickHouse embedded
}
```

### UI/Frontend Dependencies

```jsonc
{
  // React Core
  "react": "^19.2.3",                     // UI framework (required for app)
  "react-dom": "^19.2.3",                 // React DOM renderer

  // Routing & SSR
  "@tanstack/react-router": "^1.149.3",   // Type-safe routing
  "@tanstack/react-start": "^1.149.4",    // SSR framework

  // UI Primitives
  "@radix-ui/react-checkbox": "^1.3.3",   // Accessible checkbox
  "@radix-ui/react-dialog": "^1.1.15",    // Accessible dialog/modal
  "@radix-ui/react-dropdown-menu": "^2.1.16", // Dropdown menus
  "@radix-ui/react-label": "^2.1.8",      // Form labels
  "@radix-ui/react-select": "^2.2.6",     // Select input
  "@radix-ui/react-separator": "^1.1.8",  // Visual separator
  "@radix-ui/react-slot": "^1.2.4",       // Slot composition

  // Styling Utilities
  "class-variance-authority": "^0.7.1",   // Variant-based styling
  "clsx": "^2.1.1",                       // Conditional classnames
  "tailwind-merge": "^3.4.0",             // Merge Tailwind classes
  "tw-animate-css": "^1.4.0",             // Animation utilities

  // Forms & Data
  "react-hook-form": "^7.71.1",           // Form state management
  "recharts": "^3.6.0",                   // Charts/visualization
  "lucide-react": "^0.562.0",             // Icon library
}
```

### Documentation Dependencies

```jsonc
{
  // Fumadocs (Documentation Framework)
  "fumadocs-core": "^16.4.7",             // Core docs framework
  "fumadocs-mdx": "^14.2.5",              // MDX support
  "fumadocs-openapi": "^10.2.4",          // OpenAPI docs generation
  "fumadocs-typescript": "^5.0.1",        // TypeScript docs
  "fumadocs-ui": "^16.4.7",               // UI components

  // MDXUI (Marketing/Dashboard)
  "mdxui": "^2.1.1",                      // MDX components
  "@mdxui/beacon": "^2.1.1",              // Marketing components
  "@mdxui/cockpit": "^2.1.1",             // Dashboard components
  "@mdxui/primitives": "^2.1.1",          // Base primitives
  "@mdxui/themes": "^2.1.1",              // Theme system
}
```

### Terminal Dependencies

```jsonc
{
  "@xterm/xterm": "^6.0.0",               // Terminal emulator
  "@xterm/addon-attach": "^0.12.0",       // WebSocket attachment
  "@xterm/addon-fit": "^0.11.0",          // Terminal sizing
}
```

### Extended Primitives

```jsonc
{
  "bashx": "npm:bashx.do@^0.1.1",         // AI-enhanced bash execution
}
```

### Other

```jsonc
{
  "@cloudflare/sandbox": "^0.6.11",       // Cloudflare sandbox utilities
  "server-only": "^0.0.1",                // React server-only marker
}
```

---

## devDependencies

### Build & Bundle

```jsonc
{
  "typescript": "^5.7.0",                 // TypeScript compiler (required)
  "vite": "^7.0.0",                       // Build tool
  "@vitejs/plugin-react": "^4.5.2",       // React plugin for Vite
  "vite-tsconfig-paths": "^6.0.4",        // Path alias support
}
```

### Testing

```jsonc
{
  "vitest": "^3.2.4",                     // Test framework (required)
  "@vitest/coverage-v8": "^3.2.4",        // Code coverage
  "@vitest/expect": "3.2.4",              // Assertions
  "@vitest/runner": "^3.2.4",             // Test runner
  "@vitest/snapshot": "^3.2.4",           // Snapshot testing
  "@vitest/spy": "3.2.4",                 // Spies/mocks
  "@vitest/utils": "3.2.4",               // Test utilities
  "@testing-library/react": "^16.3.1",    // React testing utilities
  "@testing-library/user-event": "^14.6.1", // User event simulation
  "jsdom": "^27.4.0",                     // DOM simulation
  "@playwright/test": "^1.57.0",          // E2E testing
}
```

### Cloudflare Workers

```jsonc
{
  "wrangler": "^4.59.1",                  // Cloudflare Workers CLI (required)
  "@cloudflare/workers-types": "^4.20260114.0", // Type definitions
  "@cloudflare/vitest-pool-workers": "^0.12.3", // Workers test pool
  "@cloudflare/vite-plugin": "^1.20.3",   // Vite plugin
}
```

### Linting & Formatting

```jsonc
{
  "eslint": "^9.39.2",                    // Linting
  "@typescript-eslint/eslint-plugin": "^8.53.0", // TypeScript rules
  "@typescript-eslint/parser": "^8.53.0", // TypeScript parser
  "prettier": "^3.7.4",                   // Code formatting
}
```

### Database Tools

```jsonc
{
  "drizzle-kit": "^0.31.8",               // Drizzle migrations/studio
  "better-sqlite3": "^12.6.0",            // Native SQLite for dev
  "node-sql-parser": "^5.4.0",            // SQL parsing
  "pgsql-parser": "^17.9.11",             // PostgreSQL parsing
}
```

### Type Definitions

```jsonc
{
  "@types/node": "^25.0.8",               // Node.js types
  "@types/react": "^19.2.8",              // React types
  "@types/react-dom": "^19.0.0",          // React DOM types
  "@types/better-sqlite3": "^7.6.13",     // SQLite types
  "@types/mdx": "^2.0.0",                 // MDX types
}
```

### Documentation & Release

```jsonc
{
  "typedoc": "^0.28.16",                  // API documentation
  "typedoc-plugin-markdown": "^4.9.0",    // Markdown output
  "@changesets/cli": "^2.29.8",           // Version management
  "@changesets/changelog-github": "^0.5.2", // GitHub changelog
}
```

### Styling

```jsonc
{
  "tailwindcss": "^4.1.0",                // CSS framework
  "@tailwindcss/vite": "^4.1.0",          // Vite integration
}
```

### Forms

```jsonc
{
  "@tanstack/react-form": "^1.27.7",      // Form library
  "@tanstack/zod-form-adapter": "^0.42.1", // Zod integration
}
```

### Analysis & Utilities

```jsonc
{
  "madge": "^8.0.0",                      // Circular dependency detection
  "tsd": "^0.33.0",                       // Type testing
  "globals": "^17.0.0",                   // Global definitions for ESLint
  "smol-toml": "^1.6.0",                  // TOML parsing
}
```

---

## pnpm Configuration

### Overrides

```jsonc
{
  "pnpm": {
    "overrides": {
      // Ensure consistent bundler version
      "esbuild": ">=0.25.0",
      // Fix AWS SDK compatibility issues
      "@smithy/config-resolver": ">=4.4.0"
    }
  }
}
```

### Ignored Built Dependencies

```jsonc
{
  "pnpm": {
    "ignoredBuiltDependencies": [
      "sharp",   // Image processing - optional, platform-specific
      "workerd"  // Cloudflare runtime - installed separately by wrangler
    ]
  }
}
```

---

## Dependency Classification Summary

| Category | Count | Examples |
|----------|-------|----------|
| Core Runtime | 12 | hono, drizzle-orm, zod, capnweb |
| UI/Frontend | 18 | react, @radix-ui/*, @tanstack/* |
| Data Formats | 7 | apache-arrow, parquet-wasm, duckdb |
| Documentation | 9 | fumadocs-*, mdxui, @mdxui/* |
| Workspace | 4 | @dotdo/core, business-as-code, etc. |
| Dev/Build | 25+ | typescript, vitest, wrangler |

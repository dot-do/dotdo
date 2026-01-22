# ADR-006: Extract Configuration Management into @dotdo/config Package

## Status

Proposed

## Date

2026-01-21

## Context

Configuration in the dotdo v3 architecture is currently scattered across multiple packages and patterns, creating several challenges:

### Current Configuration Patterns

1. **Cloudflare Worker Environment (`env` object)**
   - DO bindings: `env.DO.idFromName()`, `env.DO.get()`
   - Secrets: `env.JWT_SECRET`, `env.DO_INTERNAL_SECRET`
   - API keys: `env.OPENAI_API_KEY`, `env.ANTHROPIC_API_KEY`, `env.AI_GATEWAY_URL`
   - Feature flags: `env.ENVIRONMENT`

2. **Process Environment (`process.env`)**
   - Node.js tests: `process.env.ANTHROPIC_API_KEY`, `process.env.OPENAI_API_KEY`
   - Runtime detection: `process.env.NODE_ENV`
   - Logging: `process.env.DOTDO_LOG_LEVEL`
   - Build tooling: `process.env.NO_COLOR`, `process.env.FORCE_COLOR`

3. **Wrangler Configuration (`wrangler.jsonc`)**
   - DO class bindings and migrations
   - Environment variables via `vars`
   - Secrets management (via `wrangler secret`)

4. **Package-Specific Configuration Interfaces**
   - `@dotdo/do`: `DOAuthGuardConfig`, `CircuitBreakerConfig`, `HibernationConfig`
   - `@dotdo/ai`: `RouterConfig`, `ProviderConfig`
   - `@dotdo/api`: `RateLimiterConfig`, `CORSConfig`
   - `@dotdo/auth`: `AuthConfig`, `GraphAuthConfig`

### Problems with Current Approach

1. **No Type Safety Across Packages**: Each package defines its own config types with no shared validation
2. **Inconsistent Access Patterns**: Some code uses `env.X`, others `process.env.X`
3. **No Centralized Schema**: No single source of truth for required vs optional configuration
4. **Runtime vs Build-Time Confusion**: Unclear which config is available when
5. **Secret Management Fragmentation**: Secrets handled differently across packages
6. **No Default Value Strategy**: Each package handles defaults independently
7. **Testing Complexity**: Tests must mock config differently per package

## Decision

Create a dedicated `@dotdo/config` package that provides:

### 1. Unified Configuration Schema

```typescript
// config/schema.ts
import { z } from 'zod'

export const DotdoConfigSchema = z.object({
  // Environment
  environment: z.enum(['development', 'staging', 'production']).default('development'),

  // AI Providers
  ai: z.object({
    defaultProvider: z.enum(['openai', 'anthropic', 'google', 'cloudflare']).optional(),
    openai: z.object({
      apiKey: z.string().optional(),
      organization: z.string().optional(),
    }).optional(),
    anthropic: z.object({
      apiKey: z.string().optional(),
    }).optional(),
    google: z.object({
      apiKey: z.string().optional(),
    }).optional(),
    gateway: z.object({
      url: z.string().url().optional(),
      token: z.string().optional(),
    }).optional(),
  }).optional(),

  // Authentication
  auth: z.object({
    jwtSecret: z.string().min(32).optional(),
    doInternalSecret: z.string().min(32).optional(),
    jwksUrl: z.string().url().optional(),
    issuer: z.string().optional(),
    audience: z.string().optional(),
    oauth: z.object({
      google: z.object({
        clientId: z.string(),
        clientSecret: z.string(),
      }).optional(),
      github: z.object({
        clientId: z.string(),
        clientSecret: z.string(),
      }).optional(),
    }).optional(),
  }).optional(),

  // Logging
  logging: z.object({
    level: z.enum(['SILENT', 'ERROR', 'WARN', 'INFO', 'DEBUG']).default('INFO'),
    format: z.enum(['json', 'pretty']).default('pretty'),
  }).optional(),

  // Feature Flags
  features: z.record(z.boolean()).optional(),
})

export type DotdoConfig = z.infer<typeof DotdoConfigSchema>
```

### 2. Environment-Aware Loaders

```typescript
// config/loaders.ts
export interface ConfigLoader {
  load(): Promise<Partial<DotdoConfig>>
}

// For Cloudflare Workers (env bindings)
export class CloudflareEnvLoader implements ConfigLoader {
  constructor(private env: Record<string, unknown>) {}

  async load(): Promise<Partial<DotdoConfig>> {
    return {
      environment: this.env.ENVIRONMENT as string,
      ai: {
        openai: { apiKey: this.env.OPENAI_API_KEY as string },
        anthropic: { apiKey: this.env.ANTHROPIC_API_KEY as string },
        gateway: {
          url: this.env.AI_GATEWAY_URL as string,
          token: this.env.AI_GATEWAY_TOKEN as string,
        },
      },
      auth: {
        jwtSecret: this.env.JWT_SECRET as string,
        doInternalSecret: this.env.DO_INTERNAL_SECRET as string,
      },
    }
  }
}

// For Node.js (process.env)
export class ProcessEnvLoader implements ConfigLoader {
  async load(): Promise<Partial<DotdoConfig>> {
    return {
      environment: process.env.NODE_ENV === 'production' ? 'production' : 'development',
      ai: {
        openai: { apiKey: process.env.OPENAI_API_KEY },
        anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
        gateway: {
          url: process.env.AI_GATEWAY_URL,
          token: process.env.AI_GATEWAY_TOKEN,
        },
      },
      logging: {
        level: process.env.DOTDO_LOG_LEVEL as any,
      },
    }
  }
}

// For tests (in-memory)
export class TestConfigLoader implements ConfigLoader {
  constructor(private overrides: Partial<DotdoConfig> = {}) {}

  async load(): Promise<Partial<DotdoConfig>> {
    return this.overrides
  }
}
```

### 3. Configuration Container

```typescript
// config/container.ts
export class ConfigContainer {
  private config: DotdoConfig | null = null
  private loaders: ConfigLoader[] = []

  addLoader(loader: ConfigLoader): this {
    this.loaders.push(loader)
    return this
  }

  async initialize(): Promise<DotdoConfig> {
    // Merge configs from all loaders (later loaders override)
    let merged: Partial<DotdoConfig> = {}

    for (const loader of this.loaders) {
      const partial = await loader.load()
      merged = deepMerge(merged, partial)
    }

    // Validate against schema
    this.config = DotdoConfigSchema.parse(merged)
    return this.config
  }

  get<K extends keyof DotdoConfig>(key: K): DotdoConfig[K] {
    if (!this.config) {
      throw new Error('Config not initialized. Call initialize() first.')
    }
    return this.config[key]
  }

  getRequired<K extends keyof DotdoConfig>(key: K): NonNullable<DotdoConfig[K]> {
    const value = this.get(key)
    if (value === undefined || value === null) {
      throw new Error(`Required config '${key}' is not set`)
    }
    return value as NonNullable<DotdoConfig[K]>
  }
}
```

### 4. Package-Specific Config Adapters

```typescript
// config/adapters/ai.ts
import type { RouterConfig } from '@dotdo/ai'

export function toAIRouterConfig(config: DotdoConfig): RouterConfig {
  const providers: ProviderConfig[] = []

  if (config.ai?.openai?.apiKey) {
    providers.push({ provider: 'openai', apiKey: config.ai.openai.apiKey })
  }
  if (config.ai?.anthropic?.apiKey) {
    providers.push({ provider: 'anthropic', apiKey: config.ai.anthropic.apiKey })
  }

  return { providers }
}

// config/adapters/auth.ts
import type { DOAuthGuardConfig } from '@dotdo/do'

export function toDOAuthConfig(config: DotdoConfig): DOAuthGuardConfig {
  return {
    secret: config.auth?.jwtSecret,
    issuer: config.auth?.issuer,
    audience: config.auth?.audience,
  }
}
```

### 5. Proposed Package Structure

```
config/
├── package.json
├── index.ts              # Main exports
├── schema.ts             # Zod schemas
├── container.ts          # ConfigContainer class
├── loaders/
│   ├── index.ts
│   ├── cloudflare.ts     # CloudflareEnvLoader
│   ├── process.ts        # ProcessEnvLoader
│   ├── file.ts           # FileConfigLoader (dotdo.config.ts)
│   └── test.ts           # TestConfigLoader
├── adapters/
│   ├── index.ts
│   ├── ai.ts             # AI package config adapter
│   ├── auth.ts           # Auth package config adapter
│   ├── do.ts             # DO package config adapter
│   └── api.ts            # API package config adapter
├── utils/
│   ├── merge.ts          # Deep merge utility
│   ├── validate.ts       # Validation helpers
│   └── secrets.ts        # Secret masking utilities
└── tests/
    ├── schema.test.ts
    ├── loaders.test.ts
    └── container.test.ts
```

## Migration Path

### Phase 1: Create Package (Week 1)
1. Create `@dotdo/config` package with schema and container
2. Implement Cloudflare and Node.js loaders
3. Add comprehensive tests

### Phase 2: Integrate with DO Package (Week 2)
1. Create adapter for `DOAuthGuardConfig`
2. Update `@dotdo/do` to optionally accept `ConfigContainer`
3. Maintain backward compatibility with direct config objects

### Phase 3: Integrate with AI Package (Week 2-3)
1. Create adapter for `RouterConfig` and `ProviderConfig`
2. Update `@dotdo/ai` to optionally accept `ConfigContainer`
3. Remove duplicated environment variable reading

### Phase 4: Integrate with API Package (Week 3)
1. Create adapters for rate limiting, CORS, telemetry configs
2. Update `@dotdo/api` to use centralized config

### Phase 5: Integrate with Auth Package (Week 4)
1. Create adapter for `AuthConfig` and `GraphAuthConfig`
2. Migrate OAuth credential handling to centralized config

### Phase 6: Documentation and Cleanup (Week 4-5)
1. Update CLAUDE.md with config documentation
2. Remove deprecated direct `env.X` and `process.env.X` patterns
3. Add migration guide for existing users

## Consequences

### Positive

- **Type Safety**: Single Zod schema validates all configuration at startup
- **Consistency**: One pattern for accessing config across all packages
- **Testability**: Easy to inject test configurations
- **Documentation**: Schema serves as self-documenting configuration reference
- **Secret Safety**: Centralized secret masking in logs
- **Runtime Validation**: Fail fast on invalid config instead of runtime errors
- **Flexibility**: Support for config files, environment variables, and programmatic config

### Negative

- **Additional Dependency**: All packages depend on `@dotdo/config`
- **Migration Effort**: Requires updating all packages to use new pattern
- **Indirection**: One more layer between code and configuration values
- **Bundle Size**: Zod adds ~12KB to bundle (mitigated by tree-shaking)

### Neutral

- **Breaking Change**: Existing direct `env.X` access still works during migration
- **Learning Curve**: Developers need to understand the config container pattern
- **Initialization Timing**: Must ensure config is initialized before use

## Alternatives Considered

### Alternative 1: Extend Existing Pattern

Keep current approach but add type definitions for each `env` property.

**Rejected because:**
- Doesn't solve cross-package type safety
- Requires maintaining types in multiple places
- No validation at runtime

### Alternative 2: Use Cloudflare's Wrangler Types

Generate types from `wrangler.jsonc` schema.

**Rejected because:**
- Only covers Cloudflare environment, not Node.js
- No runtime validation
- Limited to Cloudflare's type generation

### Alternative 3: Convention-Based Config (like Next.js)

Use `dotdo.config.ts` file at project root.

**Partially adopted:**
- FileConfigLoader supports this pattern
- But also need env-based config for secrets (never in files)

## References

- [Zod documentation](https://zod.dev)
- [12-Factor App: Config](https://12factor.net/config)
- [Cloudflare Workers Environment Variables](https://developers.cloudflare.com/workers/configuration/environment-variables/)
- ADR-001: Monorepo Structure (workspace package organization)
- Issue do-xwac: Extract configuration management

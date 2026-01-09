# Bundle Size Options

This guide explains dotdo's tiered bundle system and how to choose the right bundle size for your Durable Objects.

## Why Bundle Size Matters

Cloudflare Workers have strict constraints that make bundle size critical:

- **Cold Start Latency**: Larger bundles take longer to parse and initialize. For high-volume workers handling thousands of requests per second, even 10ms of additional cold start time compounds significantly.
- **Isolate Memory Limits**: Workers have a 128MB memory limit per isolate. Larger bundles consume more baseline memory, leaving less for your application's runtime data.
- **Script Size Limits**: Workers have a 10MB compressed script limit. While dotdo itself won't hit this, large bundles combined with your application code and dependencies can approach it.

### The Problem

The current monolithic `DO.ts` is 7,614 lines producing a ~350KB bundle. This includes everything from basic identity to advanced sharding—even if you only need simple SQLite storage.

## Entry Points

dotdo provides three entry points optimized for different use cases:

| Import | Size | Use Case |
|--------|------|----------|
| `dotdo/tiny` | <15KB | Minimal agents, high-volume workers |
| `dotdo` | ~80KB | Standard use with stores and scheduling |
| `dotdo/full` | ~120KB | Full lifecycle ops (clone, shard, etc.) |

## What's in Each Bundle

### dotdo/tiny (<15KB)

The minimal bundle for lightweight Durable Objects that need persistent state without the full framework:

- **Identity**: `ns` (namespace), `$type` (type identifier)
- **SQLite/Drizzle**: Full database access via `this.db`
- **Basic HTTP**: `fetch()` handler, `/health` endpoint
- **Core Methods**: `initialize()`, `toJSON()`

Best for: Counters, rate limiters, simple state machines, high-volume coordination.

### dotdo (~80KB)

The standard bundle with workflow orchestration and event-driven patterns:

- Everything in `tiny`
- **WorkflowContext** (`$`): The DSL for durable operations
- **Event Handlers**: `$.on.Noun.verb()` pattern for reactive programming
- **All 7 Stores**:
  - `things` - Entity storage
  - `rels` - Relationship graph
  - `actions` - Command log
  - `events` - Event sourcing
  - `search` - Full-text search
  - `objects` - Blob storage
  - `dlq` - Dead letter queue
- **Scheduling**: `$.every.hour()`, `$.every.monday.at('9am')()`, alarm management

Best for: Most applications—user profiles, business logic, event-driven workflows.

### dotdo/full (~120KB)

The complete bundle with advanced lifecycle management:

- Everything in default
- **Lifecycle Operations**:
  - `fork()` - Create independent copy
  - `clone()` - Create linked copy
  - `compact()` - Compress historical data
  - `move()` - Migrate to different location
- **Sharding**:
  - `shard()` - Split into multiple DOs
  - `unshard()` - Merge shards back
  - Routing strategies (consistent-hash, range, random)
- **Branching** (git-like):
  - `branch()` - Create named branch
  - `checkout()` - Switch branches
  - `merge()` - Merge branches
- **Promotion**:
  - `promote()` - Elevate to higher tier
  - `demote()` - Move to lower tier

Best for: Multi-tenant platforms, data-heavy applications, systems requiring horizontal scaling.

## Choosing the Right Bundle

Use this decision tree to select the appropriate bundle:

```
Do you need event handlers ($.on.Noun.verb)?
├─ No → Do you need stores beyond raw SQLite?
│       ├─ No → dotdo/tiny
│       └─ Yes → dotdo
└─ Yes → Do you need clone/shard/lifecycle ops?
         ├─ No → dotdo
         └─ Yes → dotdo/full
```

### Quick Reference

| Requirement | Bundle |
|-------------|--------|
| Just SQLite storage | `dotdo/tiny` |
| Rate limiting / counters | `dotdo/tiny` |
| Event handlers | `dotdo` |
| Scheduling ($.every) | `dotdo` |
| Entity stores | `dotdo` |
| Sharding / horizontal scale | `dotdo/full` |
| Cloning / forking | `dotdo/full` |
| Git-like branching | `dotdo/full` |

## Code Examples

### Minimal Agent (dotdo/tiny)

For high-volume, simple state management:

```typescript
import { DO } from 'dotdo/tiny'
import { eq, sql } from 'drizzle-orm'
import { counters } from './schema'

class CounterDO extends DO {
  async increment() {
    const [result] = await this.db
      .insert(counters)
      .values({ id: this.ns, count: 1 })
      .onConflictDoUpdate({
        target: counters.id,
        set: { count: sql`${counters.count} + 1` }
      })
      .returning()

    return result.count
  }

  async get() {
    const [row] = await this.db
      .select()
      .from(counters)
      .where(eq(counters.id, this.ns))

    return row?.count ?? 0
  }
}
```

### Standard DO (dotdo)

For event-driven business logic:

```typescript
import { DO } from 'dotdo'

class UserDO extends DO {
  async setup() {
    // React to user events
    this.$.on.User.created(async (event) => {
      await this.$.try(() => this.sendWelcomeEmail(event.user))
      await this.things.put('profile', event.user)
    })

    this.$.on.User.upgraded(async (event) => {
      await this.things.update('profile', { plan: event.plan })
      await this.$.Customer(event.user.id).notify({ type: 'upgrade' })
    })

    // Schedule recurring tasks
    this.$.every.day.at('9am')(async () => {
      await this.sendDailyDigest()
    })
  }

  async sendWelcomeEmail(user: User) {
    // Implementation
  }

  async sendDailyDigest() {
    // Implementation
  }
}
```

### Full-Featured DO (dotdo/full)

For advanced lifecycle and scaling:

```typescript
import { DO } from 'dotdo/full'

class ShardedDO extends DO {
  async scale() {
    // Shard when data grows beyond threshold
    const stats = await this.getStats()

    if (stats.rowCount > 1_000_000) {
      await this.shard({
        strategy: 'consistent-hash',
        count: 4,
        key: 'user_id'
      })
    }
  }

  async backup() {
    // Create a point-in-time clone
    const backup = await this.clone({
      name: `backup-${Date.now()}`,
      readonly: true
    })

    return backup.id
  }

  async experimentalFeature() {
    // Create a branch for testing
    await this.branch('experiment-v2')

    // Make changes on the branch
    await this.applyExperimentalChanges()

    // If successful, merge back
    await this.checkout('main')
    await this.merge('experiment-v2')
  }
}
```

## Mixins for Custom Bundles

For fine-grained control, compose your own bundle using mixins:

```typescript
import { DO } from 'dotdo/tiny'
import { withFs, withGit, withSchedule } from 'dotdo/mixins'

// Custom: tiny + filesystem + git (~25KB)
class GitDO extends withGit(withFs(DO)) {
  async saveFile(path: string, content: string) {
    await this.fs.write(path, content)
    await this.git.add(path)
    await this.git.commit(`Update ${path}`)
  }
}

// Custom: tiny + scheduling (~20KB)
class ScheduledDO extends withSchedule(DO) {
  async setup() {
    this.$.every.hour(async () => {
      await this.cleanup()
    })
  }
}
```

### Available Mixins

| Mixin | Size | Provides |
|-------|------|----------|
| `withFs` | ~5KB | `this.fs` - filesystem operations |
| `withGit` | ~8KB | `this.git` - version control |
| `withSchedule` | ~6KB | `$.every.*` scheduling |
| `withStores` | ~15KB | All 7 stores |
| `withLifecycle` | ~20KB | fork, clone, compact, move |
| `withSharding` | ~15KB | shard, unshard, routing |
| `withBranching` | ~10KB | branch, checkout, merge |

## Bundle Size Optimization Tips

### 1. Use tiny for High-Volume Workers

If you're building rate limiters, counters, or coordination primitives that handle thousands of requests per second, the cold start savings compound:

```typescript
// Good: Minimal bundle for hot path
import { DO } from 'dotdo/tiny'

class RateLimiterDO extends DO {
  async check(key: string, limit: number, window: number) {
    // Simple SQLite-based rate limiting
  }
}
```

### 2. Lazy-Load Heavy Capabilities

For operations that run infrequently, consider dynamic imports:

```typescript
import { DO } from 'dotdo'

class UserDO extends DO {
  async exportData() {
    // Only load sharding when needed
    const { ShardManager } = await import('dotdo/full')
    const manager = new ShardManager(this)
    await manager.export()
  }
}
```

### 3. Separate Workers for Heavy Operations

Split high-volume and heavy operations into separate workers:

```typescript
// worker-hot.ts - High volume, tiny bundle
import { DO } from 'dotdo/tiny'
export class CounterDO extends DO { }
export class RateLimiterDO extends DO { }

// worker-heavy.ts - Low volume, full bundle
import { DO } from 'dotdo/full'
export class AnalyticsDO extends DO { }
export class ShardedUserDO extends DO { }
```

### 4. Tree-Shake Unused Stores

If you only need specific stores, import them directly:

```typescript
import { DO } from 'dotdo/tiny'
import { ThingsStore, EventsStore } from 'dotdo/stores'

class MinimalDO extends DO {
  things = new ThingsStore(this)
  events = new EventsStore(this)

  // Only ~20KB instead of ~80KB
}
```

### 5. Monitor Your Bundle

Use Wrangler's size reporting to track bundle growth:

```bash
# Check bundle size
npx wrangler deploy --dry-run --outdir dist

# Analyze what's included
npx esbuild-visualizer dist/worker.js
```

## Migration Guide

### From Monolithic to Tiered

If you're currently using the full DO.ts and want to optimize:

1. **Audit your usage**: Which methods do you actually call?
2. **Start with tiny**: Can your DO work with just SQLite?
3. **Add mixins as needed**: Incrementally add capabilities
4. **Test cold starts**: Measure the improvement

```typescript
// Before: 350KB
import { DO } from 'dotdo'

// After: 15KB + mixins
import { DO } from 'dotdo/tiny'
import { withStores } from 'dotdo/mixins'

class MyDO extends withStores(DO) {
  // Same functionality, smaller bundle
}
```

## Summary

| Bundle | Size | Cold Start | Memory | Use When |
|--------|------|------------|--------|----------|
| `dotdo/tiny` | <15KB | ~5ms | ~2MB | High volume, simple state |
| `dotdo` | ~80KB | ~15ms | ~8MB | Standard applications |
| `dotdo/full` | ~120KB | ~25ms | ~12MB | Complex lifecycle needs |

Choose the smallest bundle that meets your requirements. When in doubt, start with `tiny` and add mixins as needed—it's easier to add capabilities than to remove unused code.

# @dotdo/postgres

**Your Supabase code. Now scales to millions.**

```typescript
// Before (Supabase) - connection limits, RLS complexity, cold starts
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// After (dotdo) - unlimited tenants, physical isolation, edge latency
import { createClient } from '@dotdo/supabase'
const supabase = createClient(this.ctx)

// Your code stays exactly the same
const { data, error } = await supabase
  .from('users')
  .select('*, orders(*), profile:profiles(*)')
  .eq('role', 'admin')
  .order('created_at', { ascending: false })
  .limit(10)
```

**Same code. Same queries. 10,000x more tenants.**

## The Problem

| Supabase/Postgres | dotdo |
|-------------------|-------|
| ~10K connection limit | Unlimited (each DO is isolated) |
| RLS policies (error-prone) | Physical tenant isolation |
| Cold start latency | Microsecond wake from hibernation |
| Single region | 300+ edge cities |
| Shared database | Dedicated SQLite per tenant |

## Migration Guide

### Step 1: Update Import

```diff
- import { createClient } from '@supabase/supabase-js'
+ import { createClient } from '@dotdo/supabase'
```

### Step 2: Remove Connection Config

```diff
- const supabase = createClient(
-   process.env.SUPABASE_URL,
-   process.env.SUPABASE_KEY
- )
+ const supabase = createClient(this.ctx)
```

### Step 3: Remove tenant_id Filters

```diff
  const { data } = await supabase
    .from('users')
    .select('*')
-   .eq('tenant_id', tenantId)  // No longer needed!
```

### Step 4: Delete RLS Policies

Your RLS policies are now physical isolation. Each Durable Object instance IS a tenant boundary. No policy bugs possible.

### Step 5: Deploy

```bash
wrangler deploy
```

Done. Your multi-tenant app now scales to millions.

## Full API Compatibility

### Select with Relations

```typescript
const { data, error } = await supabase
  .from('users')
  .select(`
    id,
    name,
    email,
    teams (*),
    projects (id, name, status),
    profile:profiles (avatar_url, bio)
  `)
  .eq('role', 'member')
  .neq('status', 'inactive')
  .order('created_at', { ascending: false })
  .limit(20)
```

### Insert

```typescript
const { data: user, error } = await supabase
  .from('users')
  .insert({
    email: 'alice@example.com',
    name: 'Alice Chen',
    role: 'admin'
  })
  .select()
  .single()
```

### Upsert

```typescript
const { data, error } = await supabase
  .from('settings')
  .upsert(
    { user_id: 'user-123', theme: 'dark', notifications: true },
    { onConflict: 'user_id' }
  )
```

### Update with Filters

```typescript
const { data, error } = await supabase
  .from('tasks')
  .update({ status: 'done', completed_at: new Date().toISOString() })
  .in('id', ['task-1', 'task-2', 'task-3'])
  .select()
```

### Delete

```typescript
const { error } = await supabase
  .from('sessions')
  .delete()
  .lt('expires_at', new Date().toISOString())
```

### All Filter Operators

```typescript
.eq('column', value)       // Equal
.neq('column', value)      // Not equal
.gt('column', value)       // Greater than
.gte('column', value)      // Greater than or equal
.lt('column', value)       // Less than
.lte('column', value)      // Less than or equal
.like('column', '%pattern%')   // Pattern match (case sensitive)
.ilike('column', '%pattern%')  // Pattern match (case insensitive)
.is('column', null)        // IS NULL / IS TRUE / IS FALSE
.in('column', [1, 2, 3])   // IN array
.contains('tags', ['a'])   // Array contains
.containedBy('tags', ['a', 'b', 'c'])  // Array contained by
```

### Auth (Supabase Auth Compatible)

```typescript
// Sign up
const { data, error } = await supabase.auth.signUp({
  email: 'user@example.com',
  password: 'secure-password-123'
})

// Sign in
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'secure-password-123'
})

// Get current user
const { data: { user } } = await supabase.auth.getUser()

// Sign out
await supabase.auth.signOut()
```

### Storage (Supabase Storage Compatible)

```typescript
// Upload file
const { data, error } = await supabase.storage
  .from('avatars')
  .upload('user-123/avatar.png', file)

// Download file
const { data, error } = await supabase.storage
  .from('avatars')
  .download('user-123/avatar.png')

// Get public URL
const { data } = supabase.storage
  .from('avatars')
  .getPublicUrl('user-123/avatar.png')

// Delete files
await supabase.storage
  .from('avatars')
  .remove(['user-123/avatar.png'])
```

## Architecture

```
Request
   |
   v
+------------------+
|   Hono Router    |  Routes by tenant ID
+------------------+
   |
   | X-Tenant-ID header, path param, or subdomain
   v
+------------------+
|  Durable Object  |  Each tenant = isolated DO
|  (MultiTenantDO) |
+------------------+
   |
   | Supabase-compatible API
   v
+------------------+
|    SQLite DB     |  Physical isolation
|   (per tenant)   |  No RLS needed
+------------------+
```

### How Multi-Tenancy Works

1. **Request arrives** with tenant identifier (header, path, subdomain)
2. **Router extracts** tenant ID and gets DO stub
3. **DO instance** is dedicated to that tenant
4. **SQLite database** inside DO stores only that tenant's data
5. **No cross-tenant queries possible** - isolation is physical

```typescript
// In your Worker
function getTenantDO(env: Env, tenantId: string) {
  const id = env.TENANT_DO.idFromName(tenantId)
  return env.TENANT_DO.get(id)
}

// Each call creates/wakes a dedicated DO for that tenant
const acmeDO = getTenantDO(env, 'acme')     // Acme's data
const globexDO = getTenantDO(env, 'globex') // Globex's data (completely separate)
```

## Running This Example

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Seed demo data for a tenant
curl -X POST http://localhost:8787/tenant/acme/seed

# Query data
curl http://localhost:8787/tenant/acme/users
curl http://localhost:8787/tenant/acme/projects
curl http://localhost:8787/tenant/acme/tasks

# Try different tenants (each isolated)
curl -X POST http://localhost:8787/tenant/globex/seed
curl http://localhost:8787/tenant/globex/users  # Different data!
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/tenant/:id/stats` | Dashboard statistics |
| GET | `/tenant/:id/users` | List users |
| POST | `/tenant/:id/users` | Create user |
| GET | `/tenant/:id/users/:userId` | Get user with relations |
| PATCH | `/tenant/:id/users/:userId` | Update user |
| GET | `/tenant/:id/teams` | List teams |
| POST | `/tenant/:id/teams` | Create team |
| GET | `/tenant/:id/projects` | List projects |
| POST | `/tenant/:id/projects` | Create project |
| GET | `/tenant/:id/tasks` | List tasks (with filters) |
| POST | `/tenant/:id/tasks` | Create task |
| PATCH | `/tenant/:id/tasks/bulk` | Bulk update tasks |
| GET | `/tenant/:id/audit` | Audit logs |
| POST | `/tenant/:id/seed` | Seed demo data |

## Deploy

```bash
# Deploy to Cloudflare
npm run deploy

# Your multi-tenant API is now live at:
# https://compat-postgres-multi-tenant.<your-subdomain>.workers.dev
```

## When to Use This

**Use @dotdo/postgres when:**
- You have many tenants (100+)
- You need physical data isolation
- You want edge latency
- You're hitting Postgres connection limits
- RLS policies are becoming complex

**Keep Supabase when:**
- You need cross-tenant queries
- You have complex SQL that needs Postgres
- You're using Supabase-specific features (Edge Functions, etc.)
- You have a single-tenant application

## Part of dotdo

This is one of 90 API-compatible SDKs in dotdo:

- `@dotdo/supabase` - This package
- `@dotdo/mongo` - MongoDB API on DOs
- `@dotdo/redis` - Redis API on DOs
- `@dotdo/kafka` - Kafka API on DOs
- [See all 90 compat SDKs](https://dotdo.dev/docs/compat)

---

**Build your 1-Person Unicorn.** [dotdo.dev](https://dotdo.dev)

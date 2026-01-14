# @dotdo/supabase

**Supabase for Cloudflare Workers.** Edge-native auth. Cryptographically secure. Zero dependencies.

[![npm version](https://img.shields.io/npm/v/@dotdo/supabase.svg)](https://www.npmjs.com/package/@dotdo/supabase)
[![Tests](https://img.shields.io/badge/tests-178%20passing-brightgreen.svg)](https://github.com/dot-do/dotdo)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why @dotdo/supabase?

**Edge workers can't run Supabase.** The official SDK expects Node.js, PostgreSQL connections, and long-lived processes.

**AI agents need authentication.** They need secure MFA, recovery codes, session management, and real-time subscriptions.

**@dotdo/supabase gives you both:**

```typescript
import { createClient } from '@dotdo/supabase'

// Drop-in replacement - same API, runs on the edge
const supabase = createClient('https://project.supabase.co', 'anon-key')

// Full query builder
const { data } = await supabase
  .from('users')
  .select('id, name, email')
  .eq('active', true)
  .order('created_at', { ascending: false })
  .limit(10)

// Complete auth system
await supabase.auth.signInWithPassword({ email, password })
```

**Scales to millions of agents.** Each agent gets its own isolated database on Cloudflare's edge network. No shared state. No noisy neighbors. Just fast, persistent storage at global scale.

## Installation

```bash
npm install @dotdo/supabase
```

## Quick Start

```typescript
import { createClient } from '@dotdo/supabase'

const supabase = createClient('https://project.supabase.co', 'anon-key')

// Insert
await supabase.from('users').insert({ name: 'Alice', email: 'alice@example.com.ai' })

// Select
const { data } = await supabase.from('users').select('*').eq('active', true)

// Update
await supabase.from('users').update({ active: false }).eq('id', 1)

// Delete
await supabase.from('users').delete().eq('id', 1)

// Auth
const { data: { user } } = await supabase.auth.signUp({
  email: 'user@example.com.ai',
  password: 'secure-password'
})
```

## Features

### Complete Query Builder

Full Supabase query API. All filters, modifiers, and operators.

```typescript
// 18 filter operators
const { data } = await supabase
  .from('products')
  .select('*')
  .gte('price', 10)
  .lte('price', 100)
  .ilike('name', '%widget%')
  .contains('tags', ['sale'])
  .order('price')
  .limit(20)

// Upsert with conflict handling
await supabase
  .from('users')
  .upsert({ id: 1, name: 'Updated' }, { onConflict: 'id' })

// RPC function calls
const { data } = await supabase.rpc('calculate_totals', { user_id: 123 })
```

### Cryptographically Secure MFA

Recovery codes use `crypto.getRandomValues`. No timestamps. No indices. No patterns.

```typescript
import { generateRecoveryCodes } from '@dotdo/supabase'

// Generate 10 recovery codes with 128-bit minimum entropy
const codes = generateRecoveryCodes()
// ['ABCD-EFGH-JKLM-NPQR', 'STUV-WXYZ-2345-6789', ...]

// TOTP enrollment
const { data } = await supabase.auth.mfa.enroll({
  factorType: 'totp',
  friendlyName: 'My Authenticator'
})
// Returns QR code, secret, and URI

// Challenge and verify
const { data: challenge } = await supabase.auth.mfa.challenge({ factorId })
await supabase.auth.mfa.verify({
  factorId,
  challengeId: challenge.id,
  code: '123456'
})
```

**Security guarantees:**
- 128-bit minimum entropy per code set
- Rejection sampling to avoid modulo bias
- No predictable patterns (timestamps, indices)
- Formatted for easy user entry (XXXX-XXXX-XXXX-XXXX)

### Full Auth System

Complete authentication matching Supabase Auth API.

```typescript
// Email/password
await supabase.auth.signInWithPassword({ email, password })

// Magic link
await supabase.auth.signInWithOtp({ email })

// OAuth providers
await supabase.auth.signInWithOAuth({ provider: 'github' })

// Session management
const { data: { session } } = await supabase.auth.getSession()
await supabase.auth.refreshSession()

// Auth state changes
supabase.auth.onAuthStateChange((event, session) => {
  console.log(event, session)
})
```

### Storage API

File storage with buckets, uploads, and signed URLs.

```typescript
// Create bucket
await supabase.storage.createBucket('avatars', { public: true })

// Upload
await supabase.storage.from('avatars').upload('user-123.png', file)

// Download
const { data } = await supabase.storage.from('avatars').download('user-123.png')

// Signed URLs
const { data: { signedUrl } } = await supabase.storage
  .from('private')
  .createSignedUrl('document.pdf', 3600)

// Public URLs
const { data: { publicUrl } } = supabase.storage
  .from('avatars')
  .getPublicUrl('user-123.png')
```

### Realtime Channels

Broadcast, presence, and postgres changes.

```typescript
// Subscribe to database changes
const channel = supabase
  .channel('db-changes')
  .on('postgres_changes', { event: '*', table: 'messages' }, (payload) => {
    console.log('Change:', payload)
  })
  .subscribe()

// Broadcast messages
await channel.send({
  type: 'broadcast',
  event: 'cursor_pos',
  payload: { x: 100, y: 200 }
})

// Presence tracking
await channel.track({ user_id: '123', online: true })
const state = channel.presenceState()
```

### Edge Functions

Invoke serverless functions.

```typescript
const { data, error } = await supabase.functions.invoke('process-image', {
  body: { url: 'https://example.com.ai/image.png' }
})
```

## Durable Object Integration

### As an RPC Service

Keep your DO bundle small - offload database operations:

```toml
# wrangler.toml
[[services]]
binding = "SUPABASE"
service = "supabase-do"
```

```typescript
// Heavy operations via RPC
const { data } = await env.SUPABASE.from('users').select('*')
```

### With dotdo Framework

```typescript
import { DO } from 'dotdo'
import { withSupabase } from '@dotdo/supabase/do'

class MyApp extends withSupabase(DO) {
  async loadUsers() {
    const { data } = await this.$.supabase
      .from('users')
      .select('*')
      .eq('active', true)
  }
}
```

### Extended Configuration

Shard routing, replica configuration, jurisdiction constraints.

```typescript
const supabase = createClient('https://project.supabase.co', 'anon-key', {
  // Shard by tenant for multi-tenancy
  shard: { key: 'tenant_id', count: 16, algorithm: 'consistent' },

  // Read from nearest replica
  replica: {
    readPreference: 'nearest',
    writeThrough: true,
    jurisdiction: 'eu'  // GDPR compliance
  },

  // Bind to DO namespace
  doNamespace: env.SUPABASE_DO,
})
```

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                       @dotdo/supabase                           │
├─────────────────────────────────────────────────────────────────┤
│  Supabase Client API (from, auth, storage, functions, realtime)│
├─────────────────────────────────────────────────────────────────┤
│  Query Builder                    │  Auth Client               │
│  • select/insert/update/delete    │  • signUp/signIn/signOut   │
│  • 18 filter operators            │  • MFA (TOTP + recovery)   │
│  • order/limit/range/single       │  • OAuth providers         │
│  • upsert with conflict handling  │  • Session management      │
├───────────────────────────────────┼────────────────────────────┤
│  Storage Client                   │  Realtime Client           │
│  • Buckets                        │  • Channels                │
│  • Upload/download                │  • Broadcast               │
│  • Signed URLs                    │  • Presence                │
│  • File operations                │  • Postgres changes        │
├─────────────────────────────────────────────────────────────────┤
│                     Durable Object SQLite                       │
└─────────────────────────────────────────────────────────────────┘
```

**Edge Layer (Supabase API)**
- Drop-in replacement for @supabase/supabase-js
- Full type safety with generics
- No external dependencies

**Storage Layer (Durable Object SQLite)**
- Microsecond access latency
- Transactional operations
- Automatic sharding by tenant

## API Reference

### Query Operations

| Method | Description |
|--------|-------------|
| `from(table).select(columns?)` | Select rows with optional column selection |
| `from(table).insert(values)` | Insert single or multiple rows |
| `from(table).update(values)` | Update matching rows |
| `from(table).upsert(values, options?)` | Insert or update on conflict |
| `from(table).delete()` | Delete matching rows |
| `rpc(fn, args?)` | Call stored function |

### Filter Operators

| Method | Description |
|--------|-------------|
| `eq(column, value)` | Equals |
| `neq(column, value)` | Not equals |
| `gt(column, value)` | Greater than |
| `gte(column, value)` | Greater than or equal |
| `lt(column, value)` | Less than |
| `lte(column, value)` | Less than or equal |
| `like(column, pattern)` | Pattern match (case-sensitive) |
| `ilike(column, pattern)` | Pattern match (case-insensitive) |
| `is(column, value)` | Is null/true/false |
| `in(column, values)` | In array |
| `contains(column, value)` | Array contains |
| `containedBy(column, value)` | Array contained by |
| `overlaps(column, value)` | Arrays overlap |
| `textSearch(column, query)` | Full-text search |
| `match(query)` | Match object |
| `not(column, operator, value)` | Negate filter |
| `or(filters)` | OR conditions |
| `filter(column, operator, value)` | Generic filter |

### Modifiers

| Method | Description |
|--------|-------------|
| `order(column, options?)` | Sort results |
| `limit(count)` | Limit rows returned |
| `range(from, to)` | Offset pagination |
| `single()` | Return single row |
| `maybeSingle()` | Return single or null |
| `csv()` | Return as CSV |
| `explain()` | Query plan |

### Auth Methods

| Method | Description |
|--------|-------------|
| `auth.signUp(credentials)` | Create new user |
| `auth.signInWithPassword(credentials)` | Email/password login |
| `auth.signInWithOAuth(options)` | OAuth provider login |
| `auth.signInWithOtp(options)` | Magic link / OTP |
| `auth.signOut()` | Sign out user |
| `auth.getSession()` | Get current session |
| `auth.getUser()` | Get current user |
| `auth.updateUser(attributes)` | Update user data |
| `auth.mfa.enroll(options)` | Enroll MFA factor |
| `auth.mfa.challenge(options)` | Create MFA challenge |
| `auth.mfa.verify(options)` | Verify MFA code |

### MFA Recovery Codes

| Function | Description |
|----------|-------------|
| `generateRecoveryCodes(options?)` | Generate secure recovery codes |
| `RECOVERY_CODE_CONFIG` | Default configuration |

## Comparison

| Feature | @dotdo/supabase | @supabase/supabase-js | Raw D1 |
|---------|-----------------|----------------------|--------|
| Edge Runtime | Yes | No | Yes |
| Query Builder | Yes | Yes | No |
| Full Auth | Yes | Yes | No |
| MFA/TOTP | Yes | Yes | No |
| Secure Recovery Codes | Yes | Partial | No |
| Storage API | Yes | Yes | No |
| Realtime | Yes | Yes | No |
| Zero Dependencies | Yes | No | Yes |
| DO Integration | Yes | No | No |
| Sharding | Yes | No | No |

## Performance

- **178 tests** covering all operations
- **Microsecond latency** for DO SQLite operations
- **Zero cold starts** (Durable Objects)
- **Global distribution** (300+ Cloudflare locations)
- **128-bit entropy** for recovery codes

## Security

Recovery code generation follows security best practices:

```typescript
// Uses crypto.getRandomValues (CSPRNG)
// NOT Math.random(), NOT timestamps, NOT indices

const RECOVERY_CODE_CONFIG = {
  entropyBits: 128,           // NIST minimum for cryptographic keys
  codeCount: 10,              // 10 codes per batch
  charset: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', // 32 chars, no ambiguous l/1/O/0
  groupSize: 4,               // XXXX-XXXX-XXXX-XXXX format
  groupCount: 4,              // 16 chars = 80 bits per code
}
```

Rejection sampling eliminates modulo bias:

```typescript
// Reject values that would cause uneven distribution
const maxUnbiased = 256 - (256 % charsetLength)
if (randomValue < maxUnbiased) {
  chars.push(charset[randomValue % charsetLength])
}
```

## License

MIT

## Related

- [GitHub](https://github.com/dot-do/dotdo)
- [Documentation](https://supabase.do)
- [.do](https://do.org.ai)
- [Platform.do](https://platform.do)

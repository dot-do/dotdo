# @dotdo/payload

**Payload CMS for Cloudflare.** Zero config. Edge-native. One dependency.

[![npm version](https://img.shields.io/npm/v/@dotdo/payload.svg)](https://www.npmjs.com/package/@dotdo/payload)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why @dotdo/payload?

**AI agents need content management.** They generate blogs, manage products, create documentation. They need a CMS that scales.

**Payload is the best open-source CMS.** TypeScript-native, headless, fully customizable. But deploying it means Next.js boilerplate, database configs, hosting decisions.

**@dotdo/payload eliminates all of that.** One file. Define your collections. Done.

```typescript
// payload.config.ts - your entire CMS
import { definePayload, collection } from '@dotdo/payload'

const Posts = collection({
  slug: 'posts',
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'content', type: 'richText' },
    { name: 'author', type: 'relationship', relationTo: 'authors' },
  ],
})

export default definePayload({
  collections: [Posts, Authors, Tags],
})
```

That's it. Run `payload dev`. Full admin UI. REST + GraphQL APIs. Auth built-in.

## Installation

```bash
npm install @dotdo/payload
```

## Quick Start

**1. Create your config:**

```typescript
// payload.config.ts
import { definePayload, collection } from '@dotdo/payload'

const Users = collection({ slug: 'users', auth: true, fields: [] })

const Posts = collection({
  slug: 'posts',
  admin: { useAsTitle: 'title' },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true },
    { name: 'content', type: 'richText' },
    { name: 'publishedAt', type: 'date' },
  ],
})

export default definePayload({ collections: [Users, Posts] })
```

**2. Run it:**

```bash
npx payload dev
```

**3. Open http://localhost:3000/admin**

Create your first user. Start managing content.

## How It Works

```
┌──────────────────────────────────────────────────────────────┐
│  Your Project                                                │
│  ├── payload.config.ts    ← You write this                   │
│  └── wrangler.jsonc       ← D1 binding for deploy            │
├──────────────────────────────────────────────────────────────┤
│  @dotdo/payload (embedded)                                   │
│  ├── Next.js app          ← Admin UI, API routes             │
│  ├── Payload config       ← Wired to your collections        │
│  └── CLI                  ← Symlinks config, runs Next       │
└──────────────────────────────────────────────────────────────┘
```

The entire Next.js app lives inside the package. The CLI symlinks your `payload.config.ts` into the embedded template and runs Next.js from there. You never see the boilerplate.

## Deployment

Deploy to Cloudflare Workers with D1:

```jsonc
// wrangler.jsonc
{
  "name": "my-cms",
  "d1_databases": [{ "binding": "D1", "database_name": "cms" }]
}
```

```bash
npx payload build
npx wrangler deploy
```

Your CMS runs on 300+ edge locations. SQLite (D1) for data. R2 for media. Sub-100ms responses globally.

## Features

### Collections as Code

Define your schema in TypeScript. Get full type safety:

```typescript
const Products = collection({
  slug: 'products',
  admin: { useAsTitle: 'name' },
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'price', type: 'number', required: true },
    { name: 'description', type: 'richText' },
    { name: 'images', type: 'array', fields: [
      { name: 'image', type: 'upload', relationTo: 'media' }
    ]},
    { name: 'category', type: 'relationship', relationTo: 'categories' },
  ],
})
```

### Rich Text Editor

Lexical editor included. Extensible, accessible, modern:

```typescript
{ name: 'content', type: 'richText' }
```

### Relationships

Link collections together:

```typescript
{ name: 'author', type: 'relationship', relationTo: 'users' }
{ name: 'tags', type: 'relationship', relationTo: 'tags', hasMany: true }
```

### Authentication Built-In

Any collection can be auth-enabled:

```typescript
const Users = collection({ slug: 'users', auth: true, fields: [] })
```

### REST & GraphQL

Both APIs generated automatically:

```bash
GET  /api/posts          # List posts
GET  /api/posts/:id      # Get post
POST /api/posts          # Create post
PUT  /api/posts/:id      # Update post
DELETE /api/posts/:id    # Delete post
```

GraphQL at `/api/graphql`.

## API Reference

### definePayload(options)

Create your Payload config:

```typescript
definePayload({
  collections: CollectionConfig[],  // Your collections
  admin?: {
    user?: string,                  // Auth collection slug
    meta?: { titleSuffix?: string } // Browser title
  },
  secret?: string,                  // JWT secret (or PAYLOAD_SECRET env)
  db?: string,                      // SQLite path
})
```

### collection(config)

Define a collection with type inference:

```typescript
const Posts = collection({
  slug: 'posts',
  admin: { useAsTitle: 'title' },
  access: {
    read: () => true,
    create: ({ req }) => !!req.user,
  },
  fields: [...],
})
```

## Example: Blog

A complete blog CMS in one file:

```typescript
import { definePayload, collection } from '@dotdo/payload'

const Users = collection({ slug: 'users', auth: true, fields: [] })

const Authors = collection({
  slug: 'authors',
  admin: { useAsTitle: 'name' },
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'bio', type: 'textarea' },
  ],
})

const Tags = collection({
  slug: 'tags',
  admin: { useAsTitle: 'name' },
  fields: [
    { name: 'name', type: 'text', required: true, unique: true },
  ],
})

const Posts = collection({
  slug: 'posts',
  admin: { useAsTitle: 'title' },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true },
    { name: 'content', type: 'richText' },
    { name: 'author', type: 'relationship', relationTo: 'authors' },
    { name: 'tags', type: 'relationship', relationTo: 'tags', hasMany: true },
    { name: 'publishedAt', type: 'date' },
  ],
})

export default definePayload({
  collections: [Users, Authors, Tags, Posts],
})
```

## Comparison

| Feature | Strapi | Contentful | @dotdo/payload |
|---------|--------|------------|----------------|
| **Pricing** | Self-hosted or $99/mo | $300/mo+ | Free |
| **Hosting** | Your servers | Their cloud | Cloudflare edge |
| **Type Safety** | Partial | None | Full TypeScript |
| **Customization** | Limited | Limited | Complete |
| **Cold Starts** | Seconds | N/A | <5ms |
| **Config Files** | Many | N/A | One |

## With dotdo Framework

Integrate with AI agents:

```typescript
import { DO } from 'dotdo'
import { payload } from '@dotdo/payload'

class ContentAgent extends DO {
  async createPost(topic: string) {
    const content = await this.ai.generate(`Write a blog post about ${topic}`)

    await payload.create({
      collection: 'posts',
      data: {
        title: topic,
        content,
        publishedAt: new Date(),
      },
    })
  }
}
```

## Roadmap

- [ ] Media uploads to R2
- [ ] Custom admin components
- [ ] Live preview
- [ ] Localization
- [ ] Versions & drafts

## License

MIT

## Related

- [Payload CMS](https://payloadcms.com)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [.do Platform](https://platform.do)

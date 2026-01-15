# docs.example.com.ai

A versioned documentation site built on dotdo v2.

## The Problem

Documentation sites need:
- Version management (v1, v2, v3...)
- Hierarchical navigation (page -> sections)
- Instant cache invalidation on updates
- Search across versions
- Clean URLs (`/v2/getting-started`)

Traditional solutions involve separate databases for content, complex caching layers, and custom versioning logic.

## The Solution

dotdo models documentation as semantic Things with version relationships. One Durable Object handles storage, relationships, and real-time invalidation.

```
Version ──┬── Page ──┬── Section
          │          └── Section
          ├── Page ──── Section
          └── Page
```

## Schema

```typescript
import { DO, noun, verb } from 'dotdo'

// Define your documentation types
const Version = noun('Version')   // v1, v2, v3
const Page = noun('Page')         // getting-started, api-reference
const Section = noun('Section')   // installation, configuration

const publish = verb('publish')   // published, publishing
const contain = verb('contain')   // contained, containing
```

## Usage

### Creating a Version

```typescript
const v2 = this.things.create('Version', {
  name: 'v2',
  status: 'current',
  releaseDate: new Date('2025-01-15'),
})
```

### Adding Pages to a Version

```typescript
const gettingStarted = this.things.create('Page', {
  slug: 'getting-started',
  title: 'Getting Started',
  order: 1,
})

// Create version -> page relationship
v2.contains(gettingStarted)
```

### Adding Sections to Pages

```typescript
const installation = this.things.create('Section', {
  slug: 'installation',
  title: 'Installation',
  content: '## Install\n\n```bash\nnpm install dotdo\n```',
  order: 1,
})

gettingStarted.contains(installation)
```

### Querying the Graph

```typescript
// Get all pages for a version
const pages = v2 -> 'Page'

// Get all sections for a page
const sections = gettingStarted -> 'Section'

// Find pages that link to this page (backlinks)
const backlinks = gettingStarted <- 'Page'
```

## Event-Driven Cache Invalidation

```typescript
import { DO } from 'dotdo'

export default DO.extend({
  init() {
    // Invalidate CDN cache when any page updates
    this.on.Page.updated(async (event) => {
      const page = event.thing
      const version = page <- 'Version'

      await this.do(async () => {
        await fetch(`https://cdn.example.com/purge`, {
          method: 'POST',
          body: JSON.stringify({
            paths: [`/${version.name}/${page.slug}`],
          }),
        })
      })
    })

    // Rebuild search index when sections change
    this.on.Section.updated(async (event) => {
      const section = event.thing
      const page = section <- 'Page'

      this.send('search.reindex', { pageId: page.$id })
    })

    // Notify subscribers when new version published
    this.on.Version.published(async (event) => {
      const subscribers = event.thing <- 'Subscriber'
      for (const sub of subscribers) {
        await this.Customer(sub.$id).notify(`New docs version: ${event.thing.name}`)
      }
    })
  }
})
```

## Version Switching

```typescript
// Inside DO.extend:
onRequest() {
  // API endpoint: GET /versions
  this.app.get('/versions', async (c) => {
    const versions = this.things.list('Version')
    return c.json(versions.map(v => ({
      name: v.name,
      status: v.status,
      current: v.status === 'current',
    })))
  })

  // API endpoint: GET /:version/:page
  this.app.get('/:version/:page', async (c) => {
    const { version, page } = c.req.param()

    const versionThing = this.things.find('Version', { name: version })
    const pages = versionThing -> 'Page'
    const pageThing = pages.find(p => p.slug === page)

    if (!pageThing) return c.notFound()

    const sections = pageThing -> 'Section'

    return c.json({
      version: versionThing,
      page: pageThing,
      sections: sections.sort((a, b) => a.order - b.order),
    })
  })
}
```

## Promise Pipelining (Cap'n Web)

True Cap'n Proto-style pipelining: method calls on stubs batch until `await`, then resolve in a single round-trip.

```typescript
// ❌ Sequential - N round-trips
this.on.Version.published(async (event) => {
  const subscribers = event.thing <- 'Subscriber'
  for (const sub of subscribers) {
    await this.Customer(sub.$id).notify(`New version: ${event.thing.name}`)
  }
})

// ✅ Pipelined - fire and forget
this.on.Version.published(async (event) => {
  const subscribers = event.thing <- 'Subscriber'
  subscribers.forEach(sub =>
    this.Customer(sub.$id).notify(`New version: ${event.thing.name}`)
  )
})

// ✅ Pipelined - single round-trip for chained access
const owner = await this.Doc(id).workspace.owner
```

`this.Noun(id)` returns a pipelined stub. Fire-and-forget is valid for side effects like notifications.

## Deploy

```bash
# wrangler.toml
name = "docs-example"

[[durable_objects.bindings]]
name = "DO"
class_name = "DO"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["DO"]
```

```bash
npx wrangler deploy
```

## Next Steps

1. Fork this example
2. Define your doc schema (or use this one)
3. Build your content pipeline (Markdown -> Things)
4. Deploy to Cloudflare

The semantic model scales with your documentation. Add `CodeExample`, `Changelog`, or `Tutorial` as new Nouns. The graph grows naturally.

# wiki.example.com.ai

A collaborative wiki with full edit history built on dotdo.

## The Problem

Team wikis need revision history, conflict resolution, and permissions. Building these from scratch means:

- Custom audit logging tables
- Separate event streams
- Manual permission checks
- Complex revision diffing

## The Solution

In dotdo, **Actions ARE your audit log**. When a user edits a page, that edit is automatically:

- An **event** (something happened)
- An **edge** (user -> page relationship)
- An **audit record** (who did what when)

No extra code. No separate logging.

## Data Model

```typescript
import { noun, verb, thing, action } from 'dotdo'

// Define types
const User = noun('User')
const Page = noun('Page')
const Revision = noun('Revision')

// Define verbs
const edit = verb('edit')      // edited, editing
const create = verb('create')  // created, creating
const view = verb('view')      // viewed, viewing
```

## Creating Pages

```typescript
// Create a user
const alice = thing(User, 'alice', { name: 'Alice Chen', role: 'editor' })

// Create a page
const homepage = thing(Page, 'home', {
  title: 'Welcome',
  content: '# Welcome to our wiki',
  slug: 'home'
})

// Record the creation - this IS the audit log
action(alice, create, homepage)
```

## Recording Edits

Every edit creates an Action that unifies event + edge + audit:

```typescript
// Edit a page
const revision = thing(Revision, {
  pageId: homepage.$id,
  content: '# Welcome to our wiki\n\nUpdated content here.',
  previous: homepage.content
})

// alice.edited(homepage) - automatically logged
const editAction = action(alice, edit, homepage, {
  revisionId: revision.$id,
  summary: 'Added introduction section'
})

// editAction contains:
// - event: { type: 'edited', subject: 'alice', object: 'home', timestamp }
// - edge: { from: 'alice', to: 'home', verb: 'edited' }
// - audit: { actor: 'alice', verb: 'edited', target: 'home', timestamp }
```

## Event Handlers

React to edits in real-time:

```typescript
// Notify watchers when pages are edited
$.on.Page.edited(async (event) => {
  const watchers = await $.things.User.watching(event.object)
  for (const watcher of watchers) {
    await $.send({ type: 'notification', to: watcher.$id, message: `Page edited` })
  }
})

// Index content for search
$.on.Page.created(async (event) => {
  const page = await $.things.Page(event.object)
  await indexThing(page)
})

// Track all changes (wildcard)
$.on.*.edited(async (event) => {
  console.log(`${event.subject} edited ${event.object}`)
})
```

## Promise Pipelining

Promises are stubs. Chain freely, await only when needed.

```typescript
// ❌ Sequential - N round-trips
for (const watcherId of watchers) {
  await $.User(watcherId).notify(pageUpdate)
}

// ✅ Pipelined - fire and forget
watchers.forEach(id => $.User(id).notify(pageUpdate))

// ✅ Pipelined - single round-trip
const author = await $.Page(pageId).getLastRevision().author
```

Only `await` at exit points when you actually need the value. Fire-and-forget is valid for side effects like notifications.

## Querying Revision History

Actions give you revision history for free:

```typescript
// Get all edits to a page
const pageHistory = await $.actions
  .filter({ verb: 'edited', object: pageId })
  .orderBy('timestamp', 'desc')

// Get all edits by a user
const userEdits = await $.actions
  .filter({ verb: 'edited', subject: userId })
  .orderBy('timestamp', 'desc')

// Get recent activity across all pages
const recentActivity = await $.actions
  .filter({ verb: ['created', 'edited'] })
  .orderBy('timestamp', 'desc')
  .limit(50)
```

## Wiki DO Implementation

```typescript
import { DO } from 'dotdo'

export class WikiDO extends DO {
  async editPage(userId: string, pageId: string, content: string, summary: string) {
    const user = await this.things.User(userId)
    const page = await this.things.Page(pageId)

    // Create revision
    const revision = await this.things.Revision.create({
      pageId,
      content,
      previous: page.content
    })

    // Update page content
    await this.things.Page.update(pageId, { content })

    // Record the edit - this IS your audit log
    return this.action(user, edit, page, {
      revisionId: revision.$id,
      summary
    })
  }

  async getPageHistory(pageId: string) {
    return this.actions
      .filter({ object: pageId })
      .orderBy('timestamp', 'desc')
  }

  async getUserContributions(userId: string) {
    return this.actions
      .filter({ subject: userId })
      .orderBy('timestamp', 'desc')
  }
}
```

## Deploy

```bash
# Deploy to wiki.example.com.ai
npm run deploy -- --name wiki-do
```

```toml
# wrangler.toml
name = "wiki"
[[durable_objects.bindings]]
name = "WIKI"
class_name = "WikiDO"
```

## What You Get

Without writing audit code:

- Full edit history per page
- User contribution tracking
- Real-time edit notifications
- Relationship-based permissions
- Semantic search across pages

Actions unify what traditional systems split across events, edges, and audit tables. One write. Three purposes.
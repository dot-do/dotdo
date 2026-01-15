# blog.example.com.ai

A content publishing platform in one Durable Object.

## The Problem

You want to build a blog. Traditional approach:

- Provision a database, caching layer, CDN
- Deploy application servers
- Manage connection pools, replicas, backups
- Pay for idle capacity 24/7

All this for a blog.

## The Solution

One Durable Object. One deployment. Done.

```typescript
import { $, ai, DO } from 'dotdo'

export class BlogDO extends DO {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    // Define your domain
    this.defineNoun('Post')
    this.defineNoun('Author')
    this.defineNoun('Comment')
    this.defineVerb('publish')
    this.defineVerb('write')

    // React to events
    $.on.Post.published(this.notifySubscribers)
    $.on.Comment.created(this.moderateComment)
  }
}
```

## Semantic Model

Your blog domain expressed as Nouns, Verbs, and Things:

```typescript
// Nouns - auto-derive singular/plural
this.defineNoun('Post')      // post, posts
this.defineNoun('Author')    // author, authors
this.defineNoun('Comment')   // comment, comments

// Verbs - auto-derive tenses
this.defineVerb('write')     // wrote, writes, writing
this.defineVerb('publish')   // published, publishes, publishing

// Things - instances with $id and $type
const author = this.createThing('Author', {
  name: 'Jane Smith',
  email: 'jane@example.com'
})

const post = this.createThing('Post', {
  title: 'Getting Started with dotdo',
  content: '...',
  status: 'draft'
})

// Actions - unified event + edge + audit
this.createAction(author.$id, 'write', post.$id)
// Creates:
//   Event: { type: 'wrote', subject: author, object: post }
//   Edge:  author -> post (wrote)
//   Audit: { actor: author, verb: 'wrote', target: post }
```

## Relationships

Navigate your content graph:

```typescript
// Forward: get all posts by an author
const posts = this.forward(author.$id, 'Post')

// Backward: get the author of a post
const [author] = this.backward(post.$id, 'Author')

// Build a post with full context
const fullPost = {
  ...post,
  author: this.backward(post.$id, 'Author')[0],
  comments: this.forward(post.$id, 'Comment'),
  tags: this.forward(post.$id, 'Tag')
}
```

## Event Handlers

React to domain events with `$.on.Noun.verb`:

```typescript
// When a post is published
$.on.Post.published(async (event) => {
  const post = this.getThing(event.subject)
  const subscribers = await this.getSubscribers()

  for (const sub of subscribers) {
    $.send('Notification.created', {
      to: sub.email,
      subject: `New post: ${post.title}`
    })
  }
})

// When a comment is created - auto-moderate with cascade
$.on.Comment.created(async (event) => {
  const comment = this.getThing(event.subject)

  const result = await $.cascade({
    task: 'Moderate comment',
    tiers: {
      code: () => this.checkSpamPatterns(comment),
      generative: () => ai`Is this spam? ${comment.content}`,
      human: () => this.queueForReview(comment)
    }
  })

  if (result.value === 'spam') {
    this.deleteThing(comment.$id)
  }
})

// Wildcard: any entity created
$.on.*.created(async (event) => {
  console.log(`${event.subject} created`)
})
```

## Promise Pipelining

Promises are stubs. Chain freely, await only when needed.

```typescript
// ❌ Sequential - N round-trips
for (const subscriberId of subscribers) {
  await $.Subscriber(subscriberId).notify(newPost)
}

// ✅ Pipelined - fire and forget
subscribers.forEach(id => $.Subscriber(id).notify(newPost))

// ✅ Pipelined - single round-trip
const authorName = await $.Post(postId).getAuthor().name
```

Only `await` at exit points when you need the value. Fire-and-forget is valid for side effects like notifications.

## Scheduling

Automate your blog with `$.every`:

```typescript
// Daily digest at 9am
$.every.day.at('9am')(async () => {
  const newPosts = this.getPostsSince(yesterday)
  if (newPosts.length > 0) await this.sendDigest(newPosts)
})

// Weekly stats every Monday
$.every.Monday.at9am(async () => {
  const stats = this.calculateWeeklyStats()
  await this.notifyAuthors(stats)
})
```

## REST API

Every DO exposes a REST API automatically:

```bash
POST /posts              # Create a post
GET /posts               # List all posts
GET /posts/:id           # Get a post
PATCH /posts/:id         # Update a post
GET /posts/:id/comments  # Get comments on a post
POST /posts/:id/comments # Add a comment
```

## Deploy

```bash
git clone https://github.com/dotdo/examples
cd examples/blog
npm install
npm run deploy
```

Your blog is live at `blog.your-account.workers.dev`

## What You Get

- **Zero infrastructure**: No databases, caches, or servers to manage
- **Instant global**: Deployed to 300+ edge locations
- **SQLite durability**: Data persists in the DO's embedded SQLite
- **Real-time**: WebSocket support built-in
- **Cost-efficient**: Pay only for actual usage

## Learn More

- [dotdo Documentation](https://dotdo.dev/docs)
- [Semantic Types Guide](https://dotdo.dev/docs/semantic)
- [WorkflowContext ($) Reference](https://dotdo.dev/docs/workflow-context)

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
import { DO, ai } from 'dotdo'

export default DO.extend({
  init() {
    // React to events
    this.on.Post.published(this.notifySubscribers)
    this.on.Comment.created(this.moderateComment)
  }
})
```

## Semantic Model

Your blog domain expressed as Nouns, Verbs, and Things:

```typescript
// Things - instances with $id and $type
const author = this.things.create('Author', {
  name: 'Jane Smith',
  email: 'jane@example.com'
})

const post = this.things.create('Post', {
  title: 'Getting Started with dotdo',
  content: '...',
  status: 'draft'
})

// Actions - unified event + edge + audit
this.actions.create(author.$id, 'write', post.$id)
// Creates:
//   Event: { type: 'wrote', subject: author, object: post }
//   Edge:  author -> post (wrote)
//   Audit: { actor: author, verb: 'wrote', target: post }
```

## Relationships

Navigate your content graph:

```typescript
// Forward: get all posts by an author
const posts = this.relationships.forward(author.$id, 'Post')

// Backward: get the author of a post
const [author] = this.relationships.backward(post.$id, 'Author')

// Build a post with full context
const fullPost = {
  ...post,
  author: this.relationships.backward(post.$id, 'Author')[0],
  comments: this.relationships.forward(post.$id, 'Comment'),
  tags: this.relationships.forward(post.$id, 'Tag')
}
```

## Event Handlers

React to domain events with `this.on.Noun.verb`:

```typescript
// When a post is published
this.on.Post.published(async (event) => {
  const post = this.things.get(event.subject)
  const subscribers = await this.getSubscribers()

  for (const sub of subscribers) {
    this.send('Notification.created', {
      to: sub.email,
      subject: `New post: ${post.title}`
    })
  }
})

// When a comment is created - auto-moderate with cascade
this.on.Comment.created(async (event) => {
  const comment = this.things.get(event.subject)

  const result = await this.cascade({
    task: 'Moderate comment',
    tiers: {
      code: () => this.checkSpamPatterns(comment),
      generative: () => ai`Is this spam? ${comment.content}`,
      human: () => this.queueForReview(comment)
    }
  })

  if (result.value === 'spam') {
    this.things.delete(comment.$id)
  }
})

// Wildcard: any entity created
this.on.*.created(async (event) => {
  console.log(`${event.subject} created`)
})
```

## Promise Pipelining (Cap'n Web)

True Cap'n Proto-style pipelining: method calls on stubs batch until `await`, then resolve in a single round-trip.

```typescript
// ❌ Sequential - N round-trips
for (const subscriberId of subscribers) {
  await this.Subscriber(subscriberId).notify(newPost)
}

// ✅ Pipelined - fire and forget
subscribers.forEach(id => this.Subscriber(id).notify(newPost))

// ✅ Pipelined - single round-trip for chained access
const authorName = await this.Post(postId).author.name
```

`this.Noun(id)` returns a pipelined stub. Fire-and-forget is valid for side effects like notifications.

## Scheduling

Automate your blog with `this.every`:

```typescript
// Daily digest at 9am
this.every.day.at('9am')(async () => {
  const newPosts = this.getPostsSince(yesterday)
  if (newPosts.length > 0) await this.sendDigest(newPosts)
})

// Weekly stats every Monday
this.every.Monday.at('9am')(async () => {
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

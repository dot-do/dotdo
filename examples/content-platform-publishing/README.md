# Content Platform Publishing

**Write. Review. Publish. Automated.**

Transform your content operation into an AI-powered publishing machine. From draft to viral, with intelligent SEO optimization, automated social sharing, and human-in-the-loop moderation.

```typescript
import { ArticleDO, AuthorDO, CategoryDO, PublicationDO } from './src/index'

// Multi-DO architecture for scalable content management
// Each article gets its own DO - infinite horizontal scale

// Create an article
const article = await fetch('/api/articles', {
  method: 'POST',
  body: JSON.stringify({
    title: 'How We Built Our AI Pipeline',
    content: '# Introduction\n\nOur journey to AI-powered content...',
    authorId: 'alice',
    categoryId: 'engineering',
    tags: ['ai', 'engineering', 'tutorial']
  })
}).then(r => r.json())

// Submit for review
await fetch(`/api/articles/${article.id}/submit`, { method: 'POST' })

// Approve and schedule for publication
await fetch(`/api/articles/${article.id}/approve`, {
  method: 'POST',
  body: JSON.stringify({
    scheduledAt: '2024-01-20T09:00:00Z'
  })
})
```

## Architecture

Multi-DO design for horizontal scalability:

```
src/
  index.ts              # Hono HTTP routes
  objects/
    Article.ts          # ArticleDO - Content lifecycle, versioning, scheduling
    Author.ts           # AuthorDO - Profiles, roles, permissions
    Category.ts         # CategoryDO - Categories, tags, taxonomy
    Publication.ts      # PublicationDO - Settings, calendar, moderation
  PublishingDO.ts       # Legacy monolithic DO (backward compat)
tests/
  publishing.test.ts    # Comprehensive tests
```

### Durable Objects

| DO | Purpose | Instance Strategy |
|----|---------|-------------------|
| `ArticleDO` | Content lifecycle, versioning, scheduling, analytics | One per article (unique ID) |
| `AuthorDO` | Author profiles, roles, permissions | One per author (named by ID) |
| `CategoryDO` | Categories and tags | Singleton (named "main") |
| `PublicationDO` | Settings, calendar, moderation, stats | Singleton (named "main") |

## Content Lifecycle

```
Draft --> Review --> Scheduled --> Published --> Archived
  |         |           |            |
  v         v           v            v
 Edit    Approve    Reschedule   Archive
          |
          v
      Publish Now
```

Every status change is tracked. Every version is preserved. Roll back anytime.

## Features

### Article Management
- **CRUD Operations**: Create, read, update, delete articles
- **Status Workflow**: Draft -> Review -> Scheduled -> Published -> Archived
- **Version History**: Full version tracking with rollback support
- **Markdown Support**: Write content in Markdown
- **Scheduled Publishing**: Use Cloudflare Alarms for future publication

### AI-Powered SEO
Auto-generated SEO metadata from title and content:
- Meta title and description
- Keywords extraction
- Open Graph image generation

### Multi-Author Support
- Role-based permissions (contributor, author, editor, admin)
- Author profiles with bio, avatar, social links
- Article tracking per author
- View statistics

### Categories and Tags
- Hierarchical category structure
- Unlimited tags per article
- Article counts per category/tag
- Category tree navigation

### Comment Moderation
- AI moderation (Quinn agent simulation)
- Spam detection
- Toxicity filtering
- Human escalation for flagged content

### Editorial Calendar
- Monthly calendar view
- See scheduled and published content
- Upcoming posts list

### Analytics
- View tracking
- Share tracking
- Referrer analysis
- Per-article and aggregate stats

## API Endpoints

### Articles

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/articles` | List articles (with filters) |
| POST | `/api/articles` | Create article |
| GET | `/api/articles/:id` | Get article |
| PUT | `/api/articles/:id` | Update article |
| DELETE | `/api/articles/:id` | Delete article |
| POST | `/api/articles/:id/submit` | Submit for review |
| POST | `/api/articles/:id/approve` | Approve (optional schedule) |
| POST | `/api/articles/:id/publish` | Publish immediately |
| POST | `/api/articles/:id/schedule` | Schedule publication |
| POST | `/api/articles/:id/archive` | Archive article |
| GET | `/api/articles/:id/versions` | Get version history |
| POST | `/api/articles/:id/revert` | Revert to version |
| GET | `/api/articles/:id/analytics` | Get analytics |
| POST | `/api/articles/:id/view` | Track view |

### Authors

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/authors` | Create author |
| GET | `/api/authors/:id` | Get author |
| PUT | `/api/authors/:id` | Update author |
| GET | `/api/authors/:id/stats` | Get author stats |
| GET | `/api/authors/:id/articles` | Get author's articles |

### Categories & Tags

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/categories` | List categories |
| GET | `/api/categories/tree` | Get category tree |
| POST | `/api/categories` | Create category |
| GET | `/api/categories/:id` | Get category |
| PUT | `/api/categories/:id` | Update category |
| DELETE | `/api/categories/:id` | Delete category |
| GET | `/api/tags` | List tags |
| GET | `/api/categories/:id/articles` | Articles in category |
| GET | `/api/tags/:id/articles` | Articles with tag |

### Publication

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/settings` | Get settings |
| PUT | `/api/settings` | Update settings |
| GET | `/api/stats` | Dashboard statistics |
| GET | `/api/calendar/:yearMonth` | Editorial calendar |
| GET | `/api/upcoming` | Upcoming scheduled posts |

### Comments & Moderation

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/articles/:id/comments` | Get comments |
| POST | `/api/articles/:id/comments` | Add comment |
| POST | `/api/comments/:id/approve` | Approve comment |
| POST | `/api/comments/:id/reject` | Reject comment |
| GET | `/api/moderation` | Moderation queue |
| GET | `/api/reviews` | Human review queue |
| POST | `/api/reviews/:id/complete` | Complete review |

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test

# Deploy
npm run deploy
```

## Example Workflows

### Create and Publish Article

```typescript
// 1. Create author
const author = await fetch('/api/authors', {
  method: 'POST',
  body: JSON.stringify({
    id: 'alice',
    name: 'Alice Chen',
    email: 'alice@example.com',
    role: 'editor'
  })
}).then(r => r.json())

// 2. Create article
const article = await fetch('/api/articles', {
  method: 'POST',
  body: JSON.stringify({
    title: 'How We Scaled to 1M Users',
    content: '# Introduction\n\nOur journey...',
    authorId: 'alice',
    categoryId: 'engineering',
    tags: ['scaling', 'durable-objects']
  })
}).then(r => r.json())

// 3. Submit for review
await fetch(`/api/articles/${article.id}/submit`, { method: 'POST' })

// 4. Approve and schedule
await fetch(`/api/articles/${article.id}/approve`, {
  method: 'POST',
  body: JSON.stringify({
    scheduledAt: '2024-01-20T09:00:00Z'
  })
})

// Article will auto-publish at scheduled time via Cloudflare Alarm
```

### Comment Moderation Flow

```typescript
// 1. User adds comment
const comment = await fetch('/api/articles/abc123/comments', {
  method: 'POST',
  body: JSON.stringify({
    author: 'John Reader',
    authorEmail: 'john@example.com',
    content: 'Great article! Very helpful.'
  })
}).then(r => r.json())

// 2. If safe: status = 'pending'
// 3. If flagged by AI: status = 'flagged', human review task created

// 4. Moderator reviews queue
const queue = await fetch('/api/moderation').then(r => r.json())

// 5. Approve or reject
await fetch(`/api/comments/${comment.id}/approve`, { method: 'POST' })
```

## Agents Used

| Agent | Role |
|-------|------|
| Mark | SEO optimization, social content generation |
| Quinn | Comment moderation, content quality checks |

## Human Escalation

When AI flags content that needs human review:

```typescript
// Flagged content creates review task
const reviews = await fetch('/api/reviews').then(r => r.json())

// Human completes review
await fetch(`/api/reviews/${reviewId}/complete`, {
  method: 'POST',
  body: JSON.stringify({
    decision: 'approved', // or 'rejected'
    reviewer: 'alice'
  })
})
```

---

**From draft to viral. With AI assistance.**

Built with [dotdo](https://dotdo.dev) - Build your 1-Person Unicorn

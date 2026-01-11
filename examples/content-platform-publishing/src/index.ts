/**
 * Content Platform Publishing Worker Entry Point
 *
 * Routes requests to multi-DO architecture for content management:
 * - ArticleDO: Content lifecycle (draft -> review -> schedule -> publish)
 * - AuthorDO: Author profiles and permissions
 * - CategoryDO: Categories and tags
 * - PublicationDO: Settings, calendar, moderation, statistics
 *
 * Demonstrates:
 * - Multi-DO coordination
 * - Event-driven publishing workflows
 * - Scheduled publishing with alarms
 * - AI-assisted SEO and moderation
 * - Human-in-the-loop escalation
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'

// Re-export DO classes for Cloudflare to instantiate
export { ArticleDO } from './objects/Article'
export { AuthorDO } from './objects/Author'
export { CategoryDO } from './objects/Category'
export { PublicationDO } from './objects/Publication'

// Also export the legacy PublishingDO for backward compatibility
export { PublishingDO } from './PublishingDO'

// ============================================================================
// TYPES
// ============================================================================

interface Env {
  ARTICLE_DO: DurableObjectNamespace
  AUTHOR_DO: DurableObjectNamespace
  CATEGORY_DO: DurableObjectNamespace
  PUBLICATION_DO: DurableObjectNamespace
  // Legacy binding
  PUBLISHING_DO?: DurableObjectNamespace
}

// ============================================================================
// RPC HELPER
// ============================================================================

async function callDO(stub: DurableObjectStub, method: string, args: unknown[] = []): Promise<Response> {
  const response = await stub.fetch('https://do.internal/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params: args,
    }),
  })

  const result = (await response.json()) as { result?: unknown; error?: { message: string } }

  if (result.error) {
    return Response.json({ error: result.error.message }, { status: 400 })
  }

  return Response.json(result.result)
}

// ============================================================================
// APPLICATION
// ============================================================================

const app = new Hono<{ Bindings: Env }>()

// Enable CORS
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
)

// ============================================================================
// LANDING PAGE
// ============================================================================

app.get('/', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Content Platform Publishing</title>
  <style>
    :root { --bg: #0a0a0a; --fg: #fafafa; --accent: #10b981; --muted: #71717a; --card: #1f1f1f; }
    body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--fg); margin: 0; padding: 2rem; line-height: 1.6; }
    .container { max-width: 900px; margin: 0 auto; }
    h1 { color: var(--accent); margin-bottom: 0.25rem; font-size: 2.5rem; }
    .tagline { font-size: 1.5rem; color: var(--muted); margin-bottom: 2rem; font-weight: 300; }
    code { background: var(--card); padding: 0.2rem 0.4rem; border-radius: 4px; font-size: 0.9rem; }
    pre { background: var(--card); padding: 1.5rem; border-radius: 8px; overflow-x: auto; margin: 1.5rem 0; }
    pre code { background: none; padding: 0; }
    .section { margin: 3rem 0; }
    .section h2 { color: var(--fg); border-bottom: 1px solid #333; padding-bottom: 0.5rem; }
    .flow { display: flex; align-items: center; gap: 0.5rem; margin: 1rem 0; flex-wrap: wrap; }
    .flow-step { background: var(--card); padding: 0.5rem 1rem; border-radius: 4px; }
    .flow-arrow { color: var(--muted); }
    .dos { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin: 1rem 0; }
    .do-card { background: var(--card); padding: 1rem; border-radius: 8px; border-left: 3px solid var(--accent); }
    .do-card h3 { margin: 0 0 0.5rem 0; color: var(--accent); }
    .do-card p { margin: 0; color: var(--muted); font-size: 0.9rem; }
    .endpoints { display: grid; gap: 0.5rem; margin: 1rem 0; }
    .endpoint { background: var(--card); padding: 0.75rem 1rem; border-radius: 4px; display: flex; gap: 1rem; align-items: center; }
    .method { font-weight: 600; font-size: 0.75rem; padding: 0.2rem 0.5rem; border-radius: 3px; min-width: 50px; text-align: center; }
    .method.get { background: var(--accent); color: var(--bg); }
    .method.post { background: #3b82f6; color: white; }
    .method.put { background: #f59e0b; color: var(--bg); }
    .method.delete { background: #ef4444; color: white; }
    .path { font-family: monospace; color: var(--fg); }
    .desc { color: var(--muted); font-size: 0.85rem; margin-left: auto; }
    a { color: var(--accent); }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin: 1rem 0; }
    .stat { background: var(--card); padding: 1rem; border-radius: 8px; text-align: center; }
    .stat-value { font-size: 2rem; font-weight: 600; color: var(--accent); }
    .stat-label { color: var(--muted); font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Content Platform Publishing</h1>
    <p class="tagline">Write. Review. Publish. Automated.</p>

    <p>A complete CMS workflow powered by multi-DO architecture. From draft to viral, with intelligent SEO optimization, automated social sharing, and human-in-the-loop moderation.</p>

    <div class="section">
      <h2>Architecture</h2>
      <div class="dos">
        <div class="do-card">
          <h3>ArticleDO</h3>
          <p>Content lifecycle, versioning, scheduling, analytics</p>
        </div>
        <div class="do-card">
          <h3>AuthorDO</h3>
          <p>Author profiles, roles, permissions</p>
        </div>
        <div class="do-card">
          <h3>CategoryDO</h3>
          <p>Categories, tags, taxonomy</p>
        </div>
        <div class="do-card">
          <h3>PublicationDO</h3>
          <p>Settings, calendar, moderation, stats</p>
        </div>
      </div>
    </div>

    <div class="section">
      <h2>Content Lifecycle</h2>
      <div class="flow">
        <span class="flow-step">Draft</span>
        <span class="flow-arrow">-></span>
        <span class="flow-step">Review</span>
        <span class="flow-arrow">-></span>
        <span class="flow-step">Scheduled</span>
        <span class="flow-arrow">-></span>
        <span class="flow-step">Published</span>
        <span class="flow-arrow">-></span>
        <span class="flow-step">Archived</span>
      </div>
    </div>

    <div class="section">
      <h2>Dashboard</h2>
      <div class="stats" id="stats">
        <div class="stat"><div class="stat-value" id="totalArticles">-</div><div class="stat-label">Total Articles</div></div>
        <div class="stat"><div class="stat-value" id="published">-</div><div class="stat-label">Published</div></div>
        <div class="stat"><div class="stat-value" id="totalViews">-</div><div class="stat-label">Total Views</div></div>
        <div class="stat"><div class="stat-value" id="pendingReviews">-</div><div class="stat-label">Pending Reviews</div></div>
      </div>
    </div>

    <div class="section">
      <h2>API Endpoints</h2>

      <h3>Articles</h3>
      <div class="endpoints">
        <div class="endpoint"><span class="method get">GET</span><span class="path">/api/articles</span><span class="desc">List articles</span></div>
        <div class="endpoint"><span class="method post">POST</span><span class="path">/api/articles</span><span class="desc">Create article</span></div>
        <div class="endpoint"><span class="method get">GET</span><span class="path">/api/articles/:id</span><span class="desc">Get article</span></div>
        <div class="endpoint"><span class="method put">PUT</span><span class="path">/api/articles/:id</span><span class="desc">Update article</span></div>
        <div class="endpoint"><span class="method post">POST</span><span class="path">/api/articles/:id/submit</span><span class="desc">Submit for review</span></div>
        <div class="endpoint"><span class="method post">POST</span><span class="path">/api/articles/:id/approve</span><span class="desc">Approve/schedule</span></div>
        <div class="endpoint"><span class="method post">POST</span><span class="path">/api/articles/:id/publish</span><span class="desc">Publish now</span></div>
      </div>

      <h3>Authors</h3>
      <div class="endpoints">
        <div class="endpoint"><span class="method get">GET</span><span class="path">/api/authors</span><span class="desc">List authors</span></div>
        <div class="endpoint"><span class="method post">POST</span><span class="path">/api/authors</span><span class="desc">Create author</span></div>
        <div class="endpoint"><span class="method get">GET</span><span class="path">/api/authors/:id</span><span class="desc">Get author</span></div>
      </div>

      <h3>Categories</h3>
      <div class="endpoints">
        <div class="endpoint"><span class="method get">GET</span><span class="path">/api/categories</span><span class="desc">List categories</span></div>
        <div class="endpoint"><span class="method post">POST</span><span class="path">/api/categories</span><span class="desc">Create category</span></div>
        <div class="endpoint"><span class="method get">GET</span><span class="path">/api/tags</span><span class="desc">List tags</span></div>
      </div>

      <h3>Publication</h3>
      <div class="endpoints">
        <div class="endpoint"><span class="method get">GET</span><span class="path">/api/stats</span><span class="desc">Dashboard stats</span></div>
        <div class="endpoint"><span class="method get">GET</span><span class="path">/api/calendar/:yearMonth</span><span class="desc">Editorial calendar</span></div>
        <div class="endpoint"><span class="method get">GET</span><span class="path">/api/moderation</span><span class="desc">Moderation queue</span></div>
        <div class="endpoint"><span class="method get">GET</span><span class="path">/api/reviews</span><span class="desc">Human review queue</span></div>
      </div>
    </div>

    <div class="section">
      <h2>Example Usage</h2>
      <pre><code>// Create an article
const article = await fetch('/api/articles', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: 'How We Built Our AI Pipeline',
    content: '# Introduction\\n\\nOur journey to AI-powered content...',
    authorId: 'alice',
    categoryId: 'engineering'
  })
}).then(r => r.json())

// Submit for review
await fetch(\`/api/articles/\${article.id}/submit\`, { method: 'POST' })

// Approve and schedule
await fetch(\`/api/articles/\${article.id}/approve\`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    scheduledAt: '2024-01-20T09:00:00Z'
  })
})</code></pre>
    </div>

    <footer style="margin-top: 3rem; color: var(--muted); border-top: 1px solid #333; padding-top: 1rem;">
      <p>From draft to viral. With AI assistance.</p>
      <p>Built with <a href="https://dotdo.dev">dotdo</a> - Build your 1-Person Unicorn</p>
    </footer>
  </div>

  <script>
    fetch('/api/stats')
      .then(r => r.json())
      .then(stats => {
        document.getElementById('totalArticles').textContent = stats.totalArticles || 0;
        document.getElementById('published').textContent = stats.publishedArticles || 0;
        document.getElementById('totalViews').textContent = (stats.totalViews || 0).toLocaleString();
        document.getElementById('pendingReviews').textContent = stats.pendingReviews || 0;
      })
      .catch(() => {});
  </script>
</body>
</html>
  `)
})

// ============================================================================
// ARTICLE ROUTES
// ============================================================================

// List articles
app.get('/api/articles', async (c) => {
  const stub = c.env.PUBLICATION_DO.get(c.env.PUBLICATION_DO.idFromName('main'))
  const status = c.req.query('status')
  const authorId = c.req.query('author')
  const categoryId = c.req.query('category')

  const filters: Record<string, string> = {}
  if (status) filters.status = status
  if (authorId) filters.authorId = authorId
  if (categoryId) filters.categoryId = categoryId

  return callDO(stub, 'listArticles', [Object.keys(filters).length > 0 ? filters : undefined])
})

// Create article
app.post('/api/articles', async (c) => {
  const body = (await c.req.json()) as { title: string; content: string; authorId: string; categoryId?: string; tags?: string[] }

  // Create a new ArticleDO instance
  const articleId = c.env.ARTICLE_DO.newUniqueId()
  const articleStub = c.env.ARTICLE_DO.get(articleId)

  const response = await callDO(articleStub, 'create', [body])
  const article = await response.json()

  // Register in publication index
  const pubStub = c.env.PUBLICATION_DO.get(c.env.PUBLICATION_DO.idFromName('main'))
  await callDO(pubStub, 'registerArticle', [
    articleId.toString(),
    {
      title: body.title,
      status: 'draft',
      authorId: body.authorId,
      categoryId: body.categoryId || 'uncategorized',
    },
  ])

  // Add to author's article list
  if (body.authorId) {
    const authorStub = c.env.AUTHOR_DO.get(c.env.AUTHOR_DO.idFromName(body.authorId))
    await callDO(authorStub, 'addArticle', [articleId.toString()])
  }

  // Add to category
  if (body.categoryId) {
    const catStub = c.env.CATEGORY_DO.get(c.env.CATEGORY_DO.idFromName('main'))
    await callDO(catStub, 'addArticleToCategory', [articleId.toString(), body.categoryId])
  }

  // Add tags
  if (body.tags && body.tags.length > 0) {
    const catStub = c.env.CATEGORY_DO.get(c.env.CATEGORY_DO.idFromName('main'))
    await callDO(catStub, 'addArticleTags', [articleId.toString(), body.tags])
  }

  return Response.json(article)
})

// Get article
app.get('/api/articles/:id', async (c) => {
  const id = c.req.param('id')
  const articleStub = c.env.ARTICLE_DO.get(c.env.ARTICLE_DO.idFromString(id))
  return callDO(articleStub, 'get')
})

// Update article
app.put('/api/articles/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const articleStub = c.env.ARTICLE_DO.get(c.env.ARTICLE_DO.idFromString(id))
  return callDO(articleStub, 'update', [body])
})

// Delete article
app.delete('/api/articles/:id', async (c) => {
  const id = c.req.param('id')
  const articleStub = c.env.ARTICLE_DO.get(c.env.ARTICLE_DO.idFromString(id))
  const response = await callDO(articleStub, 'delete')

  // Unregister from publication
  const pubStub = c.env.PUBLICATION_DO.get(c.env.PUBLICATION_DO.idFromName('main'))
  await callDO(pubStub, 'unregisterArticle', [id])

  return response
})

// Submit for review
app.post('/api/articles/:id/submit', async (c) => {
  const id = c.req.param('id')
  const articleStub = c.env.ARTICLE_DO.get(c.env.ARTICLE_DO.idFromString(id))
  const response = await callDO(articleStub, 'submitForReview')

  // Update publication index
  const pubStub = c.env.PUBLICATION_DO.get(c.env.PUBLICATION_DO.idFromName('main'))
  await callDO(pubStub, 'updateArticleStatus', [id, 'review'])

  return response
})

// Approve article
app.post('/api/articles/:id/approve', async (c) => {
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as { scheduledAt?: string }
  const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : undefined

  const articleStub = c.env.ARTICLE_DO.get(c.env.ARTICLE_DO.idFromString(id))
  const response = await callDO(articleStub, 'approve', [scheduledAt])

  // Update publication index
  const pubStub = c.env.PUBLICATION_DO.get(c.env.PUBLICATION_DO.idFromName('main'))
  const newStatus = scheduledAt ? 'scheduled' : 'published'
  await callDO(pubStub, 'updateArticleStatus', [id, newStatus, scheduledAt?.toISOString(), scheduledAt ? undefined : new Date().toISOString()])

  return response
})

// Publish immediately
app.post('/api/articles/:id/publish', async (c) => {
  const id = c.req.param('id')
  const articleStub = c.env.ARTICLE_DO.get(c.env.ARTICLE_DO.idFromString(id))
  const response = await callDO(articleStub, 'publish')

  // Update publication index
  const pubStub = c.env.PUBLICATION_DO.get(c.env.PUBLICATION_DO.idFromName('main'))
  await callDO(pubStub, 'updateArticleStatus', [id, 'published', undefined, new Date().toISOString()])

  return response
})

// Schedule article
app.post('/api/articles/:id/schedule', async (c) => {
  const id = c.req.param('id')
  const body = (await c.req.json()) as { scheduledAt: string }
  const scheduledAt = new Date(body.scheduledAt)

  const articleStub = c.env.ARTICLE_DO.get(c.env.ARTICLE_DO.idFromString(id))
  const response = await callDO(articleStub, 'schedule', [scheduledAt])

  // Update publication index
  const pubStub = c.env.PUBLICATION_DO.get(c.env.PUBLICATION_DO.idFromName('main'))
  await callDO(pubStub, 'updateArticleStatus', [id, 'scheduled', scheduledAt.toISOString()])

  return response
})

// Archive article
app.post('/api/articles/:id/archive', async (c) => {
  const id = c.req.param('id')
  const articleStub = c.env.ARTICLE_DO.get(c.env.ARTICLE_DO.idFromString(id))
  const response = await callDO(articleStub, 'archive')

  const pubStub = c.env.PUBLICATION_DO.get(c.env.PUBLICATION_DO.idFromName('main'))
  await callDO(pubStub, 'updateArticleStatus', [id, 'archived'])

  return response
})

// Get version history
app.get('/api/articles/:id/versions', async (c) => {
  const id = c.req.param('id')
  const articleStub = c.env.ARTICLE_DO.get(c.env.ARTICLE_DO.idFromString(id))
  return callDO(articleStub, 'getVersionHistory')
})

// Revert to version
app.post('/api/articles/:id/revert', async (c) => {
  const id = c.req.param('id')
  const body = (await c.req.json()) as { version: number }
  const articleStub = c.env.ARTICLE_DO.get(c.env.ARTICLE_DO.idFromString(id))
  return callDO(articleStub, 'revertToVersion', [body.version])
})

// Get analytics
app.get('/api/articles/:id/analytics', async (c) => {
  const id = c.req.param('id')
  const articleStub = c.env.ARTICLE_DO.get(c.env.ARTICLE_DO.idFromString(id))
  return callDO(articleStub, 'getAnalytics')
})

// Track view
app.post('/api/articles/:id/view', async (c) => {
  const id = c.req.param('id')
  const articleStub = c.env.ARTICLE_DO.get(c.env.ARTICLE_DO.idFromString(id))
  return callDO(articleStub, 'trackView')
})

// ============================================================================
// AUTHOR ROUTES
// ============================================================================

// Create author
app.post('/api/authors', async (c) => {
  const body = (await c.req.json()) as { id: string; name: string; email: string; bio?: string; role?: string }
  const authorId = body.id || crypto.randomUUID()
  const authorStub = c.env.AUTHOR_DO.get(c.env.AUTHOR_DO.idFromName(authorId))
  return callDO(authorStub, 'create', [body])
})

// Get author
app.get('/api/authors/:id', async (c) => {
  const id = c.req.param('id')
  const authorStub = c.env.AUTHOR_DO.get(c.env.AUTHOR_DO.idFromName(id))
  return callDO(authorStub, 'get')
})

// Update author
app.put('/api/authors/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const authorStub = c.env.AUTHOR_DO.get(c.env.AUTHOR_DO.idFromName(id))
  return callDO(authorStub, 'update', [body])
})

// Get author stats
app.get('/api/authors/:id/stats', async (c) => {
  const id = c.req.param('id')
  const authorStub = c.env.AUTHOR_DO.get(c.env.AUTHOR_DO.idFromName(id))
  return callDO(authorStub, 'getStats')
})

// Get author articles
app.get('/api/authors/:id/articles', async (c) => {
  const id = c.req.param('id')
  const authorStub = c.env.AUTHOR_DO.get(c.env.AUTHOR_DO.idFromName(id))
  return callDO(authorStub, 'getArticleIds')
})

// ============================================================================
// CATEGORY ROUTES
// ============================================================================

// List categories
app.get('/api/categories', async (c) => {
  const catStub = c.env.CATEGORY_DO.get(c.env.CATEGORY_DO.idFromName('main'))
  return callDO(catStub, 'listCategories')
})

// Get category tree
app.get('/api/categories/tree', async (c) => {
  const catStub = c.env.CATEGORY_DO.get(c.env.CATEGORY_DO.idFromName('main'))
  return callDO(catStub, 'getCategoryTree')
})

// Create category
app.post('/api/categories', async (c) => {
  const body = await c.req.json()
  const catStub = c.env.CATEGORY_DO.get(c.env.CATEGORY_DO.idFromName('main'))
  return callDO(catStub, 'createCategory', [body])
})

// Get category
app.get('/api/categories/:id', async (c) => {
  const id = c.req.param('id')
  const catStub = c.env.CATEGORY_DO.get(c.env.CATEGORY_DO.idFromName('main'))
  return callDO(catStub, 'getCategory', [id])
})

// Update category
app.put('/api/categories/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const catStub = c.env.CATEGORY_DO.get(c.env.CATEGORY_DO.idFromName('main'))
  return callDO(catStub, 'updateCategory', [id, body])
})

// Delete category
app.delete('/api/categories/:id', async (c) => {
  const id = c.req.param('id')
  const catStub = c.env.CATEGORY_DO.get(c.env.CATEGORY_DO.idFromName('main'))
  return callDO(catStub, 'deleteCategory', [id])
})

// List tags
app.get('/api/tags', async (c) => {
  const catStub = c.env.CATEGORY_DO.get(c.env.CATEGORY_DO.idFromName('main'))
  return callDO(catStub, 'listTags')
})

// Get articles by category
app.get('/api/categories/:id/articles', async (c) => {
  const id = c.req.param('id')
  const catStub = c.env.CATEGORY_DO.get(c.env.CATEGORY_DO.idFromName('main'))
  return callDO(catStub, 'getArticlesByCategory', [id])
})

// Get articles by tag
app.get('/api/tags/:id/articles', async (c) => {
  const id = c.req.param('id')
  const catStub = c.env.CATEGORY_DO.get(c.env.CATEGORY_DO.idFromName('main'))
  return callDO(catStub, 'getArticlesByTag', [id])
})

// ============================================================================
// PUBLICATION ROUTES
// ============================================================================

// Get settings
app.get('/api/settings', async (c) => {
  const pubStub = c.env.PUBLICATION_DO.get(c.env.PUBLICATION_DO.idFromName('main'))
  return callDO(pubStub, 'getSettings')
})

// Update settings
app.put('/api/settings', async (c) => {
  const body = await c.req.json()
  const pubStub = c.env.PUBLICATION_DO.get(c.env.PUBLICATION_DO.idFromName('main'))
  return callDO(pubStub, 'updateSettings', [body])
})

// Get stats
app.get('/api/stats', async (c) => {
  const pubStub = c.env.PUBLICATION_DO.get(c.env.PUBLICATION_DO.idFromName('main'))
  return callDO(pubStub, 'getStats')
})

// Get calendar
app.get('/api/calendar/:yearMonth', async (c) => {
  const yearMonth = c.req.param('yearMonth')
  const pubStub = c.env.PUBLICATION_DO.get(c.env.PUBLICATION_DO.idFromName('main'))
  return callDO(pubStub, 'getCalendar', [yearMonth])
})

// Get upcoming articles
app.get('/api/upcoming', async (c) => {
  const limit = parseInt(c.req.query('limit') || '10')
  const pubStub = c.env.PUBLICATION_DO.get(c.env.PUBLICATION_DO.idFromName('main'))
  return callDO(pubStub, 'getUpcomingArticles', [limit])
})

// ============================================================================
// COMMENTS ROUTES
// ============================================================================

// Get comments for article
app.get('/api/articles/:id/comments', async (c) => {
  const id = c.req.param('id')
  const includeAll = c.req.query('all') === 'true'
  const pubStub = c.env.PUBLICATION_DO.get(c.env.PUBLICATION_DO.idFromName('main'))
  return callDO(pubStub, 'getComments', [id, includeAll])
})

// Add comment
app.post('/api/articles/:id/comments', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const pubStub = c.env.PUBLICATION_DO.get(c.env.PUBLICATION_DO.idFromName('main'))
  return callDO(pubStub, 'addComment', [id, body])
})

// Approve comment
app.post('/api/comments/:id/approve', async (c) => {
  const id = c.req.param('id')
  const pubStub = c.env.PUBLICATION_DO.get(c.env.PUBLICATION_DO.idFromName('main'))
  return callDO(pubStub, 'approveComment', [id])
})

// Reject comment
app.post('/api/comments/:id/reject', async (c) => {
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => ({}))) as { reason?: string }
  const pubStub = c.env.PUBLICATION_DO.get(c.env.PUBLICATION_DO.idFromName('main'))
  return callDO(pubStub, 'rejectComment', [id, body.reason])
})

// Get moderation queue
app.get('/api/moderation', async (c) => {
  const pubStub = c.env.PUBLICATION_DO.get(c.env.PUBLICATION_DO.idFromName('main'))
  return callDO(pubStub, 'getModerationQueue')
})

// ============================================================================
// HUMAN REVIEW ROUTES
// ============================================================================

// Get review queue
app.get('/api/reviews', async (c) => {
  const pubStub = c.env.PUBLICATION_DO.get(c.env.PUBLICATION_DO.idFromName('main'))
  return callDO(pubStub, 'getHumanReviewQueue')
})

// Complete review
app.post('/api/reviews/:id/complete', async (c) => {
  const id = c.req.param('id')
  const body = (await c.req.json()) as { decision: 'approved' | 'rejected'; reviewer: string }
  const pubStub = c.env.PUBLICATION_DO.get(c.env.PUBLICATION_DO.idFromName('main'))
  return callDO(pubStub, 'completeHumanReview', [id, body.decision, body.reviewer])
})

// ============================================================================
// HEALTH CHECK
// ============================================================================

app.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'content-platform-publishing', version: '2.0.0' })
})

export default app

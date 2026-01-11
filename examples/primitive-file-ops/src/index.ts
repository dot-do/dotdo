/**
 * primitive-file-ops - Worker entry point
 *
 * Demonstrates fsx (filesystem on SQLite) with a simple HTTP API.
 * Routes requests to the FileOpsDO Durable Object.
 */

import { Hono } from 'hono'
import { FileOpsDO } from './FileOpsDO'

// Re-export the DO class for Wrangler
export { FileOpsDO }

// Types
interface Env {
  DO: DurableObjectNamespace
}

// Create Hono app
const app = new Hono<{ Bindings: Env }>()

/**
 * Get DO stub for the default instance
 */
function getDO(env: Env, namespace: string = 'default') {
  const id = env.DO.idFromName(namespace)
  return env.DO.get(id)
}

// ============================================================================
// ROUTES
// ============================================================================

/**
 * Health check
 */
app.get('/', (c) => {
  return c.json({
    name: 'primitive-file-ops',
    description: 'fsx demonstration - filesystem on SQLite',
    endpoints: {
      'POST /process': 'Process a CSV file from URL',
      'GET /files': 'List all files',
      'GET /files/*': 'List files in directory',
      'GET /file/*': 'Read a specific file',
      'POST /file/*': 'Write a file',
      'DELETE /file/*': 'Delete a file',
      'GET /stats': 'Get filesystem statistics',
      'GET /reports': 'List all reports',
      'POST /batch': 'Batch write multiple files',
      'POST /copy': 'Copy a file',
      'POST /move': 'Move a file',
      'GET /stream/*': 'Stream a file',
      'GET /tier/*': 'Get storage tier for a file',
      'POST /cleanup': 'Clean up old files',
    },
  })
})

/**
 * Process CSV import
 */
app.post('/process', async (c) => {
  const body = await c.req.json<{ url: string; namespace?: string }>()

  if (!body.url) {
    return c.json({ error: 'Missing url parameter' }, 400)
  }

  const stub = getDO(c.env, body.namespace)
  const result = await stub.processDataImport(body.url)
  return c.json(result)
})

/**
 * List files in root
 */
app.get('/files', async (c) => {
  const namespace = c.req.query('namespace') || 'default'
  const stub = getDO(c.env, namespace)
  const result = await stub.listFiles('/')
  return c.json(result)
})

/**
 * List files in a specific directory
 */
app.get('/files/*', async (c) => {
  const path = '/' + c.req.param('*')
  const namespace = c.req.query('namespace') || 'default'
  const stub = getDO(c.env, namespace)
  const result = await stub.listFiles(path)
  return c.json(result)
})

/**
 * Read a specific file
 */
app.get('/file/*', async (c) => {
  const path = '/' + c.req.param('*')
  const namespace = c.req.query('namespace') || 'default'
  const stub = getDO(c.env, namespace)

  try {
    const result = await stub.readFile(path)
    return c.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return c.json({ error: message }, 404)
  }
})

/**
 * Write a file
 */
app.post('/file/*', async (c) => {
  const path = '/' + c.req.param('*')
  const namespace = c.req.query('namespace') || 'default'
  const content = await c.req.text()
  const stub = getDO(c.env, namespace)
  const result = await stub.writeFile(path, content)
  return c.json(result, 201)
})

/**
 * Delete a file
 */
app.delete('/file/*', async (c) => {
  const path = '/' + c.req.param('*')
  const namespace = c.req.query('namespace') || 'default'
  const stub = getDO(c.env, namespace)
  const result = await stub.deleteFile(path)
  return c.json(result)
})

/**
 * Get filesystem statistics
 */
app.get('/stats', async (c) => {
  const namespace = c.req.query('namespace') || 'default'
  const stub = getDO(c.env, namespace)
  const result = await stub.getStats()
  return c.json(result)
})

/**
 * List reports
 */
app.get('/reports', async (c) => {
  const namespace = c.req.query('namespace') || 'default'
  const stub = getDO(c.env, namespace)
  const result = await stub.listReports()
  return c.json(result)
})

/**
 * Batch write files
 */
app.post('/batch', async (c) => {
  const body = await c.req.json<{
    files: Array<{ path: string; content: string }>
    namespace?: string
  }>()

  if (!body.files || !Array.isArray(body.files)) {
    return c.json({ error: 'Missing files array' }, 400)
  }

  const stub = getDO(c.env, body.namespace)
  const result = await stub.batchWrite(body.files)
  return c.json(result, 201)
})

/**
 * Copy a file
 */
app.post('/copy', async (c) => {
  const body = await c.req.json<{
    source: string
    destination: string
    namespace?: string
  }>()

  if (!body.source || !body.destination) {
    return c.json({ error: 'Missing source or destination' }, 400)
  }

  const stub = getDO(c.env, body.namespace)
  try {
    const result = await stub.copyFile(body.source, body.destination)
    return c.json(result, 201)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return c.json({ error: message }, 400)
  }
})

/**
 * Move a file
 */
app.post('/move', async (c) => {
  const body = await c.req.json<{
    source: string
    destination: string
    namespace?: string
  }>()

  if (!body.source || !body.destination) {
    return c.json({ error: 'Missing source or destination' }, 400)
  }

  const stub = getDO(c.env, body.namespace)
  try {
    const result = await stub.moveFile(body.source, body.destination)
    return c.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return c.json({ error: message }, 400)
  }
})

/**
 * Stream a file
 */
app.get('/stream/*', async (c) => {
  const path = '/' + c.req.param('*')
  const namespace = c.req.query('namespace') || 'default'
  const stub = getDO(c.env, namespace)

  try {
    const stream = await stub.streamFile(path)
    return new Response(stream, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${path.split('/').pop()}"`,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return c.json({ error: message }, 404)
  }
})

/**
 * Get storage tier for a file
 */
app.get('/tier/*', async (c) => {
  const path = '/' + c.req.param('*')
  const namespace = c.req.query('namespace') || 'default'
  const stub = getDO(c.env, namespace)

  try {
    const result = await stub.getFileTier(path)
    return c.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return c.json({ error: message }, 404)
  }
})

/**
 * Cleanup old files
 */
app.post('/cleanup', async (c) => {
  const body = await c.req.json<{ olderThanDays?: number; namespace?: string }>().catch(() => ({}))
  const stub = getDO(c.env, body.namespace)
  const result = await stub.cleanup(body.olderThanDays)
  return c.json(result)
})

// ============================================================================
// DEMO ENDPOINTS
// ============================================================================

/**
 * Demo: Create sample files
 */
app.post('/demo/setup', async (c) => {
  const namespace = c.req.query('namespace') || 'default'
  const stub = getDO(c.env, namespace)

  // Create sample files
  await stub.batchWrite([
    {
      path: '/config/app.json',
      content: JSON.stringify({
        name: 'MyApp',
        version: '1.0.0',
        features: ['auth', 'api', 'storage'],
      }, null, 2),
    },
    {
      path: '/config/database.json',
      content: JSON.stringify({
        host: 'localhost',
        port: 5432,
        database: 'myapp',
      }, null, 2),
    },
    {
      path: '/data/users.csv',
      content: 'id,name,email\n1,Alice,alice@example.com\n2,Bob,bob@example.com\n3,Charlie,charlie@example.com',
    },
    {
      path: '/templates/email.html',
      content: '<html><body><h1>Hello {{name}}</h1><p>Welcome to our service!</p></body></html>',
    },
    {
      path: '/logs/app.log',
      content: `[${new Date().toISOString()}] INFO: Application started\n[${new Date().toISOString()}] INFO: Connected to database\n`,
    },
  ])

  const stats = await stub.getStats()
  return c.json({
    message: 'Demo files created',
    ...stats,
  })
})

/**
 * Demo: Process sample CSV
 */
app.post('/demo/process', async (c) => {
  const namespace = c.req.query('namespace') || 'default'
  const stub = getDO(c.env, namespace)

  // Create a sample CSV first
  await stub.writeFile('/imports/sample.csv', `
id,name,email,department,salary
1,Alice Smith,alice@example.com,Engineering,120000
2,Bob Johnson,bob@example.com,Marketing,95000
3,Charlie Brown,charlie@example.com,Sales,85000
4,Diana Prince,diana@example.com,Engineering,135000
5,Eve Wilson,eve@example.com,HR,75000
`.trim())

  // Read and process it
  const csv = await stub.readFile('/imports/sample.csv')
  const content = csv.content as string
  const lines = content.split('\n')
  const headers = lines[0].split(',')

  const processed = lines.slice(1).map((line, i) => {
    const values = line.split(',')
    const record: Record<string, string> = {}
    headers.forEach((h, j) => {
      record[h] = values[j] || ''
    })
    return record
  })

  // Write processed results
  await Promise.all(
    processed.map((record, i) =>
      stub.writeFile(`/results/employee-${record.id || i}.json`, JSON.stringify({
        ...record,
        salaryFormatted: `$${Number(record.salary).toLocaleString()}`,
        processedAt: new Date().toISOString(),
      }, null, 2))
    )
  )

  const stats = await stub.getStats()
  return c.json({
    message: 'Sample CSV processed',
    recordsProcessed: processed.length,
    ...stats,
  })
})

export default app

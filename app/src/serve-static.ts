/**
 * Static Documentation Serving Module
 *
 * Serves static documentation files from the build output with:
 * - Proper MIME type detection
 * - Cache headers for assets
 * - ETag support for conditional requests
 * - 404 handling with helpful error pages
 */

import { existsSync, readFileSync, statSync } from 'fs'
import { join, extname } from 'path'
import { createHash } from 'crypto'

// MIME type mapping
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'font/otf',
  '.map': 'application/json',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
}

// Cache durations
const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable' // 1 year for hashed assets
const CACHE_DEFAULT = 'public, max-age=3600' // 1 hour for HTML
const CACHE_NO_STORE = 'no-store'

// Build output directory
const DIST_DIR = join(process.cwd(), 'dist/docs')

/**
 * Check if a file path contains a hash (for cache busting)
 */
function isHashedAsset(filename: string): boolean {
  // Match patterns like main.abc123.js or styles.abc12345.css
  return /\.[a-f0-9]{6,}\./i.test(filename)
}

/**
 * Get MIME type for a file
 */
function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  return MIME_TYPES[ext] || 'application/octet-stream'
}

/**
 * Generate ETag from file content
 */
function generateETag(content: Buffer | string): string {
  const hash = createHash('md5').update(content).digest('hex')
  return `"${hash}"`
}

/**
 * Get cache control header based on file type and path
 */
function getCacheControl(filePath: string): string {
  if (isHashedAsset(filePath)) {
    return CACHE_IMMUTABLE
  }
  if (filePath.endsWith('.html')) {
    return CACHE_DEFAULT
  }
  if (filePath.includes('/_assets/')) {
    return 'public, max-age=86400' // 1 day for assets
  }
  return CACHE_DEFAULT
}

/**
 * Generate the 404 error page HTML
 */
function generate404Page(requestedPath: string): string {
  const title = 'Page Not Found - do.md Documentation'
  const description = 'The documentation page you are looking for could not be found.'

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${description}">
  <title>${title}</title>
  <style>
    :root {
      --bg: #ffffff;
      --fg: #1a1a1a;
      --muted: #666666;
      --accent: #3b82f6;
      --border: #e5e5e5;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0a0a0a;
        --fg: #fafafa;
        --muted: #a3a3a3;
        --accent: #60a5fa;
        --border: #262626;
      }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--fg);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }
    .container {
      max-width: 480px;
      text-align: center;
    }
    h1 {
      font-size: 6rem;
      font-weight: 700;
      margin-bottom: 1rem;
      color: var(--muted);
    }
    h2 {
      font-size: 1.5rem;
      margin-bottom: 1rem;
    }
    p {
      color: var(--muted);
      margin-bottom: 2rem;
      line-height: 1.6;
    }
    .search-box {
      margin-bottom: 2rem;
    }
    .search-box input {
      width: 100%;
      padding: 0.75rem 1rem;
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      background: var(--bg);
      color: var(--fg);
      font-size: 1rem;
    }
    .search-box input::placeholder {
      color: var(--muted);
    }
    .search-box input:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
    }
    .links {
      display: flex;
      gap: 1rem;
      justify-content: center;
      flex-wrap: wrap;
    }
    .links a {
      color: var(--accent);
      text-decoration: none;
      padding: 0.5rem 1rem;
      border-radius: 0.375rem;
      transition: background 0.2s;
    }
    .links a:hover {
      background: rgba(59, 130, 246, 0.1);
    }
    code {
      background: var(--border);
      padding: 0.125rem 0.375rem;
      border-radius: 0.25rem;
      font-size: 0.875rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>404</h1>
    <h2>Page Not Found</h2>
    <p>
      The page <code>${requestedPath}</code> could not be found.
      Try searching or navigate to an existing page.
    </p>
    <div class="search-box">
      <input type="search" placeholder="Search documentation..." aria-label="Search documentation">
    </div>
    <div class="links">
      <a href="/docs/">Documentation Home</a>
      <a href="/docs/getting-started">Getting Started</a>
      <a href="/docs/api">API Reference</a>
    </div>
  </div>
  <script>
    document.querySelector('.search-box input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const query = e.target.value.trim();
        if (query) {
          window.location.href = '/docs/?search=' + encodeURIComponent(query);
        }
      }
    });
  </script>
</body>
</html>`
}

/**
 * Resolve the file path for a request
 */
function resolveFilePath(requestPath: string): string | null {
  // Remove /docs prefix if present
  let normalizedPath = requestPath.replace(/^\/docs\/?/, '')

  // Handle URL decoding
  try {
    normalizedPath = decodeURIComponent(normalizedPath)
  } catch {
    // Invalid encoding, continue with original
  }

  // Try various path resolutions
  const pathsToTry = [
    join(DIST_DIR, normalizedPath),
    join(DIST_DIR, normalizedPath, 'index.html'),
    join(DIST_DIR, normalizedPath + '.html'),
  ]

  // If path ends with /, only try index.html
  if (normalizedPath.endsWith('/') || normalizedPath === '') {
    const indexPath = join(DIST_DIR, normalizedPath, 'index.html')
    if (existsSync(indexPath)) {
      return indexPath
    }
    return null
  }

  for (const path of pathsToTry) {
    if (existsSync(path)) {
      // Check it's a file, not directory
      const stat = statSync(path)
      if (stat.isFile()) {
        return path
      }
    }
  }

  return null
}

/**
 * Options for serving static files
 */
interface ServeOptions {
  headers?: Record<string, string>
}

/**
 * Serve static documentation pages
 */
export async function serveStaticDocs(
  path: string,
  options: ServeOptions = {}
): Promise<Response> {
  const filePath = resolveFilePath(path)

  // Handle conditional requests (If-None-Match)
  if (filePath && options.headers?.['If-None-Match']) {
    try {
      const content = readFileSync(filePath)
      const etag = generateETag(content)
      if (options.headers['If-None-Match'] === etag) {
        return new Response(null, { status: 304 })
      }
    } catch {
      // Fall through to 404
    }
  }

  if (!filePath) {
    const html = generate404Page(path)
    return new Response(html, {
      status: 404,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': CACHE_NO_STORE,
      },
    })
  }

  try {
    const content = readFileSync(filePath)
    const mimeType = getMimeType(filePath)
    const etag = generateETag(content)
    const cacheControl = getCacheControl(filePath)

    return new Response(content, {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Cache-Control': cacheControl,
        'ETag': etag,
      },
    })
  } catch (error) {
    const html = generate404Page(path)
    return new Response(html, {
      status: 404,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': CACHE_NO_STORE,
      },
    })
  }
}

/**
 * Serve static assets (JS, CSS, images, fonts)
 */
export async function serveStaticAsset(path: string): Promise<Response> {
  // Prevent directory listing - return 404 for directories
  if (path.endsWith('/')) {
    return new Response('Not Found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  // Remove /docs prefix and resolve
  const normalizedPath = path.replace(/^\/docs\/?/, '')
  const filePath = join(DIST_DIR, normalizedPath)

  // Check if file exists and is a file (not directory)
  if (!existsSync(filePath)) {
    return new Response('Not Found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  try {
    const stat = statSync(filePath)
    if (!stat.isFile()) {
      return new Response('Not Found', {
        status: 404,
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    const content = readFileSync(filePath)
    const mimeType = getMimeType(filePath)
    const cacheControl = getCacheControl(filePath)

    return new Response(content, {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Cache-Control': cacheControl,
      },
    })
  } catch {
    return new Response('Not Found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain' },
    })
  }
}

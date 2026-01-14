/**
 * Surface Router
 *
 * Creates a Hono router that serves discovered surfaces at their respective paths.
 *
 * Surface routing:
 * - Site -> / (root) and /site/*
 * - App -> /app/* (also / if no Site exists)
 * - Admin -> /admin/*
 * - Docs -> /docs/*
 * - Blog -> /blog/*
 *
 * Unknown paths return 404.
 */

import type { Hono } from 'hono'
import type { Surface } from '../utils/discover'
import { createBundler, type Bundler, type BundlerOptions } from './bundler'

// Lazy-loaded Hono for cold start optimization
let honoModule: typeof import('hono') | null = null

async function getHono(): Promise<typeof import('hono')> {
  if (!honoModule) {
    honoModule = await import('hono')
  }
  return honoModule
}

/**
 * Options for creating a surface router
 */
export interface SurfaceRouterOptions {
  /**
   * Map of surface names to their file paths.
   * null means the surface is not configured.
   */
  surfaces: Record<Surface, string | null>

  /**
   * Callback to render a surface file.
   * Called with the surface file path and the incoming request.
   * Should return a Response.
   */
  renderSurface: (surfacePath: string, request: Request) => Promise<Response>
}

/**
 * Creates a Hono router that routes requests to discovered surfaces.
 *
 * @param options - Surface router configuration
 * @returns Hono app configured with surface routes
 */
export async function createSurfaceRouter(options: SurfaceRouterOptions): Promise<Hono> {
  const { Hono } = await getHono()
  const { surfaces, renderSurface } = options
  const app = new Hono()

  // Site at root (/) - highest priority for root path
  if (surfaces.Site) {
    app.all('/', async (c) => renderSurface(surfaces.Site!, c.req.raw))
    // Also serve at /site/* path
    app.all('/site', async (c) => renderSurface(surfaces.Site!, c.req.raw))
    app.all('/site/*', async (c) => renderSurface(surfaces.Site!, c.req.raw))
  }

  // App surface at /app/*
  if (surfaces.App) {
    app.all('/app', async (c) => renderSurface(surfaces.App!, c.req.raw))
    app.all('/app/*', async (c) => renderSurface(surfaces.App!, c.req.raw))

    // App serves at root if no Site exists
    if (!surfaces.Site) {
      app.all('/', async (c) => renderSurface(surfaces.App!, c.req.raw))
    }
  }

  // Admin surface at /admin/*
  if (surfaces.Admin) {
    app.all('/admin', async (c) => renderSurface(surfaces.Admin!, c.req.raw))
    app.all('/admin/*', async (c) => renderSurface(surfaces.Admin!, c.req.raw))
  }

  // Docs surface at /docs/*
  if (surfaces.Docs) {
    app.all('/docs', async (c) => renderSurface(surfaces.Docs!, c.req.raw))
    app.all('/docs/*', async (c) => renderSurface(surfaces.Docs!, c.req.raw))
  }

  // Blog surface at /blog/*
  if (surfaces.Blog) {
    app.all('/blog', async (c) => renderSurface(surfaces.Blog!, c.req.raw))
    app.all('/blog/*', async (c) => renderSurface(surfaces.Blog!, c.req.raw))
  }

  // 404 fallback for all unmatched routes
  app.all('*', (c) => c.text('Not Found', 404))

  return app
}

/**
 * Creates a surface renderer that uses the bundler to compile TSX/MDX files.
 *
 * This is a convenience function that creates a bundler and returns a render function
 * suitable for use with createSurfaceRouter.
 *
 * @param options - Bundler options for compilation
 * @returns A render function that compiles surfaces and returns HTML responses
 */
export function createSurfaceRenderer(options?: BundlerOptions): {
  render: (surfacePath: string, request: Request) => Promise<Response>
  bundler: Bundler
} {
  const bundler = createBundler(options)

  const render = async (surfacePath: string, _request: Request): Promise<Response> => {
    try {
      const result = await bundler.compile(surfacePath)

      // Create an HTML response that loads the compiled JavaScript
      // The compiled code is a module that exports a default React component
      const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Surface</title>
  <script type="importmap">
  {
    "imports": {
      "react": "https://esm.sh/react@19",
      "react-dom": "https://esm.sh/react-dom@19",
      "react-dom/client": "https://esm.sh/react-dom@19/client",
      "react/jsx-runtime": "https://esm.sh/react@19/jsx-runtime",
      "@mdxui/beacon": "https://esm.sh/@mdxui/beacon",
      "@mdxui/cockpit": "https://esm.sh/@mdxui/cockpit",
      "@mdxui/primitives": "https://esm.sh/@mdxui/primitives"
    }
  }
  </script>
</head>
<body>
  <div id="root"></div>
  <script type="module">
    import { createRoot } from 'react-dom/client';

    // Inline the compiled module
    ${result.code}

    // Get the default export (the component)
    const Component = typeof _default !== 'undefined' ? _default :
                     typeof MDXContent !== 'undefined' ? MDXContent :
                     null;

    if (Component) {
      const root = createRoot(document.getElementById('root'));
      root.render(Component());
    }
  </script>
</body>
</html>
`.trim()

      return new Response(html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return new Response(`Compilation Error: ${message}`, {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      })
    }
  }

  return { render, bundler }
}

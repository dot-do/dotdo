'use client'

/**
 * Catch-All Route with REST API Support
 *
 * This route handles:
 * 1. REST API requests (GET, POST, PUT, PATCH, DELETE) for /:type and /:type/:id
 * 2. Edit UI at /:type/:id/edit (returns HTML with Monaco editor)
 * 3. 404 fallback for unmatched routes
 *
 * ## REST API Routes
 * - GET /:type - List collection (returns JSON-LD)
 * - GET /:type/:id - Get single item (returns JSON-LD)
 * - GET /:type/:id/edit - Edit UI (returns HTML with Monaco)
 * - POST /:type - Create item
 * - PUT /:type/:id - Update item (replace)
 * - PATCH /:type/:id - Update item (merge)
 * - DELETE /:type/:id - Delete item
 *
 * ## Data Test IDs
 * - 404-page: Root container for the 404 page
 * - 404-message: The "not found" message text
 * - 404-home-link: Link to navigate back to the home page
 */

import { createFileRoute, Link, useLocation } from '@tanstack/react-router'
import { Home, ArrowLeft } from 'lucide-react'
import { Button } from '@mdxui/primitives/button'
import { memoryStore, singularize, capitalize, pluralize } from '../lib/memory-store'
import { buildResponse } from '../../lib/response/linked-data'
import { buildCollectionResponse } from '../../lib/response/collection'
import { buildItemLinks } from '../../lib/response/links'
import { buildItemActionsClickable } from '../../lib/response/actions'
import { generateEditUI, createEditUIData } from '../../objects/transport/edit-ui'

/**
 * Parse route path to extract type, id, and action
 *
 * Supports:
 * - /:type - collection route
 * - /:type/:id - item route
 * - /:type/:id/edit - edit UI route
 * - /:parent/:parentId/:type/:id/edit - nested edit UI route (e.g., /organizations/acme/customers/alice/edit)
 */
function parseRoute(pathname: string): { type: string; id?: string; action?: 'edit' } | null {
  const segments = pathname.slice(1).split('/').filter(Boolean)

  if (segments.length === 0) return null

  // Skip known routes (admin, app, docs, login, etc.)
  const knownRoutes = ['admin', 'app', 'docs', 'login', 'auth', 'api', 'schema']
  if (knownRoutes.includes(segments[0]!.toLowerCase())) return null

  // Check if last segment is 'edit' - handle any depth of nesting
  if (segments[segments.length - 1]?.toLowerCase() === 'edit' && segments.length >= 3) {
    // Take the second-to-last segment as id, third-to-last as type
    const id = segments[segments.length - 2]
    const typeSegment = segments[segments.length - 3]
    const type = capitalize(singularize(typeSegment!))
    return { type, id, action: 'edit' }
  }

  if (segments.length === 1) {
    // /:type - collection route
    const type = capitalize(singularize(segments[0]!))
    return { type }
  }

  if (segments.length === 2) {
    // /:type/:id - item route
    const type = capitalize(singularize(segments[0]!))
    return { type, id: segments[1] }
  }

  // For longer paths without /edit, take last two segments as type/id
  if (segments.length >= 2) {
    const id = segments[segments.length - 1]
    const typeSegment = segments[segments.length - 2]
    const type = capitalize(singularize(typeSegment!))
    return { type, id }
  }

  return null
}

/**
 * Handle collection GET request
 */
async function handleCollectionGet(ns: string, type: string): Promise<Response> {
  const items = await memoryStore.list(type)
  const count = items.length

  const formattedItems = items.map((item) => ({
    id: item.$id,
    name: item.name ?? undefined,
    ...(item.data ?? {}),
  }))

  const collection = buildCollectionResponse(formattedItems, count, {
    ns,
    type,
  })

  return Response.json(collection, {
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Handle item GET request
 */
async function handleItemGet(ns: string, type: string, id: string): Promise<Response> {
  const item = await memoryStore.get(type, id)

  if (!item) {
    return Response.json(
      { $type: 'Error', error: `${type} not found: ${id}`, code: 'NOT_FOUND' },
      { status: 404 }
    )
  }

  const data = {
    id: item.$id,
    name: item.name ?? undefined,
    ...(item.data ?? {}),
  }

  const response = buildResponse(data, { ns, type, id })
  const links = buildItemLinks({ ns, type, id })
  const actions = buildItemActionsClickable({ ns, type, id })

  return Response.json(
    {
      ...response,
      links: {
        self: response.$id,
        ...links,
      },
      actions,
    },
    { headers: { 'Content-Type': 'application/json' } }
  )
}

/**
 * Handle edit UI GET request
 */
async function handleEditGet(ns: string, type: string, id: string): Promise<Response> {
  const item = await memoryStore.get(type, id)

  const editData = createEditUIData(
    ns,
    type,
    id,
    item
      ? {
          id: item.$id,
          name: item.name ?? undefined,
          ...(item.data ?? {}),
        }
      : null
  )

  const html = generateEditUI(editData)

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

/**
 * Handle POST request (create)
 */
async function handleCreate(ns: string, type: string, body: Record<string, unknown>): Promise<Response> {
  const { $id, $type, $context, ...restData } = body

  const item = await memoryStore.create(type, {
    $id: $id as string | undefined,
    name: restData.name as string | undefined,
    data: restData,
  })

  const response = buildResponse(
    {
      id: item.$id,
      name: item.name ?? undefined,
      ...(item.data ?? {}),
    },
    { ns, type, id: item.$id }
  )
  const links = buildItemLinks({ ns, type, id: item.$id })
  const actions = buildItemActionsClickable({ ns, type, id: item.$id })

  return Response.json(
    {
      ...response,
      links: {
        self: response.$id,
        ...links,
      },
      actions,
    },
    {
      status: 201,
      headers: {
        'Content-Type': 'application/json',
        'Location': response.$id,
      },
    }
  )
}

/**
 * Handle PUT/PATCH request (update)
 */
async function handleUpdate(
  ns: string,
  type: string,
  id: string,
  body: Record<string, unknown>
): Promise<Response> {
  const existing = await memoryStore.get(type, id)

  if (!existing) {
    return Response.json(
      { $type: 'Error', error: `${type} not found: ${id}`, code: 'NOT_FOUND' },
      { status: 404 }
    )
  }

  const { $id, $type: _, $context, ...restData } = body

  const item = await memoryStore.update(type, id, {
    name: restData.name as string | undefined,
    data: restData,
  })

  const response = buildResponse(
    {
      id: item.$id,
      name: item.name ?? undefined,
      ...(item.data ?? {}),
    },
    { ns, type, id: item.$id }
  )
  const links = buildItemLinks({ ns, type, id: item.$id })
  const actions = buildItemActionsClickable({ ns, type, id: item.$id })

  return Response.json(
    {
      ...response,
      links: {
        self: response.$id,
        ...links,
      },
      actions,
    },
    { headers: { 'Content-Type': 'application/json' } }
  )
}

/**
 * Handle DELETE request
 */
async function handleDelete(type: string, id: string): Promise<Response> {
  const existing = await memoryStore.get(type, id)

  if (!existing) {
    return Response.json(
      { $type: 'Error', error: `${type} not found: ${id}`, code: 'NOT_FOUND' },
      { status: 404 }
    )
  }

  await memoryStore.delete(type, id)

  return new Response(null, { status: 204 })
}

export const Route = createFileRoute('/$')({
  component: NotFoundPage,
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const ns = url.origin
        const route = parseRoute(url.pathname)

        // Not a REST route - let the component render (404)
        if (!route) {
          return undefined
        }

        const { type, id, action } = route

        // Edit UI route
        if (action === 'edit' && id) {
          return handleEditGet(ns, type, id)
        }

        // Content negotiation - only handle JSON requests for API
        const accept = request.headers.get('Accept') || ''
        const isApiRequest = accept.includes('application/json') || accept.includes('*/*')

        // Collection route
        if (!id) {
          if (isApiRequest) {
            return handleCollectionGet(ns, type)
          }
          return undefined // Let component render
        }

        // Item route
        if (isApiRequest) {
          return handleItemGet(ns, type, id)
        }

        return undefined // Let component render
      },

      POST: async ({ request }) => {
        const url = new URL(request.url)
        const ns = url.origin
        const route = parseRoute(url.pathname)

        if (!route || route.id) {
          return Response.json(
            { $type: 'Error', error: 'POST only allowed on collection routes', code: 'METHOD_NOT_ALLOWED' },
            { status: 405 }
          )
        }

        try {
          const body = await request.json()
          return handleCreate(ns, route.type, body)
        } catch {
          return Response.json(
            { $type: 'Error', error: 'Invalid JSON body', code: 'BAD_REQUEST' },
            { status: 400 }
          )
        }
      },

      PUT: async ({ request }) => {
        const url = new URL(request.url)
        const ns = url.origin
        const route = parseRoute(url.pathname)

        if (!route || !route.id || route.action) {
          return Response.json(
            { $type: 'Error', error: 'PUT requires /:type/:id route', code: 'METHOD_NOT_ALLOWED' },
            { status: 405 }
          )
        }

        try {
          const body = await request.json()
          return handleUpdate(ns, route.type, route.id, body)
        } catch {
          return Response.json(
            { $type: 'Error', error: 'Invalid JSON body', code: 'BAD_REQUEST' },
            { status: 400 }
          )
        }
      },

      PATCH: async ({ request }) => {
        const url = new URL(request.url)
        const ns = url.origin
        const route = parseRoute(url.pathname)

        if (!route || !route.id || route.action) {
          return Response.json(
            { $type: 'Error', error: 'PATCH requires /:type/:id route', code: 'METHOD_NOT_ALLOWED' },
            { status: 405 }
          )
        }

        try {
          const body = await request.json()
          return handleUpdate(ns, route.type, route.id, body)
        } catch {
          return Response.json(
            { $type: 'Error', error: 'Invalid JSON body', code: 'BAD_REQUEST' },
            { status: 400 }
          )
        }
      },

      DELETE: async ({ request }) => {
        const url = new URL(request.url)
        const route = parseRoute(url.pathname)

        if (!route || !route.id || route.action) {
          return Response.json(
            { $type: 'Error', error: 'DELETE requires /:type/:id route', code: 'METHOD_NOT_ALLOWED' },
            { status: 405 }
          )
        }

        return handleDelete(route.type, route.id)
      },
    },
  },
})

function NotFoundPage() {
  const location = useLocation()
  const attemptedPath = location.pathname

  return (
    <div
      data-testid="404-page"
      className="min-h-screen flex items-center justify-center bg-background text-foreground"
    >
      <div className="text-center max-w-md mx-auto px-6">
        {/* 404 Status Code */}
        <div className="mb-8">
          <h1 className="text-9xl font-bold text-muted-foreground/20">404</h1>
        </div>

        {/* Error Message */}
        <div className="mb-8">
          <h2
            data-testid="404-message"
            className="text-2xl font-semibold mb-4"
          >
            Page Not Found
          </h2>
          <p className="text-muted-foreground">
            The page you're looking for doesn't exist or has been moved.
          </p>
          {attemptedPath && attemptedPath !== '/' && (
            <p className="text-sm text-muted-foreground mt-2 font-mono bg-muted/50 px-3 py-1 rounded-md inline-block">
              {attemptedPath}
            </p>
          )}
        </div>

        {/* Navigation Options */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button asChild variant="default" data-testid="404-home-link">
            <Link to="/">
              <Home className="mr-2 h-4 w-4" />
              Go Home
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/" onClick={(e) => { e.preventDefault(); window.history.back(); }}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Go Back
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )
}

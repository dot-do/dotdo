/**
 * Index route for TanStack Start app
 *
 * This is the home page rendered at the root path '/'.
 *
 * @see https://tanstack.com/start/latest/docs/routing/file-routes
 */
import type { ReactNode } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: IndexComponent,
  head: () => ({
    meta: [
      { title: 'dotdo - Durable Objects Runtime' },
    ],
  }),
})

/**
 * Home page component
 *
 * Displays the main landing page with introduction to dotdo.
 */
function IndexComponent(): ReactNode {
  return (
    <main>
      <h1>dotdo</h1>
      <p>Durable Objects runtime framework</p>
      <nav>
        <Link to="/docs">View Documentation</Link>
      </nav>
    </main>
  )
}

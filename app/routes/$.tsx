/**
 * Catch-All 404 Route
 *
 * This route handles all unmatched URLs and displays a user-friendly 404 page.
 * It serves as the fallback for any route that doesn't match existing routes.
 *
 * ## Features
 * - User-friendly "Page Not Found" message
 * - Navigation back to home page
 * - Consistent styling with the rest of the application
 *
 * ## Data Test IDs
 * - 404-page: Root container for the 404 page
 * - 404-message: The "not found" message text
 * - 404-home-link: Link to navigate back to the home page
 */

import { createFileRoute, Link, useLocation } from '@tanstack/react-router'
import { Home, ArrowLeft } from 'lucide-react'
import { Button } from '@mdxui/primitives/button'

export const Route = createFileRoute('/$')({
  component: NotFoundPage,
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

/**
 * Lazy Terminal Component
 *
 * Client-only wrapper for TerminalEmbed that safely handles SSR.
 * Uses dynamic import with SSR guard to ensure xterm.js is never
 * imported on the server.
 *
 * Usage:
 * ```tsx
 * import { LazyTerminal, TerminalSkeleton } from '~/components/LazyTerminal'
 *
 * function MyComponent() {
 *   return (
 *     <LazyTerminal
 *       sandboxId="my-sandbox"
 *       className="h-96"
 *       onError={(err) => console.error(err)}
 *     />
 *   )
 * }
 * ```
 *
 * @see app/components/TerminalEmbed.tsx - Underlying terminal implementation
 */

'use client'

import { Suspense, lazy, memo, useState, useEffect } from 'react'
import type { TerminalEmbedProps } from './TerminalEmbed'

// =============================================================================
// Terminal Skeleton
// =============================================================================

export interface TerminalSkeletonProps {
  className?: string
  height?: number
}

/**
 * Skeleton loading state for the terminal.
 * Shows a realistic terminal-like appearance while loading.
 */
export const TerminalSkeleton = memo(function TerminalSkeleton({
  className = '',
  height = 384, // h-96 = 24rem = 384px
}: TerminalSkeletonProps) {
  return (
    <div
      className={`relative ${className}`}
      data-testid="terminal-skeleton"
      role="progressbar"
      aria-label="Loading terminal..."
      aria-busy="true"
    >
      {/* Status indicator skeleton */}
      <div className="absolute top-2 left-2 z-10 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-gray-500 animate-pulse" />
        <span className="text-xs text-white bg-black/50 px-2 py-1 rounded animate-pulse">
          Loading...
        </span>
      </div>

      {/* Terminal container skeleton */}
      <div
        className="w-full border rounded bg-gray-900 overflow-hidden"
        style={{ height }}
      >
        {/* Fake terminal content */}
        <div className="p-4 font-mono text-sm text-gray-400 animate-pulse">
          <div className="h-4 bg-gray-700/50 rounded w-32 mb-2" />
          <div className="h-4 bg-gray-700/50 rounded w-48 mb-2" />
          <div className="h-4 bg-gray-700/50 rounded w-24 mb-2" />
          <div className="flex items-center gap-2">
            <span className="text-green-500">$</span>
            <div className="h-4 w-2 bg-gray-400 animate-blink" />
          </div>
        </div>
      </div>
    </div>
  )
})

// =============================================================================
// Lazy Terminal Component
// =============================================================================

/**
 * Lazy-loaded TerminalEmbed component.
 * Only loads on the client side to avoid SSR issues with xterm.js.
 */
const LazyTerminalEmbed = lazy(() =>
  import('./TerminalEmbed').then((mod) => ({ default: mod.TerminalEmbed }))
)

/**
 * SSR-safe wrapper for TerminalEmbed.
 *
 * Features:
 * - Only renders on client (SSR-safe)
 * - Shows skeleton during load
 * - Suspense boundary for code splitting
 * - Graceful error handling
 */
export function LazyTerminal(props: TerminalEmbedProps) {
  const [isClient, setIsClient] = useState(false)

  // Only render on client to avoid SSR issues with xterm
  useEffect(() => {
    setIsClient(true)
  }, [])

  // During SSR or initial client render, show skeleton
  if (!isClient) {
    return (
      <TerminalSkeleton
        className={props.className}
        height={384}
      />
    )
  }

  return (
    <Suspense
      fallback={
        <TerminalSkeleton
          className={props.className}
          height={384}
        />
      }
    >
      <LazyTerminalEmbed {...props} />
    </Suspense>
  )
}

export default LazyTerminal

/**
 * Site MDX Components
 *
 * Components used in Site.mdx for the landing page.
 * Re-exports from @dotdo/landing with proper data attributes for E2E testing.
 */

import type { ReactNode } from 'react'

// Re-export from @dotdo/landing
export {
  AgentGrid,
  Agent,
  FeatureGrid,
  Feature,
  CTA,
  PrimitivePage,
} from '@dotdo/landing'

// Hero section wrapper
interface HeroProps {
  children: ReactNode
}

export function Hero({ children }: HeroProps) {
  return (
    <section className="py-20 px-4">
      <div className="container max-w-6xl mx-auto text-center">{children}</div>
    </section>
  )
}

// Section wrapper
interface SectionProps {
  children: ReactNode
  background?: 'default' | 'alt'
}

export function Section({ children, background = 'default' }: SectionProps) {
  const bg = background === 'alt' ? 'bg-gray-900/50' : ''
  return (
    <section className={`py-20 px-4 border-t border-gray-800 ${bg}`}>
      <div className="container max-w-6xl mx-auto">{children}</div>
    </section>
  )
}

// Code block with terminal styling
interface CodeBlockProps {
  filename?: string
  language?: string
  children: ReactNode
}

export function CodeBlock({ filename, children }: CodeBlockProps) {
  return (
    <div className="max-w-3xl mx-auto my-8">
      <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
        {filename && (
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <div className="w-3 h-3 rounded-full bg-yellow-500" />
            <div className="w-3 h-3 rounded-full bg-green-500" />
            <span className="ml-2 text-sm text-gray-500">{filename}</span>
          </div>
        )}
        <pre className="p-4 overflow-x-auto">
          <code>{children}</code>
        </pre>
      </div>
    </div>
  )
}

// Export LandingLayout (keep for backwards compatibility, but use PrimitivePage)
export { LandingLayout } from './LandingLayout'

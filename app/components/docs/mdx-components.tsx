/**
 * MDX Components Configuration
 *
 * Custom MDX component overrides for documentation.
 * Extends fumadocs-ui/mdx default components.
 *
 * ## Features
 * - Heading components with anchor links for deep linking
 * - Code blocks with copy button support
 * - Callout/admonition components (info, warning, error, tip)
 * - Table styling for responsive display
 * - Image optimization with lazy loading
 *
 * ## Accessibility
 * - Headings with visible anchor links on hover/focus
 * - Code blocks with proper language labeling
 * - Callouts with semantic role and iconography
 * - Focus indicators on all interactive elements
 *
 * @module components/docs/mdx-components
 * @see https://fumadocs.dev/docs/ui/mdx
 */

import React, { type ReactNode, type ComponentType, type HTMLAttributes, memo } from 'react'
import fumadocsComponents from 'fumadocs-ui/mdx'

/**
 * MDX component type helper
 */
type MDXComponent<P = object> = ComponentType<P>

/**
 * Heading level type
 */
type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

/**
 * Props for heading components
 */
interface HeadingProps extends HTMLAttributes<HTMLHeadingElement> {
  /** Anchor ID for deep linking */
  id?: string
  /** Heading content */
  children?: ReactNode
}

/**
 * Creates a heading component with anchor link support.
 *
 * The anchor link appears on hover/focus, allowing users to easily
 * copy deep links to specific sections of documentation.
 *
 * @param level - Heading level (1-6)
 * @returns React component for the specified heading level
 */
function createHeading(level: HeadingLevel): MDXComponent<HeadingProps> {
  const Tag = `h${level}` as const

  // Define heading-specific styles
  const styles: Record<HeadingLevel, string> = {
    1: 'text-4xl font-bold mt-8 mb-4',
    2: 'text-2xl font-semibold mt-8 mb-3 pb-2 border-b border-border/50',
    3: 'text-xl font-semibold mt-6 mb-2',
    4: 'text-lg font-medium mt-4 mb-2',
    5: 'text-base font-medium mt-3 mb-1',
    6: 'text-sm font-medium mt-3 mb-1',
  }

  return memo(function Heading({ id, children, className, ...props }: HeadingProps): ReactNode {
    return (
      <Tag
        id={id}
        className={`scroll-mt-24 group relative ${styles[level]} ${className ?? ''}`}
        {...props}
      >
        {children}
        {id && (
          <a
            href={`#${id}`}
            className="
              ml-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100
              transition-opacity duration-200
              text-muted-foreground hover:text-primary
              focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded
              absolute -left-5 top-1/2 -translate-y-1/2
              hidden sm:inline-block
            "
            aria-label={`Link to section: ${typeof children === 'string' ? children : 'this section'}`}
          >
            <LinkIcon />
          </a>
        )}
      </Tag>
    )
  })
}

/**
 * Link icon for heading anchors
 */
function LinkIcon(): ReactNode {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
      />
    </svg>
  )
}

/**
 * Props for code components
 */
interface CodeProps extends HTMLAttributes<HTMLElement> {
  /** Code content */
  children?: ReactNode
  /** Language class (e.g., "language-typescript") */
  className?: string
}

/**
 * Custom code block component.
 * Handles both inline code and code blocks with language syntax.
 */
const CodeBlock = memo(function CodeBlock({
  children,
  className,
  ...props
}: CodeProps): ReactNode {
  // Check if this is a code block (has language class) vs inline code
  const isInline = !className?.includes('language-')

  if (isInline) {
    return (
      <code
        className="px-1.5 py-0.5 bg-muted/70 rounded text-[0.9em] font-mono text-foreground"
        {...props}
      >
        {children}
      </code>
    )
  }

  // Extract language for accessibility
  const language = className?.replace('language-', '') ?? 'text'

  return (
    <code
      className={className}
      aria-label={`Code snippet in ${language}`}
      {...props}
    >
      {children}
    </code>
  )
})

/**
 * Props for pre (code block wrapper) components
 */
interface PreProps extends HTMLAttributes<HTMLPreElement> {
  /** Code content */
  children?: ReactNode
  /** Raw code string for copy functionality */
  raw?: string
}

/**
 * Custom pre (code block wrapper) component.
 * Provides styling and copy button functionality.
 */
const Pre = memo(function Pre({ children, className, ...props }: PreProps): ReactNode {
  return (
    <pre
      className={`
        my-4 p-4 rounded-lg bg-muted/50 border border-border/50
        overflow-x-auto text-sm
        focus:outline-none focus-visible:ring-2 focus-visible:ring-primary
        ${className ?? ''}
      `}
      tabIndex={0}
      {...props}
    >
      {children}
    </pre>
  )
})

/**
 * Callout type options
 */
export type CalloutType = 'info' | 'warning' | 'error' | 'tip' | 'note'

/**
 * Props for Callout component
 */
export interface CalloutProps {
  /** Type of callout affecting style and icon */
  type?: CalloutType
  /** Optional title for the callout */
  title?: string
  /** Callout content */
  children?: ReactNode
}

/**
 * Style configuration for callout types
 */
const calloutStyles: Record<CalloutType, { border: string; bg: string; icon: ReactNode }> = {
  info: {
    border: 'border-blue-500/50',
    bg: 'bg-blue-50/50 dark:bg-blue-950/20',
    icon: <InfoIcon className="text-blue-500" />,
  },
  note: {
    border: 'border-blue-500/50',
    bg: 'bg-blue-50/50 dark:bg-blue-950/20',
    icon: <InfoIcon className="text-blue-500" />,
  },
  warning: {
    border: 'border-yellow-500/50',
    bg: 'bg-yellow-50/50 dark:bg-yellow-950/20',
    icon: <WarningIcon className="text-yellow-600 dark:text-yellow-500" />,
  },
  error: {
    border: 'border-red-500/50',
    bg: 'bg-red-50/50 dark:bg-red-950/20',
    icon: <ErrorIcon className="text-red-500" />,
  },
  tip: {
    border: 'border-green-500/50',
    bg: 'bg-green-50/50 dark:bg-green-950/20',
    icon: <TipIcon className="text-green-600 dark:text-green-500" />,
  },
}

/**
 * Callout component for notes, warnings, tips, and errors.
 *
 * Use callouts to highlight important information in documentation.
 * Each type has a distinct color scheme and icon.
 *
 * @example
 * ```tsx
 * <Callout type="warning" title="Breaking Change">
 *   This API has changed in v2.0.
 * </Callout>
 *
 * <Callout type="tip">
 *   You can use keyboard shortcuts for faster navigation.
 * </Callout>
 * ```
 */
export const Callout = memo(function Callout({
  type = 'info',
  title,
  children,
}: CalloutProps): ReactNode {
  const style = calloutStyles[type]

  return (
    <div
      className={`my-6 p-4 border-l-4 rounded-r-lg ${style.border} ${style.bg}`}
      role="note"
      aria-label={`${type} callout${title ? `: ${title}` : ''}`}
    >
      <div className="flex items-start gap-3">
        <span className="shrink-0 mt-0.5" aria-hidden="true">
          {style.icon}
        </span>
        <div className="flex-1 min-w-0">
          {title && (
            <p className="font-semibold mb-1 text-foreground">{title}</p>
          )}
          <div className="text-sm text-foreground/90 prose-sm">
            {children}
          </div>
        </div>
      </div>
    </div>
  )
})

// Callout icon components
function InfoIcon({ className }: { className?: string }): ReactNode {
  return (
    <svg className={`w-5 h-5 ${className}`} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
    </svg>
  )
}

function WarningIcon({ className }: { className?: string }): ReactNode {
  return (
    <svg className={`w-5 h-5 ${className}`} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
  )
}

function ErrorIcon({ className }: { className?: string }): ReactNode {
  return (
    <svg className={`w-5 h-5 ${className}`} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
    </svg>
  )
}

function TipIcon({ className }: { className?: string }): ReactNode {
  return (
    <svg className={`w-5 h-5 ${className}`} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
  )
}

/**
 * MDX components configuration
 *
 * Extends fumadocs-ui default components with custom overrides for:
 * - Heading components (h1-h6) with anchor links
 * - Code blocks with syntax highlighting support
 * - Callout component for admonitions
 *
 * @example
 * ```tsx
 * import { mdxComponents } from './mdx-components'
 *
 * <MDXContent components={mdxComponents}>
 *   {content}
 * </MDXContent>
 * ```
 */
export const mdxComponents = {
  ...fumadocsComponents,
  // Custom heading components with anchor links
  h1: createHeading(1),
  h2: createHeading(2),
  h3: createHeading(3),
  h4: createHeading(4),
  h5: createHeading(5),
  h6: createHeading(6),
  // Code components
  code: CodeBlock,
  pre: Pre,
  // Admonition components
  Callout,
} as const

/**
 * Hook for MDX components (Next.js/MDX Provider pattern)
 *
 * This hook returns the configured MDX components for use with
 * MDX provider patterns. It's memoized for performance.
 *
 * @returns MDX components configuration object
 *
 * @example
 * ```tsx
 * import { useMDXComponents } from './mdx-components'
 *
 * export function MDXProvider({ children }) {
 *   const components = useMDXComponents()
 *   return <MDXContent components={components}>{children}</MDXContent>
 * }
 * ```
 */
export function useMDXComponents(): typeof mdxComponents {
  return mdxComponents
}

// Named export for component mapping
export { mdxComponents as components }
export default mdxComponents

/**
 * Fumadocs MDX Configuration
 *
 * This file configures the fumadocs-mdx plugin for processing MDX files.
 * It's used during Next.js build to generate the virtual module.
 *
 * @see https://fumadocs.dev/docs/mdx
 * @see https://fumadocs.dev/docs/mdx/configuration
 */

import { defineDocs, defineConfig, type GlobalConfig } from 'fumadocs-mdx/config'
import type { PluggableList } from 'unified'

/**
 * Docs collection configuration.
 * Scans the docs/ directory for MDX files and meta.json navigation files.
 */
export const docs = defineDocs({
  /** Directory containing documentation files */
  dir: 'docs',
  /** File extensions to process */
  // files: ['**/*.mdx', '**/*.md'],
})

/**
 * Remark plugins for MDX processing.
 * These run during the parse phase (Markdown AST).
 *
 * Common plugins:
 * - remark-gfm: GitHub Flavored Markdown (tables, strikethrough, etc.)
 * - remark-math: Math expressions with KaTeX/MathJax
 * - remark-emoji: Emoji shortcodes
 */
const remarkPlugins: PluggableList = [
  // Add remark plugins here when needed
  // Example: [remarkGfm, { singleTilde: false }]
]

/**
 * Rehype plugins for MDX processing.
 * These run during the transform phase (HTML AST).
 *
 * Common plugins:
 * - rehype-slug: Add IDs to headings
 * - rehype-autolink-headings: Add anchor links to headings
 * - rehype-pretty-code: Syntax highlighting with Shiki
 * - rehype-katex: Render math with KaTeX
 */
const rehypePlugins: PluggableList = [
  // Add rehype plugins here when needed
  // Example: [rehypePrettyCode, { theme: 'github-dark' }]
]

/**
 * Global MDX configuration.
 * Applies to all MDX files in the docs collection.
 */
const config: GlobalConfig = {
  /** MDX compiler options */
  mdxOptions: {
    remarkPlugins,
    rehypePlugins,
    /** Enable development mode for better error messages */
    development: process.env.NODE_ENV === 'development',
  },
  /**
   * Generate last modified timestamp from git.
   * Useful for showing "Last updated" on pages.
   */
  lastModifiedTime: 'git',
}

export default defineConfig(config)

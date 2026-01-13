/**
 * MDX Processing Library
 *
 * Provides utilities for rendering Site.mdx and App.mdx content
 * with custom MDXUI components.
 */

export { getSitePage, getAppPage, siteSource, appContentSource } from '../source'

/**
 * MDX Components used in Site.mdx and App.mdx
 * These are re-exported from the mdx-components.tsx file
 */
export {
  AgentGrid,
  Agent,
  FeatureGrid,
  Feature,
  CTA,
  PrimitivePage,
  Hero,
  Section,
  CodeBlock,
  AutoTypeTable,
  useMDXComponents,
} from '../../mdx-components'

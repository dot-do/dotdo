/**
 * MDX Components Configuration
 *
 * This file provides custom React components for use in MDX files.
 * These components are automatically available in all MDX documents
 * without needing explicit imports.
 *
 * @see https://fumadocs.dev/docs/ui/mdx
 * @see https://nextjs.org/docs/app/building-your-application/configuring/mdx
 */

import type { MDXComponents } from 'mdx/types'
import defaultComponents from 'fumadocs-ui/mdx'
import {
  Tab,
  Tabs,
} from 'fumadocs-ui/components/tabs'
import {
  Accordion,
  Accordions,
} from 'fumadocs-ui/components/accordion'
import { Callout } from 'fumadocs-ui/components/callout'
import { Card, Cards } from 'fumadocs-ui/components/card'
import { Step, Steps } from 'fumadocs-ui/components/steps'
import { File, Files, Folder } from 'fumadocs-ui/components/files'
import { TypeTable } from 'fumadocs-ui/components/type-table'
import { ImageZoom } from 'fumadocs-ui/components/image-zoom'

/**
 * Custom components available in MDX files.
 *
 * Usage in MDX:
 * ```mdx
 * <Callout type="info">
 *   This is an informational callout.
 * </Callout>
 *
 * <Tabs items={['npm', 'pnpm', 'yarn']}>
 *   <Tab value="npm">npm install dotdo</Tab>
 *   <Tab value="pnpm">pnpm add dotdo</Tab>
 *   <Tab value="yarn">yarn add dotdo</Tab>
 * </Tabs>
 * ```
 */
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    // Include default Fumadocs components (headings, code blocks, etc.)
    ...defaultComponents,

    // Callouts for tips, warnings, and info boxes
    Callout,

    // Tabs for showing alternative content
    Tab,
    Tabs,

    // Accordions for collapsible content
    Accordion,
    Accordions,

    // Cards for navigation and feature highlights
    Card,
    Cards,

    // Steps for numbered instructions
    Step,
    Steps,

    // File tree visualization
    File,
    Files,
    Folder,

    // Type documentation tables
    TypeTable,

    // Zoomable images
    ImageZoom,

    // Allow overriding with custom components
    ...components,
  }
}

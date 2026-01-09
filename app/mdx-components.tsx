/**
 * MDX Components Configuration
 *
 * This file exports all components available in MDX files.
 * Components are auto-imported into MDX pages.
 */

import { AutoTypeTable } from './components/AutoTypeTable'
import {
  AgentGrid,
  Agent,
  FeatureGrid,
  Feature,
  CTA,
  Hero,
  Section,
  CodeBlock,
} from './components/site'

// Site MDX components
export {
  AgentGrid,
  Agent,
  FeatureGrid,
  Feature,
  CTA,
  Hero,
  Section,
  CodeBlock,
  AutoTypeTable,
}

// Default MDX components export for fumadocs integration
export function useMDXComponents(components: Record<string, unknown>) {
  return {
    ...components,
    AutoTypeTable,
    AgentGrid,
    Agent,
    FeatureGrid,
    Feature,
    CTA,
    Hero,
    Section,
    CodeBlock,
  }
}

/**
 * MDX Components Configuration
 *
 * This file exports all components available in MDX files.
 * Components are auto-imported into MDX pages.
 */

import { AutoTypeTable } from './components/AutoTypeTable'

export { AutoTypeTable }

// Default MDX components export for fumadocs integration
export function useMDXComponents(components: Record<string, unknown>) {
  return {
    ...components,
    AutoTypeTable,
  }
}

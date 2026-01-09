import { defineDocs, frontmatterSchema } from 'fumadocs-mdx/config'
import { createOpenAPI } from 'fumadocs-openapi/server'
import { createGenerator } from 'fumadocs-typescript'

export const { docs, meta } = defineDocs({
  dir: 'docs',
})

// TypeScript type documentation configuration
export const typeGenerator = createGenerator({
  // Source files for type extraction
  files: ['./types/*.ts'],
})

// TypeDoc configuration for SDK documentation
export const typeDocConfig = {
  sourceFiles: [
    'types/Thing.ts',
    'types/WorkflowContext.ts',
    'types/capabilities.ts',
    'types/fn.ts',
    'types/Things.ts',
  ],
  outputPath: 'docs/sdk',
  exportedTypes: [
    'Thing',
    'ThingData',
    'ThingDO',
    'WorkflowContext',
    'DOFunction',
    'FsCapability',
    'GitCapability',
    'BashCapability',
    'WithFs',
    'WithGit',
    'WithBash',
    'RateLimitResult',
  ],
  typeTableComponent: 'AutoTypeTable',
}

// OpenAPI documentation configuration
export const openapi = createOpenAPI({
  // Path to the OpenAPI spec file or URL
  // In production, this would be generated from the API routes
})

// Code sample generators can be added later using createCodeSample from fumadocs-openapi/server
// Example:
// import { createCodeSample } from 'fumadocs-openapi/server'
// export const codeSampleGenerator = createCodeSample({ ... })

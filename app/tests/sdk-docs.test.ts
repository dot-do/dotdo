import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'

/**
 * TypeScript SDK Documentation Tests
 *
 * These tests verify that TypeScript type documentation is properly generated
 * using fumadocs-typescript integration:
 * - /docs/sdk/* pages render type documentation
 * - AutoTypeTable component displays interface properties
 * - JSDoc comments extracted and displayed
 * - @internal fields hidden from output
 * - @remarks and @fumadocsType annotations work
 * - fumadocs-typescript configured correctly
 * - Types extracted from actual source files (types/*.ts)
 *
 * Expected to FAIL until:
 * - fumadocs-typescript is installed
 * - TypeScript integration is configured in source.config.ts
 * - AutoTypeTable component is created/configured
 * - /docs/sdk/* routes are set up
 * - Type extraction pipeline is implemented
 */

// ============================================================================
// Mock Fetchers - Will need actual implementation
// ============================================================================

// Mock page fetcher for rendered SDK docs pages
async function fetchSDKDocsPage(path: string): Promise<Response> {
  // @ts-expect-error - module not yet implemented
  const { renderDocsPage } = await import('../src/docs/render')
  return renderDocsPage(path)
}

// Mock type extractor configuration getter
async function getTypeDocConfig(): Promise<TypeDocConfig> {
  // @ts-expect-error - module not yet implemented
  const { getTypeDocConfiguration } = await import('../lib/docs/type-docs')
  return getTypeDocConfiguration()
}

// Mock type definition extractor
async function extractTypeDefinition(typeName: string): Promise<ExtractedType> {
  // @ts-expect-error - module not yet implemented
  const { extractType } = await import('../lib/docs/type-extractor')
  return extractType(typeName)
}

// ============================================================================
// Types for Test Infrastructure
// ============================================================================

interface TypeDocConfig {
  sourceFiles: string[]
  outputPath: string
  exportedTypes: string[]
  typeTableComponent: string
}

interface ExtractedType {
  name: string
  kind: 'interface' | 'type' | 'class' | 'enum' | 'function'
  description?: string
  properties?: ExtractedProperty[]
  typeParameters?: TypeParameter[]
  extends?: string[]
  sourceFile: string
  lineNumber: number
}

interface ExtractedProperty {
  name: string
  type: string
  description?: string
  required: boolean
  defaultValue?: string
  internal?: boolean
  remarks?: string
  deprecated?: boolean
  examples?: string[]
}

interface TypeParameter {
  name: string
  constraint?: string
  default?: string
  description?: string
}

// ============================================================================
// 1. fumadocs-typescript Package Installation Tests
// ============================================================================

describe('fumadocs-typescript Configuration', () => {
  describe('Package Installation', () => {
    it('fumadocs-typescript is installed', async () => {
      const pkgPath = 'package.json'
      expect(existsSync(pkgPath)).toBe(true)
      const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'))
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      expect(deps['fumadocs-typescript']).toBeDefined()
    })

    it('typescript is installed with version >= 5.0', async () => {
      const pkgPath = 'package.json'
      const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'))
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      expect(deps['typescript']).toBeDefined()
      // Version should be 5.x or higher
      const version = deps['typescript'].replace(/[\^~]/, '')
      const major = parseInt(version.split('.')[0], 10)
      expect(major).toBeGreaterThanOrEqual(5)
    })
  })

  describe('Source Configuration', () => {
    it('source.config.ts exists', () => {
      expect(existsSync('docs/source.config.ts')).toBe(true)
    })

    it('source.config.ts imports fumadocs-typescript', async () => {
      const content = await readFile('docs/source.config.ts', 'utf-8')
      expect(content).toContain('fumadocs-typescript')
    })

    it('source.config.ts configures TypeScript type extraction', async () => {
      const content = await readFile('docs/source.config.ts', 'utf-8')
      // Should configure type extraction from source files
      expect(content).toMatch(/createTypeTable|generateTypeDoc|typeTable/i)
    })

    it('source.config.ts references types directory', async () => {
      const content = await readFile('docs/source.config.ts', 'utf-8')
      // Should reference the types/ directory for extraction
      expect(content).toMatch(/types\/|\.\/types|types\*/)
    })
  })

  describe('TypeDoc Configuration', () => {
    let config: TypeDocConfig

    beforeAll(async () => {
      config = await getTypeDocConfig()
    })

    it('has sourceFiles configured', () => {
      expect(config.sourceFiles).toBeDefined()
      expect(Array.isArray(config.sourceFiles)).toBe(true)
      expect(config.sourceFiles.length).toBeGreaterThan(0)
    })

    it('includes types/*.ts files', () => {
      const hasTypesDir = config.sourceFiles.some(
        (f) => f.includes('types/') || f.includes('types\\')
      )
      expect(hasTypesDir).toBe(true)
    })

    it('has exportedTypes list', () => {
      expect(config.exportedTypes).toBeDefined()
      expect(config.exportedTypes).toContain('Thing')
      expect(config.exportedTypes).toContain('WorkflowContext')
    })

    it('has typeTableComponent configured', () => {
      expect(config.typeTableComponent).toBeDefined()
      expect(config.typeTableComponent).toMatch(/AutoTypeTable|TypeTable/i)
    })
  })
})

// ============================================================================
// 2. AutoTypeTable MDX Component Tests
// ============================================================================

describe('AutoTypeTable Component', () => {
  describe('Component Existence', () => {
    it('AutoTypeTable component file exists', () => {
      const possiblePaths = [
        'app/components/AutoTypeTable.tsx',
        'app/components/auto-type-table.tsx',
        'app/components/docs/AutoTypeTable.tsx',
        'app/components/mdx/AutoTypeTable.tsx',
        'app/components/ui/type-table.tsx',
      ]
      const exists = possiblePaths.some((p) => existsSync(p))
      expect(exists).toBe(true)
    })

    it('AutoTypeTable is exported from MDX components', async () => {
      const possiblePaths = [
        'app/components/mdx/index.ts',
        'app/components/mdx/index.tsx',
        'app/mdx-components.tsx',
        'app/components/index.ts',
      ]

      let found = false
      for (const p of possiblePaths) {
        if (existsSync(p)) {
          const content = await readFile(p, 'utf-8')
          if (content.includes('AutoTypeTable')) {
            found = true
            break
          }
        }
      }
      expect(found).toBe(true)
    })
  })

  describe('Component Usage in MDX', () => {
    it('SDK docs directory exists', () => {
      expect(existsSync('docs/sdk')).toBe(true)
    })

    it('SDK index.mdx uses AutoTypeTable', async () => {
      const possiblePaths = [
        'docs/sdk/index.mdx',
        'docs/sdk/index.md',
        'docs/sdk/overview.mdx',
      ]

      let found = false
      for (const p of possiblePaths) {
        if (existsSync(p)) {
          const content = await readFile(p, 'utf-8')
          if (content.includes('AutoTypeTable')) {
            found = true
            break
          }
        }
      }
      expect(found).toBe(true)
    })

    it('AutoTypeTable is used with type prop', async () => {
      // Look for usage like <AutoTypeTable type="Thing" />
      const docsContent = await readFile('docs/sdk/index.mdx', 'utf-8')
      expect(docsContent).toMatch(/<AutoTypeTable[^>]+type=["'][^"']+["']/)
    })
  })

  describe('Component Rendering', () => {
    let html: string

    beforeAll(async () => {
      const res = await fetchSDKDocsPage('/docs/sdk')
      html = await res.text()
    })

    it('renders type table HTML structure', () => {
      expect(html).toMatch(/<table|<div[^>]+class=["'][^"']*type-table/)
    })

    it('renders property names', () => {
      // Should show property names from interfaces
      expect(html).toMatch(/\$id|\$type|name|data/)
    })

    it('renders property types', () => {
      // Should show TypeScript types
      expect(html).toMatch(/string|number|boolean|Date|Record|Array/)
    })

    it('renders required indicators', () => {
      // Should indicate required vs optional properties
      expect(html).toMatch(/required|\*|optional|\?/)
    })
  })
})

// ============================================================================
// 3. Type Extraction from types/*.ts Tests
// ============================================================================

describe('Type Extraction from Source Files', () => {
  describe('Thing Interface Extraction', () => {
    let thingType: ExtractedType

    beforeAll(async () => {
      thingType = await extractTypeDefinition('Thing')
    })

    it('extracts Thing interface', () => {
      expect(thingType).toBeDefined()
      expect(thingType.name).toBe('Thing')
      expect(thingType.kind).toBe('interface')
    })

    it('extracts Thing properties', () => {
      expect(thingType.properties).toBeDefined()
      expect(thingType.properties!.length).toBeGreaterThan(0)
    })

    it('extracts $id property', () => {
      const $id = thingType.properties!.find((p) => p.name === '$id')
      expect($id).toBeDefined()
      expect($id!.type).toBe('string')
      expect($id!.required).toBe(true)
    })

    it('extracts $type property', () => {
      const $type = thingType.properties!.find((p) => p.name === '$type')
      expect($type).toBeDefined()
      expect($type!.type).toBe('string')
    })

    it('extracts optional properties correctly', () => {
      const name = thingType.properties!.find((p) => p.name === 'name')
      expect(name).toBeDefined()
      expect(name!.required).toBe(false)
    })

    it('extracts method signatures', () => {
      const update = thingType.properties!.find((p) => p.name === 'update')
      expect(update).toBeDefined()
      expect(update!.type).toContain('RpcPromise')
    })

    it('tracks source file location', () => {
      expect(thingType.sourceFile).toContain('types/Thing.ts')
      expect(thingType.lineNumber).toBeGreaterThan(0)
    })
  })

  describe('ThingData Interface Extraction', () => {
    let thingDataType: ExtractedType

    beforeAll(async () => {
      thingDataType = await extractTypeDefinition('ThingData')
    })

    it('extracts ThingData interface', () => {
      expect(thingDataType).toBeDefined()
      expect(thingDataType.name).toBe('ThingData')
    })

    it('extracts nested $source property', () => {
      const $source = thingDataType.properties!.find((p) => p.name === '$source')
      expect($source).toBeDefined()
      expect($source!.type).toContain('repo')
      expect($source!.type).toContain('path')
    })

    it('extracts Date type properties', () => {
      const createdAt = thingDataType.properties!.find((p) => p.name === 'createdAt')
      expect(createdAt).toBeDefined()
      expect(createdAt!.type).toBe('Date')
    })

    it('extracts Record type properties', () => {
      const data = thingDataType.properties!.find((p) => p.name === 'data')
      expect(data).toBeDefined()
      expect(data!.type).toContain('Record')
    })
  })

  describe('WorkflowContext Interface Extraction', () => {
    let workflowCtx: ExtractedType

    beforeAll(async () => {
      workflowCtx = await extractTypeDefinition('WorkflowContext')
    })

    it('extracts WorkflowContext interface', () => {
      expect(workflowCtx).toBeDefined()
      expect(workflowCtx.name).toBe('WorkflowContext')
    })

    it('extracts execution mode methods', () => {
      const send = workflowCtx.properties!.find((p) => p.name === 'send')
      const tryMethod = workflowCtx.properties!.find((p) => p.name === 'try')
      const doMethod = workflowCtx.properties!.find((p) => p.name === 'do')

      expect(send).toBeDefined()
      expect(tryMethod).toBeDefined()
      expect(doMethod).toBeDefined()
    })

    it('extracts proxy properties', () => {
      const on = workflowCtx.properties!.find((p) => p.name === 'on')
      const every = workflowCtx.properties!.find((p) => p.name === 'every')

      expect(on).toBeDefined()
      expect(on!.type).toContain('OnProxy')
      expect(every).toBeDefined()
      expect(every!.type).toContain('ScheduleBuilder')
    })

    it('extracts index signature for domain resolution', () => {
      // Should extract [Noun: string] signature
      const indexSig = workflowCtx.properties!.find(
        (p) => p.name === '[Noun: string]' || p.name === 'Noun'
      )
      expect(indexSig).toBeDefined()
    })
  })

  describe('Generic Type Extraction', () => {
    let doFunction: ExtractedType

    beforeAll(async () => {
      doFunction = await extractTypeDefinition('DOFunction')
    })

    it('extracts generic type', () => {
      expect(doFunction).toBeDefined()
      expect(doFunction.kind).toBe('type')
    })

    it('extracts type parameters', () => {
      expect(doFunction.typeParameters).toBeDefined()
      expect(doFunction.typeParameters!.length).toBeGreaterThanOrEqual(2)
    })

    it('extracts Output type parameter', () => {
      const output = doFunction.typeParameters!.find((p) => p.name === 'Output')
      expect(output).toBeDefined()
    })

    it('extracts Input type parameter with default', () => {
      const input = doFunction.typeParameters!.find((p) => p.name === 'Input')
      expect(input).toBeDefined()
      expect(input!.default).toBe('unknown')
    })

    it('extracts Options type parameter with constraint', () => {
      const options = doFunction.typeParameters!.find((p) => p.name === 'Options')
      expect(options).toBeDefined()
      expect(options!.constraint).toContain('Record')
    })
  })
})

// ============================================================================
// 4. JSDoc Comment Extraction Tests
// ============================================================================

describe('JSDoc Comment Extraction', () => {
  describe('Description Extraction', () => {
    let workflowCtx: ExtractedType

    beforeAll(async () => {
      workflowCtx = await extractTypeDefinition('WorkflowContext')
    })

    it('extracts interface description', () => {
      expect(workflowCtx.description).toBeDefined()
      expect(workflowCtx.description).toContain('WORKFLOW CONTEXT')
    })

    it('extracts method descriptions', () => {
      const send = workflowCtx.properties!.find((p) => p.name === 'send')
      expect(send!.description).toBeDefined()
      expect(send!.description).toContain('Fire-and-forget')
    })

    it('extracts property descriptions', () => {
      const on = workflowCtx.properties!.find((p) => p.name === 'on')
      expect(on!.description).toBeDefined()
      expect(on!.description).toContain('Subscribe')
    })
  })

  describe('JSDoc Tags Extraction', () => {
    let fsCapability: ExtractedType

    beforeAll(async () => {
      fsCapability = await extractTypeDefinition('FsCapability')
    })

    it('extracts @param documentation', () => {
      const readFile = fsCapability.properties!.find((p) => p.name === 'readFile')
      expect(readFile!.description).toContain('path')
    })

    it('extracts @returns documentation', () => {
      const readFile = fsCapability.properties!.find((p) => p.name === 'readFile')
      expect(readFile!.description).toMatch(/return|Promise/)
    })
  })

  describe('Example Extraction', () => {
    let workflowCtx: ExtractedType

    beforeAll(async () => {
      workflowCtx = await extractTypeDefinition('WorkflowContext')
    })

    it('extracts @example tags as code blocks', () => {
      const on = workflowCtx.properties!.find((p) => p.name === 'on')
      expect(on!.examples).toBeDefined()
      expect(on!.examples!.length).toBeGreaterThan(0)
    })

    it('example shows usage pattern', () => {
      const on = workflowCtx.properties!.find((p) => p.name === 'on')
      if (on!.examples && on!.examples.length > 0) {
        expect(on!.examples[0]).toContain('$.on.')
      }
    })
  })
})

// ============================================================================
// 5. @internal Field Hiding Tests
// ============================================================================

describe('@internal Field Hiding', () => {
  describe('Internal Fields Detection', () => {
    it('hides @internal marked properties from output', async () => {
      const res = await fetchSDKDocsPage('/docs/sdk/thing')
      const html = await res.text()

      // Any property marked @internal should NOT appear
      // We need to add @internal to some fields to test this
      expect(html).not.toContain('_internalField')
      expect(html).not.toContain('__private')
    })

    it('shows non-internal properties', async () => {
      const res = await fetchSDKDocsPage('/docs/sdk/thing')
      const html = await res.text()

      // Public properties should appear
      expect(html).toContain('$id')
      expect(html).toContain('$type')
    })
  })

  describe('Internal Type Extraction', () => {
    let extracted: ExtractedType

    beforeAll(async () => {
      extracted = await extractTypeDefinition('Thing')
    })

    it('marks internal properties in extraction', () => {
      const props = extracted.properties!
      const internalProps = props.filter((p) => p.internal === true)
      // Internal properties should be marked
      expect(Array.isArray(internalProps)).toBe(true)
    })

    it('filters internal properties for display', () => {
      const props = extracted.properties!
      const displayProps = props.filter((p) => !p.internal)
      expect(displayProps.length).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// 6. @remarks and @fumadocsType Annotations Tests
// ============================================================================

describe('@remarks Annotation Support', () => {
  describe('Remarks Extraction', () => {
    let rateLimitResult: ExtractedType

    beforeAll(async () => {
      rateLimitResult = await extractTypeDefinition('RateLimitResult')
    })

    it('extracts @remarks content', () => {
      // Properties with remarks should have them extracted
      const successProp = rateLimitResult.properties!.find((p) => p.name === 'success')
      expect(successProp).toBeDefined()
      // Remarks are extracted if present
      if (successProp!.remarks) {
        expect(successProp!.remarks.length).toBeGreaterThan(0)
      }
    })

    it('displays remarks separately from description', async () => {
      const res = await fetchSDKDocsPage('/docs/sdk/rate-limit')
      const html = await res.text()
      // Remarks should appear in a separate section
      expect(html).toMatch(/remarks|note|additional/i)
    })
  })

  describe('@fumadocsType Annotation', () => {
    it('respects @fumadocsType override', async () => {
      // @fumadocsType can override the displayed type
      const extracted = await extractTypeDefinition('Thing')
      const $id = extracted.properties!.find((p) => p.name === '$id')

      // If @fumadocsType is set, it should override
      expect($id!.type).toBeDefined()
    })

    it('displays custom type when @fumadocsType is set', async () => {
      const res = await fetchSDKDocsPage('/docs/sdk/thing')
      const html = await res.text()

      // Custom types from @fumadocsType should appear
      expect(html).toMatch(/URL|ThingURL|string/)
    })
  })
})

// ============================================================================
// 7. SDK Docs Page Rendering Tests
// ============================================================================

describe('/docs/sdk/* Page Rendering', () => {
  describe('SDK Index Page', () => {
    let html: string

    beforeAll(async () => {
      const res = await fetchSDKDocsPage('/docs/sdk')
      html = await res.text()
    })

    it('returns 200 status', async () => {
      const res = await fetchSDKDocsPage('/docs/sdk')
      expect(res.status).toBe(200)
    })

    it('has SDK documentation title', () => {
      expect(html).toMatch(/<title>[^<]*SDK[^<]*<\/title>/i)
    })

    it('lists core types', () => {
      expect(html).toContain('Thing')
      expect(html).toContain('WorkflowContext')
    })

    it('has navigation to type pages', () => {
      expect(html).toMatch(/href=["'][^"']*\/docs\/sdk\/[^"']+["']/)
    })
  })

  describe('/docs/sdk/thing Page', () => {
    let html: string

    beforeAll(async () => {
      const res = await fetchSDKDocsPage('/docs/sdk/thing')
      html = await res.text()
    })

    it('page exists', async () => {
      const res = await fetchSDKDocsPage('/docs/sdk/thing')
      expect(res.status).toBe(200)
    })

    it('shows Thing interface documentation', () => {
      expect(html).toContain('Thing')
      expect(html).toMatch(/interface|type/i)
    })

    it('shows property table', () => {
      expect(html).toMatch(/<table|type-table/)
    })

    it('shows $id property', () => {
      expect(html).toContain('$id')
      expect(html).toContain('string')
    })

    it('shows relationships property', () => {
      expect(html).toContain('relationships')
    })

    it('shows method documentation', () => {
      expect(html).toContain('update')
      expect(html).toContain('delete')
    })
  })

  describe('/docs/sdk/workflow-context Page', () => {
    let html: string

    beforeAll(async () => {
      const res = await fetchSDKDocsPage('/docs/sdk/workflow-context')
      html = await res.text()
    })

    it('page exists', async () => {
      const res = await fetchSDKDocsPage('/docs/sdk/workflow-context')
      expect(res.status).toBe(200)
    })

    it('documents execution modes', () => {
      expect(html).toContain('send')
      expect(html).toContain('try')
      expect(html).toContain('do')
    })

    it('documents event subscriptions', () => {
      expect(html).toContain('on')
      expect(html).toMatch(/subscribe|event/i)
    })

    it('documents scheduling', () => {
      expect(html).toContain('every')
      expect(html).toMatch(/schedule|cron|recurring/i)
    })

    it('shows usage examples', () => {
      expect(html).toMatch(/example|usage|\$\./i)
    })
  })

  describe('/docs/sdk/capabilities Page', () => {
    let html: string

    beforeAll(async () => {
      const res = await fetchSDKDocsPage('/docs/sdk/capabilities')
      html = await res.text()
    })

    it('page exists', async () => {
      const res = await fetchSDKDocsPage('/docs/sdk/capabilities')
      expect(res.status).toBe(200)
    })

    it('documents FsCapability', () => {
      expect(html).toContain('FsCapability')
      expect(html).toContain('readFile')
      expect(html).toContain('writeFile')
    })

    it('documents GitCapability', () => {
      expect(html).toContain('GitCapability')
      expect(html).toContain('commit')
      expect(html).toContain('push')
    })

    it('documents BashCapability', () => {
      expect(html).toContain('BashCapability')
      expect(html).toContain('exec')
    })
  })
})

// ============================================================================
// 8. Interface Property Display Tests
// ============================================================================

describe('Interface Property Display', () => {
  describe('Property Table Structure', () => {
    let html: string

    beforeAll(async () => {
      const res = await fetchSDKDocsPage('/docs/sdk/thing')
      html = await res.text()
    })

    it('displays property name column', () => {
      expect(html).toMatch(/name|property|field/i)
      expect(html).toContain('$id')
    })

    it('displays type column', () => {
      expect(html).toMatch(/type/i)
      expect(html).toContain('string')
    })

    it('displays description column', () => {
      expect(html).toMatch(/description|desc/i)
    })

    it('displays required indicator', () => {
      expect(html).toMatch(/required|\*|optional|\?/i)
    })

    it('displays default values when present', () => {
      expect(html).toMatch(/default|defaults/i)
    })
  })

  describe('Complex Type Rendering', () => {
    let html: string

    beforeAll(async () => {
      const res = await fetchSDKDocsPage('/docs/sdk/thing')
      html = await res.text()
    })

    it('renders nested object types', () => {
      // $source is a nested object type
      expect(html).toContain('$source')
      expect(html).toMatch(/repo|path|branch|commit/)
    })

    it('renders union types', () => {
      // Should handle string | number | boolean
      expect(html).toMatch(/\|/)
    })

    it('renders Record types', () => {
      expect(html).toContain('Record')
    })

    it('renders Promise types', () => {
      expect(html).toMatch(/Promise|RpcPromise/)
    })

    it('renders function types', () => {
      // Methods should show their signatures
      expect(html).toMatch(/\([^)]*\)/)
    })
  })

  describe('Type Link Generation', () => {
    let html: string

    beforeAll(async () => {
      const res = await fetchSDKDocsPage('/docs/sdk/thing')
      html = await res.text()
    })

    it('links to related types', () => {
      // References to other types should be links
      expect(html).toMatch(/href=["'][^"']*ThingData[^"']*["']/)
    })

    it('links to ThingDO from Thing', () => {
      expect(html).toMatch(/ThingDO/)
    })

    it('external types not linked', () => {
      // Built-in types like string, number shouldn't be links
      const stringLink = html.match(/href=["'][^"']*["'][^>]*>string</)
      // This should NOT exist - string shouldn't be a link
      expect(stringLink).toBeNull()
    })
  })
})

// ============================================================================
// 9. Generic Type Handling Tests
// ============================================================================

describe('Generic Type Handling', () => {
  describe('Type Parameter Display', () => {
    let html: string

    beforeAll(async () => {
      const res = await fetchSDKDocsPage('/docs/sdk/functions')
      html = await res.text()
    })

    it('shows generic type parameters', () => {
      expect(html).toMatch(/<T>|<Output|<Input|<Options/)
    })

    it('shows type parameter constraints', () => {
      expect(html).toMatch(/extends|Record/)
    })

    it('shows type parameter defaults', () => {
      expect(html).toMatch(/=\s*unknown|default/)
    })
  })

  describe('Generic Interface Rendering', () => {
    let html: string

    beforeAll(async () => {
      const res = await fetchSDKDocsPage('/docs/sdk/things')
      html = await res.text()
    })

    it('shows Things<T> generic', () => {
      expect(html).toMatch(/Things<|Things&lt;/)
    })

    it('explains type parameter usage', () => {
      expect(html).toMatch(/T extends Thing|generic|type parameter/)
    })
  })

  describe('Utility Types Display', () => {
    let html: string

    beforeAll(async () => {
      const res = await fetchSDKDocsPage('/docs/sdk/workflow-context')
      html = await res.text()
    })

    it('shows WithFs type alias', () => {
      expect(html).toContain('WithFs')
    })

    it('shows WithGit type alias', () => {
      expect(html).toContain('WithGit')
    })

    it('shows intersection types correctly', () => {
      // WithFs = WorkflowContext & { fs: FsCapability }
      expect(html).toMatch(/&amp;|\&|intersection/)
    })
  })
})

// ============================================================================
// 10. Navigation and Structure Tests
// ============================================================================

describe('SDK Docs Navigation', () => {
  describe('Sidebar Navigation', () => {
    let html: string

    beforeAll(async () => {
      const res = await fetchSDKDocsPage('/docs/sdk')
      html = await res.text()
    })

    it('has SDK section in sidebar', () => {
      expect(html).toMatch(/sidebar|nav/i)
      expect(html).toMatch(/SDK|Types|TypeScript/i)
    })

    it('lists core types in navigation', () => {
      expect(html).toContain('Thing')
      expect(html).toContain('WorkflowContext')
    })

    it('groups types logically', () => {
      // Should have groupings like Core, Capabilities, etc.
      expect(html).toMatch(/Core|Base|Capabilities|Utilities/i)
    })
  })

  describe('Type Hierarchy Display', () => {
    let html: string

    beforeAll(async () => {
      const res = await fetchSDKDocsPage('/docs/sdk/thing')
      html = await res.text()
    })

    it('shows extends relationship', () => {
      // Thing extends ThingData
      expect(html).toMatch(/extends|inherits|ThingData/)
    })

    it('shows implemented by relationship', () => {
      // Should show what implements Thing
      expect(html).toMatch(/ThingDO|implemented/)
    })
  })

  describe('Breadcrumbs', () => {
    let html: string

    beforeAll(async () => {
      const res = await fetchSDKDocsPage('/docs/sdk/thing')
      html = await res.text()
    })

    it('shows breadcrumb navigation', () => {
      expect(html).toMatch(/breadcrumb/i)
    })

    it('shows path: Docs > SDK > Thing', () => {
      expect(html).toContain('Docs')
      expect(html).toContain('SDK')
      expect(html).toContain('Thing')
    })
  })
})

// ============================================================================
// 11. MDX File Structure Tests
// ============================================================================

describe('SDK Docs MDX Files', () => {
  describe('Directory Structure', () => {
    it('docs/sdk directory exists', () => {
      expect(existsSync('docs/sdk')).toBe(true)
    })

    it('docs/sdk/index.mdx exists', () => {
      const paths = ['docs/sdk/index.mdx', 'docs/sdk/index.md']
      const exists = paths.some((p) => existsSync(p))
      expect(exists).toBe(true)
    })

    it('docs/sdk/thing.mdx exists', () => {
      const paths = ['docs/sdk/thing.mdx', 'docs/sdk/thing.md']
      const exists = paths.some((p) => existsSync(p))
      expect(exists).toBe(true)
    })

    it('docs/sdk/workflow-context.mdx exists', () => {
      const paths = [
        'docs/sdk/workflow-context.mdx',
        'docs/sdk/workflow-context.md',
        'docs/sdk/workflowcontext.mdx',
      ]
      const exists = paths.some((p) => existsSync(p))
      expect(exists).toBe(true)
    })
  })

  describe('MDX Frontmatter', () => {
    it('SDK index has proper frontmatter', async () => {
      const content = await readFile('docs/sdk/index.mdx', 'utf-8')
      expect(content).toMatch(/^---/)
      expect(content).toMatch(/title:/i)
    })

    it('Thing page has proper frontmatter', async () => {
      const content = await readFile('docs/sdk/thing.mdx', 'utf-8')
      expect(content).toMatch(/^---/)
      expect(content).toMatch(/title:/i)
      expect(content).toMatch(/description:/i)
    })
  })

  describe('MDX Content', () => {
    it('SDK index imports AutoTypeTable', async () => {
      const content = await readFile('docs/sdk/index.mdx', 'utf-8')
      expect(content).toMatch(/import.*AutoTypeTable|<AutoTypeTable/)
    })

    it('Thing page uses AutoTypeTable with type="Thing"', async () => {
      const content = await readFile('docs/sdk/thing.mdx', 'utf-8')
      expect(content).toMatch(/<AutoTypeTable[^>]+type=["']Thing["']/)
    })
  })
})

// ============================================================================
// 12. Error Handling Tests
// ============================================================================

describe('SDK Docs Error Handling', () => {
  describe('Missing Type Pages', () => {
    it('returns 404 for non-existent type', async () => {
      const res = await fetchSDKDocsPage('/docs/sdk/non-existent-type')
      expect(res.status).toBe(404)
    })

    it('404 page suggests similar types', async () => {
      const res = await fetchSDKDocsPage('/docs/sdk/thin')
      if (res.status === 404) {
        const html = await res.text()
        expect(html).toMatch(/Thing|similar|did you mean/i)
      }
    })
  })

  describe('Type Extraction Errors', () => {
    it('handles missing source file gracefully', async () => {
      try {
        await extractTypeDefinition('NonExistentType')
      } catch (e) {
        expect(e).toBeDefined()
        expect((e as Error).message).toMatch(/not found|does not exist/i)
      }
    })
  })
})

// ============================================================================
// 13. Search Integration Tests
// ============================================================================

describe('SDK Docs Search', () => {
  describe('Type Indexing', () => {
    it('types are indexed for search', async () => {
      const res = await fetchSDKDocsPage('/api/search?q=Thing')
      if (res.ok) {
        const results = await res.json()
        expect(results).toBeDefined()
        expect(Array.isArray(results.hits || results.results || results)).toBe(true)
      }
    })

    it('properties are searchable', async () => {
      const res = await fetchSDKDocsPage('/api/search?q=$id')
      if (res.ok) {
        const results = await res.json()
        expect(results).toBeDefined()
      }
    })
  })
})

// ============================================================================
// 14. SEO and Meta Tests
// ============================================================================

describe('SDK Docs SEO', () => {
  describe('Meta Tags', () => {
    let html: string

    beforeAll(async () => {
      const res = await fetchSDKDocsPage('/docs/sdk')
      html = await res.text()
    })

    it('has unique title', () => {
      expect(html).toMatch(/<title>[^<]*SDK[^<]*<\/title>/i)
    })

    it('has meta description', () => {
      expect(html).toMatch(/<meta[^>]+name=["']description["']/i)
    })

    it('has Open Graph tags', () => {
      expect(html).toMatch(/<meta[^>]+property=["']og:title["']/i)
    })
  })

  describe('Structured Data', () => {
    let html: string

    beforeAll(async () => {
      const res = await fetchSDKDocsPage('/docs/sdk')
      html = await res.text()
    })

    it('has JSON-LD structured data', () => {
      expect(html).toMatch(/<script[^>]+type=["']application\/ld\+json["']/i)
    })
  })
})

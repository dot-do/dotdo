/**
 * Type tests for @/ path aliases
 *
 * This test verifies that TypeScript's path aliases are correctly configured.
 * The @/ alias should resolve to the project root.
 *
 * RED phase: These imports should fail until path aliases are properly configured
 * for the TypeScript compiler.
 */

// Test @/ alias resolution for lib/source
import type { DocsPageData, DocsMetaData, StructuredData } from '@/lib/source'

// Test @/ alias resolution for lib/seo
import type { SeoMeta, MetaTag, JsonLdOptions, SeoDefaults } from '@/lib/seo'

// Verify types are usable (not just importable)
type _AssertDocsPageData = DocsPageData extends { title: string } ? true : never
type _AssertDocsMetaData = DocsMetaData extends { title?: string } ? true : never
type _AssertStructuredData = StructuredData extends { headings?: unknown[] } ? true : never

type _AssertSeoMeta = SeoMeta extends { title?: string } ? true : never
type _AssertMetaTag = MetaTag extends { name?: string } ? true : never
type _AssertJsonLdOptions = JsonLdOptions extends { type: unknown } ? true : never
type _AssertSeoDefaults = SeoDefaults extends { siteName: string } ? true : never

// These assertions ensure the types resolve correctly
const _test1: _AssertDocsPageData = true
const _test2: _AssertDocsMetaData = true
const _test3: _AssertStructuredData = true
const _test4: _AssertSeoMeta = true
const _test5: _AssertMetaTag = true
const _test6: _AssertJsonLdOptions = true
const _test7: _AssertSeoDefaults = true

// Export to avoid unused variable warnings
export type {
  _AssertDocsPageData,
  _AssertDocsMetaData,
  _AssertStructuredData,
  _AssertSeoMeta,
  _AssertMetaTag,
  _AssertJsonLdOptions,
  _AssertSeoDefaults,
}

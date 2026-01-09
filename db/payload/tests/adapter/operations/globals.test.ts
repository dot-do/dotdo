import { describe, it, expect, beforeEach } from 'vitest'
import { createPayloadAdapterHarness } from '../../../src'
import type { PayloadAdapterHarness } from '../../../src'

/**
 * PayloadAdapter Globals Operations Tests
 *
 * These tests verify the adapter's globals operations, including:
 * - Reading global documents (singleton pattern)
 * - Updating global documents
 * - Global field type handling
 * - Global versioning support
 * - Access control and hooks
 *
 * In Payload CMS, Globals are singleton documents that represent one-off content
 * like site settings, navigation, footers, and configuration. Unlike Collections
 * which contain many documents, each Global corresponds to exactly one document.
 *
 * Implementation Strategy:
 * Globals map to fixed-path Things in dotdo:
 * - Global "header" maps to Thing at `{namespace}/globals/header`
 * - Global "footer" maps to Thing at `{namespace}/globals/footer`
 * - etc.
 *
 * Reference: dotdo-23tn - A24 RED: Globals tests
 */

// ============================================================================
// TEST FIXTURES
// ============================================================================

/** Sample global data for site header */
const sampleHeader = {
  logo: 'media-logo-123',
  navItems: [
    { label: 'Home', link: '/' },
    { label: 'About', link: '/about' },
    { label: 'Contact', link: '/contact' },
  ],
  ctaButton: {
    text: 'Get Started',
    link: '/signup',
    variant: 'primary',
  },
}

/** Sample global data for site footer */
const sampleFooter = {
  copyright: '2026 My Company',
  socialLinks: [
    { platform: 'twitter', url: 'https://twitter.com/mycompany' },
    { platform: 'github', url: 'https://github.com/mycompany' },
  ],
  legalLinks: [
    { label: 'Privacy Policy', link: '/privacy' },
    { label: 'Terms of Service', link: '/terms' },
  ],
}

/** Sample global data for site settings */
const sampleSettings = {
  siteName: 'My Awesome Site',
  siteDescription: 'A fantastic website built with Payload CMS',
  defaultLanguage: 'en',
  timezone: 'America/New_York',
  analyticsId: 'GA-12345678',
  maintenanceMode: false,
}

// ============================================================================
// GLOBALS OPERATIONS TESTS
// ============================================================================

describe('PayloadAdapter Globals Operations', () => {
  let harness: PayloadAdapterHarness

  beforeEach(() => {
    harness = createPayloadAdapterHarness({
      namespace: 'https://test.do',
    })
  })

  // ==========================================================================
  // findGlobal - Read singleton document
  // ==========================================================================

  describe('findGlobal', () => {
    it('should return global document by slug', async () => {
      const adapter = harness.adapter as any

      // First, initialize the global with data
      await adapter.updateGlobal({
        slug: 'header',
        data: sampleHeader,
      })

      // Find the global
      const global = await adapter.findGlobal({
        slug: 'header',
      })

      expect(global).toBeDefined()
      expect(global.navItems).toHaveLength(3)
      expect(global.ctaButton.text).toBe('Get Started')
    })

    it('should return empty object for uninitialized global', async () => {
      const adapter = harness.adapter as any

      // Find a global that hasn't been set
      const global = await adapter.findGlobal({
        slug: 'uninitialized-global',
      })

      // Should return empty object or default structure, not throw
      expect(global).toBeDefined()
      expect(Object.keys(global).length).toBe(0)
    })

    it('should include createdAt and updatedAt timestamps', async () => {
      const adapter = harness.adapter as any
      const before = new Date()

      await adapter.updateGlobal({
        slug: 'settings',
        data: sampleSettings,
      })

      const after = new Date()

      const global = await adapter.findGlobal({
        slug: 'settings',
      })

      expect(global.createdAt).toBeDefined()
      expect(global.updatedAt).toBeDefined()

      const createdAt = new Date(global.createdAt)
      const updatedAt = new Date(global.updatedAt)

      expect(createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(createdAt.getTime()).toBeLessThanOrEqual(after.getTime())
      expect(updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(updatedAt.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it('should return consistent data across multiple reads', async () => {
      const adapter = harness.adapter as any

      await adapter.updateGlobal({
        slug: 'footer',
        data: sampleFooter,
      })

      // Read multiple times
      const read1 = await adapter.findGlobal({ slug: 'footer' })
      const read2 = await adapter.findGlobal({ slug: 'footer' })
      const read3 = await adapter.findGlobal({ slug: 'footer' })

      expect(read1).toEqual(read2)
      expect(read2).toEqual(read3)
      expect(read1.copyright).toBe('2026 My Company')
    })

    it('should support depth parameter for relationship population', async () => {
      const adapter = harness.adapter as any

      // Create a media document for the logo
      await adapter.create({
        collection: 'media',
        data: {
          id: 'media-logo-123',
          filename: 'logo.png',
          url: '/uploads/logo.png',
        },
      })

      await adapter.updateGlobal({
        slug: 'header',
        data: sampleHeader,
      })

      // Find with depth to populate relationships
      const globalWithDepth = await adapter.findGlobal({
        slug: 'header',
        depth: 1,
      })

      // Logo should be populated
      expect(globalWithDepth.logo).toBeDefined()
      expect(typeof globalWithDepth.logo).toBe('object')
      expect(globalWithDepth.logo.filename).toBe('logo.png')
    })
  })

  // ==========================================================================
  // updateGlobal - Update singleton document
  // ==========================================================================

  describe('updateGlobal', () => {
    it('should create global if it does not exist', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.updateGlobal({
        slug: 'settings',
        data: sampleSettings,
      })

      expect(result).toBeDefined()
      expect(result.siteName).toBe('My Awesome Site')
      expect(result.maintenanceMode).toBe(false)
    })

    it('should update existing global', async () => {
      const adapter = harness.adapter as any

      // Create initial global
      await adapter.updateGlobal({
        slug: 'settings',
        data: sampleSettings,
      })

      // Update it
      const updated = await adapter.updateGlobal({
        slug: 'settings',
        data: {
          siteName: 'Updated Site Name',
          maintenanceMode: true,
        },
      })

      expect(updated.siteName).toBe('Updated Site Name')
      expect(updated.maintenanceMode).toBe(true)
      // Other fields should be preserved
      expect(updated.siteDescription).toBe('A fantastic website built with Payload CMS')
    })

    it('should merge data with existing global (partial update)', async () => {
      const adapter = harness.adapter as any

      // Create initial global
      await adapter.updateGlobal({
        slug: 'footer',
        data: sampleFooter,
      })

      // Update only copyright
      await adapter.updateGlobal({
        slug: 'footer',
        data: {
          copyright: '2027 My Company',
        },
      })

      const global = await adapter.findGlobal({ slug: 'footer' })

      // Updated field
      expect(global.copyright).toBe('2027 My Company')
      // Preserved fields
      expect(global.socialLinks).toHaveLength(2)
      expect(global.legalLinks).toHaveLength(2)
    })

    it('should update updatedAt timestamp on update', async () => {
      const adapter = harness.adapter as any

      // Create initial global
      await adapter.updateGlobal({
        slug: 'settings',
        data: sampleSettings,
      })

      const initial = await adapter.findGlobal({ slug: 'settings' })
      const initialUpdatedAt = new Date(initial.updatedAt).getTime()

      // Wait a bit to ensure time difference
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Update global
      await adapter.updateGlobal({
        slug: 'settings',
        data: { siteName: 'Changed Name' },
      })

      const updated = await adapter.findGlobal({ slug: 'settings' })
      const newUpdatedAt = new Date(updated.updatedAt).getTime()

      expect(newUpdatedAt).toBeGreaterThan(initialUpdatedAt)
      // createdAt should remain unchanged
      expect(initial.createdAt).toBe(updated.createdAt)
    })

    it('should return the full updated global', async () => {
      const adapter = harness.adapter as any

      await adapter.updateGlobal({
        slug: 'header',
        data: sampleHeader,
      })

      const result = await adapter.updateGlobal({
        slug: 'header',
        data: {
          ctaButton: {
            text: 'Sign Up Now',
            link: '/register',
            variant: 'secondary',
          },
        },
      })

      // Should return full global with updated CTA
      expect(result.navItems).toHaveLength(3)
      expect(result.logo).toBe('media-logo-123')
      expect(result.ctaButton.text).toBe('Sign Up Now')
      expect(result.ctaButton.variant).toBe('secondary')
    })

    it('should handle nested field updates', async () => {
      const adapter = harness.adapter as any

      await adapter.updateGlobal({
        slug: 'header',
        data: sampleHeader,
      })

      // Update nested navItems
      await adapter.updateGlobal({
        slug: 'header',
        data: {
          navItems: [
            { label: 'Home', link: '/' },
            { label: 'Products', link: '/products' },
            { label: 'Blog', link: '/blog' },
            { label: 'Contact', link: '/contact' },
          ],
        },
      })

      const global = await adapter.findGlobal({ slug: 'header' })

      expect(global.navItems).toHaveLength(4)
      expect(global.navItems[1].label).toBe('Products')
    })
  })

  // ==========================================================================
  // Thing Storage - Fixed-path mapping
  // ==========================================================================

  describe('Thing storage', () => {
    it('should store global as Thing with fixed path', async () => {
      const adapter = harness.adapter as any

      await adapter.updateGlobal({
        slug: 'header',
        data: sampleHeader,
      })

      // Check Thing was stored at fixed path
      const thingId = 'https://test.do/globals/header'
      const thing = harness.things.get(thingId)

      expect(thing).toBeDefined()
      expect(thing?.$id).toBe('https://test.do/globals/header')
    })

    it('should store global with $type indicating globals collection', async () => {
      const adapter = harness.adapter as any

      await adapter.updateGlobal({
        slug: 'settings',
        data: sampleSettings,
      })

      const thingId = 'https://test.do/globals/settings'
      const thing = harness.things.get(thingId)

      expect(thing).toBeDefined()
      expect(thing?.$type).toBe('https://test.do/globals')
    })

    it('should use global slug as Thing name', async () => {
      const adapter = harness.adapter as any

      await adapter.updateGlobal({
        slug: 'site-footer',
        data: sampleFooter,
      })

      const thingId = 'https://test.do/globals/site-footer'
      const thing = harness.things.get(thingId)

      expect(thing).toBeDefined()
      expect(thing?.name).toBe('site-footer')
    })

    it('should update Thing in place (not create new)', async () => {
      const adapter = harness.adapter as any

      // Create global
      await adapter.updateGlobal({
        slug: 'settings',
        data: { siteName: 'Version 1' },
      })

      const thing1 = harness.things.get('https://test.do/globals/settings')
      expect(thing1?.data?.siteName).toBe('Version 1')

      // Update global
      await adapter.updateGlobal({
        slug: 'settings',
        data: { siteName: 'Version 2' },
      })

      // Should be same Thing, updated in place
      const thing2 = harness.things.get('https://test.do/globals/settings')
      expect(thing2?.data?.siteName).toBe('Version 2')

      // Should only be one Thing for this global
      const allGlobalsThings = harness.things.list({ type: 'https://test.do/globals' })
      expect(allGlobalsThings).toHaveLength(1)
    })
  })

  // ==========================================================================
  // Field Types
  // ==========================================================================

  describe('field types', () => {
    it('should handle text fields', async () => {
      const adapter = harness.adapter as any

      await adapter.updateGlobal({
        slug: 'settings',
        data: {
          siteName: 'My Site',
          tagline: 'Building the future',
        },
      })

      const global = await adapter.findGlobal({ slug: 'settings' })

      expect(global.siteName).toBe('My Site')
      expect(global.tagline).toBe('Building the future')
    })

    it('should handle checkbox/boolean fields', async () => {
      const adapter = harness.adapter as any

      await adapter.updateGlobal({
        slug: 'settings',
        data: {
          maintenanceMode: true,
          allowRegistration: false,
        },
      })

      const global = await adapter.findGlobal({ slug: 'settings' })

      expect(global.maintenanceMode).toBe(true)
      expect(global.allowRegistration).toBe(false)
    })

    it('should handle select/enum fields', async () => {
      const adapter = harness.adapter as any

      await adapter.updateGlobal({
        slug: 'settings',
        data: {
          theme: 'dark',
          defaultLanguage: 'en',
        },
      })

      const global = await adapter.findGlobal({ slug: 'settings' })

      expect(global.theme).toBe('dark')
      expect(global.defaultLanguage).toBe('en')
    })

    it('should handle array fields', async () => {
      const adapter = harness.adapter as any

      await adapter.updateGlobal({
        slug: 'header',
        data: {
          navItems: [
            { label: 'Home', link: '/', order: 1 },
            { label: 'About', link: '/about', order: 2 },
          ],
        },
      })

      const global = await adapter.findGlobal({ slug: 'header' })

      expect(Array.isArray(global.navItems)).toBe(true)
      expect(global.navItems).toHaveLength(2)
      expect(global.navItems[0].label).toBe('Home')
    })

    it('should handle group fields', async () => {
      const adapter = harness.adapter as any

      await adapter.updateGlobal({
        slug: 'settings',
        data: {
          seo: {
            title: 'Default SEO Title',
            description: 'Default meta description',
            ogImage: 'media-og-123',
          },
        },
      })

      const global = await adapter.findGlobal({ slug: 'settings' })

      expect(global.seo).toBeDefined()
      expect(global.seo.title).toBe('Default SEO Title')
      expect(global.seo.description).toBe('Default meta description')
    })

    it('should handle relationship fields (upload)', async () => {
      const adapter = harness.adapter as any

      await adapter.updateGlobal({
        slug: 'header',
        data: {
          logo: 'media-logo-456',
          favicon: 'media-favicon-789',
        },
      })

      const global = await adapter.findGlobal({ slug: 'header' })

      expect(global.logo).toBe('media-logo-456')
      expect(global.favicon).toBe('media-favicon-789')
    })

    it('should handle blocks fields', async () => {
      const adapter = harness.adapter as any

      await adapter.updateGlobal({
        slug: 'footer',
        data: {
          content: [
            { blockType: 'richText', content: 'Footer content here' },
            { blockType: 'linkList', links: [{ label: 'Link 1', url: '/link1' }] },
          ],
        },
      })

      const global = await adapter.findGlobal({ slug: 'footer' })

      expect(Array.isArray(global.content)).toBe(true)
      expect(global.content[0].blockType).toBe('richText')
      expect(global.content[1].blockType).toBe('linkList')
    })

    it('should handle richText fields', async () => {
      const adapter = harness.adapter as any
      const richTextContent = [
        { type: 'paragraph', children: [{ text: 'Welcome to our site' }] },
        { type: 'heading', level: 2, children: [{ text: 'Features' }] },
      ]

      await adapter.updateGlobal({
        slug: 'footer',
        data: {
          legalDisclaimer: richTextContent,
        },
      })

      const global = await adapter.findGlobal({ slug: 'footer' })

      expect(global.legalDisclaimer).toEqual(richTextContent)
    })
  })

  // ==========================================================================
  // Global Versioning
  // ==========================================================================

  describe('global versioning', () => {
    it('should create version snapshot of global', async () => {
      const adapter = harness.adapter as any

      // Create initial global
      await adapter.updateGlobal({
        slug: 'settings',
        data: sampleSettings,
      })

      // Create a version
      const version = await adapter.createGlobalVersion({
        slug: 'settings',
      })

      expect(version).toBeDefined()
      expect(version.id).toBeDefined()
      expect(version.version?.siteName).toBe('My Awesome Site')
    })

    it('should find versions of a global', async () => {
      const adapter = harness.adapter as any

      // Create global
      await adapter.updateGlobal({
        slug: 'settings',
        data: sampleSettings,
      })

      // Create versions
      await adapter.createGlobalVersion({ slug: 'settings' })
      await adapter.updateGlobal({ slug: 'settings', data: { siteName: 'Update 1' } })
      await adapter.createGlobalVersion({ slug: 'settings' })
      await adapter.updateGlobal({ slug: 'settings', data: { siteName: 'Update 2' } })
      await adapter.createGlobalVersion({ slug: 'settings' })

      // Find all versions
      const result = await adapter.findGlobalVersions({
        slug: 'settings',
      })

      expect(result.docs).toHaveLength(3)
      expect(result.totalDocs).toBe(3)
    })

    it('should restore global to specific version', async () => {
      const adapter = harness.adapter as any

      // Create global
      await adapter.updateGlobal({
        slug: 'settings',
        data: { siteName: 'Original Name', timezone: 'UTC' },
      })

      // Create version 1
      await adapter.createGlobalVersion({ slug: 'settings' })

      // Update global
      await adapter.updateGlobal({
        slug: 'settings',
        data: { siteName: 'Updated Name', timezone: 'PST' },
      })

      // Verify current state
      const current = await adapter.findGlobal({ slug: 'settings' })
      expect(current.siteName).toBe('Updated Name')

      // Restore to version 1
      await adapter.restoreGlobalVersion({
        slug: 'settings',
        versionNumber: 1,
      })

      // Verify restored
      const restored = await adapter.findGlobal({ slug: 'settings' })
      expect(restored.siteName).toBe('Original Name')
      expect(restored.timezone).toBe('UTC')
    })

    it('should support version drafts for globals', async () => {
      const adapter = harness.adapter as any

      // Create global with draft
      await adapter.updateGlobal({
        slug: 'settings',
        data: sampleSettings,
        draft: true,
      })

      // Create published version
      const version = await adapter.createGlobalVersion({
        slug: 'settings',
        type: 'draft',
      })

      expect(version.type).toBe('draft')

      // Find only published versions
      const publishedVersions = await adapter.findGlobalVersions({
        slug: 'settings',
        where: { type: { equals: 'published' } },
      })

      expect(publishedVersions.docs.every((v: any) => v.type === 'published')).toBe(true)
    })
  })

  // ==========================================================================
  // Hooks
  // ==========================================================================

  describe('hooks', () => {
    it('should call beforeRead hook', async () => {
      const beforeReadCalls: Array<{ slug: string }> = []

      const harnessWithHooks = createPayloadAdapterHarness({
        namespace: 'https://test.do',
      })

      const adapter = harnessWithHooks.adapter as any
      adapter.hooks = adapter.hooks || {}
      adapter.hooks.beforeReadGlobal = async (args: { slug: string }) => {
        beforeReadCalls.push({ slug: args.slug })
      }

      // Initialize global
      await adapter.updateGlobal({
        slug: 'settings',
        data: sampleSettings,
      })

      // Read global
      await adapter.findGlobal({ slug: 'settings' })

      expect(beforeReadCalls).toHaveLength(1)
      expect(beforeReadCalls[0].slug).toBe('settings')
    })

    it('should call afterRead hook', async () => {
      const afterReadCalls: Array<{ slug: string; doc: Record<string, unknown> }> = []

      const harnessWithHooks = createPayloadAdapterHarness({
        namespace: 'https://test.do',
      })

      const adapter = harnessWithHooks.adapter as any
      adapter.hooks = adapter.hooks || {}
      adapter.hooks.afterReadGlobal = async (args: { slug: string; doc: Record<string, unknown> }) => {
        afterReadCalls.push({ slug: args.slug, doc: { ...args.doc } })
      }

      await adapter.updateGlobal({
        slug: 'settings',
        data: sampleSettings,
      })

      await adapter.findGlobal({ slug: 'settings' })

      expect(afterReadCalls).toHaveLength(1)
      expect(afterReadCalls[0].slug).toBe('settings')
      expect(afterReadCalls[0].doc.siteName).toBe('My Awesome Site')
    })

    it('should call beforeChange hook on update', async () => {
      const beforeChangeCalls: Array<{ slug: string; data: Record<string, unknown> }> = []

      const harnessWithHooks = createPayloadAdapterHarness({
        namespace: 'https://test.do',
      })

      const adapter = harnessWithHooks.adapter as any
      adapter.hooks = adapter.hooks || {}
      adapter.hooks.beforeChangeGlobal = async (args: { slug: string; data: Record<string, unknown> }) => {
        beforeChangeCalls.push({ slug: args.slug, data: { ...args.data } })
        return args.data
      }

      await adapter.updateGlobal({
        slug: 'settings',
        data: sampleSettings,
      })

      expect(beforeChangeCalls).toHaveLength(1)
      expect(beforeChangeCalls[0].slug).toBe('settings')
      expect(beforeChangeCalls[0].data.siteName).toBe('My Awesome Site')
    })

    it('should call afterChange hook on update', async () => {
      const afterChangeCalls: Array<{ slug: string; doc: Record<string, unknown> }> = []

      const harnessWithHooks = createPayloadAdapterHarness({
        namespace: 'https://test.do',
      })

      const adapter = harnessWithHooks.adapter as any
      adapter.hooks = adapter.hooks || {}
      adapter.hooks.afterChangeGlobal = async (args: { slug: string; doc: Record<string, unknown> }) => {
        afterChangeCalls.push({ slug: args.slug, doc: { ...args.doc } })
      }

      await adapter.updateGlobal({
        slug: 'settings',
        data: sampleSettings,
      })

      expect(afterChangeCalls).toHaveLength(1)
      expect(afterChangeCalls[0].slug).toBe('settings')
      expect(afterChangeCalls[0].doc.siteName).toBe('My Awesome Site')
    })

    it('should allow hook to modify data before save', async () => {
      const harnessWithHooks = createPayloadAdapterHarness({
        namespace: 'https://test.do',
      })

      const adapter = harnessWithHooks.adapter as any
      adapter.hooks = adapter.hooks || {}
      adapter.hooks.beforeChangeGlobal = async (args: { slug: string; data: Record<string, unknown> }) => {
        // Modify data
        return {
          ...args.data,
          siteName: `[Modified] ${args.data.siteName}`,
          modifiedAt: new Date().toISOString(),
        }
      }

      await adapter.updateGlobal({
        slug: 'settings',
        data: { siteName: 'Original' },
      })

      const global = await adapter.findGlobal({ slug: 'settings' })

      expect(global.siteName).toBe('[Modified] Original')
      expect(global.modifiedAt).toBeDefined()
    })

    it('should abort on hook error', async () => {
      const harnessWithHooks = createPayloadAdapterHarness({
        namespace: 'https://test.do',
      })

      const adapter = harnessWithHooks.adapter as any
      adapter.hooks = adapter.hooks || {}
      adapter.hooks.beforeChangeGlobal = async () => {
        throw new Error('Validation failed in beforeChange hook')
      }

      await expect(
        adapter.updateGlobal({
          slug: 'settings',
          data: sampleSettings,
        })
      ).rejects.toThrow('Validation failed in beforeChange hook')

      // Global should not exist
      const global = await adapter.findGlobal({ slug: 'settings' })
      expect(Object.keys(global).length).toBe(0)
    })
  })

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle empty global data', async () => {
      const adapter = harness.adapter as any

      await adapter.updateGlobal({
        slug: 'empty',
        data: {},
      })

      const global = await adapter.findGlobal({ slug: 'empty' })

      expect(global).toBeDefined()
      expect(global.createdAt).toBeDefined()
      expect(global.updatedAt).toBeDefined()
    })

    it('should handle special characters in global slug', async () => {
      const adapter = harness.adapter as any

      await adapter.updateGlobal({
        slug: 'site-header-v2',
        data: { title: 'Header V2' },
      })

      const global = await adapter.findGlobal({ slug: 'site-header-v2' })

      expect(global.title).toBe('Header V2')
    })

    it('should handle unicode content in global data', async () => {
      const adapter = harness.adapter as any

      await adapter.updateGlobal({
        slug: 'settings',
        data: {
          siteName: 'cafe Resume',
          description: 'Japanese text: Hello - Hello',
          emoji: 'Building the future with AI',
        },
      })

      const global = await adapter.findGlobal({ slug: 'settings' })

      expect(global.siteName).toBe('cafe Resume')
      expect(global.description).toContain('Hello')
      expect(global.emoji).toContain('AI')
    })

    it('should handle very large global data', async () => {
      const adapter = harness.adapter as any
      const largeContent = 'a'.repeat(100000)

      await adapter.updateGlobal({
        slug: 'large-global',
        data: {
          content: largeContent,
          items: Array.from({ length: 1000 }, (_, i) => ({ id: i, name: `Item ${i}` })),
        },
      })

      const global = await adapter.findGlobal({ slug: 'large-global' })

      expect(global.content).toBe(largeContent)
      expect(global.items).toHaveLength(1000)
    })

    it('should handle null and undefined field values', async () => {
      const adapter = harness.adapter as any

      await adapter.updateGlobal({
        slug: 'settings',
        data: {
          siteName: 'Test',
          description: null,
          tagline: undefined,
        },
      })

      const global = await adapter.findGlobal({ slug: 'settings' })

      expect(global.siteName).toBe('Test')
      expect(global.description).toBeNull()
      // undefined fields may be omitted
      expect(global.tagline === undefined || !('tagline' in global)).toBe(true)
    })

    it('should handle concurrent updates to same global', async () => {
      const adapter = harness.adapter as any

      // Initialize global
      await adapter.updateGlobal({
        slug: 'settings',
        data: { counter: 0 },
      })

      // Concurrent updates
      await Promise.all([
        adapter.updateGlobal({ slug: 'settings', data: { counter: 1 } }),
        adapter.updateGlobal({ slug: 'settings', data: { counter: 2 } }),
        adapter.updateGlobal({ slug: 'settings', data: { counter: 3 } }),
      ])

      // One of them should win
      const global = await adapter.findGlobal({ slug: 'settings' })
      expect([1, 2, 3]).toContain(global.counter)
    })
  })

  // ==========================================================================
  // Operation Tracking
  // ==========================================================================

  describe('operation tracking', () => {
    it('should track findGlobal operations', async () => {
      const adapter = harness.adapter as any

      await adapter.updateGlobal({
        slug: 'settings',
        data: sampleSettings,
      })

      await adapter.findGlobal({ slug: 'settings' })

      const findOps = harness.operations.filter((op) => op.type === 'findGlobal' as any)
      expect(findOps.length).toBeGreaterThan(0)
    })

    it('should track updateGlobal operations', async () => {
      const adapter = harness.adapter as any

      await adapter.updateGlobal({
        slug: 'settings',
        data: sampleSettings,
      })

      const updateOps = harness.operations.filter((op) => op.type === 'updateGlobal' as any)
      expect(updateOps.length).toBeGreaterThan(0)
    })

    it('should record global slug in operation data', async () => {
      const adapter = harness.adapter as any

      await adapter.updateGlobal({
        slug: 'my-global',
        data: { key: 'value' },
      })

      const updateOp = harness.operations.find((op) => op.type === 'updateGlobal' as any)
      expect((updateOp as any)?.slug || updateOp?.collection).toBe('my-global')
    })
  })

  // ==========================================================================
  // Multiple Globals
  // ==========================================================================

  describe('multiple globals', () => {
    it('should maintain separate globals independently', async () => {
      const adapter = harness.adapter as any

      await adapter.updateGlobal({
        slug: 'header',
        data: sampleHeader,
      })

      await adapter.updateGlobal({
        slug: 'footer',
        data: sampleFooter,
      })

      await adapter.updateGlobal({
        slug: 'settings',
        data: sampleSettings,
      })

      // Each should be independent
      const header = await adapter.findGlobal({ slug: 'header' })
      const footer = await adapter.findGlobal({ slug: 'footer' })
      const settings = await adapter.findGlobal({ slug: 'settings' })

      expect(header.navItems).toBeDefined()
      expect(footer.socialLinks).toBeDefined()
      expect(settings.siteName).toBeDefined()

      // Modifying one shouldn't affect others
      await adapter.updateGlobal({
        slug: 'header',
        data: { navItems: [] },
      })

      const footerAfter = await adapter.findGlobal({ slug: 'footer' })
      expect(footerAfter.socialLinks).toHaveLength(2) // Unchanged
    })

    it('should list all globals', async () => {
      const adapter = harness.adapter as any

      await adapter.updateGlobal({ slug: 'header', data: sampleHeader })
      await adapter.updateGlobal({ slug: 'footer', data: sampleFooter })
      await adapter.updateGlobal({ slug: 'settings', data: sampleSettings })

      // List all globals (if such API exists)
      const globals = await adapter.getGlobals?.()

      if (globals) {
        expect(globals).toHaveLength(3)
        expect(globals.map((g: any) => g.slug).sort()).toEqual(['footer', 'header', 'settings'])
      }
    })
  })
})

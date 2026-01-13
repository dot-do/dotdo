/**
 * @dotdo/contentful - Contentful Asset API Compat Layer Tests
 *
 * Comprehensive tests for contentful-management SDK compatible Asset API
 * Tests follow TDD approach: write failing tests first (RED), then implement (GREEN)
 *
 * Based on Contentful Management API and Images API:
 * - https://www.contentful.com/developers/docs/references/content-management-api/
 * - https://www.contentful.com/developers/docs/references/images-api/
 * - https://contentful.github.io/contentful-management.js/
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// These imports will fail until we implement them (RED phase)
import {
  // Client
  createClient,

  // Types
  type ContentfulClient,
  type Space,
  type Environment,
  type Asset,
  type AssetCollection,
  type AssetProps,
  type CreateAssetProps,
  type AssetFileProp,

  // Errors
  ContentfulError,
  NotFoundError,
  ValidationError,
  AccessDeniedError,
  RateLimitError,

  // Image transformation utilities
  getImageUrl,
  buildImageTransformUrl,
  type ImageTransformOptions,

  // Test utilities
  _clearAll,
  _getAssets,
} from '../index'

// =============================================================================
// Test Setup
// =============================================================================

describe('@dotdo/contentful - Asset API Compat Layer', () => {
  let client: ContentfulClient
  let space: Space
  let environment: Environment

  beforeEach(async () => {
    _clearAll()
    client = createClient({
      accessToken: 'test-access-token',
    })
    space = await client.getSpace('test-space-id')
    environment = await space.getEnvironment('master')
  })

  // ===========================================================================
  // Client Tests
  // ===========================================================================

  describe('Client', () => {
    it('should export createClient function', () => {
      expect(createClient).toBeDefined()
      expect(typeof createClient).toBe('function')
    })

    it('should create client with access token', () => {
      const client = createClient({
        accessToken: 'test-token',
      })
      expect(client).toBeDefined()
    })

    it('should create client with custom host', () => {
      const client = createClient({
        accessToken: 'test-token',
        host: 'api.eu.contentful.com',
      })
      expect(client).toBeDefined()
    })

    it('should get space', async () => {
      const space = await client.getSpace('test-space-id')
      expect(space).toBeDefined()
      expect(space.sys.id).toBe('test-space-id')
    })

    it('should get environment', async () => {
      const env = await space.getEnvironment('master')
      expect(env).toBeDefined()
      expect(env.sys.id).toBe('master')
    })
  })

  // ===========================================================================
  // Asset Upload Tests
  // ===========================================================================

  describe('Asset Upload', () => {
    describe('Create Asset from URL', () => {
      it('should create an asset from a URL', async () => {
        const asset = await environment.createAsset({
          fields: {
            title: {
              'en-US': 'Test Image',
            },
            description: {
              'en-US': 'A test image uploaded from URL',
            },
            file: {
              'en-US': {
                contentType: 'image/png',
                fileName: 'test-image.png',
                upload: 'https://example.com/image.png',
              },
            },
          },
        })

        expect(asset).toBeDefined()
        expect(asset.sys.id).toBeDefined()
        expect(asset.sys.type).toBe('Asset')
        expect(asset.fields.title['en-US']).toBe('Test Image')
        expect(asset.fields.file['en-US'].fileName).toBe('test-image.png')
      })

      it('should create an asset with custom ID', async () => {
        const asset = await environment.createAssetWithId('custom-asset-id', {
          fields: {
            title: {
              'en-US': 'Custom ID Asset',
            },
            file: {
              'en-US': {
                contentType: 'image/jpeg',
                fileName: 'custom.jpg',
                upload: 'https://example.com/custom.jpg',
              },
            },
          },
        })

        expect(asset.sys.id).toBe('custom-asset-id')
      })

      it('should create asset from upload reference', async () => {
        // First create an upload
        const upload = await environment.createUpload({
          file: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), // PNG header
        })

        // Then create asset linking to the upload
        const asset = await environment.createAsset({
          fields: {
            title: {
              'en-US': 'Uploaded Asset',
            },
            file: {
              'en-US': {
                contentType: 'image/png',
                fileName: 'uploaded.png',
                uploadFrom: {
                  sys: {
                    type: 'Link',
                    linkType: 'Upload',
                    id: upload.sys.id,
                  },
                },
              },
            },
          },
        })

        expect(asset).toBeDefined()
        expect(asset.sys.id).toBeDefined()
      })
    })

    describe('Direct File Upload', () => {
      it('should upload a file directly', async () => {
        const fileContent = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        const upload = await environment.createUpload({
          file: fileContent,
        })

        expect(upload).toBeDefined()
        expect(upload.sys.id).toBeDefined()
        expect(upload.sys.type).toBe('Upload')
      })

      it('should upload a file from Blob', async () => {
        const blob = new Blob(['Hello World'], { type: 'text/plain' })
        const upload = await environment.createUpload({
          file: blob,
        })

        expect(upload).toBeDefined()
        expect(upload.sys.id).toBeDefined()
      })

      it('should upload a file from ArrayBuffer', async () => {
        const buffer = new TextEncoder().encode('Test content').buffer
        const upload = await environment.createUpload({
          file: new Uint8Array(buffer),
        })

        expect(upload).toBeDefined()
        expect(upload.sys.id).toBeDefined()
      })

      it('should respect file size limits (max 1000MB)', async () => {
        // Create a mock large file reference (we won't actually allocate 1GB)
        const mockLargeFile = { size: 1001 * 1024 * 1024 } as unknown as Blob

        await expect(
          environment.createUpload({ file: mockLargeFile })
        ).rejects.toThrow(ValidationError)
      })

      it('should delete upload after 24 hours if not processed', async () => {
        const upload = await environment.createUpload({
          file: new Uint8Array([0x00]),
        })

        expect(upload.sys.expiresAt).toBeDefined()
        const expiresAt = new Date(upload.sys.expiresAt)
        const now = new Date()
        const hoursDiff = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60)
        expect(hoursDiff).toBeLessThanOrEqual(24)
      })
    })

    describe('Upload Different File Types', () => {
      it('should upload an image file', async () => {
        const asset = await environment.createAsset({
          fields: {
            title: { 'en-US': 'Image Asset' },
            file: {
              'en-US': {
                contentType: 'image/jpeg',
                fileName: 'photo.jpg',
                upload: 'https://example.com/photo.jpg',
              },
            },
          },
        })

        expect(asset.fields.file['en-US'].contentType).toBe('image/jpeg')
      })

      it('should upload a PDF file', async () => {
        const asset = await environment.createAsset({
          fields: {
            title: { 'en-US': 'PDF Document' },
            file: {
              'en-US': {
                contentType: 'application/pdf',
                fileName: 'document.pdf',
                upload: 'https://example.com/document.pdf',
              },
            },
          },
        })

        expect(asset.fields.file['en-US'].contentType).toBe('application/pdf')
      })

      it('should upload a video file', async () => {
        const asset = await environment.createAsset({
          fields: {
            title: { 'en-US': 'Video Asset' },
            file: {
              'en-US': {
                contentType: 'video/mp4',
                fileName: 'video.mp4',
                upload: 'https://example.com/video.mp4',
              },
            },
          },
        })

        expect(asset.fields.file['en-US'].contentType).toBe('video/mp4')
      })

      it('should upload a JSON file', async () => {
        const asset = await environment.createAsset({
          fields: {
            title: { 'en-US': 'JSON Data' },
            file: {
              'en-US': {
                contentType: 'application/json',
                fileName: 'data.json',
                upload: 'https://example.com/data.json',
              },
            },
          },
        })

        expect(asset.fields.file['en-US'].contentType).toBe('application/json')
      })
    })
  })

  // ===========================================================================
  // Asset Processing Tests
  // ===========================================================================

  describe('Asset Processing', () => {
    let unprocessedAsset: Asset

    beforeEach(async () => {
      unprocessedAsset = await environment.createAsset({
        fields: {
          title: { 'en-US': 'Processing Test' },
          file: {
            'en-US': {
              contentType: 'image/png',
              fileName: 'process-test.png',
              upload: 'https://example.com/process-test.png',
            },
          },
        },
      })
    })

    describe('Process for Locale', () => {
      it('should process asset for a specific locale', async () => {
        const processedAsset = await unprocessedAsset.processForLocale('en-US')

        expect(processedAsset).toBeDefined()
        expect(processedAsset.fields.file['en-US'].url).toBeDefined()
        expect(processedAsset.fields.file['en-US'].upload).toBeUndefined()
      })

      it('should have processing status during processing', async () => {
        // Start processing
        const processingPromise = unprocessedAsset.processForLocale('en-US')

        // Check status (in real impl this would be a separate call)
        expect(unprocessedAsset.sys.publishedAt).toBeUndefined()

        await processingPromise
      })

      it('should fail processing for invalid locale', async () => {
        await expect(
          unprocessedAsset.processForLocale('invalid-locale')
        ).rejects.toThrow(ValidationError)
      })

      it('should make url available after processing', async () => {
        // Before processing, url should not be available
        expect(unprocessedAsset.fields.file['en-US'].url).toBeUndefined()

        // After processing, url should be available
        const processed = await unprocessedAsset.processForLocale('en-US')
        expect(processed.fields.file['en-US'].url).toBeDefined()
        expect(processed.fields.file['en-US'].url).toContain('ctfassets.net')
      })

      it('should remove upload URL after processing', async () => {
        const processed = await unprocessedAsset.processForLocale('en-US')
        expect(processed.fields.file['en-US'].upload).toBeUndefined()
      })
    })

    describe('Process for All Locales', () => {
      let multiLocaleAsset: Asset

      beforeEach(async () => {
        multiLocaleAsset = await environment.createAsset({
          fields: {
            title: {
              'en-US': 'Multi-locale Asset',
              'de-DE': 'Mehrsprachiges Asset',
            },
            file: {
              'en-US': {
                contentType: 'image/png',
                fileName: 'en-image.png',
                upload: 'https://example.com/en-image.png',
              },
              'de-DE': {
                contentType: 'image/png',
                fileName: 'de-image.png',
                upload: 'https://example.com/de-image.png',
              },
            },
          },
        })
      })

      it('should process asset for all locales simultaneously', async () => {
        const processed = await multiLocaleAsset.processForAllLocales()

        expect(processed.fields.file['en-US'].url).toBeDefined()
        expect(processed.fields.file['de-DE'].url).toBeDefined()
      })

      it('should have options for processing timeout', async () => {
        const processed = await multiLocaleAsset.processForAllLocales({
          processingCheckWait: 500,
          processingCheckRetries: 10,
        })

        expect(processed).toBeDefined()
      })
    })

    describe('Processing Status', () => {
      it('should track processing state', async () => {
        const asset = await environment.createAsset({
          fields: {
            title: { 'en-US': 'Status Test' },
            file: {
              'en-US': {
                contentType: 'image/png',
                fileName: 'status-test.png',
                upload: 'https://example.com/status-test.png',
              },
            },
          },
        })

        // Check if asset needs processing
        expect(asset.fields.file['en-US'].upload).toBeDefined()
        expect(asset.fields.file['en-US'].url).toBeUndefined()

        // Process
        const processed = await asset.processForLocale('en-US')

        // Check processed state
        expect(processed.fields.file['en-US'].url).toBeDefined()
        expect(processed.fields.file['en-US'].upload).toBeUndefined()
      })

      it('should populate file details after processing', async () => {
        const processed = await unprocessedAsset.processForLocale('en-US')

        expect(processed.fields.file['en-US'].details).toBeDefined()
        expect(processed.fields.file['en-US'].details.size).toBeGreaterThan(0)
      })

      it('should populate image dimensions for image assets', async () => {
        const processed = await unprocessedAsset.processForLocale('en-US')

        expect(processed.fields.file['en-US'].details.image).toBeDefined()
        expect(processed.fields.file['en-US'].details.image.width).toBeGreaterThan(0)
        expect(processed.fields.file['en-US'].details.image.height).toBeGreaterThan(0)
      })
    })
  })

  // ===========================================================================
  // Image Transformation Tests
  // ===========================================================================

  describe('Image Transformations', () => {
    let imageAsset: Asset

    beforeEach(async () => {
      const asset = await environment.createAsset({
        fields: {
          title: { 'en-US': 'Transform Test Image' },
          file: {
            'en-US': {
              contentType: 'image/jpeg',
              fileName: 'transform-test.jpg',
              upload: 'https://example.com/transform-test.jpg',
            },
          },
        },
      })
      imageAsset = await asset.processForLocale('en-US')
    })

    describe('Resize', () => {
      it('should resize image by width', () => {
        const url = getImageUrl(imageAsset, 'en-US', { width: 300 })

        expect(url).toContain('w=300')
      })

      it('should resize image by height', () => {
        const url = getImageUrl(imageAsset, 'en-US', { height: 200 })

        expect(url).toContain('h=200')
      })

      it('should resize image by width and height', () => {
        const url = getImageUrl(imageAsset, 'en-US', { width: 300, height: 200 })

        expect(url).toContain('w=300')
        expect(url).toContain('h=200')
      })

      it('should enforce max dimension of 4000px', () => {
        expect(() => {
          getImageUrl(imageAsset, 'en-US', { width: 5000 })
        }).toThrow(ValidationError)

        expect(() => {
          getImageUrl(imageAsset, 'en-US', { height: 5000 })
        }).toThrow(ValidationError)
      })

      it('should maintain aspect ratio by default', () => {
        const url = getImageUrl(imageAsset, 'en-US', { width: 300, height: 200 })

        // Default fit maintains aspect ratio
        expect(url).not.toContain('fit=scale')
      })
    })

    describe('Fit/Crop Behavior', () => {
      it('should support pad fit', () => {
        const url = getImageUrl(imageAsset, 'en-US', {
          width: 500,
          height: 250,
          fit: 'pad',
        })

        expect(url).toContain('fit=pad')
      })

      it('should support fill fit', () => {
        const url = getImageUrl(imageAsset, 'en-US', {
          width: 500,
          height: 250,
          fit: 'fill',
        })

        expect(url).toContain('fit=fill')
      })

      it('should support scale fit (changes aspect ratio)', () => {
        const url = getImageUrl(imageAsset, 'en-US', {
          width: 500,
          height: 250,
          fit: 'scale',
        })

        expect(url).toContain('fit=scale')
      })

      it('should support crop fit', () => {
        const url = getImageUrl(imageAsset, 'en-US', {
          width: 500,
          height: 250,
          fit: 'crop',
        })

        expect(url).toContain('fit=crop')
      })

      it('should support thumb fit', () => {
        const url = getImageUrl(imageAsset, 'en-US', {
          width: 100,
          height: 100,
          fit: 'thumb',
        })

        expect(url).toContain('fit=thumb')
      })
    })

    describe('Focus Area', () => {
      it('should support center focus', () => {
        const url = getImageUrl(imageAsset, 'en-US', {
          width: 300,
          height: 300,
          fit: 'thumb',
          focus: 'center',
        })

        expect(url).toContain('f=center')
      })

      it('should support face focus', () => {
        const url = getImageUrl(imageAsset, 'en-US', {
          width: 100,
          height: 100,
          fit: 'thumb',
          focus: 'face',
        })

        expect(url).toContain('f=face')
      })

      it('should support faces focus (multiple faces)', () => {
        const url = getImageUrl(imageAsset, 'en-US', {
          width: 300,
          height: 300,
          fit: 'thumb',
          focus: 'faces',
        })

        expect(url).toContain('f=faces')
      })

      it('should support directional focus', () => {
        const directions = ['top', 'right', 'left', 'bottom', 'top_right', 'top_left', 'bottom_right', 'bottom_left']

        for (const direction of directions) {
          const url = getImageUrl(imageAsset, 'en-US', {
            width: 300,
            height: 300,
            fit: 'crop',
            focus: direction as ImageTransformOptions['focus'],
          })

          expect(url).toContain(`f=${direction}`)
        }
      })
    })

    describe('Format Conversion', () => {
      it('should convert to JPEG', () => {
        const url = getImageUrl(imageAsset, 'en-US', { format: 'jpg' })

        expect(url).toContain('fm=jpg')
      })

      it('should convert to PNG', () => {
        const url = getImageUrl(imageAsset, 'en-US', { format: 'png' })

        expect(url).toContain('fm=png')
      })

      it('should convert to WebP', () => {
        const url = getImageUrl(imageAsset, 'en-US', { format: 'webp' })

        expect(url).toContain('fm=webp')
      })

      it('should convert to AVIF', () => {
        const url = getImageUrl(imageAsset, 'en-US', { format: 'avif' })

        expect(url).toContain('fm=avif')
      })

      it('should convert to GIF', () => {
        const url = getImageUrl(imageAsset, 'en-US', { format: 'gif' })

        expect(url).toContain('fm=gif')
      })

      it('should support progressive JPEG', () => {
        const url = getImageUrl(imageAsset, 'en-US', {
          format: 'jpg',
          progressive: true,
        })

        expect(url).toContain('fm=jpg')
        expect(url).toContain('fl=progressive')
      })

      it('should support 8-bit PNG', () => {
        const url = getImageUrl(imageAsset, 'en-US', {
          format: 'png',
          png8: true,
        })

        expect(url).toContain('fm=png')
        expect(url).toContain('fl=png8')
      })
    })

    describe('Quality', () => {
      it('should set quality percentage', () => {
        const url = getImageUrl(imageAsset, 'en-US', {
          format: 'jpg',
          quality: 80,
        })

        expect(url).toContain('q=80')
      })

      it('should accept quality from 1 to 100', () => {
        const url1 = getImageUrl(imageAsset, 'en-US', { quality: 1 })
        const url100 = getImageUrl(imageAsset, 'en-US', { quality: 100 })

        expect(url1).toContain('q=1')
        expect(url100).toContain('q=100')
      })

      it('should reject invalid quality values', () => {
        expect(() => {
          getImageUrl(imageAsset, 'en-US', { quality: 0 })
        }).toThrow(ValidationError)

        expect(() => {
          getImageUrl(imageAsset, 'en-US', { quality: 101 })
        }).toThrow(ValidationError)
      })
    })

    describe('Corner Radius', () => {
      it('should add corner radius', () => {
        const url = getImageUrl(imageAsset, 'en-US', { radius: 20 })

        expect(url).toContain('r=20')
      })

      it('should support max radius for circle/ellipse', () => {
        const url = getImageUrl(imageAsset, 'en-US', { radius: 'max' })

        expect(url).toContain('r=max')
      })

      it('should crop to circle with radius 180', () => {
        const url = getImageUrl(imageAsset, 'en-US', {
          width: 200,
          height: 200,
          radius: 180,
        })

        expect(url).toContain('r=180')
      })
    })

    describe('Background Color', () => {
      it('should set background color with RGB', () => {
        const url = getImageUrl(imageAsset, 'en-US', {
          fit: 'pad',
          width: 500,
          height: 250,
          backgroundColor: 'rgb:9090ff',
        })

        expect(url).toContain('bg=rgb:9090ff')
      })

      it('should set white background', () => {
        const url = getImageUrl(imageAsset, 'en-US', {
          fit: 'pad',
          backgroundColor: 'rgb:ffffff',
        })

        expect(url).toContain('bg=rgb:ffffff')
      })
    })

    describe('Build Transform URL', () => {
      it('should build URL with multiple transformations', () => {
        const url = buildImageTransformUrl('https://images.ctfassets.net/space/asset/image.jpg', {
          width: 300,
          height: 200,
          fit: 'fill',
          focus: 'face',
          format: 'webp',
          quality: 80,
        })

        expect(url).toContain('w=300')
        expect(url).toContain('h=200')
        expect(url).toContain('fit=fill')
        expect(url).toContain('f=face')
        expect(url).toContain('fm=webp')
        expect(url).toContain('q=80')
      })

      it('should handle URL that already has query params', () => {
        const url = buildImageTransformUrl('https://images.ctfassets.net/image.jpg?existing=param', {
          width: 300,
        })

        expect(url).toContain('existing=param')
        expect(url).toContain('w=300')
      })
    })
  })

  // ===========================================================================
  // Asset Retrieval Tests
  // ===========================================================================

  describe('Asset Retrieval', () => {
    beforeEach(async () => {
      // Create some test assets
      const asset1 = await environment.createAsset({
        fields: {
          title: { 'en-US': 'First Asset' },
          description: { 'en-US': 'First asset description' },
          file: {
            'en-US': {
              contentType: 'image/png',
              fileName: 'first.png',
              upload: 'https://example.com/first.png',
            },
          },
        },
      })
      await asset1.processForLocale('en-US')
      await asset1.publish()

      const asset2 = await environment.createAsset({
        fields: {
          title: { 'en-US': 'Second Asset' },
          file: {
            'en-US': {
              contentType: 'image/jpeg',
              fileName: 'second.jpg',
              upload: 'https://example.com/second.jpg',
            },
          },
        },
      })
      await asset2.processForLocale('en-US')

      const asset3 = await environment.createAsset({
        fields: {
          title: { 'en-US': 'Third Asset' },
          file: {
            'en-US': {
              contentType: 'application/pdf',
              fileName: 'third.pdf',
              upload: 'https://example.com/third.pdf',
            },
          },
        },
      })
      await asset3.processForLocale('en-US')
    })

    describe('Get Asset by ID', () => {
      it('should retrieve asset by ID', async () => {
        const assets = await environment.getAssets()
        const firstAsset = assets.items[0]

        const retrieved = await environment.getAsset(firstAsset.sys.id)

        expect(retrieved).toBeDefined()
        expect(retrieved.sys.id).toBe(firstAsset.sys.id)
      })

      it('should throw NotFoundError for non-existent asset', async () => {
        await expect(
          environment.getAsset('non-existent-id')
        ).rejects.toThrow(NotFoundError)
      })

      it('should include all fields in retrieved asset', async () => {
        const assets = await environment.getAssets()
        const asset = assets.items[0]

        const retrieved = await environment.getAsset(asset.sys.id)

        expect(retrieved.fields.title).toBeDefined()
        expect(retrieved.fields.file).toBeDefined()
        expect(retrieved.sys).toBeDefined()
      })
    })

    describe('Get All Assets', () => {
      it('should retrieve all assets', async () => {
        const assets = await environment.getAssets()

        expect(assets).toBeDefined()
        expect(assets.items).toBeInstanceOf(Array)
        expect(assets.items.length).toBe(3)
        expect(assets.total).toBe(3)
      })

      it('should include pagination info', async () => {
        const assets = await environment.getAssets()

        expect(assets.skip).toBeDefined()
        expect(assets.limit).toBeDefined()
        expect(assets.total).toBeDefined()
      })
    })

    describe('Query Assets', () => {
      it('should filter by content type', async () => {
        const assets = await environment.getAssets({
          'fields.file.contentType': 'image/png',
        })

        expect(assets.items.length).toBe(1)
        expect(assets.items[0].fields.file['en-US'].contentType).toBe('image/png')
      })

      it('should search by title', async () => {
        const assets = await environment.getAssets({
          'fields.title[match]': 'First',
        })

        expect(assets.items.length).toBe(1)
        expect(assets.items[0].fields.title['en-US']).toContain('First')
      })

      it('should paginate with skip and limit', async () => {
        const page1 = await environment.getAssets({ limit: 2 })
        const page2 = await environment.getAssets({ skip: 2, limit: 2 })

        expect(page1.items.length).toBe(2)
        expect(page2.items.length).toBe(1)
      })

      it('should order by field', async () => {
        const assets = await environment.getAssets({
          order: 'fields.title',
        })

        expect(assets.items[0].fields.title['en-US']).toBe('First Asset')
      })

      it('should order descending', async () => {
        const assets = await environment.getAssets({
          order: '-fields.title',
        })

        expect(assets.items[0].fields.title['en-US']).toBe('Third Asset')
      })

      it('should filter by sys properties', async () => {
        const assets = await environment.getAssets({
          'sys.publishedAt[exists]': true,
        })

        // Only published assets
        expect(assets.items.every(a => a.sys.publishedAt !== undefined)).toBe(true)
      })

      it('should filter by mimetype group', async () => {
        const assets = await environment.getAssets({
          mimetype_group: 'image',
        })

        expect(assets.items.every(a =>
          a.fields.file['en-US'].contentType.startsWith('image/')
        )).toBe(true)
      })

      it('should select specific fields', async () => {
        const assets = await environment.getAssets({
          select: 'sys.id,fields.title',
        })

        // Should have id and title, but not file or description
        expect(assets.items[0].sys.id).toBeDefined()
        expect(assets.items[0].fields.title).toBeDefined()
      })
    })

    describe('Get Published Assets', () => {
      it('should retrieve only published assets', async () => {
        const publishedAssets = await environment.getPublishedAssets()

        expect(publishedAssets.items.length).toBe(1)
        expect(publishedAssets.items.every(a => a.sys.publishedAt !== undefined)).toBe(true)
      })
    })
  })

  // ===========================================================================
  // Asset Metadata Tests
  // ===========================================================================

  describe('Asset Metadata', () => {
    let asset: Asset

    beforeEach(async () => {
      const created = await environment.createAsset({
        fields: {
          title: {
            'en-US': 'Metadata Test Asset',
            'de-DE': 'Metadaten Test Asset',
          },
          description: {
            'en-US': 'An asset for testing metadata',
            'de-DE': 'Ein Asset zum Testen von Metadaten',
          },
          file: {
            'en-US': {
              contentType: 'image/jpeg',
              fileName: 'metadata-test.jpg',
              upload: 'https://example.com/metadata-test.jpg',
            },
          },
        },
      })
      asset = await created.processForLocale('en-US')
    })

    describe('Title and Description', () => {
      it('should have title field', () => {
        expect(asset.fields.title).toBeDefined()
        expect(asset.fields.title['en-US']).toBe('Metadata Test Asset')
      })

      it('should have description field', () => {
        expect(asset.fields.description).toBeDefined()
        expect(asset.fields.description['en-US']).toBe('An asset for testing metadata')
      })

      it('should support multiple locales for title', () => {
        expect(asset.fields.title['en-US']).toBe('Metadata Test Asset')
        expect(asset.fields.title['de-DE']).toBe('Metadaten Test Asset')
      })

      it('should support multiple locales for description', () => {
        expect(asset.fields.description['en-US']).toBe('An asset for testing metadata')
        expect(asset.fields.description['de-DE']).toBe('Ein Asset zum Testen von Metadaten')
      })
    })

    describe('File Info', () => {
      it('should have file name', () => {
        expect(asset.fields.file['en-US'].fileName).toBe('metadata-test.jpg')
      })

      it('should have content type', () => {
        expect(asset.fields.file['en-US'].contentType).toBe('image/jpeg')
      })

      it('should have file URL after processing', () => {
        expect(asset.fields.file['en-US'].url).toBeDefined()
        expect(asset.fields.file['en-US'].url).toContain('ctfassets.net')
      })

      it('should have file details', () => {
        expect(asset.fields.file['en-US'].details).toBeDefined()
      })

      it('should have file size in details', () => {
        expect(asset.fields.file['en-US'].details.size).toBeDefined()
        expect(typeof asset.fields.file['en-US'].details.size).toBe('number')
      })

      it('should have image dimensions for image files', () => {
        expect(asset.fields.file['en-US'].details.image).toBeDefined()
        expect(asset.fields.file['en-US'].details.image.width).toBeDefined()
        expect(asset.fields.file['en-US'].details.image.height).toBeDefined()
      })
    })

    describe('System Metadata', () => {
      it('should have sys.id', () => {
        expect(asset.sys.id).toBeDefined()
        expect(typeof asset.sys.id).toBe('string')
      })

      it('should have sys.type as Asset', () => {
        expect(asset.sys.type).toBe('Asset')
      })

      it('should have sys.version', () => {
        expect(asset.sys.version).toBeDefined()
        expect(typeof asset.sys.version).toBe('number')
      })

      it('should have sys.createdAt', () => {
        expect(asset.sys.createdAt).toBeDefined()
      })

      it('should have sys.updatedAt', () => {
        expect(asset.sys.updatedAt).toBeDefined()
      })

      it('should have sys.space', () => {
        expect(asset.sys.space).toBeDefined()
        expect(asset.sys.space.sys.id).toBe('test-space-id')
      })

      it('should have sys.environment', () => {
        expect(asset.sys.environment).toBeDefined()
        expect(asset.sys.environment.sys.id).toBe('master')
      })

      it('should track publishedAt when published', async () => {
        expect(asset.sys.publishedAt).toBeUndefined()

        const published = await asset.publish()

        expect(published.sys.publishedAt).toBeDefined()
      })

      it('should track publishedVersion when published', async () => {
        const published = await asset.publish()

        expect(published.sys.publishedVersion).toBeDefined()
      })

      it('should track archivedAt when archived', async () => {
        const archived = await asset.archive()

        expect(archived.sys.archivedAt).toBeDefined()
      })
    })

    describe('Update Metadata', () => {
      it('should update title', async () => {
        asset.fields.title['en-US'] = 'Updated Title'
        const updated = await asset.update()

        expect(updated.fields.title['en-US']).toBe('Updated Title')
      })

      it('should update description', async () => {
        asset.fields.description['en-US'] = 'Updated description'
        const updated = await asset.update()

        expect(updated.fields.description['en-US']).toBe('Updated description')
      })

      it('should increment version on update', async () => {
        const originalVersion = asset.sys.version
        asset.fields.title['en-US'] = 'New Title'
        const updated = await asset.update()

        expect(updated.sys.version).toBe(originalVersion + 1)
      })
    })

    describe('Custom Metadata', () => {
      it('should support metadata tags', async () => {
        const assetWithTags = await environment.createAsset({
          fields: {
            title: { 'en-US': 'Tagged Asset' },
            file: {
              'en-US': {
                contentType: 'image/png',
                fileName: 'tagged.png',
                upload: 'https://example.com/tagged.png',
              },
            },
          },
          metadata: {
            tags: [
              { sys: { type: 'Link', linkType: 'Tag', id: 'marketing' } },
              { sys: { type: 'Link', linkType: 'Tag', id: 'hero-image' } },
            ],
          },
        })

        expect(assetWithTags.metadata).toBeDefined()
        expect(assetWithTags.metadata.tags).toHaveLength(2)
      })
    })
  })

  // ===========================================================================
  // Asset Localization Tests
  // ===========================================================================

  describe('Asset Localization', () => {
    describe('Create Localized Asset', () => {
      it('should create asset with multiple locales', async () => {
        const asset = await environment.createAsset({
          fields: {
            title: {
              'en-US': 'English Title',
              'de-DE': 'German Title',
              'fr-FR': 'French Title',
            },
            description: {
              'en-US': 'English description',
              'de-DE': 'German description',
              'fr-FR': 'French description',
            },
            file: {
              'en-US': {
                contentType: 'image/png',
                fileName: 'en-image.png',
                upload: 'https://example.com/en-image.png',
              },
              'de-DE': {
                contentType: 'image/png',
                fileName: 'de-image.png',
                upload: 'https://example.com/de-image.png',
              },
              'fr-FR': {
                contentType: 'image/png',
                fileName: 'fr-image.png',
                upload: 'https://example.com/fr-image.png',
              },
            },
          },
        })

        expect(asset.fields.title['en-US']).toBe('English Title')
        expect(asset.fields.title['de-DE']).toBe('German Title')
        expect(asset.fields.title['fr-FR']).toBe('French Title')
      })

      it('should create asset with different files per locale', async () => {
        const asset = await environment.createAsset({
          fields: {
            title: {
              'en-US': 'Localized Image',
              'ja-JP': 'Localized Image',
            },
            file: {
              'en-US': {
                contentType: 'image/png',
                fileName: 'english-version.png',
                upload: 'https://example.com/en.png',
              },
              'ja-JP': {
                contentType: 'image/png',
                fileName: 'japanese-version.png',
                upload: 'https://example.com/ja.png',
              },
            },
          },
        })

        expect(asset.fields.file['en-US'].fileName).toBe('english-version.png')
        expect(asset.fields.file['ja-JP'].fileName).toBe('japanese-version.png')
      })
    })

    describe('Process Localized Assets', () => {
      let localizedAsset: Asset

      beforeEach(async () => {
        localizedAsset = await environment.createAsset({
          fields: {
            title: {
              'en-US': 'Multi-locale',
              'de-DE': 'Mehrsprachig',
            },
            file: {
              'en-US': {
                contentType: 'image/png',
                fileName: 'en.png',
                upload: 'https://example.com/en.png',
              },
              'de-DE': {
                contentType: 'image/png',
                fileName: 'de.png',
                upload: 'https://example.com/de.png',
              },
            },
          },
        })
      })

      it('should process only specific locale', async () => {
        const processed = await localizedAsset.processForLocale('en-US')

        expect(processed.fields.file['en-US'].url).toBeDefined()
        expect(processed.fields.file['de-DE'].url).toBeUndefined()
        expect(processed.fields.file['de-DE'].upload).toBeDefined()
      })

      it('should process all locales', async () => {
        const processed = await localizedAsset.processForAllLocales()

        expect(processed.fields.file['en-US'].url).toBeDefined()
        expect(processed.fields.file['de-DE'].url).toBeDefined()
      })
    })

    describe('Locale Fallback', () => {
      it('should support locale fallback chain', async () => {
        const asset = await environment.createAsset({
          fields: {
            title: {
              'en-US': 'English Only Title',
            },
            description: {
              'en-US': 'English description',
              'de-DE': 'German description',
            },
            file: {
              'en-US': {
                contentType: 'image/png',
                fileName: 'shared.png',
                upload: 'https://example.com/shared.png',
              },
            },
          },
        })

        // When accessing de-DE title, should fall back to en-US
        expect(asset.fields.title['en-US']).toBe('English Only Title')
        expect(asset.fields.title['de-DE']).toBeUndefined() // No fallback in raw data
      })

      it('should get asset with locale parameter', async () => {
        const assetData = await environment.createAsset({
          fields: {
            title: {
              'en-US': 'English Title',
              'de-DE': 'German Title',
            },
            file: {
              'en-US': {
                contentType: 'image/png',
                fileName: 'image.png',
                upload: 'https://example.com/image.png',
              },
            },
          },
        })

        const asset = await environment.getAsset(assetData.sys.id, {
          locale: 'de-DE',
        })

        expect(asset.fields.title).toBe('German Title')
      })
    })
  })

  // ===========================================================================
  // Asset Lifecycle Tests
  // ===========================================================================

  describe('Asset Lifecycle', () => {
    let asset: Asset

    beforeEach(async () => {
      const created = await environment.createAsset({
        fields: {
          title: { 'en-US': 'Lifecycle Test' },
          file: {
            'en-US': {
              contentType: 'image/png',
              fileName: 'lifecycle.png',
              upload: 'https://example.com/lifecycle.png',
            },
          },
        },
      })
      asset = await created.processForLocale('en-US')
    })

    describe('Publish', () => {
      it('should publish asset', async () => {
        const published = await asset.publish()

        expect(published.sys.publishedAt).toBeDefined()
        expect(published.isPublished()).toBe(true)
      })

      it('should fail to publish unprocessed asset', async () => {
        const unprocessed = await environment.createAsset({
          fields: {
            title: { 'en-US': 'Unprocessed' },
            file: {
              'en-US': {
                contentType: 'image/png',
                fileName: 'unprocessed.png',
                upload: 'https://example.com/unprocessed.png',
              },
            },
          },
        })

        await expect(unprocessed.publish()).rejects.toThrow(ValidationError)
      })
    })

    describe('Unpublish', () => {
      it('should unpublish asset', async () => {
        const published = await asset.publish()
        const unpublished = await published.unpublish()

        expect(unpublished.sys.publishedAt).toBeUndefined()
        expect(unpublished.isPublished()).toBe(false)
      })
    })

    describe('Archive', () => {
      it('should archive asset', async () => {
        const archived = await asset.archive()

        expect(archived.sys.archivedAt).toBeDefined()
        expect(archived.isArchived()).toBe(true)
      })

      it('should unarchive asset', async () => {
        const archived = await asset.archive()
        const unarchived = await archived.unarchive()

        expect(unarchived.sys.archivedAt).toBeUndefined()
        expect(unarchived.isArchived()).toBe(false)
      })
    })

    describe('Delete', () => {
      it('should delete asset', async () => {
        const assetId = asset.sys.id
        await asset.delete()

        await expect(
          environment.getAsset(assetId)
        ).rejects.toThrow(NotFoundError)
      })

      it('should fail to delete published asset', async () => {
        const published = await asset.publish()

        await expect(published.delete()).rejects.toThrow(ValidationError)
      })
    })

    describe('Status Checks', () => {
      it('should check if asset is published', async () => {
        expect(asset.isPublished()).toBe(false)

        const published = await asset.publish()
        expect(published.isPublished()).toBe(true)
      })

      it('should check if asset is draft', () => {
        expect(asset.isDraft()).toBe(true)
      })

      it('should check if asset is updated (has unpublished changes)', async () => {
        const published = await asset.publish()
        expect(published.isUpdated()).toBe(false)

        published.fields.title['en-US'] = 'Updated Title'
        const updated = await published.update()
        expect(updated.isUpdated()).toBe(true)
      })

      it('should check if asset is archived', async () => {
        expect(asset.isArchived()).toBe(false)

        const archived = await asset.archive()
        expect(archived.isArchived()).toBe(true)
      })
    })
  })

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================

  describe('Error Handling', () => {
    it('should export ContentfulError', () => {
      expect(ContentfulError).toBeDefined()
    })

    it('should export NotFoundError', () => {
      expect(NotFoundError).toBeDefined()
      const error = new NotFoundError('Asset not found')
      expect(error.name).toBe('NotFoundError')
    })

    it('should export ValidationError', () => {
      expect(ValidationError).toBeDefined()
      const error = new ValidationError('Invalid field')
      expect(error.name).toBe('ValidationError')
    })

    it('should export AccessDeniedError', () => {
      expect(AccessDeniedError).toBeDefined()
      const error = new AccessDeniedError('Access denied')
      expect(error.name).toBe('AccessDeniedError')
    })

    it('should export RateLimitError', () => {
      expect(RateLimitError).toBeDefined()
      const error = new RateLimitError('Rate limit exceeded')
      expect(error.name).toBe('RateLimitError')
    })

    it('should throw NotFoundError for non-existent asset', async () => {
      await expect(
        environment.getAsset('non-existent')
      ).rejects.toThrow(NotFoundError)
    })

    it('should throw ValidationError for invalid asset data', async () => {
      await expect(
        environment.createAsset({
          fields: {
            // Missing required file field
            title: { 'en-US': 'Invalid Asset' },
          },
        } as CreateAssetProps)
      ).rejects.toThrow(ValidationError)
    })

    it('should throw AccessDeniedError for unauthorized access', async () => {
      const unauthorizedClient = createClient({
        accessToken: 'invalid-token',
      })

      await expect(
        unauthorizedClient.getSpace('test-space')
      ).rejects.toThrow(AccessDeniedError)
    })

    it('should include error details in ContentfulError', async () => {
      try {
        await environment.getAsset('non-existent')
      } catch (error) {
        expect(error).toBeInstanceOf(ContentfulError)
        expect((error as ContentfulError).message).toBeDefined()
        expect((error as ContentfulError).sys).toBeDefined()
      }
    })
  })

  // ===========================================================================
  // Test Utilities
  // ===========================================================================

  describe('Test Utilities', () => {
    it('should export _clearAll', () => {
      expect(_clearAll).toBeDefined()
      expect(typeof _clearAll).toBe('function')
    })

    it('should export _getAssets', () => {
      expect(_getAssets).toBeDefined()
      expect(typeof _getAssets).toBe('function')
    })

    it('should clear all data', async () => {
      await environment.createAsset({
        fields: {
          title: { 'en-US': 'Test' },
          file: {
            'en-US': {
              contentType: 'image/png',
              fileName: 'test.png',
              upload: 'https://example.com/test.png',
            },
          },
        },
      })

      _clearAll()

      const assets = await environment.getAssets()
      expect(assets.items).toHaveLength(0)
    })
  })

  // ===========================================================================
  // toPlainObject Tests
  // ===========================================================================

  describe('toPlainObject', () => {
    it('should convert asset to plain object', async () => {
      const asset = await environment.createAsset({
        fields: {
          title: { 'en-US': 'Plain Object Test' },
          file: {
            'en-US': {
              contentType: 'image/png',
              fileName: 'plain.png',
              upload: 'https://example.com/plain.png',
            },
          },
        },
      })

      const plain = asset.toPlainObject()

      expect(plain).toBeDefined()
      expect(plain.sys).toBeDefined()
      expect(plain.fields).toBeDefined()
      expect(typeof plain.publish).toBe('undefined')
      expect(typeof plain.update).toBe('undefined')
    })
  })
})

/**
 * Image Transformer Tests - TDD RED Phase
 *
 * Tests for the ImageTransformer primitive providing:
 * - Image resize operations with various modes
 * - Crop operations with position control
 * - Format conversion (JPEG, PNG, WebP, AVIF, GIF)
 * - Quality settings for lossy formats
 * - Aspect ratio handling
 * - Workers Image Resizing API compatibility
 *
 * These tests are designed to fail until the implementation is complete.
 * @see https://developers.cloudflare.com/images/transform-images/transform-via-workers/
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createImageTransformer,
  type ImageTransformer,
  type ResizeOptions,
  type CropOptions,
  type TransformOptions,
  type OutputFormat,
  type FitMode,
  type GravityPosition,
  type ImageMetadata,
  type TransformResult,
} from '../image-transformer'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestImageTransformer(): ImageTransformer {
  return createImageTransformer()
}

/**
 * Creates a minimal valid PNG image buffer for testing
 * 1x1 red pixel PNG
 */
function createTestPngBuffer(): Uint8Array {
  // Minimal 1x1 red PNG (67 bytes)
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 dimensions
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, // IDAT chunk
    0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x05, 0xfe,
    0xd4, 0xef, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, // IEND chunk
    0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ])
}

/**
 * Creates a test image with specific dimensions
 */
function createTestImageMetadata(
  width: number,
  height: number,
  format: OutputFormat = 'png'
): ImageMetadata {
  return {
    width,
    height,
    format,
    size: width * height * 4, // Approximate size for RGBA
    hasAlpha: format === 'png' || format === 'webp',
  }
}

// =============================================================================
// Image Transformer Factory Tests
// =============================================================================

describe('ImageTransformer', () => {
  describe('factory', () => {
    it('should create an image transformer instance', () => {
      const transformer = createImageTransformer()
      expect(transformer).toBeDefined()
      expect(typeof transformer.resize).toBe('function')
      expect(typeof transformer.crop).toBe('function')
      expect(typeof transformer.transform).toBe('function')
      expect(typeof transformer.getMetadata).toBe('function')
    })

    it('should accept configuration options', () => {
      const transformer = createImageTransformer({
        maxWidth: 4096,
        maxHeight: 4096,
        defaultQuality: 85,
        defaultFormat: 'webp',
      })
      expect(transformer).toBeDefined()
    })
  })

  // ===========================================================================
  // Resize Operation Tests
  // ===========================================================================

  describe('resize operations', () => {
    let transformer: ImageTransformer

    beforeEach(() => {
      transformer = createTestImageTransformer()
    })

    describe('basic resize', () => {
      it('should resize image by width only', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.resize(input, { width: 300 })

        expect(result).toBeDefined()
        expect(result.width).toBe(300)
        // Height should be proportionally scaled
        expect(result.height).toBeGreaterThan(0)
      })

      it('should resize image by height only', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.resize(input, { height: 200 })

        expect(result).toBeDefined()
        expect(result.height).toBe(200)
        // Width should be proportionally scaled
        expect(result.width).toBeGreaterThan(0)
      })

      it('should resize image by both width and height', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.resize(input, { width: 300, height: 200 })

        expect(result).toBeDefined()
        expect(result.width).toBeLessThanOrEqual(300)
        expect(result.height).toBeLessThanOrEqual(200)
      })

      it('should not upscale by default', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.resize(input, {
          width: 1000,
          height: 1000,
        })

        // Original 1x1 image should not be upscaled beyond original
        expect(result.width).toBeLessThanOrEqual(1000)
        expect(result.height).toBeLessThanOrEqual(1000)
      })

      it('should upscale when explicitly allowed', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.resize(input, {
          width: 100,
          height: 100,
          allowUpscale: true,
        })

        expect(result.width).toBe(100)
        expect(result.height).toBe(100)
      })
    })

    describe('fit modes', () => {
      it('should support contain fit mode (preserve aspect ratio)', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.resize(input, {
          width: 300,
          height: 200,
          fit: 'contain',
        })

        expect(result).toBeDefined()
        // Image should fit within bounds while maintaining aspect ratio
        expect(result.width).toBeLessThanOrEqual(300)
        expect(result.height).toBeLessThanOrEqual(200)
      })

      it('should support cover fit mode (fill dimensions, crop excess)', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.resize(input, {
          width: 300,
          height: 200,
          fit: 'cover',
        })

        expect(result).toBeDefined()
        // Image should fill the entire dimensions
        expect(result.width).toBe(300)
        expect(result.height).toBe(200)
      })

      it('should support scale-down fit mode (only shrink)', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.resize(input, {
          width: 300,
          height: 200,
          fit: 'scale-down',
        })

        expect(result).toBeDefined()
        // Should only shrink, never enlarge
        expect(result.width).toBeLessThanOrEqual(300)
        expect(result.height).toBeLessThanOrEqual(200)
      })

      it('should support pad fit mode (add padding to fill dimensions)', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.resize(input, {
          width: 300,
          height: 200,
          fit: 'pad',
          background: '#ffffff',
        })

        expect(result).toBeDefined()
        // Output should exactly match requested dimensions with padding
        expect(result.width).toBe(300)
        expect(result.height).toBe(200)
      })

      it('should support crop fit mode (center crop)', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.resize(input, {
          width: 300,
          height: 200,
          fit: 'crop',
        })

        expect(result).toBeDefined()
        expect(result.width).toBe(300)
        expect(result.height).toBe(200)
      })
    })

    describe('dimension constraints', () => {
      it('should enforce maximum width constraint', async () => {
        const input = createTestPngBuffer()

        await expect(
          transformer.resize(input, { width: 10000 })
        ).rejects.toThrow(/maximum.*width/i)
      })

      it('should enforce maximum height constraint', async () => {
        const input = createTestPngBuffer()

        await expect(
          transformer.resize(input, { height: 10000 })
        ).rejects.toThrow(/maximum.*height/i)
      })

      it('should enforce minimum dimensions', async () => {
        const input = createTestPngBuffer()

        await expect(
          transformer.resize(input, { width: 0 })
        ).rejects.toThrow(/minimum|positive/i)

        await expect(
          transformer.resize(input, { height: -1 })
        ).rejects.toThrow(/minimum|positive/i)
      })

      it('should enforce pixel limit (total pixels)', async () => {
        const input = createTestPngBuffer()

        // 5000 x 5000 = 25 million pixels - may exceed limits
        await expect(
          transformer.resize(input, { width: 5000, height: 5000 })
        ).rejects.toThrow(/pixel.*limit|too large/i)
      })
    })
  })

  // ===========================================================================
  // Crop Operation Tests
  // ===========================================================================

  describe('crop operations', () => {
    let transformer: ImageTransformer

    beforeEach(() => {
      transformer = createTestImageTransformer()
    })

    describe('basic crop', () => {
      it('should crop image with x, y, width, height', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.crop(input, {
          x: 10,
          y: 10,
          width: 100,
          height: 100,
        })

        expect(result).toBeDefined()
        expect(result.width).toBe(100)
        expect(result.height).toBe(100)
      })

      it('should crop from center by default', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.crop(input, {
          width: 100,
          height: 100,
        })

        expect(result).toBeDefined()
        expect(result.width).toBe(100)
        expect(result.height).toBe(100)
      })

      it('should crop with percentage-based coordinates', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.crop(input, {
          x: '10%',
          y: '10%',
          width: '80%',
          height: '80%',
        })

        expect(result).toBeDefined()
        // Width should be 80% of original
        expect(result.width).toBeGreaterThan(0)
        expect(result.height).toBeGreaterThan(0)
      })
    })

    describe('gravity-based cropping', () => {
      it('should crop from top-left', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.crop(input, {
          width: 100,
          height: 100,
          gravity: 'top-left',
        })

        expect(result).toBeDefined()
        expect(result.width).toBe(100)
        expect(result.height).toBe(100)
      })

      it('should crop from top-right', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.crop(input, {
          width: 100,
          height: 100,
          gravity: 'top-right',
        })

        expect(result).toBeDefined()
      })

      it('should crop from bottom-left', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.crop(input, {
          width: 100,
          height: 100,
          gravity: 'bottom-left',
        })

        expect(result).toBeDefined()
      })

      it('should crop from bottom-right', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.crop(input, {
          width: 100,
          height: 100,
          gravity: 'bottom-right',
        })

        expect(result).toBeDefined()
      })

      it('should crop from center', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.crop(input, {
          width: 100,
          height: 100,
          gravity: 'center',
        })

        expect(result).toBeDefined()
      })

      it('should support edge gravities (top, bottom, left, right)', async () => {
        const input = createTestPngBuffer()
        const gravities: GravityPosition[] = ['top', 'bottom', 'left', 'right']

        for (const gravity of gravities) {
          const result = await transformer.crop(input, {
            width: 100,
            height: 100,
            gravity,
          })
          expect(result).toBeDefined()
        }
      })
    })

    describe('smart cropping', () => {
      it('should support face detection gravity', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.crop(input, {
          width: 100,
          height: 100,
          gravity: 'face',
        })

        expect(result).toBeDefined()
        // Should focus on detected face region
      })

      it('should support entropy-based smart crop', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.crop(input, {
          width: 100,
          height: 100,
          gravity: 'entropy',
        })

        expect(result).toBeDefined()
        // Should focus on high-entropy (detailed) regions
      })

      it('should support attention-based smart crop', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.crop(input, {
          width: 100,
          height: 100,
          gravity: 'attention',
        })

        expect(result).toBeDefined()
        // Should focus on visually interesting regions
      })
    })

    describe('aspect ratio cropping', () => {
      it('should crop to aspect ratio 1:1 (square)', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.crop(input, {
          aspectRatio: '1:1',
        })

        expect(result).toBeDefined()
        expect(result.width).toBe(result.height)
      })

      it('should crop to aspect ratio 16:9', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.crop(input, {
          aspectRatio: '16:9',
        })

        expect(result).toBeDefined()
        const ratio = result.width / result.height
        expect(ratio).toBeCloseTo(16 / 9, 1)
      })

      it('should crop to aspect ratio 4:3', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.crop(input, {
          aspectRatio: '4:3',
        })

        expect(result).toBeDefined()
        const ratio = result.width / result.height
        expect(ratio).toBeCloseTo(4 / 3, 1)
      })

      it('should crop to aspect ratio 3:2', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.crop(input, {
          aspectRatio: '3:2',
        })

        expect(result).toBeDefined()
        const ratio = result.width / result.height
        expect(ratio).toBeCloseTo(3 / 2, 1)
      })

      it('should support decimal aspect ratios', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.crop(input, {
          aspectRatio: 1.5, // 3:2
        })

        expect(result).toBeDefined()
        const ratio = result.width / result.height
        expect(ratio).toBeCloseTo(1.5, 1)
      })
    })

    describe('crop validation', () => {
      it('should reject crop region outside image bounds', async () => {
        const input = createTestPngBuffer()

        await expect(
          transformer.crop(input, {
            x: 1000,
            y: 1000,
            width: 100,
            height: 100,
          })
        ).rejects.toThrow(/bounds|outside|invalid/i)
      })

      it('should reject zero-dimension crops', async () => {
        const input = createTestPngBuffer()

        await expect(
          transformer.crop(input, { width: 0, height: 100 })
        ).rejects.toThrow(/dimension|zero|positive/i)
      })

      it('should reject negative coordinates', async () => {
        const input = createTestPngBuffer()

        await expect(
          transformer.crop(input, { x: -10, y: 0, width: 100, height: 100 })
        ).rejects.toThrow(/negative|invalid/i)
      })
    })
  })

  // ===========================================================================
  // Format Conversion Tests
  // ===========================================================================

  describe('format conversion', () => {
    let transformer: ImageTransformer

    beforeEach(() => {
      transformer = createTestImageTransformer()
    })

    describe('supported formats', () => {
      it('should convert to JPEG', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.transform(input, { format: 'jpeg' })

        expect(result).toBeDefined()
        expect(result.format).toBe('jpeg')
        expect(result.data[0]).toBe(0xff) // JPEG magic number
        expect(result.data[1]).toBe(0xd8)
      })

      it('should convert to PNG', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.transform(input, { format: 'png' })

        expect(result).toBeDefined()
        expect(result.format).toBe('png')
        // PNG magic number
        expect(result.data[0]).toBe(0x89)
        expect(result.data[1]).toBe(0x50)
      })

      it('should convert to WebP', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.transform(input, { format: 'webp' })

        expect(result).toBeDefined()
        expect(result.format).toBe('webp')
        // WebP magic number (RIFF....WEBP)
        expect(result.data[0]).toBe(0x52) // R
        expect(result.data[1]).toBe(0x49) // I
        expect(result.data[2]).toBe(0x46) // F
        expect(result.data[3]).toBe(0x46) // F
      })

      it('should convert to AVIF', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.transform(input, { format: 'avif' })

        expect(result).toBeDefined()
        expect(result.format).toBe('avif')
      })

      it('should convert to GIF', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.transform(input, { format: 'gif' })

        expect(result).toBeDefined()
        expect(result.format).toBe('gif')
        // GIF magic number
        expect(result.data[0]).toBe(0x47) // G
        expect(result.data[1]).toBe(0x49) // I
        expect(result.data[2]).toBe(0x46) // F
      })
    })

    describe('format aliases', () => {
      it('should accept jpg as alias for jpeg', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.transform(input, { format: 'jpg' })

        expect(result.format).toBe('jpeg')
      })
    })

    describe('alpha channel handling', () => {
      it('should preserve transparency in PNG', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.transform(input, { format: 'png' })

        expect(result).toBeDefined()
        expect(result.metadata?.hasAlpha).toBe(true)
      })

      it('should preserve transparency in WebP', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.transform(input, { format: 'webp' })

        expect(result).toBeDefined()
        expect(result.metadata?.hasAlpha).toBe(true)
      })

      it('should flatten transparency to background in JPEG', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.transform(input, {
          format: 'jpeg',
          background: '#ffffff',
        })

        expect(result).toBeDefined()
        expect(result.metadata?.hasAlpha).toBe(false)
      })

      it('should use default white background when converting to JPEG', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.transform(input, { format: 'jpeg' })

        expect(result).toBeDefined()
        // Should not have alpha channel
        expect(result.metadata?.hasAlpha).toBe(false)
      })
    })
  })

  // ===========================================================================
  // Quality Settings Tests
  // ===========================================================================

  describe('quality settings', () => {
    let transformer: ImageTransformer

    beforeEach(() => {
      transformer = createTestImageTransformer()
    })

    describe('JPEG quality', () => {
      it('should accept quality 1-100 for JPEG', async () => {
        const input = createTestPngBuffer()

        const lowQuality = await transformer.transform(input, {
          format: 'jpeg',
          quality: 10,
        })
        const highQuality = await transformer.transform(input, {
          format: 'jpeg',
          quality: 100,
        })

        expect(lowQuality.data.length).toBeLessThan(highQuality.data.length)
      })

      it('should use default quality of 85 for JPEG', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.transform(input, { format: 'jpeg' })

        expect(result).toBeDefined()
        // Default quality should produce reasonable file size
      })

      it('should reject quality below 1', async () => {
        const input = createTestPngBuffer()

        await expect(
          transformer.transform(input, { format: 'jpeg', quality: 0 })
        ).rejects.toThrow(/quality.*1.*100/i)
      })

      it('should reject quality above 100', async () => {
        const input = createTestPngBuffer()

        await expect(
          transformer.transform(input, { format: 'jpeg', quality: 101 })
        ).rejects.toThrow(/quality.*1.*100/i)
      })
    })

    describe('WebP quality', () => {
      it('should accept quality 1-100 for WebP', async () => {
        const input = createTestPngBuffer()

        const lowQuality = await transformer.transform(input, {
          format: 'webp',
          quality: 10,
        })
        const highQuality = await transformer.transform(input, {
          format: 'webp',
          quality: 100,
        })

        expect(lowQuality.data.length).toBeLessThan(highQuality.data.length)
      })

      it('should support lossless WebP', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.transform(input, {
          format: 'webp',
          lossless: true,
        })

        expect(result).toBeDefined()
        // Lossless should preserve exact pixel data
      })
    })

    describe('AVIF quality', () => {
      it('should accept quality 1-100 for AVIF', async () => {
        const input = createTestPngBuffer()

        const result = await transformer.transform(input, {
          format: 'avif',
          quality: 50,
        })

        expect(result).toBeDefined()
      })

      it('should support lossless AVIF', async () => {
        const input = createTestPngBuffer()
        const result = await transformer.transform(input, {
          format: 'avif',
          lossless: true,
        })

        expect(result).toBeDefined()
      })
    })

    describe('PNG compression', () => {
      it('should support PNG compression level 1-9', async () => {
        const input = createTestPngBuffer()

        const fastCompression = await transformer.transform(input, {
          format: 'png',
          compressionLevel: 1,
        })
        const maxCompression = await transformer.transform(input, {
          format: 'png',
          compressionLevel: 9,
        })

        // Max compression should produce smaller file
        expect(maxCompression.data.length).toBeLessThanOrEqual(
          fastCompression.data.length
        )
      })
    })
  })

  // ===========================================================================
  // Combined Transform Tests
  // ===========================================================================

  describe('combined transformations', () => {
    let transformer: ImageTransformer

    beforeEach(() => {
      transformer = createTestImageTransformer()
    })

    it('should resize and convert format in single operation', async () => {
      const input = createTestPngBuffer()
      const result = await transformer.transform(input, {
        width: 200,
        height: 200,
        format: 'webp',
        quality: 80,
      })

      expect(result.width).toBeLessThanOrEqual(200)
      expect(result.height).toBeLessThanOrEqual(200)
      expect(result.format).toBe('webp')
    })

    it('should resize, crop, and convert in single operation', async () => {
      const input = createTestPngBuffer()
      const result = await transformer.transform(input, {
        width: 200,
        height: 200,
        fit: 'cover',
        format: 'jpeg',
        quality: 85,
      })

      expect(result.width).toBe(200)
      expect(result.height).toBe(200)
      expect(result.format).toBe('jpeg')
    })

    it('should apply background color with padding', async () => {
      const input = createTestPngBuffer()
      const result = await transformer.transform(input, {
        width: 200,
        height: 200,
        fit: 'pad',
        background: '#ff0000', // Red background
        format: 'png',
      })

      expect(result.width).toBe(200)
      expect(result.height).toBe(200)
    })

    it('should handle chained operations', async () => {
      const input = createTestPngBuffer()

      // First resize
      const resized = await transformer.resize(input, {
        width: 500,
        height: 500,
      })

      // Then crop
      const cropped = await transformer.crop(resized.data, {
        width: 300,
        height: 200,
        gravity: 'center',
      })

      // Then convert format
      const result = await transformer.transform(cropped.data, {
        format: 'webp',
        quality: 85,
      })

      expect(result.width).toBe(300)
      expect(result.height).toBe(200)
      expect(result.format).toBe('webp')
    })
  })

  // ===========================================================================
  // Metadata Tests
  // ===========================================================================

  describe('image metadata', () => {
    let transformer: ImageTransformer

    beforeEach(() => {
      transformer = createTestImageTransformer()
    })

    it('should extract basic metadata from image', async () => {
      const input = createTestPngBuffer()
      const metadata = await transformer.getMetadata(input)

      expect(metadata).toBeDefined()
      expect(metadata.width).toBeGreaterThan(0)
      expect(metadata.height).toBeGreaterThan(0)
      expect(metadata.format).toBe('png')
    })

    it('should detect image format from magic bytes', async () => {
      const pngInput = createTestPngBuffer()
      const metadata = await transformer.getMetadata(pngInput)

      expect(metadata.format).toBe('png')
    })

    it('should include file size in metadata', async () => {
      const input = createTestPngBuffer()
      const metadata = await transformer.getMetadata(input)

      expect(metadata.size).toBe(input.length)
    })

    it('should detect alpha channel presence', async () => {
      const input = createTestPngBuffer()
      const metadata = await transformer.getMetadata(input)

      expect(metadata.hasAlpha).toBeDefined()
      expect(typeof metadata.hasAlpha).toBe('boolean')
    })

    it('should include color space information', async () => {
      const input = createTestPngBuffer()
      const metadata = await transformer.getMetadata(input)

      expect(metadata.colorSpace).toBeDefined()
      // Common values: 'srgb', 'rgb', 'grayscale'
    })

    it('should return result metadata after transformation', async () => {
      const input = createTestPngBuffer()
      const result = await transformer.transform(input, {
        width: 100,
        format: 'webp',
      })

      expect(result.metadata).toBeDefined()
      expect(result.metadata?.width).toBeDefined()
      expect(result.metadata?.height).toBeDefined()
      expect(result.metadata?.format).toBe('webp')
    })
  })

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================

  describe('error handling', () => {
    let transformer: ImageTransformer

    beforeEach(() => {
      transformer = createTestImageTransformer()
    })

    it('should reject invalid image data', async () => {
      const invalidData = new Uint8Array([0x00, 0x01, 0x02, 0x03])

      await expect(
        transformer.transform(invalidData, { format: 'png' })
      ).rejects.toThrow(/invalid.*image|unsupported.*format/i)
    })

    it('should reject empty buffer', async () => {
      const emptyData = new Uint8Array(0)

      await expect(
        transformer.transform(emptyData, { format: 'png' })
      ).rejects.toThrow(/empty|invalid/i)
    })

    it('should reject unsupported format', async () => {
      const input = createTestPngBuffer()

      await expect(
        transformer.transform(input, { format: 'bmp' as OutputFormat })
      ).rejects.toThrow(/unsupported.*format/i)
    })

    it('should handle corrupted image data gracefully', async () => {
      // Partial PNG header
      const corruptedData = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ])

      await expect(
        transformer.transform(corruptedData, { format: 'png' })
      ).rejects.toThrow(/corrupted|invalid|truncated/i)
    })

    it('should timeout on very large images', async () => {
      const input = createTestPngBuffer()

      // This would require actual large image handling
      // Here we just verify the timeout option is supported
      await expect(
        transformer.transform(input, {
          format: 'png',
          timeout: 1, // 1ms timeout - should fail
        })
      ).rejects.toThrow(/timeout/i)
    }, 5000) // 5 second test timeout
  })

  // ===========================================================================
  // Workers Image Resizing Compatibility Tests
  // ===========================================================================

  describe('Workers Image Resizing API compatibility', () => {
    let transformer: ImageTransformer

    beforeEach(() => {
      transformer = createTestImageTransformer()
    })

    it('should support cf.image transform options format', async () => {
      const input = createTestPngBuffer()
      const result = await transformer.transformWithCfOptions(input, {
        width: 300,
        height: 200,
        fit: 'cover',
        gravity: 'auto',
        quality: 85,
        format: 'webp',
      })

      expect(result).toBeDefined()
      expect(result.format).toBe('webp')
    })

    it('should support anim option for animated images', async () => {
      const input = createTestPngBuffer()
      const result = await transformer.transformWithCfOptions(input, {
        format: 'gif',
        anim: false, // Extract first frame only
      })

      expect(result).toBeDefined()
    })

    it('should support blur option', async () => {
      const input = createTestPngBuffer()
      const result = await transformer.transformWithCfOptions(input, {
        blur: 10, // Blur radius
      })

      expect(result).toBeDefined()
    })

    it('should support brightness option', async () => {
      const input = createTestPngBuffer()
      const result = await transformer.transformWithCfOptions(input, {
        brightness: 1.2, // 20% brighter
      })

      expect(result).toBeDefined()
    })

    it('should support contrast option', async () => {
      const input = createTestPngBuffer()
      const result = await transformer.transformWithCfOptions(input, {
        contrast: 1.1, // 10% more contrast
      })

      expect(result).toBeDefined()
    })

    it('should support rotate option', async () => {
      const input = createTestPngBuffer()
      const result = await transformer.transformWithCfOptions(input, {
        rotate: 90,
      })

      expect(result).toBeDefined()
      // Width and height should be swapped for 90 degree rotation
    })

    it('should support sharpen option', async () => {
      const input = createTestPngBuffer()
      const result = await transformer.transformWithCfOptions(input, {
        sharpen: 2.0,
      })

      expect(result).toBeDefined()
    })

    it('should support trim option', async () => {
      const input = createTestPngBuffer()
      const result = await transformer.transformWithCfOptions(input, {
        trim: {
          top: 10,
          right: 10,
          bottom: 10,
          left: 10,
        },
      })

      expect(result).toBeDefined()
    })

    it('should support dpr (device pixel ratio) option', async () => {
      const input = createTestPngBuffer()
      const result = await transformer.transformWithCfOptions(input, {
        width: 100,
        height: 100,
        dpr: 2, // 2x for retina displays
      })

      expect(result).toBeDefined()
      // Output should be 200x200 (100 * 2)
      expect(result.width).toBe(200)
      expect(result.height).toBe(200)
    })

    it('should support metadata option', async () => {
      const input = createTestPngBuffer()
      const result = await transformer.transformWithCfOptions(input, {
        metadata: 'copyright', // Preserve only copyright metadata
      })

      expect(result).toBeDefined()
    })

    it('should support background option with hex color', async () => {
      const input = createTestPngBuffer()
      const result = await transformer.transformWithCfOptions(input, {
        fit: 'pad',
        width: 200,
        height: 200,
        background: '#ff5500',
      })

      expect(result).toBeDefined()
    })

    it('should support background option with CSS color name', async () => {
      const input = createTestPngBuffer()
      const result = await transformer.transformWithCfOptions(input, {
        fit: 'pad',
        width: 200,
        height: 200,
        background: 'red',
      })

      expect(result).toBeDefined()
    })
  })

  // ===========================================================================
  // URL-based Transform Tests
  // ===========================================================================

  describe('URL-based transformations', () => {
    let transformer: ImageTransformer

    beforeEach(() => {
      transformer = createTestImageTransformer()
    })

    it('should generate transform URL with width parameter', () => {
      const url = transformer.getTransformUrl('https://example.com/image.jpg', {
        width: 300,
      })

      expect(url).toContain('w=300')
    })

    it('should generate transform URL with height parameter', () => {
      const url = transformer.getTransformUrl('https://example.com/image.jpg', {
        height: 200,
      })

      expect(url).toContain('h=200')
    })

    it('should generate transform URL with format parameter', () => {
      const url = transformer.getTransformUrl('https://example.com/image.jpg', {
        format: 'webp',
      })

      expect(url).toContain('f=webp')
    })

    it('should generate transform URL with quality parameter', () => {
      const url = transformer.getTransformUrl('https://example.com/image.jpg', {
        quality: 80,
      })

      expect(url).toContain('q=80')
    })

    it('should generate transform URL with fit parameter', () => {
      const url = transformer.getTransformUrl('https://example.com/image.jpg', {
        fit: 'cover',
      })

      expect(url).toContain('fit=cover')
    })

    it('should generate transform URL with gravity parameter', () => {
      const url = transformer.getTransformUrl('https://example.com/image.jpg', {
        gravity: 'face',
      })

      expect(url).toContain('g=face')
    })

    it('should generate transform URL with multiple parameters', () => {
      const url = transformer.getTransformUrl('https://example.com/image.jpg', {
        width: 300,
        height: 200,
        fit: 'cover',
        format: 'webp',
        quality: 85,
      })

      expect(url).toContain('w=300')
      expect(url).toContain('h=200')
      expect(url).toContain('fit=cover')
      expect(url).toContain('f=webp')
      expect(url).toContain('q=85')
    })

    it('should handle URL with existing query parameters', () => {
      const url = transformer.getTransformUrl(
        'https://example.com/image.jpg?token=abc123',
        { width: 300 }
      )

      expect(url).toContain('token=abc123')
      expect(url).toContain('w=300')
    })
  })
})

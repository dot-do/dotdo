/**
 * E-Signature Placement Tests - RED Phase
 *
 * These tests define the expected behavior for e-signature placement functionality.
 * Tests should FAIL initially - this is the RED phase of TDD.
 *
 * Coverage:
 * - Place signature at specified coordinates
 * - Place signature in named fields
 * - Multiple signature placements in one document
 * - Signature appearance customization (image, text, drawn)
 * - Signature validation and verification
 * - Certificate chain handling
 */

import { describe, it, expect, beforeEach } from 'vitest'

// =============================================================================
// Types for E-Signature Placement (to be implemented)
// =============================================================================

/**
 * Coordinates for signature placement
 */
interface SignatureCoordinates {
  x: number
  y: number
  page: number
  width?: number
  height?: number
}

/**
 * Named field definition for signature placement
 */
interface NamedSignatureField {
  name: string
  signerId: string
  type: 'signature' | 'initials' | 'date' | 'text'
  required: boolean
  tooltip?: string
}

/**
 * Signature appearance options
 */
interface SignatureAppearance {
  type: 'image' | 'text' | 'drawn'
  imageData?: string // base64 PNG/JPEG
  text?: string
  fontFamily?: string
  fontSize?: number
  fontColor?: string
  drawnPaths?: DrawnPath[]
  backgroundColor?: string
  borderColor?: string
  borderWidth?: number
}

/**
 * Path data for drawn signatures
 */
interface DrawnPath {
  points: Array<{ x: number; y: number }>
  strokeWidth: number
  strokeColor: string
}

/**
 * Signature validation result
 */
interface SignatureValidationResult {
  valid: boolean
  errors: SignatureValidationError[]
  warnings: string[]
}

interface SignatureValidationError {
  code: string
  message: string
  field?: string
}

/**
 * Certificate for digital signature
 */
interface SigningCertificate {
  subject: string
  issuer: string
  serialNumber: string
  validFrom: Date
  validTo: Date
  publicKey: string
  signature: string
}

/**
 * Certificate chain for signature verification
 */
interface CertificateChain {
  endEntity: SigningCertificate
  intermediates: SigningCertificate[]
  root?: SigningCertificate
}

/**
 * Certificate chain validation result
 */
interface CertificateChainValidationResult {
  valid: boolean
  chainComplete: boolean
  trustPath: string[]
  errors: Array<{ code: string; message: string; certificate?: string }>
}

/**
 * Placed signature result
 */
interface PlacedSignature {
  fieldId: string
  page: number
  bounds: { x: number; y: number; width: number; height: number }
  signerId: string
  signedAt: Date
  appearance: SignatureAppearance
  certificateChain?: CertificateChain
}

// =============================================================================
// Mock implementations that will FAIL (placeholder for real implementation)
// =============================================================================

/**
 * Signature placer interface (not yet implemented)
 */
interface ISignaturePlacer {
  placeAtCoordinates(
    pdf: Uint8Array,
    coordinates: SignatureCoordinates,
    appearance: SignatureAppearance,
    signerId: string
  ): Promise<{ pdf: Uint8Array; signature: PlacedSignature }>

  placeInNamedField(
    pdf: Uint8Array,
    fieldName: string,
    appearance: SignatureAppearance,
    signerId: string
  ): Promise<{ pdf: Uint8Array; signature: PlacedSignature }>

  placeMultiple(
    pdf: Uint8Array,
    placements: Array<{
      coordinates?: SignatureCoordinates
      fieldName?: string
      appearance: SignatureAppearance
      signerId: string
    }>
  ): Promise<{ pdf: Uint8Array; signatures: PlacedSignature[] }>

  getNamedFields(pdf: Uint8Array): Promise<NamedSignatureField[]>

  validatePlacement(
    pdf: Uint8Array,
    coordinates: SignatureCoordinates
  ): Promise<SignatureValidationResult>
}

/**
 * Signature validator interface (not yet implemented)
 */
interface ISignatureValidator {
  validateSignature(pdf: Uint8Array, signatureId: string): Promise<SignatureValidationResult>
  validateAppearance(appearance: SignatureAppearance): SignatureValidationResult
  validateCertificateChain(chain: CertificateChain): Promise<CertificateChainValidationResult>
  verifyDocumentIntegrity(pdf: Uint8Array): Promise<{ intact: boolean; modifiedFields?: string[] }>
}

// Import the actual implementation
import {
  getSignaturePlacer as getActualSignaturePlacer,
  getSignatureValidator as getActualSignatureValidator,
  createSignaturePlacer,
  createSignatureValidator,
} from '../signature'

// Factory functions that return fresh instances for each test
function getSignaturePlacer(): ISignaturePlacer {
  return createSignaturePlacer()
}

function getSignatureValidator(): ISignatureValidator {
  return createSignatureValidator()
}

// Helper to create test PDF bytes
function createTestPdf(): Uint8Array {
  return new TextEncoder().encode('%PDF-1.7\n%%EOF')
}

// Helper to create test signature image (1x1 transparent PNG)
function createTestSignatureImage(): string {
  return 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
}

// =============================================================================
// Place Signature at Specified Coordinates
// =============================================================================

describe('E-Signature Placement - Coordinate-Based', () => {
  let placer: ISignaturePlacer
  let testPdf: Uint8Array

  beforeEach(() => {
    placer = getSignaturePlacer()
    testPdf = createTestPdf()
  })

  describe('placeAtCoordinates', () => {
    it('should place signature at exact x,y coordinates on page 1', async () => {
      const coordinates: SignatureCoordinates = {
        x: 100,
        y: 200,
        page: 1,
        width: 150,
        height: 50,
      }
      const appearance: SignatureAppearance = {
        type: 'image',
        imageData: createTestSignatureImage(),
      }

      const result = await placer.placeAtCoordinates(testPdf, coordinates, appearance, 'signer-1')

      expect(result.pdf).toBeInstanceOf(Uint8Array)
      expect(result.pdf.length).toBeGreaterThan(testPdf.length)
      expect(result.signature.bounds.x).toBe(100)
      expect(result.signature.bounds.y).toBe(200)
      expect(result.signature.bounds.width).toBe(150)
      expect(result.signature.bounds.height).toBe(50)
      expect(result.signature.page).toBe(1)
    })

    it('should place signature on a specific page other than page 1', async () => {
      const coordinates: SignatureCoordinates = {
        x: 50,
        y: 600,
        page: 3,
        width: 200,
        height: 75,
      }
      const appearance: SignatureAppearance = {
        type: 'text',
        text: 'John Doe',
        fontFamily: 'Helvetica',
        fontSize: 14,
      }

      const result = await placer.placeAtCoordinates(testPdf, coordinates, appearance, 'signer-2')

      expect(result.signature.page).toBe(3)
      expect(result.signature.bounds.x).toBe(50)
      expect(result.signature.bounds.y).toBe(600)
    })

    it('should use default dimensions when width/height not specified', async () => {
      const coordinates: SignatureCoordinates = {
        x: 100,
        y: 100,
        page: 1,
      }
      const appearance: SignatureAppearance = {
        type: 'image',
        imageData: createTestSignatureImage(),
      }

      const result = await placer.placeAtCoordinates(testPdf, coordinates, appearance, 'signer-1')

      // Default signature size should be applied
      expect(result.signature.bounds.width).toBeGreaterThan(0)
      expect(result.signature.bounds.height).toBeGreaterThan(0)
    })

    it('should reject coordinates outside page bounds', async () => {
      const coordinates: SignatureCoordinates = {
        x: -50, // Invalid negative coordinate
        y: 200,
        page: 1,
      }
      const appearance: SignatureAppearance = {
        type: 'image',
        imageData: createTestSignatureImage(),
      }

      await expect(
        placer.placeAtCoordinates(testPdf, coordinates, appearance, 'signer-1')
      ).rejects.toThrow(/coordinate|bounds|invalid/i)
    })

    it('should reject placement on non-existent page', async () => {
      const coordinates: SignatureCoordinates = {
        x: 100,
        y: 200,
        page: 999, // Page doesn't exist
      }
      const appearance: SignatureAppearance = {
        type: 'image',
        imageData: createTestSignatureImage(),
      }

      await expect(
        placer.placeAtCoordinates(testPdf, coordinates, appearance, 'signer-1')
      ).rejects.toThrow(/page|not found|invalid/i)
    })

    it('should handle coordinates with floating point precision', async () => {
      const coordinates: SignatureCoordinates = {
        x: 100.5,
        y: 200.75,
        page: 1,
        width: 150.25,
        height: 50.125,
      }
      const appearance: SignatureAppearance = {
        type: 'image',
        imageData: createTestSignatureImage(),
      }

      const result = await placer.placeAtCoordinates(testPdf, coordinates, appearance, 'signer-1')

      // Should round or handle floating points appropriately
      expect(result.signature.bounds.x).toBeCloseTo(100.5, 1)
      expect(result.signature.bounds.y).toBeCloseTo(200.75, 1)
    })

    it('should record signerId in placed signature', async () => {
      const coordinates: SignatureCoordinates = {
        x: 100,
        y: 200,
        page: 1,
      }
      const appearance: SignatureAppearance = {
        type: 'text',
        text: 'Signature',
      }

      const result = await placer.placeAtCoordinates(testPdf, coordinates, appearance, 'user-123')

      expect(result.signature.signerId).toBe('user-123')
    })

    it('should record timestamp when signature is placed', async () => {
      const beforeTime = new Date()
      const coordinates: SignatureCoordinates = {
        x: 100,
        y: 200,
        page: 1,
      }
      const appearance: SignatureAppearance = {
        type: 'text',
        text: 'Signature',
      }

      const result = await placer.placeAtCoordinates(testPdf, coordinates, appearance, 'signer-1')
      const afterTime = new Date()

      expect(result.signature.signedAt).toBeInstanceOf(Date)
      expect(result.signature.signedAt.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime())
      expect(result.signature.signedAt.getTime()).toBeLessThanOrEqual(afterTime.getTime())
    })
  })

  describe('validatePlacement', () => {
    it('should validate coordinates are within page bounds', async () => {
      const coordinates: SignatureCoordinates = {
        x: 100,
        y: 200,
        page: 1,
        width: 150,
        height: 50,
      }

      const result = await placer.validatePlacement(testPdf, coordinates)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should return error for signature that would extend beyond page', async () => {
      const coordinates: SignatureCoordinates = {
        x: 500,
        y: 700,
        page: 1,
        width: 200, // Would extend beyond typical page width
        height: 200, // Would extend beyond typical page height
      }

      const result = await placer.validatePlacement(testPdf, coordinates)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'OUT_OF_BOUNDS')).toBe(true)
    })

    it('should warn about placement in margin areas', async () => {
      const coordinates: SignatureCoordinates = {
        x: 10, // Very close to left edge
        y: 10, // Very close to bottom edge
        page: 1,
      }

      const result = await placer.validatePlacement(testPdf, coordinates)

      expect(result.warnings.some((w) => /margin/i.test(w))).toBe(true)
    })
  })
})

// =============================================================================
// Place Signature in Named Fields
// =============================================================================

describe('E-Signature Placement - Named Fields', () => {
  let placer: ISignaturePlacer
  let testPdf: Uint8Array

  beforeEach(() => {
    placer = getSignaturePlacer()
    testPdf = createTestPdf()
  })

  describe('getNamedFields', () => {
    it('should extract named signature fields from PDF', async () => {
      const fields = await placer.getNamedFields(testPdf)

      expect(Array.isArray(fields)).toBe(true)
    })

    it('should return field metadata including name, type, and required status', async () => {
      const fields = await placer.getNamedFields(testPdf)

      if (fields.length > 0) {
        const field = fields[0]
        expect(field).toHaveProperty('name')
        expect(field).toHaveProperty('type')
        expect(field).toHaveProperty('required')
        expect(field).toHaveProperty('signerId')
      }
    })

    it('should return empty array for PDF without signature fields', async () => {
      const emptyPdf = createTestPdf()
      const fields = await placer.getNamedFields(emptyPdf)

      expect(fields).toHaveLength(0)
    })
  })

  describe('placeInNamedField', () => {
    it('should place signature in field by name', async () => {
      const appearance: SignatureAppearance = {
        type: 'image',
        imageData: createTestSignatureImage(),
      }

      const result = await placer.placeInNamedField(
        testPdf,
        'signature_field_1',
        appearance,
        'signer-1'
      )

      expect(result.pdf).toBeInstanceOf(Uint8Array)
      expect(result.signature.fieldId).toBe('signature_field_1')
    })

    it('should throw error for non-existent field name', async () => {
      const appearance: SignatureAppearance = {
        type: 'text',
        text: 'John Doe',
      }

      await expect(
        placer.placeInNamedField(testPdf, 'non_existent_field', appearance, 'signer-1')
      ).rejects.toThrow(/field|not found/i)
    })

    it('should inherit field dimensions from the named field definition', async () => {
      const appearance: SignatureAppearance = {
        type: 'image',
        imageData: createTestSignatureImage(),
      }

      const result = await placer.placeInNamedField(
        testPdf,
        'signature_field_1',
        appearance,
        'signer-1'
      )

      // Field dimensions should come from the PDF field definition, not appearance
      expect(result.signature.bounds.width).toBeGreaterThan(0)
      expect(result.signature.bounds.height).toBeGreaterThan(0)
    })

    it('should reject placement if field is already signed', async () => {
      const appearance: SignatureAppearance = {
        type: 'text',
        text: 'John Doe',
      }

      // First placement should succeed
      const firstResult = await placer.placeInNamedField(
        testPdf,
        'signature_field_1',
        appearance,
        'signer-1'
      )

      // Second placement in same field should fail
      await expect(
        placer.placeInNamedField(firstResult.pdf, 'signature_field_1', appearance, 'signer-2')
      ).rejects.toThrow(/already signed|locked/i)
    })

    it('should reject placement if signerId does not match field assignment', async () => {
      const appearance: SignatureAppearance = {
        type: 'text',
        text: 'Wrong Signer',
      }

      // Field is assigned to signer-1, but we're trying to sign as signer-999
      await expect(
        placer.placeInNamedField(testPdf, 'signature_field_1', appearance, 'signer-999')
      ).rejects.toThrow(/signer|unauthorized|mismatch/i)
    })
  })
})

// =============================================================================
// Multiple Signature Placements in One Document
// =============================================================================

describe('E-Signature Placement - Multiple Signatures', () => {
  let placer: ISignaturePlacer
  let testPdf: Uint8Array

  beforeEach(() => {
    placer = getSignaturePlacer()
    testPdf = createTestPdf()
  })

  describe('placeMultiple', () => {
    it('should place multiple signatures in one operation', async () => {
      const placements = [
        {
          coordinates: { x: 100, y: 200, page: 1 },
          appearance: { type: 'text' as const, text: 'Signer 1' },
          signerId: 'signer-1',
        },
        {
          coordinates: { x: 100, y: 400, page: 1 },
          appearance: { type: 'text' as const, text: 'Signer 2' },
          signerId: 'signer-2',
        },
        {
          coordinates: { x: 100, y: 200, page: 2 },
          appearance: { type: 'text' as const, text: 'Signer 3' },
          signerId: 'signer-3',
        },
      ]

      const result = await placer.placeMultiple(testPdf, placements)

      expect(result.pdf).toBeInstanceOf(Uint8Array)
      expect(result.signatures).toHaveLength(3)
      expect(result.signatures[0].signerId).toBe('signer-1')
      expect(result.signatures[1].signerId).toBe('signer-2')
      expect(result.signatures[2].signerId).toBe('signer-3')
    })

    it('should place signatures across multiple pages', async () => {
      const placements = [
        {
          coordinates: { x: 100, y: 200, page: 1 },
          appearance: { type: 'image' as const, imageData: createTestSignatureImage() },
          signerId: 'signer-1',
        },
        {
          coordinates: { x: 100, y: 200, page: 5 },
          appearance: { type: 'image' as const, imageData: createTestSignatureImage() },
          signerId: 'signer-2',
        },
      ]

      const result = await placer.placeMultiple(testPdf, placements)

      expect(result.signatures[0].page).toBe(1)
      expect(result.signatures[1].page).toBe(5)
    })

    it('should mix coordinate-based and named field placements', async () => {
      const placements = [
        {
          coordinates: { x: 100, y: 200, page: 1 },
          appearance: { type: 'text' as const, text: 'By coordinates' },
          signerId: 'signer-1',
        },
        {
          fieldName: 'signature_field_2',
          appearance: { type: 'text' as const, text: 'By field name' },
          signerId: 'signer-2',
        },
      ]

      const result = await placer.placeMultiple(testPdf, placements)

      expect(result.signatures).toHaveLength(2)
    })

    it('should reject if any placement overlaps with another', async () => {
      const placements = [
        {
          coordinates: { x: 100, y: 200, page: 1, width: 200, height: 50 },
          appearance: { type: 'text' as const, text: 'Signature 1' },
          signerId: 'signer-1',
        },
        {
          coordinates: { x: 150, y: 210, page: 1, width: 200, height: 50 }, // Overlaps with first
          appearance: { type: 'text' as const, text: 'Signature 2' },
          signerId: 'signer-2',
        },
      ]

      await expect(placer.placeMultiple(testPdf, placements)).rejects.toThrow(/overlap/i)
    })

    it('should allow overlapping placements on different pages', async () => {
      const placements = [
        {
          coordinates: { x: 100, y: 200, page: 1, width: 200, height: 50 },
          appearance: { type: 'text' as const, text: 'Page 1 Sig' },
          signerId: 'signer-1',
        },
        {
          coordinates: { x: 100, y: 200, page: 2, width: 200, height: 50 }, // Same coords, different page
          appearance: { type: 'text' as const, text: 'Page 2 Sig' },
          signerId: 'signer-2',
        },
      ]

      const result = await placer.placeMultiple(testPdf, placements)

      expect(result.signatures).toHaveLength(2)
    })

    it('should assign unique fieldIds to each signature', async () => {
      const placements = [
        {
          coordinates: { x: 100, y: 200, page: 1 },
          appearance: { type: 'text' as const, text: 'Sig 1' },
          signerId: 'signer-1',
        },
        {
          coordinates: { x: 100, y: 400, page: 1 },
          appearance: { type: 'text' as const, text: 'Sig 2' },
          signerId: 'signer-2',
        },
      ]

      const result = await placer.placeMultiple(testPdf, placements)

      const fieldIds = result.signatures.map((s) => s.fieldId)
      const uniqueFieldIds = new Set(fieldIds)
      expect(uniqueFieldIds.size).toBe(fieldIds.length)
    })

    it('should preserve document integrity after multiple placements', async () => {
      const placements = Array.from({ length: 10 }, (_, i) => ({
        coordinates: { x: 50 + (i % 3) * 150, y: 100 + Math.floor(i / 3) * 100, page: 1 },
        appearance: { type: 'text' as const, text: `Signer ${i + 1}` },
        signerId: `signer-${i + 1}`,
      }))

      const result = await placer.placeMultiple(testPdf, placements)

      expect(result.signatures).toHaveLength(10)
      // PDF should still be valid
      expect(new TextDecoder().decode(result.pdf.slice(0, 8))).toContain('%PDF')
    })
  })
})

// =============================================================================
// Signature Appearance Customization
// =============================================================================

describe('E-Signature Appearance - Image Signatures', () => {
  let placer: ISignaturePlacer
  let testPdf: Uint8Array

  beforeEach(() => {
    placer = getSignaturePlacer()
    testPdf = createTestPdf()
  })

  it('should place PNG signature image', async () => {
    const appearance: SignatureAppearance = {
      type: 'image',
      imageData: createTestSignatureImage(),
    }
    const coordinates: SignatureCoordinates = { x: 100, y: 200, page: 1 }

    const result = await placer.placeAtCoordinates(testPdf, coordinates, appearance, 'signer-1')

    expect(result.signature.appearance.type).toBe('image')
    expect(result.signature.appearance.imageData).toBe(createTestSignatureImage())
  })

  it('should place JPEG signature image', async () => {
    // Minimal valid JPEG header
    const jpegBase64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMC'
    const appearance: SignatureAppearance = {
      type: 'image',
      imageData: jpegBase64,
    }
    const coordinates: SignatureCoordinates = { x: 100, y: 200, page: 1 }

    const result = await placer.placeAtCoordinates(testPdf, coordinates, appearance, 'signer-1')

    expect(result.signature.appearance.type).toBe('image')
  })

  it('should reject invalid image data', async () => {
    const appearance: SignatureAppearance = {
      type: 'image',
      imageData: 'not-valid-base64-image-data!!!',
    }
    const coordinates: SignatureCoordinates = { x: 100, y: 200, page: 1 }

    await expect(
      placer.placeAtCoordinates(testPdf, coordinates, appearance, 'signer-1')
    ).rejects.toThrow(/image|invalid|format/i)
  })

  it('should scale image to fit field dimensions', async () => {
    const appearance: SignatureAppearance = {
      type: 'image',
      imageData: createTestSignatureImage(),
    }
    const coordinates: SignatureCoordinates = {
      x: 100,
      y: 200,
      page: 1,
      width: 100,
      height: 30,
    }

    const result = await placer.placeAtCoordinates(testPdf, coordinates, appearance, 'signer-1')

    expect(result.signature.bounds.width).toBe(100)
    expect(result.signature.bounds.height).toBe(30)
  })

  it('should apply background color to image signature', async () => {
    const appearance: SignatureAppearance = {
      type: 'image',
      imageData: createTestSignatureImage(),
      backgroundColor: '#ffffff',
    }
    const coordinates: SignatureCoordinates = { x: 100, y: 200, page: 1 }

    const result = await placer.placeAtCoordinates(testPdf, coordinates, appearance, 'signer-1')

    expect(result.signature.appearance.backgroundColor).toBe('#ffffff')
  })

  it('should apply border to image signature', async () => {
    const appearance: SignatureAppearance = {
      type: 'image',
      imageData: createTestSignatureImage(),
      borderColor: '#000000',
      borderWidth: 1,
    }
    const coordinates: SignatureCoordinates = { x: 100, y: 200, page: 1 }

    const result = await placer.placeAtCoordinates(testPdf, coordinates, appearance, 'signer-1')

    expect(result.signature.appearance.borderColor).toBe('#000000')
    expect(result.signature.appearance.borderWidth).toBe(1)
  })
})

describe('E-Signature Appearance - Text Signatures', () => {
  let placer: ISignaturePlacer
  let testPdf: Uint8Array

  beforeEach(() => {
    placer = getSignaturePlacer()
    testPdf = createTestPdf()
  })

  it('should place typed text signature', async () => {
    const appearance: SignatureAppearance = {
      type: 'text',
      text: 'John Doe',
    }
    const coordinates: SignatureCoordinates = { x: 100, y: 200, page: 1 }

    const result = await placer.placeAtCoordinates(testPdf, coordinates, appearance, 'signer-1')

    expect(result.signature.appearance.type).toBe('text')
    expect(result.signature.appearance.text).toBe('John Doe')
  })

  it('should apply custom font family', async () => {
    const appearance: SignatureAppearance = {
      type: 'text',
      text: 'Jane Smith',
      fontFamily: 'Dancing Script',
    }
    const coordinates: SignatureCoordinates = { x: 100, y: 200, page: 1 }

    const result = await placer.placeAtCoordinates(testPdf, coordinates, appearance, 'signer-1')

    expect(result.signature.appearance.fontFamily).toBe('Dancing Script')
  })

  it('should apply custom font size', async () => {
    const appearance: SignatureAppearance = {
      type: 'text',
      text: 'Bob Builder',
      fontSize: 24,
    }
    const coordinates: SignatureCoordinates = { x: 100, y: 200, page: 1 }

    const result = await placer.placeAtCoordinates(testPdf, coordinates, appearance, 'signer-1')

    expect(result.signature.appearance.fontSize).toBe(24)
  })

  it('should apply custom font color', async () => {
    const appearance: SignatureAppearance = {
      type: 'text',
      text: 'Alice Wonder',
      fontColor: '#0000ff',
    }
    const coordinates: SignatureCoordinates = { x: 100, y: 200, page: 1 }

    const result = await placer.placeAtCoordinates(testPdf, coordinates, appearance, 'signer-1')

    expect(result.signature.appearance.fontColor).toBe('#0000ff')
  })

  it('should reject empty text signature', async () => {
    const appearance: SignatureAppearance = {
      type: 'text',
      text: '',
    }
    const coordinates: SignatureCoordinates = { x: 100, y: 200, page: 1 }

    await expect(
      placer.placeAtCoordinates(testPdf, coordinates, appearance, 'signer-1')
    ).rejects.toThrow(/empty|required|text/i)
  })

  it('should handle very long text by truncating or wrapping', async () => {
    const longText = 'A'.repeat(500)
    const appearance: SignatureAppearance = {
      type: 'text',
      text: longText,
    }
    const coordinates: SignatureCoordinates = { x: 100, y: 200, page: 1, width: 150 }

    const result = await placer.placeAtCoordinates(testPdf, coordinates, appearance, 'signer-1')

    // Should not throw, text should fit within bounds
    expect(result.signature.bounds.width).toBeLessThanOrEqual(150)
  })
})

describe('E-Signature Appearance - Drawn Signatures', () => {
  let placer: ISignaturePlacer
  let testPdf: Uint8Array

  beforeEach(() => {
    placer = getSignaturePlacer()
    testPdf = createTestPdf()
  })

  it('should place drawn signature with path data', async () => {
    const appearance: SignatureAppearance = {
      type: 'drawn',
      drawnPaths: [
        {
          points: [
            { x: 0, y: 0 },
            { x: 50, y: 25 },
            { x: 100, y: 0 },
          ],
          strokeWidth: 2,
          strokeColor: '#000000',
        },
      ],
    }
    const coordinates: SignatureCoordinates = { x: 100, y: 200, page: 1 }

    const result = await placer.placeAtCoordinates(testPdf, coordinates, appearance, 'signer-1')

    expect(result.signature.appearance.type).toBe('drawn')
    expect(result.signature.appearance.drawnPaths).toHaveLength(1)
  })

  it('should support multiple stroke paths', async () => {
    const appearance: SignatureAppearance = {
      type: 'drawn',
      drawnPaths: [
        {
          points: [
            { x: 0, y: 0 },
            { x: 50, y: 25 },
          ],
          strokeWidth: 2,
          strokeColor: '#000000',
        },
        {
          points: [
            { x: 60, y: 0 },
            { x: 100, y: 30 },
          ],
          strokeWidth: 2,
          strokeColor: '#000000',
        },
      ],
    }
    const coordinates: SignatureCoordinates = { x: 100, y: 200, page: 1 }

    const result = await placer.placeAtCoordinates(testPdf, coordinates, appearance, 'signer-1')

    expect(result.signature.appearance.drawnPaths).toHaveLength(2)
  })

  it('should apply stroke width to drawn paths', async () => {
    const appearance: SignatureAppearance = {
      type: 'drawn',
      drawnPaths: [
        {
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 50 },
          ],
          strokeWidth: 4,
          strokeColor: '#000000',
        },
      ],
    }
    const coordinates: SignatureCoordinates = { x: 100, y: 200, page: 1 }

    const result = await placer.placeAtCoordinates(testPdf, coordinates, appearance, 'signer-1')

    expect(result.signature.appearance.drawnPaths![0].strokeWidth).toBe(4)
  })

  it('should apply stroke color to drawn paths', async () => {
    const appearance: SignatureAppearance = {
      type: 'drawn',
      drawnPaths: [
        {
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 50 },
          ],
          strokeWidth: 2,
          strokeColor: '#0000ff',
        },
      ],
    }
    const coordinates: SignatureCoordinates = { x: 100, y: 200, page: 1 }

    const result = await placer.placeAtCoordinates(testPdf, coordinates, appearance, 'signer-1')

    expect(result.signature.appearance.drawnPaths![0].strokeColor).toBe('#0000ff')
  })

  it('should reject drawn signature with no paths', async () => {
    const appearance: SignatureAppearance = {
      type: 'drawn',
      drawnPaths: [],
    }
    const coordinates: SignatureCoordinates = { x: 100, y: 200, page: 1 }

    await expect(
      placer.placeAtCoordinates(testPdf, coordinates, appearance, 'signer-1')
    ).rejects.toThrow(/empty|path|required/i)
  })

  it('should reject path with less than 2 points', async () => {
    const appearance: SignatureAppearance = {
      type: 'drawn',
      drawnPaths: [
        {
          points: [{ x: 0, y: 0 }], // Only one point
          strokeWidth: 2,
          strokeColor: '#000000',
        },
      ],
    }
    const coordinates: SignatureCoordinates = { x: 100, y: 200, page: 1 }

    await expect(
      placer.placeAtCoordinates(testPdf, coordinates, appearance, 'signer-1')
    ).rejects.toThrow(/point|minimum|invalid/i)
  })

  it('should scale drawn paths to fit field dimensions', async () => {
    const appearance: SignatureAppearance = {
      type: 'drawn',
      drawnPaths: [
        {
          points: [
            { x: 0, y: 0 },
            { x: 200, y: 100 }, // Original size
          ],
          strokeWidth: 2,
          strokeColor: '#000000',
        },
      ],
    }
    const coordinates: SignatureCoordinates = {
      x: 100,
      y: 200,
      page: 1,
      width: 100, // Smaller than original
      height: 50,
    }

    const result = await placer.placeAtCoordinates(testPdf, coordinates, appearance, 'signer-1')

    // Path should be scaled to fit within specified bounds
    expect(result.signature.bounds.width).toBe(100)
    expect(result.signature.bounds.height).toBe(50)
  })
})

// =============================================================================
// Signature Validation and Verification
// =============================================================================

describe('E-Signature Validation', () => {
  let validator: ISignatureValidator
  let testPdf: Uint8Array

  beforeEach(() => {
    validator = getSignatureValidator()
    testPdf = createTestPdf()
  })

  describe('validateAppearance', () => {
    it('should validate image appearance with valid image data', () => {
      const appearance: SignatureAppearance = {
        type: 'image',
        imageData: createTestSignatureImage(),
      }

      const result = validator.validateAppearance(appearance)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should reject image appearance without image data', () => {
      const appearance: SignatureAppearance = {
        type: 'image',
        // imageData is missing
      }

      const result = validator.validateAppearance(appearance)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'MISSING_IMAGE_DATA')).toBe(true)
    })

    it('should validate text appearance with text content', () => {
      const appearance: SignatureAppearance = {
        type: 'text',
        text: 'John Doe',
      }

      const result = validator.validateAppearance(appearance)

      expect(result.valid).toBe(true)
    })

    it('should reject text appearance without text', () => {
      const appearance: SignatureAppearance = {
        type: 'text',
        // text is missing
      }

      const result = validator.validateAppearance(appearance)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'MISSING_TEXT')).toBe(true)
    })

    it('should validate drawn appearance with paths', () => {
      const appearance: SignatureAppearance = {
        type: 'drawn',
        drawnPaths: [
          {
            points: [
              { x: 0, y: 0 },
              { x: 100, y: 50 },
            ],
            strokeWidth: 2,
            strokeColor: '#000000',
          },
        ],
      }

      const result = validator.validateAppearance(appearance)

      expect(result.valid).toBe(true)
    })

    it('should reject drawn appearance without paths', () => {
      const appearance: SignatureAppearance = {
        type: 'drawn',
        // drawnPaths is missing
      }

      const result = validator.validateAppearance(appearance)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'MISSING_DRAWN_PATHS')).toBe(true)
    })

    it('should warn about small font size', () => {
      const appearance: SignatureAppearance = {
        type: 'text',
        text: 'Tiny Text',
        fontSize: 6, // Very small
      }

      const result = validator.validateAppearance(appearance)

      expect(result.warnings.some((w) => /font.*size|small/i.test(w))).toBe(true)
    })

    it('should warn about low contrast colors', () => {
      const appearance: SignatureAppearance = {
        type: 'text',
        text: 'Low Contrast',
        fontColor: '#f0f0f0', // Light gray
        backgroundColor: '#ffffff', // White background
      }

      const result = validator.validateAppearance(appearance)

      expect(result.warnings.some((w) => /contrast/i.test(w))).toBe(true)
    })
  })

  describe('validateSignature', () => {
    it('should validate a properly signed signature field', async () => {
      const result = await validator.validateSignature(testPdf, 'signature-field-1')

      expect(result).toHaveProperty('valid')
      expect(result).toHaveProperty('errors')
    })

    it('should return error for non-existent signature field', async () => {
      const result = await validator.validateSignature(testPdf, 'non-existent-field')

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'FIELD_NOT_FOUND')).toBe(true)
    })

    it('should return error for unsigned signature field', async () => {
      const result = await validator.validateSignature(testPdf, 'unsigned-field')

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'FIELD_NOT_SIGNED')).toBe(true)
    })
  })

  describe('verifyDocumentIntegrity', () => {
    it('should verify document has not been modified after signing', async () => {
      const result = await validator.verifyDocumentIntegrity(testPdf)

      expect(result).toHaveProperty('intact')
    })

    it('should detect document modification after signing', async () => {
      // Tamper with the PDF
      const tamperedPdf = new Uint8Array(testPdf)
      tamperedPdf[10] = 0xff // Modify a byte

      const result = await validator.verifyDocumentIntegrity(tamperedPdf)

      expect(result.intact).toBe(false)
    })

    it('should identify which fields were modified', async () => {
      const tamperedPdf = createTestPdf() // Assume this has modifications

      const result = await validator.verifyDocumentIntegrity(tamperedPdf)

      if (!result.intact) {
        expect(result.modifiedFields).toBeDefined()
        expect(Array.isArray(result.modifiedFields)).toBe(true)
      }
    })
  })
})

// =============================================================================
// Certificate Chain Handling
// =============================================================================

describe('E-Signature Certificate Chain', () => {
  let validator: ISignatureValidator

  beforeEach(() => {
    validator = getSignatureValidator()
  })

  describe('validateCertificateChain', () => {
    it('should validate a complete certificate chain', async () => {
      const chain: CertificateChain = {
        endEntity: {
          subject: 'CN=John Doe,O=Example Corp',
          issuer: 'CN=Intermediate CA,O=Example Corp',
          serialNumber: '1234567890',
          validFrom: new Date('2025-01-01'),
          validTo: new Date('2028-12-31'),
          publicKey: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...',
          signature: 'signature-data',
        },
        intermediates: [
          {
            subject: 'CN=Intermediate CA,O=Example Corp',
            issuer: 'CN=Root CA,O=Example Corp',
            serialNumber: '0987654321',
            validFrom: new Date('2020-01-01'),
            validTo: new Date('2030-12-31'),
            publicKey: 'intermediate-public-key',
            signature: 'intermediate-signature',
          },
        ],
        root: {
          subject: 'CN=Root CA,O=Example Corp',
          issuer: 'CN=Root CA,O=Example Corp',
          serialNumber: '1111111111',
          validFrom: new Date('2010-01-01'),
          validTo: new Date('2040-12-31'),
          publicKey: 'root-public-key',
          signature: 'root-signature',
        },
      }

      const result = await validator.validateCertificateChain(chain)

      expect(result.valid).toBe(true)
      expect(result.chainComplete).toBe(true)
      expect(result.trustPath).toContain('CN=Root CA,O=Example Corp')
    })

    it('should detect expired end-entity certificate', async () => {
      const chain: CertificateChain = {
        endEntity: {
          subject: 'CN=John Doe',
          issuer: 'CN=CA',
          serialNumber: '123',
          validFrom: new Date('2020-01-01'),
          validTo: new Date('2021-12-31'), // Expired
          publicKey: 'key',
          signature: 'sig',
        },
        intermediates: [],
      }

      const result = await validator.validateCertificateChain(chain)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'CERTIFICATE_EXPIRED')).toBe(true)
    })

    it('should detect not-yet-valid certificate', async () => {
      const chain: CertificateChain = {
        endEntity: {
          subject: 'CN=Future Signer',
          issuer: 'CN=CA',
          serialNumber: '123',
          validFrom: new Date('2030-01-01'), // Not yet valid
          validTo: new Date('2031-12-31'),
          publicKey: 'key',
          signature: 'sig',
        },
        intermediates: [],
      }

      const result = await validator.validateCertificateChain(chain)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'CERTIFICATE_NOT_YET_VALID')).toBe(true)
    })

    it('should detect missing intermediate certificate', async () => {
      const chain: CertificateChain = {
        endEntity: {
          subject: 'CN=John Doe',
          issuer: 'CN=Intermediate CA', // Issued by intermediate that's not in chain
          serialNumber: '123',
          validFrom: new Date('2024-01-01'),
          validTo: new Date('2025-12-31'),
          publicKey: 'key',
          signature: 'sig',
        },
        intermediates: [], // Missing intermediate
        root: {
          subject: 'CN=Root CA',
          issuer: 'CN=Root CA',
          serialNumber: '111',
          validFrom: new Date('2010-01-01'),
          validTo: new Date('2040-12-31'),
          publicKey: 'root-key',
          signature: 'root-sig',
        },
      }

      const result = await validator.validateCertificateChain(chain)

      expect(result.chainComplete).toBe(false)
      expect(result.errors.some((e) => e.code === 'CHAIN_INCOMPLETE')).toBe(true)
    })

    it('should detect issuer mismatch in chain', async () => {
      const chain: CertificateChain = {
        endEntity: {
          subject: 'CN=John Doe',
          issuer: 'CN=Intermediate CA', // Expected issuer
          serialNumber: '123',
          validFrom: new Date('2024-01-01'),
          validTo: new Date('2025-12-31'),
          publicKey: 'key',
          signature: 'sig',
        },
        intermediates: [
          {
            subject: 'CN=Wrong Intermediate', // Different from expected issuer
            issuer: 'CN=Root CA',
            serialNumber: '456',
            validFrom: new Date('2020-01-01'),
            validTo: new Date('2030-12-31'),
            publicKey: 'int-key',
            signature: 'int-sig',
          },
        ],
      }

      const result = await validator.validateCertificateChain(chain)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'ISSUER_MISMATCH')).toBe(true)
    })

    it('should build correct trust path', async () => {
      const chain: CertificateChain = {
        endEntity: {
          subject: 'CN=End Entity',
          issuer: 'CN=Intermediate 1',
          serialNumber: '1',
          validFrom: new Date('2024-01-01'),
          validTo: new Date('2025-12-31'),
          publicKey: 'key1',
          signature: 'sig1',
        },
        intermediates: [
          {
            subject: 'CN=Intermediate 1',
            issuer: 'CN=Intermediate 2',
            serialNumber: '2',
            validFrom: new Date('2023-01-01'),
            validTo: new Date('2028-12-31'),
            publicKey: 'key2',
            signature: 'sig2',
          },
          {
            subject: 'CN=Intermediate 2',
            issuer: 'CN=Root',
            serialNumber: '3',
            validFrom: new Date('2020-01-01'),
            validTo: new Date('2030-12-31'),
            publicKey: 'key3',
            signature: 'sig3',
          },
        ],
        root: {
          subject: 'CN=Root',
          issuer: 'CN=Root',
          serialNumber: '4',
          validFrom: new Date('2010-01-01'),
          validTo: new Date('2040-12-31'),
          publicKey: 'key4',
          signature: 'sig4',
        },
      }

      const result = await validator.validateCertificateChain(chain)

      expect(result.trustPath).toEqual([
        'CN=End Entity',
        'CN=Intermediate 1',
        'CN=Intermediate 2',
        'CN=Root',
      ])
    })

    it('should validate self-signed certificate (no chain)', async () => {
      const chain: CertificateChain = {
        endEntity: {
          subject: 'CN=Self Signed',
          issuer: 'CN=Self Signed', // Self-signed
          serialNumber: '1',
          validFrom: new Date('2024-01-01'),
          validTo: new Date('2025-12-31'),
          publicKey: 'key',
          signature: 'sig',
        },
        intermediates: [],
      }

      const result = await validator.validateCertificateChain(chain)

      // Self-signed certificates are valid but may have warnings
      expect(result.chainComplete).toBe(true)
      expect(result.trustPath).toHaveLength(1)
    })

    it('should detect circular reference in chain', async () => {
      const chain: CertificateChain = {
        endEntity: {
          subject: 'CN=Cert A',
          issuer: 'CN=Cert B',
          serialNumber: '1',
          validFrom: new Date('2024-01-01'),
          validTo: new Date('2025-12-31'),
          publicKey: 'keyA',
          signature: 'sigA',
        },
        intermediates: [
          {
            subject: 'CN=Cert B',
            issuer: 'CN=Cert A', // Circular!
            serialNumber: '2',
            validFrom: new Date('2024-01-01'),
            validTo: new Date('2025-12-31'),
            publicKey: 'keyB',
            signature: 'sigB',
          },
        ],
      }

      const result = await validator.validateCertificateChain(chain)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === 'CIRCULAR_CHAIN')).toBe(true)
    })

    it('should handle chain with expired intermediate', async () => {
      const chain: CertificateChain = {
        endEntity: {
          subject: 'CN=End Entity',
          issuer: 'CN=Intermediate',
          serialNumber: '1',
          validFrom: new Date('2024-01-01'),
          validTo: new Date('2025-12-31'),
          publicKey: 'key1',
          signature: 'sig1',
        },
        intermediates: [
          {
            subject: 'CN=Intermediate',
            issuer: 'CN=Root',
            serialNumber: '2',
            validFrom: new Date('2020-01-01'),
            validTo: new Date('2021-12-31'), // Expired intermediate
            publicKey: 'key2',
            signature: 'sig2',
          },
        ],
        root: {
          subject: 'CN=Root',
          issuer: 'CN=Root',
          serialNumber: '3',
          validFrom: new Date('2010-01-01'),
          validTo: new Date('2040-12-31'),
          publicKey: 'key3',
          signature: 'sig3',
        },
      }

      const result = await validator.validateCertificateChain(chain)

      expect(result.valid).toBe(false)
      expect(
        result.errors.some(
          (e) => e.code === 'CERTIFICATE_EXPIRED' && e.certificate === 'CN=Intermediate'
        )
      ).toBe(true)
    })

    it('should handle multiple intermediate certificates in order', async () => {
      const chain: CertificateChain = {
        endEntity: {
          subject: 'CN=End',
          issuer: 'CN=Int1',
          serialNumber: '1',
          validFrom: new Date('2024-01-01'),
          validTo: new Date('2025-12-31'),
          publicKey: 'key1',
          signature: 'sig1',
        },
        intermediates: [
          {
            subject: 'CN=Int1',
            issuer: 'CN=Int2',
            serialNumber: '2',
            validFrom: new Date('2023-01-01'),
            validTo: new Date('2028-12-31'),
            publicKey: 'key2',
            signature: 'sig2',
          },
          {
            subject: 'CN=Int2',
            issuer: 'CN=Int3',
            serialNumber: '3',
            validFrom: new Date('2022-01-01'),
            validTo: new Date('2029-12-31'),
            publicKey: 'key3',
            signature: 'sig3',
          },
          {
            subject: 'CN=Int3',
            issuer: 'CN=Root',
            serialNumber: '4',
            validFrom: new Date('2021-01-01'),
            validTo: new Date('2030-12-31'),
            publicKey: 'key4',
            signature: 'sig4',
          },
        ],
        root: {
          subject: 'CN=Root',
          issuer: 'CN=Root',
          serialNumber: '5',
          validFrom: new Date('2010-01-01'),
          validTo: new Date('2040-12-31'),
          publicKey: 'key5',
          signature: 'sig5',
        },
      }

      const result = await validator.validateCertificateChain(chain)

      expect(result.chainComplete).toBe(true)
      expect(result.trustPath).toHaveLength(5)
    })
  })
})

// =============================================================================
// Integration Tests - Full E-Signature Flow
// =============================================================================

describe('E-Signature Integration - Complete Workflow', () => {
  let placer: ISignaturePlacer
  let validator: ISignatureValidator
  let testPdf: Uint8Array

  beforeEach(() => {
    placer = getSignaturePlacer()
    validator = getSignatureValidator()
    testPdf = createTestPdf()
  })

  it('should place, validate, and verify a single signature', async () => {
    // Place signature
    const appearance: SignatureAppearance = {
      type: 'text',
      text: 'John Doe',
      fontFamily: 'Helvetica',
      fontSize: 14,
    }
    const coordinates: SignatureCoordinates = { x: 100, y: 200, page: 1 }

    const placeResult = await placer.placeAtCoordinates(
      testPdf,
      coordinates,
      appearance,
      'signer-1'
    )

    // Validate appearance
    const appearanceValidation = validator.validateAppearance(appearance)
    expect(appearanceValidation.valid).toBe(true)

    // Verify document integrity
    const integrityResult = await validator.verifyDocumentIntegrity(placeResult.pdf)
    expect(integrityResult.intact).toBe(true)
  })

  it('should handle multi-party signing workflow', async () => {
    const signers = [
      { id: 'signer-1', name: 'Alice', coordinates: { x: 100, y: 700, page: 1 } },
      { id: 'signer-2', name: 'Bob', coordinates: { x: 100, y: 600, page: 1 } },
      { id: 'signer-3', name: 'Charlie', coordinates: { x: 100, y: 500, page: 2 } },
    ]

    const placements = signers.map((s) => ({
      coordinates: { ...s.coordinates, width: 150, height: 50 },
      appearance: { type: 'text' as const, text: s.name },
      signerId: s.id,
    }))

    const result = await placer.placeMultiple(testPdf, placements)

    expect(result.signatures).toHaveLength(3)

    // All signatures should have unique timestamps
    const timestamps = result.signatures.map((s) => s.signedAt.getTime())
    const uniqueTimestamps = new Set(timestamps)
    expect(uniqueTimestamps.size).toBe(3)

    // Document should maintain integrity
    const integrityResult = await validator.verifyDocumentIntegrity(result.pdf)
    expect(integrityResult.intact).toBe(true)
  })

  it('should preserve signature appearance after PDF operations', async () => {
    const appearance: SignatureAppearance = {
      type: 'image',
      imageData: createTestSignatureImage(),
      backgroundColor: '#ffffff',
      borderColor: '#000000',
      borderWidth: 1,
    }
    const coordinates: SignatureCoordinates = {
      x: 100,
      y: 200,
      page: 1,
      width: 150,
      height: 50,
    }

    const result = await placer.placeAtCoordinates(testPdf, coordinates, appearance, 'signer-1')

    // Verify appearance is preserved
    expect(result.signature.appearance.type).toBe('image')
    expect(result.signature.appearance.backgroundColor).toBe('#ffffff')
    expect(result.signature.appearance.borderColor).toBe('#000000')
    expect(result.signature.appearance.borderWidth).toBe(1)
  })

  it('should create legally compliant signed document', async () => {
    // Create self-signed certificate (common for testing and internal use)
    const certificateChain: CertificateChain = {
      endEntity: {
        subject: 'CN=John Doe,O=Example Corp,C=US',
        issuer: 'CN=John Doe,O=Example Corp,C=US', // Self-signed
        serialNumber: Date.now().toString(),
        validFrom: new Date(),
        validTo: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        publicKey: 'public-key-data',
        signature: 'signature-data',
      },
      intermediates: [],
    }

    // Validate certificate chain (self-signed is valid for testing)
    const chainValidation = await validator.validateCertificateChain(certificateChain)
    expect(chainValidation.valid).toBe(true)

    // Place signature
    const appearance: SignatureAppearance = {
      type: 'text',
      text: 'John Doe',
    }
    const coordinates: SignatureCoordinates = { x: 100, y: 200, page: 1 }

    const result = await placer.placeAtCoordinates(testPdf, coordinates, appearance, 'john-doe')

    // Verify final document
    const integrityResult = await validator.verifyDocumentIntegrity(result.pdf)
    expect(integrityResult.intact).toBe(true)
  })
})

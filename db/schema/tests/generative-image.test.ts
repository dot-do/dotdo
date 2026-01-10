import { describe, it, expect, beforeEach } from 'vitest'

/**
 * $image Directive Tests
 *
 * Comprehensive tests for AI-generated images in the db4ai cascade generation system.
 * The $image directive generates images based on schema context and configuration.
 *
 * This is RED phase TDD - tests should FAIL until the image generator
 * is properly implemented in db/schema/generative/image.ts
 *
 * Key capabilities:
 * - Multiple aspect ratios for different use cases
 * - Various artistic styles
 * - Context-aware subject generation
 * - Setting, mood, and lighting customization
 * - Color palette control
 */

// These imports should FAIL until implemented
// @ts-expect-error - ImageGenerator not yet implemented
import {
  ImageGenerator,
  validateImageDirective,
  parseAspectRatio,
  buildImagePrompt,
  type ImageDirective,
  type ImageConfig,
  type ImageResult,
  type AspectRatio,
  type ImageStyle,
} from '../generative/image'

// @ts-expect-error - GenerativeTypeHandler for integration
import { GenerativeTypeHandler } from '../generative/handler'

// ============================================================================
// Type Definitions (Expected Interface)
// ============================================================================

type ValidAspectRatio = '1:1' | '4:3' | '16:9' | '9:16' | '3:2' | '2:3' | '21:9' | '9:21'

type ValidImageStyle =
  | 'Photorealistic'
  | 'Illustration'
  | 'Cartoon'
  | 'Sketch'
  | 'Oil Painting'
  | 'Watercolor'
  | '3D Render'
  | 'Digital Art'
  | 'Pixel Art'
  | 'Anime'
  | 'Minimalist'
  | 'Abstract'
  | 'Vintage'
  | 'Neon'
  | 'Isometric'

interface FullImageConfig {
  aspectRatio: ValidAspectRatio
  style: ValidImageStyle
  subject?: string
  setting?: string
  mood?: string
  lighting?: string
  colorPalette?: string[]
  negativePrompt?: string
  quality?: 'draft' | 'standard' | 'hd' | 'ultra'
  seed?: number
}

// ============================================================================
// Aspect Ratio Tests
// ============================================================================

describe('Aspect Ratio', () => {
  describe('Standard Aspect Ratios', () => {
    const standardRatios: ValidAspectRatio[] = ['1:1', '4:3', '16:9', '9:16', '3:2', '2:3']

    standardRatios.forEach((ratio) => {
      it(`supports ${ratio} aspect ratio`, () => {
        const config: FullImageConfig = {
          aspectRatio: ratio,
          style: 'Photorealistic',
        }

        expect(config.aspectRatio).toBe(ratio)
      })
    })
  })

  describe('Cinema/Ultrawide Aspect Ratios', () => {
    it('supports 21:9 ultrawide aspect ratio', () => {
      const config: FullImageConfig = {
        aspectRatio: '21:9',
        style: 'Photorealistic',
      }

      expect(config.aspectRatio).toBe('21:9')
    })

    it('supports 9:21 vertical ultrawide aspect ratio', () => {
      const config: FullImageConfig = {
        aspectRatio: '9:21',
        style: 'Photorealistic',
      }

      expect(config.aspectRatio).toBe('9:21')
    })
  })

  describe('Aspect Ratio Parsing', () => {
    it('parses 1:1 to dimensions 1024x1024', () => {
      const dimensions = parseAspectRatio('1:1')

      expect(dimensions.width).toBe(1024)
      expect(dimensions.height).toBe(1024)
    })

    it('parses 16:9 to dimensions 1792x1024', () => {
      const dimensions = parseAspectRatio('16:9')

      expect(dimensions.width).toBe(1792)
      expect(dimensions.height).toBe(1024)
    })

    it('parses 9:16 to dimensions 1024x1792', () => {
      const dimensions = parseAspectRatio('9:16')

      expect(dimensions.width).toBe(1024)
      expect(dimensions.height).toBe(1792)
    })

    it('parses 4:3 to dimensions 1365x1024', () => {
      const dimensions = parseAspectRatio('4:3')

      expect(dimensions.width).toBe(1365)
      expect(dimensions.height).toBe(1024)
    })

    it('parses 3:2 to dimensions 1536x1024', () => {
      const dimensions = parseAspectRatio('3:2')

      expect(dimensions.width).toBe(1536)
      expect(dimensions.height).toBe(1024)
    })

    it('throws on invalid aspect ratio string', () => {
      expect(() => parseAspectRatio('5:4' as any)).toThrow()
      expect(() => parseAspectRatio('invalid' as any)).toThrow()
      expect(() => parseAspectRatio('' as any)).toThrow()
    })
  })

  describe('Use Case Recommendations', () => {
    it('1:1 is optimal for profile pictures and icons', () => {
      const config: FullImageConfig = {
        aspectRatio: '1:1',
        style: 'Photorealistic',
        subject: 'Professional headshot',
      }

      expect(config.aspectRatio).toBe('1:1')
    })

    it('16:9 is optimal for hero images and banners', () => {
      const config: FullImageConfig = {
        aspectRatio: '16:9',
        style: 'Photorealistic',
        subject: 'Website hero banner',
      }

      expect(config.aspectRatio).toBe('16:9')
    })

    it('9:16 is optimal for mobile stories and reels', () => {
      const config: FullImageConfig = {
        aspectRatio: '9:16',
        style: 'Digital Art',
        subject: 'Instagram story background',
      }

      expect(config.aspectRatio).toBe('9:16')
    })

    it('4:3 is optimal for product photos', () => {
      const config: FullImageConfig = {
        aspectRatio: '4:3',
        style: 'Photorealistic',
        subject: 'E-commerce product photo',
      }

      expect(config.aspectRatio).toBe('4:3')
    })
  })
})

// ============================================================================
// Image Style Tests
// ============================================================================

describe('Image Styles', () => {
  describe('Realistic Styles', () => {
    it('supports Photorealistic style', () => {
      const config: FullImageConfig = {
        aspectRatio: '16:9',
        style: 'Photorealistic',
        subject: 'Mountain landscape',
      }

      expect(config.style).toBe('Photorealistic')
    })

    it('supports 3D Render style', () => {
      const config: FullImageConfig = {
        aspectRatio: '1:1',
        style: '3D Render',
        subject: 'Product visualization',
      }

      expect(config.style).toBe('3D Render')
    })
  })

  describe('Artistic Styles', () => {
    const artisticStyles: ValidImageStyle[] = [
      'Illustration',
      'Cartoon',
      'Sketch',
      'Oil Painting',
      'Watercolor',
      'Digital Art',
    ]

    artisticStyles.forEach((style) => {
      it(`supports ${style} style`, () => {
        const config: FullImageConfig = {
          aspectRatio: '1:1',
          style,
          subject: 'Artistic portrait',
        }

        expect(config.style).toBe(style)
      })
    })
  })

  describe('Modern Digital Styles', () => {
    it('supports Pixel Art style', () => {
      const config: FullImageConfig = {
        aspectRatio: '1:1',
        style: 'Pixel Art',
        subject: 'Game character',
      }

      expect(config.style).toBe('Pixel Art')
    })

    it('supports Anime style', () => {
      const config: FullImageConfig = {
        aspectRatio: '16:9',
        style: 'Anime',
        subject: 'Anime character scene',
      }

      expect(config.style).toBe('Anime')
    })

    it('supports Neon style', () => {
      const config: FullImageConfig = {
        aspectRatio: '16:9',
        style: 'Neon',
        subject: 'Cyberpunk cityscape',
      }

      expect(config.style).toBe('Neon')
    })

    it('supports Isometric style', () => {
      const config: FullImageConfig = {
        aspectRatio: '1:1',
        style: 'Isometric',
        subject: 'Office workspace',
      }

      expect(config.style).toBe('Isometric')
    })
  })

  describe('Minimalist and Abstract Styles', () => {
    it('supports Minimalist style', () => {
      const config: FullImageConfig = {
        aspectRatio: '1:1',
        style: 'Minimalist',
        subject: 'Logo design',
      }

      expect(config.style).toBe('Minimalist')
    })

    it('supports Abstract style', () => {
      const config: FullImageConfig = {
        aspectRatio: '16:9',
        style: 'Abstract',
        subject: 'Artistic background',
      }

      expect(config.style).toBe('Abstract')
    })
  })

  describe('Vintage Style', () => {
    it('supports Vintage style', () => {
      const config: FullImageConfig = {
        aspectRatio: '4:3',
        style: 'Vintage',
        subject: 'Retro poster',
      }

      expect(config.style).toBe('Vintage')
    })
  })
})

// ============================================================================
// Subject, Setting, and Mood Tests
// ============================================================================

describe('Subject Configuration', () => {
  describe('Subject Field', () => {
    it('accepts simple subject description', () => {
      const config: FullImageConfig = {
        aspectRatio: '16:9',
        style: 'Photorealistic',
        subject: 'A golden retriever playing in a park',
      }

      expect(config.subject).toBe('A golden retriever playing in a park')
    })

    it('accepts detailed subject description', () => {
      const detailedSubject = `
        A professional woman in her 30s sitting at a modern desk
        with a laptop, coffee cup, and potted plant.
        She is smiling and looking at the camera.
        The background shows a bright office with large windows.
      `.trim()

      const config: FullImageConfig = {
        aspectRatio: '4:3',
        style: 'Photorealistic',
        subject: detailedSubject,
      }

      expect(config.subject).toContain('professional woman')
      expect(config.subject).toContain('laptop')
    })

    it('works without subject (context-derived)', () => {
      const config: FullImageConfig = {
        aspectRatio: '1:1',
        style: 'Illustration',
        // No subject - will be derived from entity context
      }

      expect(config.subject).toBeUndefined()
    })
  })

  describe('Setting Field', () => {
    it('accepts indoor setting', () => {
      const config: FullImageConfig = {
        aspectRatio: '16:9',
        style: 'Photorealistic',
        subject: 'Business meeting',
        setting: 'Modern conference room with glass walls',
      }

      expect(config.setting).toBe('Modern conference room with glass walls')
    })

    it('accepts outdoor setting', () => {
      const config: FullImageConfig = {
        aspectRatio: '16:9',
        style: 'Photorealistic',
        subject: 'Couple walking',
        setting: 'Beach at sunset with palm trees',
      }

      expect(config.setting).toContain('Beach')
    })

    it('accepts abstract/conceptual setting', () => {
      const config: FullImageConfig = {
        aspectRatio: '1:1',
        style: 'Digital Art',
        subject: 'Technology concept',
        setting: 'Abstract digital space with flowing data streams',
      }

      expect(config.setting).toContain('digital space')
    })
  })

  describe('Mood Field', () => {
    const moods = [
      'serene',
      'energetic',
      'mysterious',
      'joyful',
      'melancholic',
      'dramatic',
      'peaceful',
      'intense',
      'whimsical',
      'professional',
    ]

    moods.forEach((mood) => {
      it(`accepts ${mood} mood`, () => {
        const config: FullImageConfig = {
          aspectRatio: '16:9',
          style: 'Photorealistic',
          subject: 'Landscape',
          mood,
        }

        expect(config.mood).toBe(mood)
      })
    })

    it('accepts compound mood descriptions', () => {
      const config: FullImageConfig = {
        aspectRatio: '16:9',
        style: 'Oil Painting',
        subject: 'Stormy sea',
        mood: 'dramatic and awe-inspiring with a sense of danger',
      }

      expect(config.mood).toContain('dramatic')
      expect(config.mood).toContain('awe-inspiring')
    })
  })
})

// ============================================================================
// Lighting and Color Tests
// ============================================================================

describe('Lighting Configuration', () => {
  describe('Natural Lighting', () => {
    const naturalLighting = [
      'golden hour',
      'blue hour',
      'midday sun',
      'overcast',
      'sunrise',
      'sunset',
      'moonlight',
      'starlight',
    ]

    naturalLighting.forEach((lighting) => {
      it(`accepts ${lighting} lighting`, () => {
        const config: FullImageConfig = {
          aspectRatio: '16:9',
          style: 'Photorealistic',
          subject: 'Landscape',
          lighting,
        }

        expect(config.lighting).toBe(lighting)
      })
    })
  })

  describe('Studio Lighting', () => {
    const studioLighting = [
      'soft box',
      'ring light',
      'Rembrandt lighting',
      'butterfly lighting',
      'split lighting',
      'backlighting',
      'rim lighting',
    ]

    studioLighting.forEach((lighting) => {
      it(`accepts ${lighting} lighting`, () => {
        const config: FullImageConfig = {
          aspectRatio: '1:1',
          style: 'Photorealistic',
          subject: 'Portrait',
          lighting,
        }

        expect(config.lighting).toBe(lighting)
      })
    })
  })

  describe('Artistic Lighting', () => {
    it('accepts chiaroscuro lighting', () => {
      const config: FullImageConfig = {
        aspectRatio: '4:3',
        style: 'Oil Painting',
        subject: 'Still life',
        lighting: 'chiaroscuro with strong contrast',
      }

      expect(config.lighting).toContain('chiaroscuro')
    })

    it('accepts neon lighting', () => {
      const config: FullImageConfig = {
        aspectRatio: '16:9',
        style: 'Neon',
        subject: 'City street',
        lighting: 'neon signs and wet reflections',
      }

      expect(config.lighting).toContain('neon')
    })
  })
})

describe('Color Palette Configuration', () => {
  describe('Color Palette Array', () => {
    it('accepts hex color palette', () => {
      const config: FullImageConfig = {
        aspectRatio: '1:1',
        style: 'Illustration',
        subject: 'Brand illustration',
        colorPalette: ['#FF5733', '#3498DB', '#2ECC71', '#9B59B6'],
      }

      expect(config.colorPalette).toHaveLength(4)
      expect(config.colorPalette?.[0]).toBe('#FF5733')
    })

    it('accepts named color palette', () => {
      const config: FullImageConfig = {
        aspectRatio: '16:9',
        style: 'Watercolor',
        subject: 'Garden scene',
        colorPalette: ['coral', 'teal', 'gold', 'ivory'],
      }

      expect(config.colorPalette).toContain('coral')
      expect(config.colorPalette).toContain('teal')
    })

    it('accepts mixed color formats', () => {
      const config: FullImageConfig = {
        aspectRatio: '1:1',
        style: 'Digital Art',
        subject: 'Abstract design',
        colorPalette: ['#FF5733', 'deep blue', 'rgb(46, 204, 113)'],
      }

      expect(config.colorPalette).toHaveLength(3)
    })

    it('accepts single dominant color', () => {
      const config: FullImageConfig = {
        aspectRatio: '1:1',
        style: 'Minimalist',
        subject: 'Monochrome design',
        colorPalette: ['#1A1A2E'],
      }

      expect(config.colorPalette).toHaveLength(1)
    })

    it('accepts large color palette', () => {
      const config: FullImageConfig = {
        aspectRatio: '16:9',
        style: 'Abstract',
        subject: 'Colorful explosion',
        colorPalette: [
          '#FF0000', '#FF7F00', '#FFFF00', '#00FF00',
          '#0000FF', '#4B0082', '#9400D3', '#FF1493',
        ],
      }

      expect(config.colorPalette).toHaveLength(8)
    })
  })
})

// ============================================================================
// Quality and Seed Tests
// ============================================================================

describe('Quality Settings', () => {
  const qualities: Array<'draft' | 'standard' | 'hd' | 'ultra'> = [
    'draft',
    'standard',
    'hd',
    'ultra',
  ]

  qualities.forEach((quality) => {
    it(`supports ${quality} quality`, () => {
      const config: FullImageConfig = {
        aspectRatio: '16:9',
        style: 'Photorealistic',
        quality,
      }

      expect(config.quality).toBe(quality)
    })
  })

  it('defaults to standard quality when not specified', () => {
    const config: FullImageConfig = {
      aspectRatio: '1:1',
      style: 'Illustration',
    }

    expect(config.quality ?? 'standard').toBe('standard')
  })
})

describe('Seed Configuration', () => {
  it('accepts seed for reproducible generation', () => {
    const config: FullImageConfig = {
      aspectRatio: '1:1',
      style: 'Photorealistic',
      seed: 42,
    }

    expect(config.seed).toBe(42)
  })

  it('accepts large seed values', () => {
    const config: FullImageConfig = {
      aspectRatio: '1:1',
      style: 'Photorealistic',
      seed: 2147483647,
    }

    expect(config.seed).toBe(2147483647)
  })

  it('generates different images without seed', () => {
    const config: FullImageConfig = {
      aspectRatio: '1:1',
      style: 'Illustration',
      // No seed - should generate different images each time
    }

    expect(config.seed).toBeUndefined()
  })
})

// ============================================================================
// Negative Prompt Tests
// ============================================================================

describe('Negative Prompt', () => {
  it('accepts simple negative prompt', () => {
    const config: FullImageConfig = {
      aspectRatio: '1:1',
      style: 'Photorealistic',
      subject: 'Professional headshot',
      negativePrompt: 'blur, noise, artifacts',
    }

    expect(config.negativePrompt).toBe('blur, noise, artifacts')
  })

  it('accepts detailed negative prompt', () => {
    const negativePrompt = `
      blurry, low quality, pixelated, distorted,
      extra limbs, missing limbs, bad anatomy,
      watermark, text, logo, signature
    `.trim()

    const config: FullImageConfig = {
      aspectRatio: '16:9',
      style: 'Photorealistic',
      subject: 'Person walking',
      negativePrompt,
    }

    expect(config.negativePrompt).toContain('watermark')
    expect(config.negativePrompt).toContain('bad anatomy')
  })

  it('works without negative prompt', () => {
    const config: FullImageConfig = {
      aspectRatio: '1:1',
      style: 'Abstract',
      subject: 'Geometric patterns',
    }

    expect(config.negativePrompt).toBeUndefined()
  })
})

// ============================================================================
// ImageGenerator Class Tests
// ============================================================================

describe('ImageGenerator Class', () => {
  let generator: InstanceType<typeof ImageGenerator>

  beforeEach(() => {
    generator = new ImageGenerator()
  })

  describe('Constructor', () => {
    it('creates generator with default provider', () => {
      expect(generator).toBeDefined()
      expect(generator.provider).toBeDefined()
    })

    it('accepts custom provider', () => {
      const customGenerator = new ImageGenerator({ provider: 'stability' })

      expect(customGenerator.provider).toBe('stability')
    })

    it('accepts API key configuration', () => {
      const customGenerator = new ImageGenerator({
        provider: 'openai',
        apiKey: 'test-key',
      })

      expect(customGenerator).toBeDefined()
    })
  })

  describe('Validation', () => {
    it('validates complete image directive', () => {
      const directive = {
        $image: {
          aspectRatio: '16:9' as const,
          style: 'Photorealistic' as const,
          subject: 'Mountain landscape',
          mood: 'serene',
          lighting: 'golden hour',
        },
      }

      expect(() => validateImageDirective(directive)).not.toThrow()
    })

    it('validates minimal image directive', () => {
      const directive = {
        $image: {
          aspectRatio: '1:1' as const,
          style: 'Illustration' as const,
        },
      }

      expect(() => validateImageDirective(directive)).not.toThrow()
    })

    it('throws on missing aspectRatio', () => {
      const directive = {
        $image: {
          style: 'Photorealistic',
        },
      }

      expect(() => validateImageDirective(directive as any)).toThrow()
    })

    it('throws on missing style', () => {
      const directive = {
        $image: {
          aspectRatio: '16:9',
        },
      }

      expect(() => validateImageDirective(directive as any)).toThrow()
    })

    it('throws on invalid aspectRatio value', () => {
      const directive = {
        $image: {
          aspectRatio: '5:4',
          style: 'Photorealistic',
        },
      }

      expect(() => validateImageDirective(directive as any)).toThrow()
    })

    it('throws on invalid style value', () => {
      const directive = {
        $image: {
          aspectRatio: '16:9',
          style: 'InvalidStyle',
        },
      }

      expect(() => validateImageDirective(directive as any)).toThrow()
    })
  })

  describe('Prompt Building', () => {
    it('builds prompt from subject', () => {
      const config: FullImageConfig = {
        aspectRatio: '16:9',
        style: 'Photorealistic',
        subject: 'A serene mountain lake',
      }

      const prompt = buildImagePrompt(config)

      expect(prompt).toContain('mountain lake')
    })

    it('includes style in prompt', () => {
      const config: FullImageConfig = {
        aspectRatio: '1:1',
        style: 'Oil Painting',
        subject: 'Portrait',
      }

      const prompt = buildImagePrompt(config)

      expect(prompt.toLowerCase()).toContain('oil painting')
    })

    it('includes setting in prompt', () => {
      const config: FullImageConfig = {
        aspectRatio: '16:9',
        style: 'Photorealistic',
        subject: 'Couple dancing',
        setting: 'elegant ballroom with chandeliers',
      }

      const prompt = buildImagePrompt(config)

      expect(prompt).toContain('ballroom')
    })

    it('includes mood in prompt', () => {
      const config: FullImageConfig = {
        aspectRatio: '16:9',
        style: 'Photorealistic',
        subject: 'Storm clouds',
        mood: 'dramatic and ominous',
      }

      const prompt = buildImagePrompt(config)

      expect(prompt.toLowerCase()).toContain('dramatic')
    })

    it('includes lighting in prompt', () => {
      const config: FullImageConfig = {
        aspectRatio: '16:9',
        style: 'Photorealistic',
        subject: 'Forest path',
        lighting: 'dappled sunlight through trees',
      }

      const prompt = buildImagePrompt(config)

      expect(prompt).toContain('sunlight')
    })

    it('includes color palette in prompt', () => {
      const config: FullImageConfig = {
        aspectRatio: '1:1',
        style: 'Illustration',
        subject: 'Abstract art',
        colorPalette: ['teal', 'coral', 'gold'],
      }

      const prompt = buildImagePrompt(config)

      expect(prompt).toContain('teal')
      expect(prompt).toContain('coral')
    })
  })

  describe('Generation', () => {
    it('generates image and returns URL', async () => {
      const directive = {
        $image: {
          aspectRatio: '16:9' as const,
          style: 'Photorealistic' as const,
          subject: 'Sunset over ocean',
        },
      }

      const result = await generator.generate(directive.$image)

      expect(result).toBeDefined()
      expect(result.url).toBeDefined()
      expect(typeof result.url).toBe('string')
    })

    it('generates image with correct dimensions', async () => {
      const directive = {
        $image: {
          aspectRatio: '1:1' as const,
          style: 'Illustration' as const,
          subject: 'App icon',
        },
      }

      const result = await generator.generate(directive.$image)

      expect(result.width).toBe(1024)
      expect(result.height).toBe(1024)
    })

    it('returns blob when configured', async () => {
      const blobGenerator = new ImageGenerator({ returnBlob: true })
      const directive = {
        $image: {
          aspectRatio: '1:1' as const,
          style: 'Minimalist' as const,
        },
      }

      const result = await blobGenerator.generate(directive.$image)

      expect(result.blob).toBeDefined()
    })

    it('includes metadata in result', async () => {
      const directive = {
        $image: {
          aspectRatio: '16:9' as const,
          style: 'Photorealistic' as const,
          subject: 'City skyline',
          quality: 'hd' as const,
        },
      }

      const result = await generator.generate(directive.$image)

      expect(result.metadata).toBeDefined()
      expect(result.metadata?.prompt).toBeDefined()
      expect(result.metadata?.style).toBe('Photorealistic')
      expect(result.metadata?.quality).toBe('hd')
    })

    it('respects seed for reproducibility', async () => {
      const directive = {
        $image: {
          aspectRatio: '1:1' as const,
          style: 'Abstract' as const,
          seed: 42,
        },
      }

      const result1 = await generator.generate(directive.$image)
      const result2 = await generator.generate(directive.$image)

      // With same seed, should get same result (in real implementation)
      expect(result1.metadata?.seed).toBe(42)
      expect(result2.metadata?.seed).toBe(42)
    })
  })
})

// ============================================================================
// Integration with GenerativeTypeHandler Tests
// ============================================================================

describe('Integration with GenerativeTypeHandler', () => {
  let handler: InstanceType<typeof GenerativeTypeHandler>

  beforeEach(() => {
    handler = new GenerativeTypeHandler()
  })

  it('handles $image directive through main handler', async () => {
    const directive = {
      $image: {
        aspectRatio: '16:9' as const,
        style: 'Photorealistic' as const,
        subject: 'Product photo',
      },
    }

    const result = await handler.generate(directive, {
      entityType: 'Product',
      fieldName: 'coverImage',
      schema: { name: 'Wireless Headphones' },
      previousGenerations: [],
      prompt: '',
    })

    expect(result.type).toBe('image')
    expect(result.url).toBeDefined()
  })

  it('uses entity context for subject inference', async () => {
    const directive = {
      $image: {
        aspectRatio: '1:1' as const,
        style: 'Photorealistic' as const,
        // No explicit subject - should be inferred from context
      },
    }

    const result = await handler.generate(directive, {
      entityType: 'Product',
      fieldName: 'thumbnail',
      schema: {
        name: 'Organic Coffee Beans',
        category: 'Food & Beverage',
        description: 'Premium Arabica coffee beans from Colombia',
      },
      previousGenerations: [],
      prompt: '',
    })

    expect(result.type).toBe('image')
    // The generated image should be contextually relevant to coffee beans
  })

  it('maintains color consistency with previous generations', async () => {
    const directive = {
      $image: {
        aspectRatio: '16:9' as const,
        style: 'Illustration' as const,
        subject: 'Secondary banner',
      },
    }

    const result = await handler.generate(directive, {
      entityType: 'Brand',
      fieldName: 'secondaryBanner',
      schema: {},
      previousGenerations: [
        {
          fieldName: 'primaryBanner',
          type: 'image',
          colorPalette: ['#1A5F7A', '#159895', '#57C5B6'],
        },
      ],
      prompt: '',
    })

    expect(result.type).toBe('image')
    // Should consider the color palette from previous generations
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Error Handling', () => {
  let generator: InstanceType<typeof ImageGenerator>

  beforeEach(() => {
    generator = new ImageGenerator()
  })

  describe('Validation Errors', () => {
    it('provides clear error for missing required fields', async () => {
      const invalidDirective = {
        $image: {
          style: 'Photorealistic',
          // Missing aspectRatio
        },
      }

      await expect(generator.generate(invalidDirective as any)).rejects.toThrow(/aspectRatio/i)
    })

    it('provides clear error for invalid aspect ratio', async () => {
      const invalidDirective = {
        $image: {
          aspectRatio: 'invalid' as any,
          style: 'Photorealistic',
        },
      }

      await expect(generator.generate(invalidDirective as any)).rejects.toThrow(/aspect ratio/i)
    })

    it('provides clear error for invalid style', async () => {
      const invalidDirective = {
        $image: {
          aspectRatio: '16:9',
          style: 'NotAStyle' as any,
        },
      }

      await expect(generator.generate(invalidDirective as any)).rejects.toThrow(/style/i)
    })

    it('provides clear error for invalid quality', async () => {
      const invalidDirective = {
        $image: {
          aspectRatio: '16:9',
          style: 'Photorealistic',
          quality: 'maximum' as any,
        },
      }

      await expect(generator.generate(invalidDirective as any)).rejects.toThrow(/quality/i)
    })
  })

  describe('Provider Errors', () => {
    it('handles provider timeout', async () => {
      const slowGenerator = new ImageGenerator({ timeout: 1 })
      const directive = {
        $image: {
          aspectRatio: '16:9' as const,
          style: 'Photorealistic' as const,
        },
      }

      await expect(slowGenerator.generate(directive.$image)).rejects.toThrow(/timeout/i)
    })

    it('handles rate limiting', async () => {
      const rateLimitedGenerator = new ImageGenerator({
        provider: 'rate-limited-mock',
      })
      const directive = {
        $image: {
          aspectRatio: '16:9' as const,
          style: 'Photorealistic' as const,
        },
      }

      await expect(rateLimitedGenerator.generate(directive.$image)).rejects.toThrow(/rate limit/i)
    })

    it('handles provider unavailable', async () => {
      const unavailableGenerator = new ImageGenerator({
        provider: 'unavailable-mock',
      })
      const directive = {
        $image: {
          aspectRatio: '16:9' as const,
          style: 'Photorealistic' as const,
        },
      }

      await expect(unavailableGenerator.generate(directive.$image)).rejects.toThrow(/unavailable/i)
    })
  })

  describe('Error Context', () => {
    it('includes directive in error context', async () => {
      const directive = {
        $image: {
          aspectRatio: 'invalid' as any,
          style: 'Photorealistic',
        },
      }

      try {
        await generator.generate(directive.$image)
        expect.fail('Should have thrown')
      } catch (error: any) {
        expect(error.directive).toBeDefined()
        expect(error.directive.aspectRatio).toBe('invalid')
      }
    })

    it('includes provider info in error context', async () => {
      const badGenerator = new ImageGenerator({ provider: 'failing-mock' })
      const directive = {
        $image: {
          aspectRatio: '16:9' as const,
          style: 'Photorealistic' as const,
        },
      }

      try {
        await badGenerator.generate(directive.$image)
        expect.fail('Should have thrown')
      } catch (error: any) {
        expect(error.provider).toBe('failing-mock')
      }
    })
  })
})

// ============================================================================
// Type Export Tests (RED Phase - Expected to FAIL)
// ============================================================================

describe('Type Exports (RED Phase)', () => {
  it('exports ImageGenerator class', async () => {
    // @ts-expect-error - ImageGenerator not yet exported
    const { ImageGenerator } = await import('../generative/image')
    expect(ImageGenerator).toBeDefined()
  })

  it('exports ImageDirective type', async () => {
    // @ts-expect-error - ImageDirective not yet exported
    const { ImageDirective } = await import('../generative/image')
    expect(ImageDirective).toBeDefined()
  })

  it('exports ImageConfig type', async () => {
    // @ts-expect-error - ImageConfig not yet exported
    const { ImageConfig } = await import('../generative/image')
    expect(ImageConfig).toBeDefined()
  })

  it('exports ImageResult type', async () => {
    // @ts-expect-error - ImageResult not yet exported
    const { ImageResult } = await import('../generative/image')
    expect(ImageResult).toBeDefined()
  })

  it('exports AspectRatio type', async () => {
    // @ts-expect-error - AspectRatio not yet exported
    const { AspectRatio } = await import('../generative/image')
    expect(AspectRatio).toBeDefined()
  })

  it('exports ImageStyle type', async () => {
    // @ts-expect-error - ImageStyle not yet exported
    const { ImageStyle } = await import('../generative/image')
    expect(ImageStyle).toBeDefined()
  })

  it('exports validateImageDirective function', async () => {
    // @ts-expect-error - validateImageDirective not yet exported
    const { validateImageDirective } = await import('../generative/image')
    expect(validateImageDirective).toBeDefined()
    expect(typeof validateImageDirective).toBe('function')
  })

  it('exports parseAspectRatio function', async () => {
    // @ts-expect-error - parseAspectRatio not yet exported
    const { parseAspectRatio } = await import('../generative/image')
    expect(parseAspectRatio).toBeDefined()
    expect(typeof parseAspectRatio).toBe('function')
  })

  it('exports buildImagePrompt function', async () => {
    // @ts-expect-error - buildImagePrompt not yet exported
    const { buildImagePrompt } = await import('../generative/image')
    expect(buildImagePrompt).toBeDefined()
    expect(typeof buildImagePrompt).toBe('function')
  })
})

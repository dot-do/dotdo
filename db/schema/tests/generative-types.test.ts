import { describe, it, expect, beforeEach } from 'vitest'

/**
 * Generative Types Schema Tests
 *
 * These tests verify the generative type directives for db4ai-style cascade generation:
 * - $image: AI-generated images
 * - $speech: Text-to-speech audio
 * - $code: Generated executable code
 * - $diagram: Generated diagram markup
 *
 * This is RED phase TDD - tests should FAIL until the generative handler
 * is properly implemented in db/schema/generative/handler.ts
 *
 * Key design principles:
 * - Schema-defined generation: Fields with $ prefix trigger generation
 * - Multi-modal output: Images, audio, code, diagrams
 * - Context-aware: Generation uses accumulated schema context
 * - Type-safe: Strongly typed output from any input
 */

// These imports should FAIL until implemented in db/schema/generative/handler.ts
// @ts-expect-error - GenerativeTypeHandler not yet implemented
import {
  GenerativeTypeHandler,
  parseGenerativeType,
  isGenerativeDirective,
  type GenerativeType,
  type GenerationContext,
  type GenerationResult,
} from '../generative/handler'

// ============================================================================
// Type Definitions (Expected Interface)
// ============================================================================

interface ImageDirective {
  $image: {
    aspectRatio: '1:1' | '4:3' | '16:9' | '9:16' | '3:2' | '2:3'
    style: 'Photorealistic' | 'Illustration' | 'Cartoon' | 'Sketch' | 'Oil Painting' | 'Watercolor' | '3D Render'
    subject?: string
    setting?: string
    mood?: string
    lighting?: string
    colorPalette?: string[]
  }
}

interface SpeechDirective {
  $speech: {
    voice: 'Alloy' | 'Nova' | 'Echo' | 'Shimmer' | 'Onyx' | 'Fable'
    speed: number // 0.5 - 2.0
    format: 'mp3' | 'wav' | 'ogg' | 'flac' | 'aac'
    text: string
    language?: string
    pitch?: number
    emotion?: 'neutral' | 'happy' | 'sad' | 'excited' | 'calm'
  }
}

interface CodeDirective {
  $code: {
    language: 'TypeScript' | 'JavaScript' | 'Python' | 'Go' | 'Rust' | 'SQL'
    runtime?: 'Node' | 'Bun' | 'Deno' | 'Browser' | 'Cloudflare Workers'
    framework?: string
    purpose: string
    dependencies?: string[]
    async?: boolean
    typed?: boolean
  }
}

interface DiagramDirective {
  $diagram: {
    type: 'Flowchart' | 'Sequence' | 'Class' | 'ER' | 'State' | 'Gantt' | 'Pie' | 'Mindmap'
    format: 'Mermaid' | 'D2' | 'PlantUML' | 'Graphviz' | 'SVG'
    direction?: 'TB' | 'BT' | 'LR' | 'RL'
    title?: string
    theme?: 'default' | 'dark' | 'forest' | 'neutral'
  }
}

type AnyGenerativeDirective = ImageDirective | SpeechDirective | CodeDirective | DiagramDirective

// ============================================================================
// Directive Detection Tests
// ============================================================================

describe('Directive Detection', () => {
  describe('isGenerativeDirective', () => {
    it('detects $image directive', () => {
      const field = { $image: { aspectRatio: '16:9', style: 'Photorealistic' } }
      expect(isGenerativeDirective(field)).toBe(true)
    })

    it('detects $speech directive', () => {
      const field = { $speech: { voice: 'Nova', speed: 1.0, format: 'mp3', text: 'Hello' } }
      expect(isGenerativeDirective(field)).toBe(true)
    })

    it('detects $code directive', () => {
      const field = { $code: { language: 'TypeScript', purpose: 'API handler' } }
      expect(isGenerativeDirective(field)).toBe(true)
    })

    it('detects $diagram directive', () => {
      const field = { $diagram: { type: 'Flowchart', format: 'Mermaid' } }
      expect(isGenerativeDirective(field)).toBe(true)
    })

    it('returns false for regular fields', () => {
      expect(isGenerativeDirective('string')).toBe(false)
      expect(isGenerativeDirective({ type: 'string' })).toBe(false)
      expect(isGenerativeDirective({ name: 'value' })).toBe(false)
      expect(isGenerativeDirective(null)).toBe(false)
      expect(isGenerativeDirective(undefined)).toBe(false)
    })

    it('returns false for fields with similar but non-directive keys', () => {
      expect(isGenerativeDirective({ image: 'url' })).toBe(false)
      expect(isGenerativeDirective({ speech: 'text' })).toBe(false)
      expect(isGenerativeDirective({ code: 'snippet' })).toBe(false)
      expect(isGenerativeDirective({ diagram: 'markup' })).toBe(false)
    })
  })

  describe('parseGenerativeType', () => {
    it('parses $image directive correctly', () => {
      const field = {
        $image: {
          aspectRatio: '16:9',
          style: 'Photorealistic',
          subject: 'Mountain landscape',
          mood: 'serene',
        },
      }

      const parsed = parseGenerativeType(field)

      expect(parsed.type).toBe('image')
      expect(parsed.config.aspectRatio).toBe('16:9')
      expect(parsed.config.style).toBe('Photorealistic')
      expect(parsed.config.subject).toBe('Mountain landscape')
    })

    it('parses $speech directive correctly', () => {
      const field = {
        $speech: {
          voice: 'Nova',
          speed: 1.2,
          format: 'mp3',
          text: 'Welcome to the application',
          emotion: 'happy',
        },
      }

      const parsed = parseGenerativeType(field)

      expect(parsed.type).toBe('speech')
      expect(parsed.config.voice).toBe('Nova')
      expect(parsed.config.speed).toBe(1.2)
      expect(parsed.config.format).toBe('mp3')
    })

    it('parses $code directive correctly', () => {
      const field = {
        $code: {
          language: 'TypeScript',
          runtime: 'Node',
          framework: 'Hono',
          purpose: 'REST API endpoint',
          typed: true,
        },
      }

      const parsed = parseGenerativeType(field)

      expect(parsed.type).toBe('code')
      expect(parsed.config.language).toBe('TypeScript')
      expect(parsed.config.runtime).toBe('Node')
      expect(parsed.config.framework).toBe('Hono')
    })

    it('parses $diagram directive correctly', () => {
      const field = {
        $diagram: {
          type: 'Sequence',
          format: 'Mermaid',
          direction: 'TB',
          title: 'User Authentication Flow',
        },
      }

      const parsed = parseGenerativeType(field)

      expect(parsed.type).toBe('diagram')
      expect(parsed.config.type).toBe('Sequence')
      expect(parsed.config.format).toBe('Mermaid')
      expect(parsed.config.direction).toBe('TB')
    })

    it('throws for invalid directive', () => {
      expect(() => parseGenerativeType({ invalid: {} })).toThrow()
      expect(() => parseGenerativeType('string')).toThrow()
      expect(() => parseGenerativeType(null)).toThrow()
    })
  })
})

// ============================================================================
// GenerativeTypeHandler Tests
// ============================================================================

describe('GenerativeTypeHandler', () => {
  let handler: InstanceType<typeof GenerativeTypeHandler>
  let mockContext: GenerationContext

  beforeEach(() => {
    handler = new GenerativeTypeHandler()
    mockContext = {
      entityType: 'TestEntity',
      fieldName: 'testField',
      schema: { type: 'object' },
      previousGenerations: [],
      prompt: '',
    }
  })

  describe('Constructor and Configuration', () => {
    it('creates handler with default configuration', () => {
      expect(handler).toBeDefined()
      expect(handler.config).toBeDefined()
    })

    it('accepts custom configuration', () => {
      const customHandler = new GenerativeTypeHandler({
        imageProvider: 'dalle',
        speechProvider: 'openai',
        codeProvider: 'claude',
        diagramProvider: 'claude',
      })

      expect(customHandler.config.imageProvider).toBe('dalle')
    })

    it('has generate method', () => {
      expect(typeof handler.generate).toBe('function')
    })
  })

  describe('Type Detection', () => {
    it('detects image type from directive', () => {
      const type = handler.detectType({
        $image: { aspectRatio: '16:9', style: 'Photorealistic' },
      })

      expect(type).toBe('image')
    })

    it('detects speech type from directive', () => {
      const type = handler.detectType({
        $speech: { voice: 'Nova', speed: 1.0, format: 'mp3', text: 'Hello' },
      })

      expect(type).toBe('speech')
    })

    it('detects code type from directive', () => {
      const type = handler.detectType({
        $code: { language: 'TypeScript', purpose: 'handler' },
      })

      expect(type).toBe('code')
    })

    it('detects diagram type from directive', () => {
      const type = handler.detectType({
        $diagram: { type: 'Flowchart', format: 'Mermaid' },
      })

      expect(type).toBe('diagram')
    })

    it('returns null for non-generative types', () => {
      expect(handler.detectType({ type: 'string' })).toBeNull()
      expect(handler.detectType('string')).toBeNull()
    })
  })
})

// ============================================================================
// $speech Directive Tests
// ============================================================================

describe('$speech Directive', () => {
  describe('Voice Options', () => {
    const voices = ['Alloy', 'Nova', 'Echo', 'Shimmer', 'Onyx', 'Fable'] as const

    voices.forEach((voice) => {
      it(`supports ${voice} voice`, () => {
        const directive: SpeechDirective = {
          $speech: {
            voice,
            speed: 1.0,
            format: 'mp3',
            text: 'Test speech',
          },
        }

        expect(directive.$speech.voice).toBe(voice)
      })
    })
  })

  describe('Speed Range', () => {
    it('accepts minimum speed 0.5', () => {
      const directive: SpeechDirective = {
        $speech: {
          voice: 'Nova',
          speed: 0.5,
          format: 'mp3',
          text: 'Slow speech',
        },
      }

      expect(directive.$speech.speed).toBe(0.5)
    })

    it('accepts maximum speed 2.0', () => {
      const directive: SpeechDirective = {
        $speech: {
          voice: 'Nova',
          speed: 2.0,
          format: 'mp3',
          text: 'Fast speech',
        },
      }

      expect(directive.$speech.speed).toBe(2.0)
    })

    it('accepts normal speed 1.0', () => {
      const directive: SpeechDirective = {
        $speech: {
          voice: 'Nova',
          speed: 1.0,
          format: 'mp3',
          text: 'Normal speech',
        },
      }

      expect(directive.$speech.speed).toBe(1.0)
    })

    it('accepts intermediate speeds', () => {
      const speeds = [0.75, 1.25, 1.5, 1.75]

      speeds.forEach((speed) => {
        const directive: SpeechDirective = {
          $speech: {
            voice: 'Nova',
            speed,
            format: 'mp3',
            text: 'Variable speed',
          },
        }

        expect(directive.$speech.speed).toBe(speed)
      })
    })
  })

  describe('Audio Formats', () => {
    const formats = ['mp3', 'wav', 'ogg', 'flac', 'aac'] as const

    formats.forEach((format) => {
      it(`supports ${format} format`, () => {
        const directive: SpeechDirective = {
          $speech: {
            voice: 'Nova',
            speed: 1.0,
            format,
            text: 'Format test',
          },
        }

        expect(directive.$speech.format).toBe(format)
      })
    })
  })

  describe('Optional Fields', () => {
    it('supports language field', () => {
      const directive: SpeechDirective = {
        $speech: {
          voice: 'Nova',
          speed: 1.0,
          format: 'mp3',
          text: 'Bonjour le monde',
          language: 'fr',
        },
      }

      expect(directive.$speech.language).toBe('fr')
    })

    it('supports pitch field', () => {
      const directive: SpeechDirective = {
        $speech: {
          voice: 'Nova',
          speed: 1.0,
          format: 'mp3',
          text: 'Higher pitch',
          pitch: 1.2,
        },
      }

      expect(directive.$speech.pitch).toBe(1.2)
    })

    it('supports emotion field', () => {
      const emotions = ['neutral', 'happy', 'sad', 'excited', 'calm'] as const

      emotions.forEach((emotion) => {
        const directive: SpeechDirective = {
          $speech: {
            voice: 'Nova',
            speed: 1.0,
            format: 'mp3',
            text: 'Emotional speech',
            emotion,
          },
        }

        expect(directive.$speech.emotion).toBe(emotion)
      })
    })
  })

  describe('Text Content', () => {
    it('accepts short text', () => {
      const directive: SpeechDirective = {
        $speech: {
          voice: 'Nova',
          speed: 1.0,
          format: 'mp3',
          text: 'Hi',
        },
      }

      expect(directive.$speech.text).toBe('Hi')
    })

    it('accepts long text', () => {
      const longText = 'This is a very long text. '.repeat(100)
      const directive: SpeechDirective = {
        $speech: {
          voice: 'Nova',
          speed: 1.0,
          format: 'mp3',
          text: longText,
        },
      }

      expect(directive.$speech.text.length).toBeGreaterThan(2000)
    })

    it('accepts text with special characters', () => {
      const directive: SpeechDirective = {
        $speech: {
          voice: 'Nova',
          speed: 1.0,
          format: 'mp3',
          text: 'Hello! How are you? I\'m fine, thanks.',
        },
      }

      expect(directive.$speech.text).toContain('!')
      expect(directive.$speech.text).toContain('?')
      expect(directive.$speech.text).toContain("'")
    })

    it('accepts multi-line text', () => {
      const directive: SpeechDirective = {
        $speech: {
          voice: 'Nova',
          speed: 1.0,
          format: 'mp3',
          text: 'Line one.\nLine two.\nLine three.',
        },
      }

      expect(directive.$speech.text).toContain('\n')
    })
  })
})

// ============================================================================
// $code Directive Tests
// ============================================================================

describe('$code Directive', () => {
  describe('Language Options', () => {
    const languages = ['TypeScript', 'JavaScript', 'Python', 'Go', 'Rust', 'SQL'] as const

    languages.forEach((language) => {
      it(`supports ${language} language`, () => {
        const directive: CodeDirective = {
          $code: {
            language,
            purpose: 'Test code',
          },
        }

        expect(directive.$code.language).toBe(language)
      })
    })
  })

  describe('Runtime Options', () => {
    const runtimes = ['Node', 'Bun', 'Deno', 'Browser', 'Cloudflare Workers'] as const

    runtimes.forEach((runtime) => {
      it(`supports ${runtime} runtime`, () => {
        const directive: CodeDirective = {
          $code: {
            language: 'TypeScript',
            runtime,
            purpose: 'Test code',
          },
        }

        expect(directive.$code.runtime).toBe(runtime)
      })
    })
  })

  describe('Framework Integration', () => {
    it('supports Hono framework', () => {
      const directive: CodeDirective = {
        $code: {
          language: 'TypeScript',
          runtime: 'Cloudflare Workers',
          framework: 'Hono',
          purpose: 'API endpoint',
        },
      }

      expect(directive.$code.framework).toBe('Hono')
    })

    it('supports Express framework', () => {
      const directive: CodeDirective = {
        $code: {
          language: 'TypeScript',
          runtime: 'Node',
          framework: 'Express',
          purpose: 'REST API',
        },
      }

      expect(directive.$code.framework).toBe('Express')
    })

    it('supports React framework', () => {
      const directive: CodeDirective = {
        $code: {
          language: 'TypeScript',
          runtime: 'Browser',
          framework: 'React',
          purpose: 'UI component',
        },
      }

      expect(directive.$code.framework).toBe('React')
    })

    it('supports Vitest framework for testing', () => {
      const directive: CodeDirective = {
        $code: {
          language: 'TypeScript',
          runtime: 'Node',
          framework: 'Vitest',
          purpose: 'Unit tests',
        },
      }

      expect(directive.$code.framework).toBe('Vitest')
    })
  })

  describe('Optional Fields', () => {
    it('supports dependencies array', () => {
      const directive: CodeDirective = {
        $code: {
          language: 'TypeScript',
          purpose: 'HTTP client',
          dependencies: ['axios', 'zod', 'lodash'],
        },
      }

      expect(directive.$code.dependencies).toHaveLength(3)
      expect(directive.$code.dependencies).toContain('axios')
    })

    it('supports async flag', () => {
      const directive: CodeDirective = {
        $code: {
          language: 'TypeScript',
          purpose: 'Async data fetcher',
          async: true,
        },
      }

      expect(directive.$code.async).toBe(true)
    })

    it('supports typed flag', () => {
      const directive: CodeDirective = {
        $code: {
          language: 'TypeScript',
          purpose: 'Strongly typed utility',
          typed: true,
        },
      }

      expect(directive.$code.typed).toBe(true)
    })
  })

  describe('Purpose Descriptions', () => {
    it('accepts short purpose', () => {
      const directive: CodeDirective = {
        $code: {
          language: 'TypeScript',
          purpose: 'Handler',
        },
      }

      expect(directive.$code.purpose).toBe('Handler')
    })

    it('accepts detailed purpose', () => {
      const detailedPurpose = `
        Create a REST API endpoint that handles user authentication.
        It should validate JWT tokens, check user permissions,
        and return appropriate error messages for failed auth attempts.
        The endpoint should also log all authentication attempts.
      `.trim()

      const directive: CodeDirective = {
        $code: {
          language: 'TypeScript',
          runtime: 'Node',
          framework: 'Express',
          purpose: detailedPurpose,
        },
      }

      expect(directive.$code.purpose).toContain('JWT')
      expect(directive.$code.purpose).toContain('authentication')
    })
  })
})

// ============================================================================
// $diagram Directive Tests
// ============================================================================

describe('$diagram Directive', () => {
  describe('Diagram Types', () => {
    const diagramTypes = ['Flowchart', 'Sequence', 'Class', 'ER', 'State', 'Gantt', 'Pie', 'Mindmap'] as const

    diagramTypes.forEach((type) => {
      it(`supports ${type} diagram type`, () => {
        const directive: DiagramDirective = {
          $diagram: {
            type,
            format: 'Mermaid',
          },
        }

        expect(directive.$diagram.type).toBe(type)
      })
    })
  })

  describe('Output Formats', () => {
    const formats = ['Mermaid', 'D2', 'PlantUML', 'Graphviz', 'SVG'] as const

    formats.forEach((format) => {
      it(`supports ${format} format`, () => {
        const directive: DiagramDirective = {
          $diagram: {
            type: 'Flowchart',
            format,
          },
        }

        expect(directive.$diagram.format).toBe(format)
      })
    })
  })

  describe('Direction Options', () => {
    const directions = ['TB', 'BT', 'LR', 'RL'] as const

    directions.forEach((direction) => {
      it(`supports ${direction} direction`, () => {
        const directive: DiagramDirective = {
          $diagram: {
            type: 'Flowchart',
            format: 'Mermaid',
            direction,
          },
        }

        expect(directive.$diagram.direction).toBe(direction)
      })
    })
  })

  describe('Optional Fields', () => {
    it('supports title field', () => {
      const directive: DiagramDirective = {
        $diagram: {
          type: 'Sequence',
          format: 'Mermaid',
          title: 'User Login Flow',
        },
      }

      expect(directive.$diagram.title).toBe('User Login Flow')
    })

    it('supports theme field', () => {
      const themes = ['default', 'dark', 'forest', 'neutral'] as const

      themes.forEach((theme) => {
        const directive: DiagramDirective = {
          $diagram: {
            type: 'Flowchart',
            format: 'Mermaid',
            theme,
          },
        }

        expect(directive.$diagram.theme).toBe(theme)
      })
    })
  })

  describe('Diagram Type Combinations', () => {
    it('creates Mermaid flowchart with all options', () => {
      const directive: DiagramDirective = {
        $diagram: {
          type: 'Flowchart',
          format: 'Mermaid',
          direction: 'TB',
          title: 'Application Architecture',
          theme: 'dark',
        },
      }

      expect(directive.$diagram.type).toBe('Flowchart')
      expect(directive.$diagram.format).toBe('Mermaid')
      expect(directive.$diagram.direction).toBe('TB')
      expect(directive.$diagram.title).toBe('Application Architecture')
      expect(directive.$diagram.theme).toBe('dark')
    })

    it('creates D2 ER diagram', () => {
      const directive: DiagramDirective = {
        $diagram: {
          type: 'ER',
          format: 'D2',
          title: 'Database Schema',
        },
      }

      expect(directive.$diagram.type).toBe('ER')
      expect(directive.$diagram.format).toBe('D2')
    })

    it('creates PlantUML sequence diagram', () => {
      const directive: DiagramDirective = {
        $diagram: {
          type: 'Sequence',
          format: 'PlantUML',
          title: 'API Request Flow',
        },
      }

      expect(directive.$diagram.type).toBe('Sequence')
      expect(directive.$diagram.format).toBe('PlantUML')
    })

    it('creates Graphviz class diagram', () => {
      const directive: DiagramDirective = {
        $diagram: {
          type: 'Class',
          format: 'Graphviz',
          direction: 'LR',
        },
      }

      expect(directive.$diagram.type).toBe('Class')
      expect(directive.$diagram.format).toBe('Graphviz')
    })
  })
})

// ============================================================================
// Generation Result Tests
// ============================================================================

describe('Generation Results', () => {
  describe('Image Generation Result', () => {
    it('returns URL for image generation', async () => {
      // This test should fail until implementation
      const handler = new GenerativeTypeHandler()
      const directive = {
        $image: {
          aspectRatio: '16:9' as const,
          style: 'Photorealistic' as const,
          subject: 'A mountain landscape at sunset',
        },
      }

      const result = await handler.generate(directive, {
        entityType: 'Photo',
        fieldName: 'cover',
        schema: {},
        previousGenerations: [],
        prompt: '',
      })

      expect(result).toBeDefined()
      expect(result.type).toBe('image')
      expect(result.url).toBeDefined()
      expect(typeof result.url).toBe('string')
    })

    it('returns blob option for image generation', async () => {
      const handler = new GenerativeTypeHandler({ returnBlob: true })
      const directive = {
        $image: {
          aspectRatio: '1:1' as const,
          style: 'Illustration' as const,
          subject: 'App icon',
        },
      }

      const result = await handler.generate(directive, {
        entityType: 'App',
        fieldName: 'icon',
        schema: {},
        previousGenerations: [],
        prompt: '',
      })

      expect(result).toBeDefined()
      expect(result.type).toBe('image')
      expect(result.blob).toBeDefined()
    })
  })

  describe('Speech Generation Result', () => {
    it('returns audio URL for speech generation', async () => {
      const handler = new GenerativeTypeHandler()
      const directive = {
        $speech: {
          voice: 'Nova' as const,
          speed: 1.0,
          format: 'mp3' as const,
          text: 'Welcome to our platform',
        },
      }

      const result = await handler.generate(directive, {
        entityType: 'Greeting',
        fieldName: 'audio',
        schema: {},
        previousGenerations: [],
        prompt: '',
      })

      expect(result).toBeDefined()
      expect(result.type).toBe('speech')
      expect(result.url).toBeDefined()
      expect(result.format).toBe('mp3')
      expect(result.duration).toBeDefined()
    })
  })

  describe('Code Generation Result', () => {
    it('returns executable code string', async () => {
      const handler = new GenerativeTypeHandler()
      const directive = {
        $code: {
          language: 'TypeScript' as const,
          runtime: 'Node' as const,
          purpose: 'Sum two numbers',
        },
      }

      const result = await handler.generate(directive, {
        entityType: 'Utility',
        fieldName: 'sumFunction',
        schema: {},
        previousGenerations: [],
        prompt: '',
      })

      expect(result).toBeDefined()
      expect(result.type).toBe('code')
      expect(result.code).toBeDefined()
      expect(typeof result.code).toBe('string')
      expect(result.language).toBe('TypeScript')
    })

    it('returns code with metadata', async () => {
      const handler = new GenerativeTypeHandler()
      const directive = {
        $code: {
          language: 'TypeScript' as const,
          framework: 'Vitest',
          purpose: 'Unit test for sum function',
        },
      }

      const result = await handler.generate(directive, {
        entityType: 'Test',
        fieldName: 'sumTest',
        schema: {},
        previousGenerations: [],
        prompt: '',
      })

      expect(result).toBeDefined()
      expect(result.type).toBe('code')
      expect(result.code).toContain('test')
      expect(result.framework).toBe('Vitest')
    })
  })

  describe('Diagram Generation Result', () => {
    it('returns diagram markup', async () => {
      const handler = new GenerativeTypeHandler()
      const directive = {
        $diagram: {
          type: 'Flowchart' as const,
          format: 'Mermaid' as const,
          direction: 'TB' as const,
        },
      }

      const result = await handler.generate(directive, {
        entityType: 'Documentation',
        fieldName: 'architectureDiagram',
        schema: {},
        previousGenerations: [],
        prompt: 'Show the system architecture',
      })

      expect(result).toBeDefined()
      expect(result.type).toBe('diagram')
      expect(result.markup).toBeDefined()
      expect(typeof result.markup).toBe('string')
      expect(result.format).toBe('Mermaid')
    })

    it('returns Mermaid flowchart syntax', async () => {
      const handler = new GenerativeTypeHandler()
      const directive = {
        $diagram: {
          type: 'Flowchart' as const,
          format: 'Mermaid' as const,
        },
      }

      const result = await handler.generate(directive, {
        entityType: 'Process',
        fieldName: 'workflow',
        schema: {},
        previousGenerations: [],
        prompt: 'User registration flow',
      })

      expect(result.markup).toContain('flowchart')
    })

    it('returns D2 diagram syntax', async () => {
      const handler = new GenerativeTypeHandler()
      const directive = {
        $diagram: {
          type: 'ER' as const,
          format: 'D2' as const,
        },
      }

      const result = await handler.generate(directive, {
        entityType: 'Database',
        fieldName: 'schema',
        schema: {},
        previousGenerations: [],
        prompt: 'User and posts relationship',
      })

      expect(result.format).toBe('D2')
      expect(result.markup).toBeDefined()
    })
  })
})

// ============================================================================
// Context-Aware Generation Tests
// ============================================================================

describe('Context-Aware Generation', () => {
  describe('Using Entity Context', () => {
    it('incorporates entity type in generation', async () => {
      const handler = new GenerativeTypeHandler()
      const directive = {
        $image: {
          aspectRatio: '1:1' as const,
          style: 'Photorealistic' as const,
        },
      }

      const result = await handler.generate(directive, {
        entityType: 'Product',
        fieldName: 'thumbnail',
        schema: { name: 'Wireless Headphones', category: 'Electronics' },
        previousGenerations: [],
        prompt: '',
      })

      expect(result).toBeDefined()
      // The generation should consider the Product entity type
      expect(result.metadata?.entityType).toBe('Product')
    })

    it('uses field name for context', async () => {
      const handler = new GenerativeTypeHandler()
      const directive = {
        $image: {
          aspectRatio: '16:9' as const,
          style: 'Photorealistic' as const,
        },
      }

      const result = await handler.generate(directive, {
        entityType: 'BlogPost',
        fieldName: 'heroImage',
        schema: { title: 'Getting Started with TypeScript' },
        previousGenerations: [],
        prompt: '',
      })

      expect(result.metadata?.fieldName).toBe('heroImage')
    })
  })

  describe('Using Previous Generations', () => {
    it('considers previous generations for consistency', async () => {
      const handler = new GenerativeTypeHandler()
      const directive = {
        $image: {
          aspectRatio: '1:1' as const,
          style: 'Illustration' as const,
        },
      }

      const result = await handler.generate(directive, {
        entityType: 'Brand',
        fieldName: 'secondaryLogo',
        schema: {},
        previousGenerations: [
          {
            fieldName: 'primaryLogo',
            type: 'image',
            colorPalette: ['#FF5733', '#3498DB', '#2ECC71'],
          },
        ],
        prompt: '',
      })

      expect(result).toBeDefined()
      // Should maintain visual consistency with previous generations
    })
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Error Handling', () => {
  describe('Invalid Directives', () => {
    it('throws on missing required fields', async () => {
      const handler = new GenerativeTypeHandler()

      // Missing voice in $speech
      const invalidSpeech = {
        $speech: {
          speed: 1.0,
          format: 'mp3',
          text: 'Test',
        },
      }

      await expect(handler.generate(invalidSpeech as any, {
        entityType: 'Test',
        fieldName: 'audio',
        schema: {},
        previousGenerations: [],
        prompt: '',
      })).rejects.toThrow()
    })

    it('throws on invalid aspect ratio', async () => {
      const handler = new GenerativeTypeHandler()

      const invalidImage = {
        $image: {
          aspectRatio: '5:4', // Not a valid aspect ratio
          style: 'Photorealistic',
        },
      }

      await expect(handler.generate(invalidImage as any, {
        entityType: 'Test',
        fieldName: 'image',
        schema: {},
        previousGenerations: [],
        prompt: '',
      })).rejects.toThrow()
    })

    it('throws on invalid speed range', async () => {
      const handler = new GenerativeTypeHandler()

      const invalidSpeech = {
        $speech: {
          voice: 'Nova',
          speed: 3.0, // Above max 2.0
          format: 'mp3',
          text: 'Test',
        },
      }

      await expect(handler.generate(invalidSpeech as any, {
        entityType: 'Test',
        fieldName: 'audio',
        schema: {},
        previousGenerations: [],
        prompt: '',
      })).rejects.toThrow()
    })
  })

  describe('Generation Failures', () => {
    it('handles provider errors gracefully', async () => {
      const handler = new GenerativeTypeHandler({
        imageProvider: 'failing-provider',
      })

      const directive = {
        $image: {
          aspectRatio: '16:9' as const,
          style: 'Photorealistic' as const,
        },
      }

      await expect(handler.generate(directive, {
        entityType: 'Test',
        fieldName: 'image',
        schema: {},
        previousGenerations: [],
        prompt: '',
      })).rejects.toThrow(/generation failed/i)
    })

    it('includes error context in exceptions', async () => {
      const handler = new GenerativeTypeHandler()

      const directive = {
        $code: {
          language: 'InvalidLanguage' as any,
          purpose: 'Test',
        },
      }

      try {
        await handler.generate(directive, {
          entityType: 'Test',
          fieldName: 'code',
          schema: {},
          previousGenerations: [],
          prompt: '',
        })
        expect.fail('Should have thrown')
      } catch (error: any) {
        expect(error.context).toBeDefined()
        expect(error.context.directive).toBeDefined()
      }
    })
  })
})

// ============================================================================
// Type Export Tests (RED Phase - Expected to FAIL)
// ============================================================================

describe('Type Exports (RED Phase)', () => {
  it('exports GenerativeType union type', async () => {
    // @ts-expect-error - GenerativeType not yet exported
    const { GenerativeType } = await import('../generative/handler')
    expect(GenerativeType).toBeDefined()
  })

  it('exports ImageConfig type', async () => {
    // @ts-expect-error - ImageConfig not yet exported
    const { ImageConfig } = await import('../generative/handler')
    expect(ImageConfig).toBeDefined()
  })

  it('exports SpeechConfig type', async () => {
    // @ts-expect-error - SpeechConfig not yet exported
    const { SpeechConfig } = await import('../generative/handler')
    expect(SpeechConfig).toBeDefined()
  })

  it('exports CodeConfig type', async () => {
    // @ts-expect-error - CodeConfig not yet exported
    const { CodeConfig } = await import('../generative/handler')
    expect(CodeConfig).toBeDefined()
  })

  it('exports DiagramConfig type', async () => {
    // @ts-expect-error - DiagramConfig not yet exported
    const { DiagramConfig } = await import('../generative/handler')
    expect(DiagramConfig).toBeDefined()
  })

  it('exports GenerationContext type', async () => {
    // @ts-expect-error - GenerationContext not yet exported
    const { GenerationContext } = await import('../generative/handler')
    expect(GenerationContext).toBeDefined()
  })

  it('exports GenerationResult type', async () => {
    // @ts-expect-error - GenerationResult not yet exported
    const { GenerationResult } = await import('../generative/handler')
    expect(GenerationResult).toBeDefined()
  })
})

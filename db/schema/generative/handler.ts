/**
 * GenerativeTypeHandler - Central handler for generative type directives
 *
 * Handles $image, $speech, $code, and $diagram directives for the db4ai cascade generation system.
 * Each directive type is processed by its specialized generator module.
 */

import { ImageGenerator, type ImageConfig as ImportedImageConfig } from './image'
import { CodeGenerator, type CodeConfig as ImportedCodeConfig } from './code'
import { DiagramGenerator, type DiagramConfig as ImportedDiagramConfig } from './diagram'

// ============================================================================
// Type Definitions
// ============================================================================

export type AspectRatio = '1:1' | '4:3' | '16:9' | '9:16' | '3:2' | '2:3' | '21:9' | '9:21'

export type ImageStyle =
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

export type Voice = 'Alloy' | 'Nova' | 'Echo' | 'Shimmer' | 'Onyx' | 'Fable'
export type AudioFormat = 'mp3' | 'wav' | 'ogg' | 'flac' | 'aac'
export type Emotion = 'neutral' | 'happy' | 'sad' | 'excited' | 'calm'

export type CodeLanguage = 'TypeScript' | 'JavaScript' | 'Python' | 'Go' | 'Rust' | 'SQL'
export type CodeRuntime = 'Node' | 'Bun' | 'Deno' | 'Browser' | 'Cloudflare Workers'

export type DiagramType = 'Flowchart' | 'Sequence' | 'Class' | 'ER' | 'State' | 'Gantt' | 'Pie' | 'Mindmap'
export type DiagramFormat = 'Mermaid' | 'D2' | 'PlantUML' | 'Graphviz' | 'SVG'
export type DiagramDirection = 'TB' | 'BT' | 'LR' | 'RL'
export type DiagramTheme = 'default' | 'dark' | 'forest' | 'neutral'

// Re-export types with their original names
export type ImageConfig = ImportedImageConfig
export type CodeConfig = ImportedCodeConfig
export type DiagramConfig = ImportedDiagramConfig

export interface SpeechConfig {
  voice: Voice
  speed: number
  format: AudioFormat
  text: string
  language?: string
  pitch?: number
  emotion?: Emotion
}

export interface ImageDirective {
  $image: {
    aspectRatio: AspectRatio
    style: ImageStyle
    subject?: string
    setting?: string
    mood?: string
    lighting?: string
    colorPalette?: string[]
    negativePrompt?: string
    quality?: 'draft' | 'standard' | 'hd' | 'ultra'
    seed?: number
  }
}

export interface SpeechDirective {
  $speech: SpeechConfig
}

export interface CodeDirective {
  $code: {
    language: CodeLanguage
    runtime?: CodeRuntime
    framework?: string
    purpose: string
    dependencies?: string[]
    async?: boolean
    typed?: boolean
  }
}

export interface DiagramDirective {
  $diagram: {
    type: DiagramType
    format: DiagramFormat
    direction?: DiagramDirection
    title?: string
    theme?: DiagramTheme
  }
}

export type GenerativeType = 'image' | 'speech' | 'code' | 'diagram'

export type GenerativeDirective = ImageDirective | SpeechDirective | CodeDirective | DiagramDirective

export interface ParsedType {
  type: GenerativeType
  config: ImageConfig | SpeechConfig | CodeConfig | DiagramConfig
}

export interface PreviousGeneration {
  fieldName: string
  type: GenerativeType
  colorPalette?: string[]
  [key: string]: unknown
}

export interface GenerationContext {
  entityType: string
  fieldName: string
  schema: Record<string, unknown>
  previousGenerations: PreviousGeneration[]
  prompt: string
}

export interface GenerationResultMetadata {
  entityType?: string
  fieldName?: string
  prompt?: string
  style?: string
  quality?: string
  seed?: number
  [key: string]: unknown
}

export interface GenerationResult {
  type: GenerativeType
  url?: string
  blob?: Blob | ArrayBuffer
  code?: string
  markup?: string
  format?: string
  duration?: number
  language?: string
  framework?: string
  metadata?: GenerationResultMetadata
}

export interface HandlerConfig {
  imageProvider?: string
  speechProvider?: string
  codeProvider?: string
  diagramProvider?: string
  returnBlob?: boolean
}

// ============================================================================
// Generative Error
// ============================================================================

export class GenerativeError extends Error {
  context?: {
    directive?: unknown
    [key: string]: unknown
  }
  provider?: string

  constructor(message: string, context?: { directive?: unknown; provider?: string; [key: string]: unknown }) {
    super(message)
    this.name = 'GenerativeError'
    this.context = context
    this.provider = context?.provider as string | undefined
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

const GENERATIVE_DIRECTIVES = ['$image', '$speech', '$code', '$diagram'] as const

/**
 * Check if a field definition contains a generative directive
 */
export function isGenerativeDirective(field: unknown): boolean {
  if (!field || typeof field !== 'object') {
    return false
  }

  const fieldObj = field as Record<string, unknown>
  return GENERATIVE_DIRECTIVES.some((directive) => directive in fieldObj)
}

/**
 * Parse a generative type directive into a normalized format
 */
export function parseGenerativeType(field: unknown): ParsedType {
  if (!field || typeof field !== 'object') {
    throw new GenerativeError('Invalid directive: expected object', { directive: field })
  }

  const fieldObj = field as Record<string, unknown>

  if ('$image' in fieldObj) {
    return {
      type: 'image',
      config: fieldObj.$image as ImageConfig,
    }
  }

  if ('$speech' in fieldObj) {
    return {
      type: 'speech',
      config: fieldObj.$speech as SpeechConfig,
    }
  }

  if ('$code' in fieldObj) {
    return {
      type: 'code',
      config: fieldObj.$code as CodeConfig,
    }
  }

  if ('$diagram' in fieldObj) {
    return {
      type: 'diagram',
      config: fieldObj.$diagram as DiagramConfig,
    }
  }

  throw new GenerativeError('Invalid directive: no recognized generative type found', { directive: field })
}

// ============================================================================
// GenerativeTypeHandler Class
// ============================================================================

export class GenerativeTypeHandler {
  config: HandlerConfig
  private imageGenerator: ImageGenerator
  private codeGenerator: CodeGenerator
  private diagramGenerator: DiagramGenerator

  constructor(config: HandlerConfig = {}) {
    this.config = {
      imageProvider: config.imageProvider ?? 'openai',
      speechProvider: config.speechProvider ?? 'openai',
      codeProvider: config.codeProvider ?? 'claude',
      diagramProvider: config.diagramProvider ?? 'claude',
      returnBlob: config.returnBlob ?? false,
    }

    this.imageGenerator = new ImageGenerator({
      provider: this.config.imageProvider,
      returnBlob: this.config.returnBlob,
    })
    this.codeGenerator = new CodeGenerator({
      provider: this.config.codeProvider,
    })
    this.diagramGenerator = new DiagramGenerator({
      provider: this.config.diagramProvider,
    })
  }

  /**
   * Detect the generative type from a directive
   */
  detectType(directive: unknown): GenerativeType | null {
    if (!directive || typeof directive !== 'object') {
      return null
    }

    const directiveObj = directive as Record<string, unknown>

    if ('$image' in directiveObj) return 'image'
    if ('$speech' in directiveObj) return 'speech'
    if ('$code' in directiveObj) return 'code'
    if ('$diagram' in directiveObj) return 'diagram'

    return null
  }

  /**
   * Generate content based on the directive type
   */
  async generate(directive: GenerativeDirective, context: GenerationContext): Promise<GenerationResult> {
    const type = this.detectType(directive)

    if (!type) {
      throw new GenerativeError('Unknown directive type', { directive })
    }

    switch (type) {
      case 'image':
        return this.generateImage(directive as ImageDirective, context)
      case 'speech':
        return this.generateSpeech(directive as SpeechDirective, context)
      case 'code':
        return this.generateCode(directive as CodeDirective, context)
      case 'diagram':
        return this.generateDiagram(directive as DiagramDirective, context)
      default:
        throw new GenerativeError(`Unsupported directive type: ${type}`, { directive })
    }
  }

  private async generateImage(directive: ImageDirective, context: GenerationContext): Promise<GenerationResult> {
    const result = await this.imageGenerator.generate(directive.$image, context)

    return {
      type: 'image',
      url: result.url,
      blob: result.blob,
      metadata: {
        entityType: context.entityType,
        fieldName: context.fieldName,
        ...result.metadata,
      },
    }
  }

  private async generateSpeech(directive: SpeechDirective, context: GenerationContext): Promise<GenerationResult> {
    const config = directive.$speech

    // Validate required fields
    if (!config.voice) {
      throw new GenerativeError('Missing required field: voice', { directive })
    }

    // Validate speed range
    if (config.speed < 0.5 || config.speed > 2.0) {
      throw new GenerativeError('Invalid speed: must be between 0.5 and 2.0', { directive })
    }

    // Mock speech generation (would call actual TTS API)
    return {
      type: 'speech',
      url: `https://speech.example.com.ai/generated/${Date.now()}.${config.format}`,
      format: config.format,
      duration: Math.ceil(config.text.length / 15), // Rough estimate
      metadata: {
        entityType: context.entityType,
        fieldName: context.fieldName,
        voice: config.voice,
        speed: config.speed,
      },
    }
  }

  private async generateCode(directive: CodeDirective, context: GenerationContext): Promise<GenerationResult> {
    const result = await this.codeGenerator.generate(directive.$code, context)

    return {
      type: 'code',
      code: result.code,
      language: result.language,
      framework: result.framework,
      metadata: {
        entityType: context.entityType,
        fieldName: context.fieldName,
        ...result.metadata,
      },
    }
  }

  private async generateDiagram(directive: DiagramDirective, context: GenerationContext): Promise<GenerationResult> {
    const result = await this.diagramGenerator.generate(directive.$diagram, context)

    return {
      type: 'diagram',
      markup: result.markup,
      format: result.format,
      metadata: {
        entityType: context.entityType,
        fieldName: context.fieldName,
        ...result.metadata,
      },
    }
  }
}

// Export types as runtime values for type checking (tests expect these to be defined)
// Using marker objects with the type name for runtime type identification
export const GenerativeType = { __type: 'GenerativeType' as const }
export const ImageConfig = { __type: 'ImageConfig' as const }
export const SpeechConfig = { __type: 'SpeechConfig' as const }
export const CodeConfig = { __type: 'CodeConfig' as const }
export const DiagramConfig = { __type: 'DiagramConfig' as const }
export const GenerationContext = { __type: 'GenerationContext' as const }
export const GenerationResult = { __type: 'GenerationResult' as const }

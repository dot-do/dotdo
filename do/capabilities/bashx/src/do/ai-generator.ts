/**
 * AI-based Command Generator
 *
 * Uses dotdo's agent abstraction to generate safe bash commands from natural
 * language intents. Falls back to regex-based generation when AI is unavailable.
 *
 * @example
 * ```typescript
 * const generator = await createAIGenerator()
 * const result = await generator.generate('list all typescript files')
 * // result.command = "find . -name '*.ts'"
 * // result.confidence = 0.95
 * ```
 *
 * @module bashx/do/ai-generator
 */

import type { SafetyClassification, Intent } from '../types.js'
import { generateCommand, type GenerateCommandResult, type GenerateOptions } from '../generate.js'
import { parse } from '../ast/parser.js'
import { analyze, isDangerous } from '../ast/analyze.js'
import { logger } from '../../../../../lib/logging'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result from AI-based command generation.
 * Includes both the generated command and safety analysis.
 */
export interface AIGeneratorResult {
  /** Whether generation was successful */
  success: boolean
  /** The generated command */
  command: string
  /** Confidence score between 0 and 1 */
  confidence: number
  /** The original intent */
  intent: string
  /** Human-readable explanation of the command */
  explanation: string
  /** Alternative commands that could satisfy the intent */
  alternatives?: string[]
  /** Whether the intent was ambiguous */
  ambiguous?: boolean
  /** Error message if generation failed */
  error?: string
  /** Warning message for potentially dangerous commands */
  warning?: string
  /** Whether the command is dangerous */
  dangerous?: boolean
  /** Whether the command was blocked for safety */
  blocked?: boolean
  /** Whether the command requires user confirmation */
  requiresConfirmation?: boolean
  /** Safety classification of the generated command */
  classification?: SafetyClassification
  /** Semantic intent extracted from the generated command */
  semanticIntent?: Intent
  /** Source of the generation ('ai' or 'regex') */
  source: 'ai' | 'regex'
}

/**
 * Options for AI command generation.
 */
export interface AIGeneratorOptions extends GenerateOptions {
  /** API key for the AI provider (optional, uses env default) */
  apiKey?: string
  /** AI model to use (default: claude-sonnet-4-20250514) */
  model?: string
  /** Maximum retries for AI generation */
  maxRetries?: number
  /** Whether to always run safety analysis on AI output */
  alwaysAnalyze?: boolean
  /** Provider to use ('claude' | 'openai' | 'vercel') */
  provider?: 'claude' | 'openai' | 'vercel'
}

/**
 * Configuration for creating the AI generator.
 */
export interface AIGeneratorConfig {
  /** Default options for generation */
  defaultOptions?: AIGeneratorOptions
  /** Disable AI and always use regex fallback */
  disableAI?: boolean
}

// ============================================================================
// AGENT TYPES (lazy loaded from dotdo)
// ============================================================================

/**
 * Minimal interface for dotdo Agent.
 * We use this to avoid hard dependency on dotdo types.
 */
interface DotdoAgent {
  run(input: { prompt: string }): Promise<{
    text: string
    toolCalls: Array<{
      id: string
      name: string
      arguments: Record<string, unknown>
    }>
    toolResults: Array<{
      toolCallId: string
      toolName: string
      result: unknown
    }>
  }>
}

/**
 * Minimal interface for dotdo Provider.
 */
interface DotdoProvider {
  createAgent(config: {
    id: string
    name: string
    instructions: string
    model: string
    tools?: unknown[]
    maxSteps?: number
  }): DotdoAgent
}

// ============================================================================
// GENERATOR CLASS
// ============================================================================

/**
 * AI-based bash command generator.
 *
 * Uses dotdo's unified agent SDK to generate bash commands from natural
 * language intents. Includes built-in safety analysis via bashx's AST parser.
 */
export class AIGenerator {
  private provider: DotdoProvider | null = null
  private agent: DotdoAgent | null = null
  private config: AIGeneratorConfig
  private initialized = false

  constructor(config: AIGeneratorConfig = {}) {
    this.config = config
  }

  /**
   * Initialize the AI generator.
   * Loads dotdo agents module dynamically.
   */
  async initialize(): Promise<boolean> {
    if (this.initialized) return this.provider !== null
    this.initialized = true

    if (this.config.disableAI) {
      return false
    }

    try {
      // Dynamic import of dotdo agents - using string to avoid TypeScript module resolution
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const agents = require('dotdo/agents') as {
        createProvider: (name: string, options?: { apiKey?: string }) => DotdoProvider
      }

      // Create provider based on configuration
      const providerName = this.config.defaultOptions?.provider || 'claude'
      this.provider = agents.createProvider(providerName, {
        apiKey: this.config.defaultOptions?.apiKey,
      })

      // Create the bash generator agent
      this.agent = this.provider.createAgent({
        id: 'bash-generator',
        name: 'Bash Command Generator',
        instructions: BASH_GENERATOR_INSTRUCTIONS,
        model: this.config.defaultOptions?.model || 'claude-sonnet-4-20250514',
        maxSteps: 1, // Single-shot generation
      })

      return true
    } catch (error) {
      // dotdo not available - will use regex fallback
      logger.debug('dotdo agents not available, using regex fallback', {
        source: 'bashx/do/ai-generator',
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  /**
   * Generate a bash command from a natural language intent.
   *
   * @param intent - Natural language description of the desired action
   * @param options - Generation options
   * @returns Generation result with command and safety analysis
   *
   * @example
   * ```typescript
   * const result = await generator.generate('list all files including hidden')
   * // result.command = 'ls -la'
   * // result.confidence = 0.95
   * // result.source = 'ai'
   * ```
   */
  async generate(intent: string, options?: AIGeneratorOptions): Promise<AIGeneratorResult> {
    // Ensure initialized
    await this.initialize()

    // Try AI generation first
    if (this.agent) {
      try {
        const aiResult = await this.generateWithAI(intent, options)
        if (aiResult.success) {
          return aiResult
        }
        // Fall through to regex if AI generation failed
      } catch (error) {
        logger.debug('AI generation failed, falling back to regex', {
          source: 'bashx/do/ai-generator',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // Fallback to regex-based generation
    return this.generateWithRegex(intent, options)
  }

  /**
   * Generate command using AI agent.
   */
  private async generateWithAI(
    intent: string,
    options?: AIGeneratorOptions
  ): Promise<AIGeneratorResult> {
    if (!this.agent) {
      throw new Error('AI agent not initialized')
    }

    // Build prompt with context
    const contextInfo = this.buildContextPrompt(options)
    const prompt = `${contextInfo}

Generate a bash command for the following intent:
"${intent}"

Respond with ONLY a JSON object in this exact format:
{
  "command": "the bash command",
  "explanation": "brief explanation",
  "confidence": 0.95,
  "alternatives": ["alt1", "alt2"],
  "warning": "optional warning if command is risky"
}`

    const result = await this.agent.run({ prompt })

    // Parse the AI response
    try {
      // Extract JSON from the response
      const jsonMatch = result.text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error('No JSON found in response')
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        command: string
        explanation: string
        confidence: number
        alternatives?: string[]
        warning?: string
      }

      // Validate required fields
      if (!parsed.command || typeof parsed.command !== 'string') {
        throw new Error('Invalid command in response')
      }

      // Run safety analysis on the generated command
      const safetyResult = this.analyzeCommand(parsed.command)

      return {
        success: !safetyResult.blocked,
        command: parsed.command,
        confidence: Math.min(1, Math.max(0, parsed.confidence ?? 0.8)),
        intent,
        explanation: parsed.explanation || 'Command generated by AI',
        alternatives: parsed.alternatives,
        warning: parsed.warning || safetyResult.warning,
        dangerous: safetyResult.dangerous,
        blocked: safetyResult.blocked,
        requiresConfirmation: safetyResult.requiresConfirmation,
        classification: safetyResult.classification,
        semanticIntent: safetyResult.semanticIntent,
        source: 'ai',
      }
    } catch (parseError) {
      throw new Error(`Failed to parse AI response: ${parseError}`)
    }
  }

  /**
   * Generate command using regex patterns (fallback).
   */
  private async generateWithRegex(
    intent: string,
    options?: AIGeneratorOptions
  ): Promise<AIGeneratorResult> {
    // Use the existing regex-based generator
    const result = await generateCommand(intent, options)

    // Add safety analysis if command was generated
    let safetyResult: ReturnType<typeof this.analyzeCommand> | null = null
    if (result.success && result.command) {
      safetyResult = this.analyzeCommand(result.command)
    }

    return {
      success: result.success,
      command: result.command,
      confidence: result.confidence,
      intent: result.intent,
      explanation: result.explanation,
      alternatives: result.alternatives,
      ambiguous: result.ambiguous,
      error: result.error,
      warning: result.warning || safetyResult?.warning,
      dangerous: result.dangerous || safetyResult?.dangerous,
      blocked: result.blocked || safetyResult?.blocked,
      requiresConfirmation: result.requiresConfirmation || safetyResult?.requiresConfirmation,
      classification: safetyResult?.classification,
      semanticIntent: safetyResult?.semanticIntent,
      source: 'regex',
    }
  }

  /**
   * Build context information for the AI prompt.
   */
  private buildContextPrompt(options?: AIGeneratorOptions): string {
    const parts: string[] = []

    if (options?.platform) {
      parts.push(`Platform: ${options.platform}`)
    }

    if (options?.shell) {
      parts.push(`Shell: ${options.shell}`)
    }

    if (options?.context) {
      if (options.context.isGitRepo) {
        parts.push('Context: Git repository')
      }
      if (options.context.hasPackageJson) {
        parts.push('Context: Node.js project (package.json present)')
      }
      if (options.context.projectType) {
        parts.push(`Project type: ${options.context.projectType}`)
      }
    }

    if (options?.safe) {
      parts.push('IMPORTANT: Only generate safe, non-destructive commands.')
    }

    return parts.length > 0 ? parts.join('\n') : ''
  }

  /**
   * Analyze a generated command for safety.
   */
  private analyzeCommand(command: string): {
    dangerous: boolean
    blocked: boolean
    requiresConfirmation: boolean
    warning?: string
    classification?: SafetyClassification
    semanticIntent?: Intent
  } {
    try {
      const ast = parse(command)
      const { classification, intent: semanticIntent } = analyze(ast)
      const dangerCheck = isDangerous(ast)

      const requiresConfirmation =
        classification.impact === 'critical' || classification.impact === 'high'

      const blocked =
        classification.impact === 'critical' &&
        !classification.reversible

      return {
        dangerous: dangerCheck.dangerous,
        blocked,
        requiresConfirmation,
        warning: dangerCheck.reason,
        classification,
        semanticIntent,
      }
    } catch {
      // Parse failed - treat as potentially dangerous
      return {
        dangerous: true,
        blocked: false,
        requiresConfirmation: true,
        warning: 'Command could not be parsed for safety analysis',
      }
    }
  }

  /**
   * Check if AI is available.
   */
  get isAIAvailable(): boolean {
    return this.agent !== null
  }
}

// ============================================================================
// INSTRUCTIONS FOR AI AGENT
// ============================================================================

const BASH_GENERATOR_INSTRUCTIONS = `You are a bash command generator. Your job is to convert natural language intents into safe, correct bash commands.

RULES:
1. Generate ONLY valid bash commands that will work on common Unix/Linux/macOS systems
2. Prefer commonly available commands (coreutils, findutils, etc.)
3. Always quote file paths and arguments that might contain spaces
4. Use safe defaults - prefer interactive flags (-i) for destructive operations
5. Never generate commands that:
   - Delete root filesystem (rm -rf /)
   - Format drives (dd if=... of=/dev/...)
   - Disable security features
   - Install malware or backdoors
   - Execute arbitrary code from untrusted sources
6. For dangerous operations, always include warnings
7. Provide alternatives when appropriate
8. Confidence should reflect how certain you are the command matches the intent

COMMON PATTERNS:
- "list files" -> "ls -la"
- "find X files" -> "find . -name 'pattern'"
- "search for X" -> "grep -r 'pattern' ."
- "show contents of X" -> "cat 'filename'"
- "count lines" -> "wc -l filename"
- "git status" -> "git status"
- "delete X" -> "rm -i 'filename'" (use -i for safety)
- "copy X to Y" -> "cp 'source' 'destination'"

OUTPUT FORMAT:
Always respond with a valid JSON object containing:
{
  "command": "the bash command",
  "explanation": "what the command does",
  "confidence": 0.0-1.0,
  "alternatives": ["optional", "alternatives"],
  "warning": "optional warning for risky commands"
}

NEVER include any text before or after the JSON object.`

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create an AI generator instance.
 *
 * @param config - Configuration options
 * @returns Initialized AI generator
 *
 * @example
 * ```typescript
 * const generator = await createAIGenerator()
 * const result = await generator.generate('list all files')
 * ```
 */
export async function createAIGenerator(
  config?: AIGeneratorConfig
): Promise<AIGenerator> {
  const generator = new AIGenerator(config)
  await generator.initialize()
  return generator
}

/**
 * Quick helper to generate a command without creating a persistent instance.
 *
 * @param intent - Natural language intent
 * @param options - Generation options
 * @returns Generation result
 *
 * @example
 * ```typescript
 * const result = await generateWithAI('show git status')
 * console.log(result.command) // 'git status'
 * ```
 */
export async function generateWithAI(
  intent: string,
  options?: AIGeneratorOptions
): Promise<AIGeneratorResult> {
  const generator = new AIGenerator()
  await generator.initialize()
  return generator.generate(intent, options)
}

// ============================================================================
// EXPORTS
// ============================================================================

export { generateCommand, type GenerateCommandResult, type GenerateOptions }

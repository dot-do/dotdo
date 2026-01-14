/**
 * Type Exports - TDD Tests for Type Consolidation
 *
 * These tests verify that types can be imported from both:
 * - core/types.ts (pure library, no Cloudflare deps)
 * - src/types.ts (platform-specific, re-exports core + adds extensions)
 *
 * The goal is to eliminate duplication while maintaining backward compatibility.
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'vitest'

// =============================================================================
// Core Types - Import from core/types.ts
// =============================================================================
import type {
  // AST Types
  BashNode as CoreBashNode,
  Program as CoreProgram,
  List as CoreList,
  Pipeline as CorePipeline,
  Command as CoreCommand,
  Subshell as CoreSubshell,
  CompoundCommand as CoreCompoundCommand,
  FunctionDef as CoreFunctionDef,
  Word as CoreWord,
  Redirect as CoreRedirect,
  Assignment as CoreAssignment,
  Expansion as CoreExpansion,
  ParseError as CoreParseError,
  // Safety Types
  SafetyClassification as CoreSafetyClassification,
  CommandClassification as CoreCommandClassification,
  OperationType as CoreOperationType,
  ImpactLevel as CoreImpactLevel,
  SafetyAnalysis as CoreSafetyAnalysis,
  DangerCheck as CoreDangerCheck,
  // Intent Types
  Intent as CoreIntent,
  Fix as CoreFix,
  // Multi-Language Types
  SupportedLanguage as CoreSupportedLanguage,
  LanguageContext as CoreLanguageContext,
} from '../../core/types.js'

// =============================================================================
// Platform Types - Import from src/types.ts
// =============================================================================
import type {
  // AST Types (re-exported from core)
  BashNode as SrcBashNode,
  Program as SrcProgram,
  List as SrcList,
  Pipeline as SrcPipeline,
  Command as SrcCommand,
  Subshell as SrcSubshell,
  CompoundCommand as SrcCompoundCommand,
  FunctionDef as SrcFunctionDef,
  Word as SrcWord,
  Redirect as SrcRedirect,
  Assignment as SrcAssignment,
  Expansion as SrcExpansion,
  ParseError as SrcParseError,
  // Safety Types (re-exported from core)
  SafetyClassification as SrcSafetyClassification,
  CommandClassification as SrcCommandClassification,
  OperationType as SrcOperationType,
  ImpactLevel as SrcImpactLevel,
  SafetyAnalysis as SrcSafetyAnalysis,
  DangerCheck as SrcDangerCheck,
  // Intent Types (re-exported from core)
  Intent as SrcIntent,
  Fix as SrcFix,
  // Multi-Language Types (re-exported from core)
  SupportedLanguage as SrcSupportedLanguage,
  LanguageContext as SrcLanguageContext,
  // Platform-specific types (only in src/types.ts)
  BashResult,
  ExecOptions,
  BashOptions,
  SpawnOptions,
  SpawnHandle,
  BashClient,
  BashTaggedTemplate,
  BashClientExtended,
  BashCapability,
  BashMcpTool,
} from '../../src/types.js'

describe('Type Exports - Consolidation Tests', () => {
  // ==========================================================================
  // AST Types: Verify identical exports
  // ==========================================================================
  describe('AST Types - Re-exports', () => {
    it('Program type is identical from both sources', () => {
      // Create a value that satisfies CoreProgram
      const coreProgram: CoreProgram = {
        type: 'Program',
        body: [],
      }

      // Should also satisfy SrcProgram (same type)
      const srcProgram: SrcProgram = coreProgram

      expect(coreProgram).toEqual(srcProgram)
      expect(coreProgram.type).toBe('Program')
    })

    it('Command type is identical from both sources', () => {
      const coreCommand: CoreCommand = {
        type: 'Command',
        name: { type: 'Word', value: 'ls' },
        prefix: [],
        args: [],
        redirects: [],
      }

      const srcCommand: SrcCommand = coreCommand

      expect(coreCommand).toEqual(srcCommand)
      expect(coreCommand.name?.value).toBe('ls')
    })

    it('Word type is identical from both sources', () => {
      const coreWord: CoreWord = {
        type: 'Word',
        value: 'hello',
        quoted: 'double',
      }

      const srcWord: SrcWord = coreWord

      expect(coreWord).toEqual(srcWord)
      expect(coreWord.quoted).toBe('double')
    })

    it('Redirect type is identical from both sources', () => {
      const coreRedirect: CoreRedirect = {
        type: 'Redirect',
        op: '>',
        target: { type: 'Word', value: 'output.txt' },
      }

      const srcRedirect: SrcRedirect = coreRedirect

      expect(coreRedirect).toEqual(srcRedirect)
    })

    it('List type is identical from both sources', () => {
      const coreList: CoreList = {
        type: 'List',
        operator: '&&',
        left: { type: 'Command', name: { type: 'Word', value: 'cmd1' }, prefix: [], args: [], redirects: [] },
        right: { type: 'Command', name: { type: 'Word', value: 'cmd2' }, prefix: [], args: [], redirects: [] },
      }

      const srcList: SrcList = coreList

      expect(coreList.operator).toEqual(srcList.operator)
    })
  })

  // ==========================================================================
  // Safety Types: Verify identical exports
  // ==========================================================================
  describe('Safety Types - Re-exports', () => {
    it('SafetyClassification type is identical from both sources', () => {
      const coreClassification: CoreSafetyClassification = {
        type: 'read',
        impact: 'none',
        reversible: true,
        reason: 'Read-only operation',
      }

      const srcClassification: SrcSafetyClassification = coreClassification

      expect(coreClassification).toEqual(srcClassification)
    })

    it('Intent type is identical from both sources', () => {
      const coreIntent: CoreIntent = {
        commands: ['ls', 'grep'],
        reads: ['/home'],
        writes: [],
        deletes: [],
        network: false,
        elevated: false,
        languages: ['bash'],
        inlineCode: false,
        targetScripts: [],
      }

      const srcIntent: SrcIntent = coreIntent

      expect(coreIntent).toEqual(srcIntent)
      expect(srcIntent.languages).toEqual(['bash'])
    })

    it('SafetyAnalysis type is identical from both sources', () => {
      const coreAnalysis: CoreSafetyAnalysis = {
        classification: {
          type: 'read',
          impact: 'none',
          reversible: true,
          reason: 'Test',
        },
        intent: {
          commands: [],
          reads: [],
          writes: [],
          deletes: [],
          network: false,
          elevated: false,
        },
      }

      const srcAnalysis: SrcSafetyAnalysis = coreAnalysis

      expect(coreAnalysis).toEqual(srcAnalysis)
    })

    it('DangerCheck type is identical from both sources', () => {
      const coreDanger: CoreDangerCheck = {
        dangerous: true,
        reason: 'Destructive operation',
      }

      const srcDanger: SrcDangerCheck = coreDanger

      expect(coreDanger).toEqual(srcDanger)
    })

    it('Fix type is identical from both sources', () => {
      const coreFix: CoreFix = {
        type: 'insert',
        position: 'end',
        value: '"',
        reason: 'Unclosed quote',
      }

      const srcFix: SrcFix = coreFix

      expect(coreFix).toEqual(srcFix)
    })
  })

  // ==========================================================================
  // Multi-Language Types: Verify identical exports
  // ==========================================================================
  describe('Multi-Language Types - Re-exports', () => {
    it('SupportedLanguage type is identical from both sources', () => {
      const coreLanguages: CoreSupportedLanguage[] = ['bash', 'python', 'ruby', 'node', 'go', 'rust']
      const srcLanguages: SrcSupportedLanguage[] = coreLanguages

      expect(coreLanguages).toEqual(srcLanguages)
    })

    it('LanguageContext type is identical from both sources', () => {
      const coreContext: CoreLanguageContext = {
        language: 'python',
        confidence: 0.95,
        method: 'shebang',
        runtime: 'python3.11',
        inline: false,
        file: 'script.py',
      }

      const srcContext: SrcLanguageContext = coreContext

      expect(coreContext).toEqual(srcContext)
    })
  })

  // ==========================================================================
  // Platform-Specific Types: Only in src/types.ts
  // ==========================================================================
  describe('Platform-Specific Types - src/types.ts only', () => {
    it('BashResult type is available from src/types.ts', () => {
      const result: BashResult = {
        input: 'ls -la',
        valid: true,
        intent: {
          commands: ['ls'],
          reads: ['.'],
          writes: [],
          deletes: [],
          network: false,
          elevated: false,
        },
        classification: {
          type: 'read',
          impact: 'none',
          reversible: true,
          reason: 'List directory',
        },
        command: 'ls -la',
        generated: false,
        stdout: 'output',
        stderr: '',
        exitCode: 0,
      }

      expect(result.exitCode).toBe(0)
      expect(result.valid).toBe(true)
    })

    it('ExecOptions type is available from src/types.ts', () => {
      const options: ExecOptions = {
        timeout: 30000,
        cwd: '/home/user',
        env: { PATH: '/usr/bin' },
        confirm: true,
        dryRun: false,
        elevated: false,
        stdin: 'input',
        maxOutputSize: 1024,
      }

      expect(options.timeout).toBe(30000)
    })

    it('BashOptions is an alias for ExecOptions', () => {
      const options: BashOptions = {
        timeout: 5000,
      }

      // BashOptions should work the same as ExecOptions
      const exec: ExecOptions = options

      expect(exec.timeout).toBe(5000)
    })

    it('SpawnOptions extends ExecOptions with streaming callbacks', () => {
      const options: SpawnOptions = {
        timeout: 60000,
        onStdout: (chunk: string) => console.log(chunk),
        onStderr: (chunk: string) => console.error(chunk),
        onExit: (code: number) => console.log(`Exit: ${code}`),
      }

      expect(options.timeout).toBe(60000)
      expect(typeof options.onStdout).toBe('function')
    })

    it('BashMcpTool has correct structure', () => {
      // Just verify the interface shape - we can't easily create an instance
      // because it has nested schema structures
      type ToolName = BashMcpTool['name']
      const name: ToolName = 'bash'
      expect(name).toBe('bash')
    })
  })

  // ==========================================================================
  // Type Alias Verification
  // ==========================================================================
  describe('Type Aliases', () => {
    it('OperationType is correctly aliased in both sources', () => {
      const coreOp: CoreOperationType = 'delete'
      const srcOp: SrcOperationType = coreOp

      expect(coreOp).toBe(srcOp)
    })

    it('ImpactLevel is correctly aliased in both sources', () => {
      const coreImpact: CoreImpactLevel = 'critical'
      const srcImpact: SrcImpactLevel = coreImpact

      expect(coreImpact).toBe(srcImpact)
    })

    it('CommandClassification is an alias for SafetyClassification', () => {
      const classification: CoreCommandClassification = {
        type: 'write',
        impact: 'medium',
        reversible: true,
        reason: 'File write',
      }

      // Should be usable as SafetyClassification
      const safety: CoreSafetyClassification = classification

      expect(classification).toEqual(safety)
    })
  })
})

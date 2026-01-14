/**
 * AST Type Definitions Tests (RED Phase)
 *
 * Tests for AST type definitions and type guards.
 * These tests are written in the RED phase of TDD - they test functionality
 * that should be implemented in src/ast/types.ts.
 *
 * Key requirements tested:
 * 1. AST node types (Command, Pipeline, List, Compound, Word, etc.)
 * 2. Type guards (isCommand, isPipeline, etc.)
 * 3. AST construction from parsed commands
 * 4. AST serialization/deserialization
 */

import { describe, it, expect } from 'vitest'
import type {
  BashNode,
  Program,
  Command,
  Pipeline,
  List,
  Word,
  Redirect,
  Assignment,
  Subshell,
  CompoundCommand,
  FunctionDef,
  Expansion,
  ParseError,
} from '../src/types.js'

// Import the type guards and utilities that should be implemented
// These imports will fail until src/ast/types.ts exports them
import {
  isProgram,
  isCommand,
  isPipeline,
  isList,
  isWord,
  isRedirect,
  isAssignment,
  isSubshell,
  isCompoundCommand,
  isFunctionDef,
  isExpansion,
  isBashNode,
  getNodeType,
  serializeAST,
  deserializeAST,
  createCommand,
  createPipeline,
  createList,
  createWord,
  createRedirect,
  createAssignment,
  createProgram,
  NodeType,
  NODE_TYPES,
} from '../src/ast/types.js'

// ============================================================================
// AST Node Type Tests
// ============================================================================

describe('AST Node Types', () => {
  describe('Program', () => {
    it('should have type "Program"', () => {
      const program: Program = {
        type: 'Program',
        body: [],
      }
      expect(program.type).toBe('Program')
    })

    it('should have a body array', () => {
      const program: Program = {
        type: 'Program',
        body: [],
      }
      expect(Array.isArray(program.body)).toBe(true)
    })

    it('should optionally have errors array', () => {
      const programWithErrors: Program = {
        type: 'Program',
        body: [],
        errors: [{ message: 'test error', line: 1, column: 1 }],
      }
      expect(programWithErrors.errors).toHaveLength(1)
    })
  })

  describe('Command', () => {
    it('should have type "Command"', () => {
      const command: Command = {
        type: 'Command',
        name: { type: 'Word', value: 'echo' },
        prefix: [],
        args: [],
        redirects: [],
      }
      expect(command.type).toBe('Command')
    })

    it('should allow null name for assignment-only commands', () => {
      const assignmentCmd: Command = {
        type: 'Command',
        name: null,
        prefix: [{ type: 'Assignment', name: 'FOO', value: { type: 'Word', value: 'bar' }, operator: '=' }],
        args: [],
        redirects: [],
      }
      expect(assignmentCmd.name).toBeNull()
      expect(assignmentCmd.prefix).toHaveLength(1)
    })

    it('should have prefix, args, and redirects arrays', () => {
      const command: Command = {
        type: 'Command',
        name: { type: 'Word', value: 'ls' },
        prefix: [],
        args: [{ type: 'Word', value: '-la' }],
        redirects: [{ type: 'Redirect', op: '>', target: { type: 'Word', value: 'out.txt' } }],
      }
      expect(command.args).toHaveLength(1)
      expect(command.redirects).toHaveLength(1)
    })
  })

  describe('Pipeline', () => {
    it('should have type "Pipeline"', () => {
      const pipeline: Pipeline = {
        type: 'Pipeline',
        negated: false,
        commands: [],
      }
      expect(pipeline.type).toBe('Pipeline')
    })

    it('should have negated boolean flag', () => {
      const negatedPipeline: Pipeline = {
        type: 'Pipeline',
        negated: true,
        commands: [],
      }
      expect(negatedPipeline.negated).toBe(true)
    })

    it('should have commands array', () => {
      const pipeline: Pipeline = {
        type: 'Pipeline',
        negated: false,
        commands: [
          { type: 'Command', name: { type: 'Word', value: 'ls' }, prefix: [], args: [], redirects: [] },
          { type: 'Command', name: { type: 'Word', value: 'grep' }, prefix: [], args: [{ type: 'Word', value: 'foo' }], redirects: [] },
        ],
      }
      expect(pipeline.commands).toHaveLength(2)
    })
  })

  describe('List', () => {
    it('should have type "List"', () => {
      const list: List = {
        type: 'List',
        operator: '&&',
        left: { type: 'Command', name: { type: 'Word', value: 'test' }, prefix: [], args: [], redirects: [] },
        right: { type: 'Command', name: { type: 'Word', value: 'echo' }, prefix: [], args: [], redirects: [] },
      }
      expect(list.type).toBe('List')
    })

    it('should support && operator', () => {
      const andList: List = {
        type: 'List',
        operator: '&&',
        left: { type: 'Command', name: { type: 'Word', value: 'a' }, prefix: [], args: [], redirects: [] },
        right: { type: 'Command', name: { type: 'Word', value: 'b' }, prefix: [], args: [], redirects: [] },
      }
      expect(andList.operator).toBe('&&')
    })

    it('should support || operator', () => {
      const orList: List = {
        type: 'List',
        operator: '||',
        left: { type: 'Command', name: { type: 'Word', value: 'a' }, prefix: [], args: [], redirects: [] },
        right: { type: 'Command', name: { type: 'Word', value: 'b' }, prefix: [], args: [], redirects: [] },
      }
      expect(orList.operator).toBe('||')
    })

    it('should support ; operator', () => {
      const seqList: List = {
        type: 'List',
        operator: ';',
        left: { type: 'Command', name: { type: 'Word', value: 'a' }, prefix: [], args: [], redirects: [] },
        right: { type: 'Command', name: { type: 'Word', value: 'b' }, prefix: [], args: [], redirects: [] },
      }
      expect(seqList.operator).toBe(';')
    })

    it('should support & operator', () => {
      const bgList: List = {
        type: 'List',
        operator: '&',
        left: { type: 'Command', name: { type: 'Word', value: 'a' }, prefix: [], args: [], redirects: [] },
        right: { type: 'Command', name: { type: 'Word', value: 'b' }, prefix: [], args: [], redirects: [] },
      }
      expect(bgList.operator).toBe('&')
    })
  })

  describe('Word', () => {
    it('should have type "Word"', () => {
      const word: Word = {
        type: 'Word',
        value: 'hello',
      }
      expect(word.type).toBe('Word')
    })

    it('should have value string', () => {
      const word: Word = {
        type: 'Word',
        value: 'test',
      }
      expect(word.value).toBe('test')
    })

    it('should optionally have quoted style', () => {
      const singleQuoted: Word = { type: 'Word', value: 'hello', quoted: 'single' }
      const doubleQuoted: Word = { type: 'Word', value: 'hello', quoted: 'double' }
      const ansiQuoted: Word = { type: 'Word', value: 'hello', quoted: 'ansi-c' }
      const localeQuoted: Word = { type: 'Word', value: 'hello', quoted: 'locale' }

      expect(singleQuoted.quoted).toBe('single')
      expect(doubleQuoted.quoted).toBe('double')
      expect(ansiQuoted.quoted).toBe('ansi-c')
      expect(localeQuoted.quoted).toBe('locale')
    })

    it('should optionally have expansions array', () => {
      const wordWithExpansion: Word = {
        type: 'Word',
        value: 'hello $USER',
        expansions: [
          { type: 'ParameterExpansion', start: 6, end: 11, content: 'USER' },
        ],
      }
      expect(wordWithExpansion.expansions).toHaveLength(1)
    })
  })

  describe('Redirect', () => {
    it('should have type "Redirect"', () => {
      const redirect: Redirect = {
        type: 'Redirect',
        op: '>',
        target: { type: 'Word', value: 'file.txt' },
      }
      expect(redirect.type).toBe('Redirect')
    })

    it('should support all redirect operators', () => {
      const ops: Redirect['op'][] = ['>', '>>', '<', '<<', '<<<', '>&', '<&', '<>', '>|']
      ops.forEach((op) => {
        const redirect: Redirect = {
          type: 'Redirect',
          op,
          target: { type: 'Word', value: 'file' },
        }
        expect(redirect.op).toBe(op)
      })
    })

    it('should optionally have file descriptor', () => {
      const stderrRedirect: Redirect = {
        type: 'Redirect',
        op: '>&',
        fd: 2,
        target: { type: 'Word', value: '1' },
      }
      expect(stderrRedirect.fd).toBe(2)
    })
  })

  describe('Assignment', () => {
    it('should have type "Assignment"', () => {
      const assignment: Assignment = {
        type: 'Assignment',
        name: 'FOO',
        value: { type: 'Word', value: 'bar' },
        operator: '=',
      }
      expect(assignment.type).toBe('Assignment')
    })

    it('should have name string', () => {
      const assignment: Assignment = {
        type: 'Assignment',
        name: 'MY_VAR',
        value: { type: 'Word', value: 'value' },
        operator: '=',
      }
      expect(assignment.name).toBe('MY_VAR')
    })

    it('should allow null value', () => {
      const emptyAssignment: Assignment = {
        type: 'Assignment',
        name: 'EMPTY',
        value: null,
        operator: '=',
      }
      expect(emptyAssignment.value).toBeNull()
    })

    it('should support += operator', () => {
      const appendAssignment: Assignment = {
        type: 'Assignment',
        name: 'PATH',
        value: { type: 'Word', value: '/usr/local/bin' },
        operator: '+=',
      }
      expect(appendAssignment.operator).toBe('+=')
    })
  })

  describe('Subshell', () => {
    it('should have type "Subshell"', () => {
      const subshell: Subshell = {
        type: 'Subshell',
        body: [],
      }
      expect(subshell.type).toBe('Subshell')
    })

    it('should have body array', () => {
      const subshell: Subshell = {
        type: 'Subshell',
        body: [
          { type: 'Command', name: { type: 'Word', value: 'cd' }, prefix: [], args: [{ type: 'Word', value: '/tmp' }], redirects: [] },
          { type: 'Command', name: { type: 'Word', value: 'ls' }, prefix: [], args: [], redirects: [] },
        ],
      }
      expect(subshell.body).toHaveLength(2)
    })
  })

  describe('CompoundCommand', () => {
    it('should have type "CompoundCommand"', () => {
      const compound: CompoundCommand = {
        type: 'CompoundCommand',
        kind: 'if',
        body: [],
      }
      expect(compound.type).toBe('CompoundCommand')
    })

    it('should support all compound command kinds', () => {
      const kinds: CompoundCommand['kind'][] = ['if', 'for', 'while', 'until', 'case', 'select', 'brace', 'arithmetic']
      kinds.forEach((kind) => {
        const compound: CompoundCommand = {
          type: 'CompoundCommand',
          kind,
          body: [],
        }
        expect(compound.kind).toBe(kind)
      })
    })
  })

  describe('FunctionDef', () => {
    it('should have type "FunctionDef"', () => {
      const funcDef: FunctionDef = {
        type: 'FunctionDef',
        name: 'myFunction',
        body: { type: 'CompoundCommand', kind: 'brace', body: [] },
      }
      expect(funcDef.type).toBe('FunctionDef')
    })

    it('should have name string', () => {
      const funcDef: FunctionDef = {
        type: 'FunctionDef',
        name: 'greet',
        body: { type: 'Command', name: { type: 'Word', value: 'echo' }, prefix: [], args: [{ type: 'Word', value: 'Hello' }], redirects: [] },
      }
      expect(funcDef.name).toBe('greet')
    })
  })

  describe('Expansion', () => {
    it('should support ParameterExpansion type', () => {
      const expansion: Expansion = {
        type: 'ParameterExpansion',
        start: 0,
        end: 5,
        content: 'VAR',
      }
      expect(expansion.type).toBe('ParameterExpansion')
    })

    it('should support CommandSubstitution type', () => {
      const expansion: Expansion = {
        type: 'CommandSubstitution',
        start: 0,
        end: 10,
        content: 'pwd',
      }
      expect(expansion.type).toBe('CommandSubstitution')
    })

    it('should support ArithmeticExpansion type', () => {
      const expansion: Expansion = {
        type: 'ArithmeticExpansion',
        start: 0,
        end: 8,
        content: '1 + 2',
      }
      expect(expansion.type).toBe('ArithmeticExpansion')
    })

    it('should support ProcessSubstitution type', () => {
      const expansion: Expansion = {
        type: 'ProcessSubstitution',
        start: 0,
        end: 10,
        content: 'cat file',
      }
      expect(expansion.type).toBe('ProcessSubstitution')
    })
  })
})

// ============================================================================
// Type Guard Tests
// ============================================================================

describe('Type Guards', () => {
  describe('isProgram', () => {
    it('should return true for Program nodes', () => {
      const program: Program = { type: 'Program', body: [] }
      expect(isProgram(program)).toBe(true)
    })

    it('should return false for non-Program nodes', () => {
      const command: Command = { type: 'Command', name: { type: 'Word', value: 'ls' }, prefix: [], args: [], redirects: [] }
      expect(isProgram(command)).toBe(false)
    })

    it('should return false for null/undefined', () => {
      expect(isProgram(null)).toBe(false)
      expect(isProgram(undefined)).toBe(false)
    })
  })

  describe('isCommand', () => {
    it('should return true for Command nodes', () => {
      const command: Command = { type: 'Command', name: { type: 'Word', value: 'ls' }, prefix: [], args: [], redirects: [] }
      expect(isCommand(command)).toBe(true)
    })

    it('should return false for Pipeline nodes', () => {
      const pipeline: Pipeline = { type: 'Pipeline', negated: false, commands: [] }
      expect(isCommand(pipeline)).toBe(false)
    })

    it('should return false for non-objects', () => {
      expect(isCommand('string')).toBe(false)
      expect(isCommand(123)).toBe(false)
      expect(isCommand(null)).toBe(false)
    })
  })

  describe('isPipeline', () => {
    it('should return true for Pipeline nodes', () => {
      const pipeline: Pipeline = { type: 'Pipeline', negated: false, commands: [] }
      expect(isPipeline(pipeline)).toBe(true)
    })

    it('should return false for Command nodes', () => {
      const command: Command = { type: 'Command', name: { type: 'Word', value: 'ls' }, prefix: [], args: [], redirects: [] }
      expect(isPipeline(command)).toBe(false)
    })
  })

  describe('isList', () => {
    it('should return true for List nodes', () => {
      const list: List = {
        type: 'List',
        operator: '&&',
        left: { type: 'Command', name: { type: 'Word', value: 'a' }, prefix: [], args: [], redirects: [] },
        right: { type: 'Command', name: { type: 'Word', value: 'b' }, prefix: [], args: [], redirects: [] },
      }
      expect(isList(list)).toBe(true)
    })

    it('should return false for non-List nodes', () => {
      const pipeline: Pipeline = { type: 'Pipeline', negated: false, commands: [] }
      expect(isList(pipeline)).toBe(false)
    })
  })

  describe('isWord', () => {
    it('should return true for Word nodes', () => {
      const word: Word = { type: 'Word', value: 'hello' }
      expect(isWord(word)).toBe(true)
    })

    it('should return false for non-Word nodes', () => {
      const redirect: Redirect = { type: 'Redirect', op: '>', target: { type: 'Word', value: 'file' } }
      expect(isWord(redirect)).toBe(false)
    })
  })

  describe('isRedirect', () => {
    it('should return true for Redirect nodes', () => {
      const redirect: Redirect = { type: 'Redirect', op: '>', target: { type: 'Word', value: 'file' } }
      expect(isRedirect(redirect)).toBe(true)
    })

    it('should return false for non-Redirect nodes', () => {
      const word: Word = { type: 'Word', value: 'hello' }
      expect(isRedirect(word)).toBe(false)
    })
  })

  describe('isAssignment', () => {
    it('should return true for Assignment nodes', () => {
      const assignment: Assignment = { type: 'Assignment', name: 'FOO', value: { type: 'Word', value: 'bar' }, operator: '=' }
      expect(isAssignment(assignment)).toBe(true)
    })

    it('should return false for non-Assignment nodes', () => {
      const word: Word = { type: 'Word', value: 'hello' }
      expect(isAssignment(word)).toBe(false)
    })
  })

  describe('isSubshell', () => {
    it('should return true for Subshell nodes', () => {
      const subshell: Subshell = { type: 'Subshell', body: [] }
      expect(isSubshell(subshell)).toBe(true)
    })

    it('should return false for non-Subshell nodes', () => {
      const command: Command = { type: 'Command', name: { type: 'Word', value: 'ls' }, prefix: [], args: [], redirects: [] }
      expect(isSubshell(command)).toBe(false)
    })
  })

  describe('isCompoundCommand', () => {
    it('should return true for CompoundCommand nodes', () => {
      const compound: CompoundCommand = { type: 'CompoundCommand', kind: 'if', body: [] }
      expect(isCompoundCommand(compound)).toBe(true)
    })

    it('should return false for non-CompoundCommand nodes', () => {
      const subshell: Subshell = { type: 'Subshell', body: [] }
      expect(isCompoundCommand(subshell)).toBe(false)
    })
  })

  describe('isFunctionDef', () => {
    it('should return true for FunctionDef nodes', () => {
      const funcDef: FunctionDef = {
        type: 'FunctionDef',
        name: 'myFunc',
        body: { type: 'CompoundCommand', kind: 'brace', body: [] },
      }
      expect(isFunctionDef(funcDef)).toBe(true)
    })

    it('should return false for non-FunctionDef nodes', () => {
      const command: Command = { type: 'Command', name: { type: 'Word', value: 'ls' }, prefix: [], args: [], redirects: [] }
      expect(isFunctionDef(command)).toBe(false)
    })
  })

  describe('isExpansion', () => {
    it('should return true for Expansion objects', () => {
      const expansion: Expansion = { type: 'ParameterExpansion', start: 0, end: 5, content: 'VAR' }
      expect(isExpansion(expansion)).toBe(true)
    })

    it('should return false for non-Expansion objects', () => {
      const word: Word = { type: 'Word', value: 'hello' }
      expect(isExpansion(word)).toBe(false)
    })
  })

  describe('isBashNode', () => {
    it('should return true for any valid BashNode', () => {
      const nodes: BashNode[] = [
        { type: 'Program', body: [] },
        { type: 'Command', name: { type: 'Word', value: 'ls' }, prefix: [], args: [], redirects: [] },
        { type: 'Pipeline', negated: false, commands: [] },
        { type: 'List', operator: '&&', left: { type: 'Command', name: null, prefix: [], args: [], redirects: [] }, right: { type: 'Command', name: null, prefix: [], args: [], redirects: [] } },
        { type: 'Subshell', body: [] },
        { type: 'CompoundCommand', kind: 'if', body: [] },
        { type: 'FunctionDef', name: 'f', body: { type: 'Command', name: null, prefix: [], args: [], redirects: [] } },
        { type: 'Word', value: 'hello' },
        { type: 'Redirect', op: '>', target: { type: 'Word', value: 'file' } },
        { type: 'Assignment', name: 'FOO', value: null, operator: '=' },
      ]

      nodes.forEach((node) => {
        expect(isBashNode(node)).toBe(true)
      })
    })

    it('should return false for invalid nodes', () => {
      expect(isBashNode(null)).toBe(false)
      expect(isBashNode(undefined)).toBe(false)
      expect(isBashNode({})).toBe(false)
      expect(isBashNode({ type: 'Unknown' })).toBe(false)
      expect(isBashNode('string')).toBe(false)
    })
  })

  describe('getNodeType', () => {
    it('should return the node type string', () => {
      const command: Command = { type: 'Command', name: { type: 'Word', value: 'ls' }, prefix: [], args: [], redirects: [] }
      expect(getNodeType(command)).toBe('Command')
    })

    it('should return undefined for non-nodes', () => {
      expect(getNodeType(null)).toBeUndefined()
      expect(getNodeType(undefined)).toBeUndefined()
      expect(getNodeType('string')).toBeUndefined()
    })
  })
})

// ============================================================================
// Node Type Constants Tests
// ============================================================================

describe('Node Type Constants', () => {
  describe('NodeType enum', () => {
    it('should have all node types', () => {
      expect(NodeType.Program).toBe('Program')
      expect(NodeType.Command).toBe('Command')
      expect(NodeType.Pipeline).toBe('Pipeline')
      expect(NodeType.List).toBe('List')
      expect(NodeType.Subshell).toBe('Subshell')
      expect(NodeType.CompoundCommand).toBe('CompoundCommand')
      expect(NodeType.FunctionDef).toBe('FunctionDef')
      expect(NodeType.Word).toBe('Word')
      expect(NodeType.Redirect).toBe('Redirect')
      expect(NodeType.Assignment).toBe('Assignment')
    })
  })

  describe('NODE_TYPES array', () => {
    it('should contain all node type strings', () => {
      expect(NODE_TYPES).toContain('Program')
      expect(NODE_TYPES).toContain('Command')
      expect(NODE_TYPES).toContain('Pipeline')
      expect(NODE_TYPES).toContain('List')
      expect(NODE_TYPES).toContain('Subshell')
      expect(NODE_TYPES).toContain('CompoundCommand')
      expect(NODE_TYPES).toContain('FunctionDef')
      expect(NODE_TYPES).toContain('Word')
      expect(NODE_TYPES).toContain('Redirect')
      expect(NODE_TYPES).toContain('Assignment')
    })

    it('should have exactly 10 node types', () => {
      expect(NODE_TYPES).toHaveLength(10)
    })
  })
})

// ============================================================================
// AST Factory Function Tests
// ============================================================================

describe('AST Factory Functions', () => {
  describe('createProgram', () => {
    it('should create a Program with empty body', () => {
      const program = createProgram()
      expect(program.type).toBe('Program')
      expect(program.body).toEqual([])
    })

    it('should create a Program with provided body', () => {
      const cmd: Command = { type: 'Command', name: { type: 'Word', value: 'ls' }, prefix: [], args: [], redirects: [] }
      const program = createProgram([cmd])
      expect(program.body).toHaveLength(1)
    })

    it('should create a Program with errors', () => {
      const errors: ParseError[] = [{ message: 'error', line: 1, column: 1 }]
      const program = createProgram([], errors)
      expect(program.errors).toEqual(errors)
    })
  })

  describe('createCommand', () => {
    it('should create a Command with name', () => {
      const command = createCommand('ls')
      expect(command.type).toBe('Command')
      expect(command.name?.value).toBe('ls')
      expect(command.prefix).toEqual([])
      expect(command.args).toEqual([])
      expect(command.redirects).toEqual([])
    })

    it('should create a Command with args', () => {
      const command = createCommand('ls', ['-la', '/tmp'])
      expect(command.args).toHaveLength(2)
      expect(command.args[0].value).toBe('-la')
      expect(command.args[1].value).toBe('/tmp')
    })

    it('should create a Command with null name', () => {
      const command = createCommand(null)
      expect(command.name).toBeNull()
    })
  })

  describe('createPipeline', () => {
    it('should create a Pipeline', () => {
      const cmd1 = createCommand('ls')
      const cmd2 = createCommand('grep', ['foo'])
      const pipeline = createPipeline([cmd1, cmd2])
      expect(pipeline.type).toBe('Pipeline')
      expect(pipeline.negated).toBe(false)
      expect(pipeline.commands).toHaveLength(2)
    })

    it('should create a negated Pipeline', () => {
      const cmd = createCommand('test', ['-f', 'file'])
      const pipeline = createPipeline([cmd], true)
      expect(pipeline.negated).toBe(true)
    })
  })

  describe('createList', () => {
    it('should create a List with && operator', () => {
      const left = createCommand('mkdir', ['foo'])
      const right = createCommand('cd', ['foo'])
      const list = createList(left, '&&', right)
      expect(list.type).toBe('List')
      expect(list.operator).toBe('&&')
    })

    it('should create a List with || operator', () => {
      const left = createCommand('test', ['-f', 'file'])
      const right = createCommand('touch', ['file'])
      const list = createList(left, '||', right)
      expect(list.operator).toBe('||')
    })

    it('should create a List with ; operator', () => {
      const left = createCommand('echo', ['hello'])
      const right = createCommand('echo', ['world'])
      const list = createList(left, ';', right)
      expect(list.operator).toBe(';')
    })
  })

  describe('createWord', () => {
    it('should create a Word with value', () => {
      const word = createWord('hello')
      expect(word.type).toBe('Word')
      expect(word.value).toBe('hello')
    })

    it('should create a quoted Word', () => {
      const word = createWord('hello world', 'double')
      expect(word.quoted).toBe('double')
    })
  })

  describe('createRedirect', () => {
    it('should create a Redirect', () => {
      const redirect = createRedirect('>', 'output.txt')
      expect(redirect.type).toBe('Redirect')
      expect(redirect.op).toBe('>')
      expect(redirect.target.value).toBe('output.txt')
    })

    it('should create a Redirect with file descriptor', () => {
      const redirect = createRedirect('>&', '1', 2)
      expect(redirect.fd).toBe(2)
    })
  })

  describe('createAssignment', () => {
    it('should create an Assignment', () => {
      const assignment = createAssignment('FOO', 'bar')
      expect(assignment.type).toBe('Assignment')
      expect(assignment.name).toBe('FOO')
      expect(assignment.value?.value).toBe('bar')
      expect(assignment.operator).toBe('=')
    })

    it('should create an Assignment with += operator', () => {
      const assignment = createAssignment('PATH', '/usr/local/bin', '+=')
      expect(assignment.operator).toBe('+=')
    })

    it('should create an Assignment with null value', () => {
      const assignment = createAssignment('EMPTY', null)
      expect(assignment.value).toBeNull()
    })
  })
})

// ============================================================================
// AST Serialization/Deserialization Tests
// ============================================================================

describe('AST Serialization', () => {
  describe('serializeAST', () => {
    it('should serialize a Program to JSON string', () => {
      const program: Program = {
        type: 'Program',
        body: [
          { type: 'Command', name: { type: 'Word', value: 'ls' }, prefix: [], args: [], redirects: [] },
        ],
      }
      const json = serializeAST(program)
      expect(typeof json).toBe('string')
      expect(json).toContain('"type":"Program"')
    })

    it('should serialize complex nested structures', () => {
      const program: Program = {
        type: 'Program',
        body: [
          {
            type: 'Pipeline',
            negated: false,
            commands: [
              { type: 'Command', name: { type: 'Word', value: 'ls' }, prefix: [], args: [{ type: 'Word', value: '-la' }], redirects: [] },
              { type: 'Command', name: { type: 'Word', value: 'grep' }, prefix: [], args: [{ type: 'Word', value: 'foo' }], redirects: [] },
            ],
          },
        ],
      }
      const json = serializeAST(program)
      expect(json).toContain('Pipeline')
      expect(json).toContain('grep')
    })

    it('should produce valid JSON', () => {
      const program: Program = { type: 'Program', body: [] }
      const json = serializeAST(program)
      expect(() => JSON.parse(json)).not.toThrow()
    })
  })

  describe('deserializeAST', () => {
    it('should deserialize a JSON string to Program', () => {
      const json = '{"type":"Program","body":[]}'
      const program = deserializeAST(json)
      expect(program.type).toBe('Program')
      expect(program.body).toEqual([])
    })

    it('should deserialize complex structures', () => {
      const original: Program = {
        type: 'Program',
        body: [
          {
            type: 'Command',
            name: { type: 'Word', value: 'echo' },
            prefix: [{ type: 'Assignment', name: 'FOO', value: { type: 'Word', value: 'bar' }, operator: '=' }],
            args: [{ type: 'Word', value: '$FOO' }],
            redirects: [{ type: 'Redirect', op: '>', target: { type: 'Word', value: 'out.txt' } }],
          },
        ],
      }
      const json = serializeAST(original)
      const restored = deserializeAST(json)
      expect(restored).toEqual(original)
    })

    it('should throw on invalid JSON', () => {
      expect(() => deserializeAST('invalid')).toThrow()
    })

    it('should throw on invalid AST structure', () => {
      expect(() => deserializeAST('{"foo":"bar"}')).toThrow()
    })

    it('should preserve round-trip integrity', () => {
      const original: Program = {
        type: 'Program',
        body: [
          {
            type: 'List',
            operator: '&&',
            left: { type: 'Command', name: { type: 'Word', value: 'mkdir' }, prefix: [], args: [{ type: 'Word', value: 'foo' }], redirects: [] },
            right: { type: 'Command', name: { type: 'Word', value: 'cd' }, prefix: [], args: [{ type: 'Word', value: 'foo' }], redirects: [] },
          },
        ],
      }
      const json = serializeAST(original)
      const restored = deserializeAST(json)
      const reJson = serializeAST(restored)
      expect(reJson).toBe(json)
    })
  })
})

// ============================================================================
// BashNode Union Type Tests
// ============================================================================

describe('BashNode Union Type', () => {
  it('should cover all node types', () => {
    // This test verifies that BashNode is a union of all node types
    // TypeScript will fail compilation if any type is missing
    const nodes: BashNode[] = [
      { type: 'Program', body: [] } as Program,
      { type: 'List', operator: '&&', left: { type: 'Word', value: '' }, right: { type: 'Word', value: '' } } as List,
      { type: 'Pipeline', negated: false, commands: [] } as Pipeline,
      { type: 'Command', name: null, prefix: [], args: [], redirects: [] } as Command,
      { type: 'Subshell', body: [] } as Subshell,
      { type: 'CompoundCommand', kind: 'if', body: [] } as CompoundCommand,
      { type: 'FunctionDef', name: 'f', body: { type: 'Word', value: '' } as Word } as FunctionDef,
      { type: 'Word', value: '' } as Word,
      { type: 'Redirect', op: '>', target: { type: 'Word', value: '' } } as Redirect,
      { type: 'Assignment', name: '', value: null, operator: '=' } as Assignment,
    ]

    // All nodes should be valid BashNodes
    nodes.forEach((node) => {
      expect(node.type).toBeDefined()
    })
  })

  it('should allow type-safe switching on node type', () => {
    function processNode(node: BashNode): string {
      switch (node.type) {
        case 'Program':
          return `Program with ${(node as Program).body.length} statements`
        case 'Command':
          return `Command: ${(node as Command).name?.value ?? 'assignment'}`
        case 'Pipeline':
          return `Pipeline with ${(node as Pipeline).commands.length} commands`
        case 'List':
          return `List with ${(node as List).operator} operator`
        case 'Subshell':
          return `Subshell with ${(node as Subshell).body.length} commands`
        case 'CompoundCommand':
          return `CompoundCommand: ${(node as CompoundCommand).kind}`
        case 'FunctionDef':
          return `Function: ${(node as FunctionDef).name}`
        case 'Word':
          return `Word: ${(node as Word).value}`
        case 'Redirect':
          return `Redirect: ${(node as Redirect).op}`
        case 'Assignment':
          return `Assignment: ${(node as Assignment).name}`
        default:
          return 'Unknown'
      }
    }

    const cmd: Command = { type: 'Command', name: { type: 'Word', value: 'ls' }, prefix: [], args: [], redirects: [] }
    expect(processNode(cmd)).toBe('Command: ls')

    const pipeline: Pipeline = { type: 'Pipeline', negated: false, commands: [cmd, cmd] }
    expect(processNode(pipeline)).toBe('Pipeline with 2 commands')
  })
})

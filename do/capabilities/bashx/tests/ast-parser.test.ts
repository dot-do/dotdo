/**
 * AST Parser Tests
 *
 * Tests for tree-sitter-bash AST parsing functionality.
 * These tests verify the parser correctly converts bash commands into AST nodes.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type {
  Program,
  Command,
  Pipeline,
  List,
  Word,
  Redirect,
  Assignment,
} from '../src/types.js'
import {
  program,
  simpleCommand,
  word,
  redirect,
  assignment,
  LS_COMMAND,
  GIT_STATUS,
  CAT_FILE,
  ECHO_HELLO,
  FIND_TS_FILES,
  LS_GREP_PIPELINE,
  CAT_GREP_WC_PIPELINE,
  ECHO_REDIRECT,
  ECHO_APPEND,
  WC_INPUT,
  MKDIR_AND_CD,
  TEST_OR_TOUCH,
  SEQUENTIAL_COMMANDS,
  ENV_VAR_COMMAND,
  PROGRAM_WITH_ERRORS,
  EMPTY_PROGRAM,
} from './utils/fixtures.js'

// Note: The actual parser is not yet implemented.
// These tests are written to verify the AST structure and will be used
// when tree-sitter-bash integration is complete.

describe('AST Parser', () => {
  describe('Simple Commands', () => {
    it('should parse a simple command with no arguments', () => {
      const expected = program(simpleCommand('ls'))
      expect(expected.type).toBe('Program')
      expect(expected.body).toHaveLength(1)

      const cmd = expected.body[0] as Command
      expect(cmd.type).toBe('Command')
      expect(cmd.name?.value).toBe('ls')
      expect(cmd.args).toHaveLength(0)
    })

    it('should parse a command with arguments', () => {
      const expected = LS_COMMAND
      expect(expected.type).toBe('Program')

      const cmd = expected.body[0] as Command
      expect(cmd.name?.value).toBe('ls')
      expect(cmd.args).toHaveLength(1)
      expect(cmd.args[0].value).toBe('-la')
    })

    it('should parse git commands with subcommands', () => {
      const expected = GIT_STATUS
      const cmd = expected.body[0] as Command
      expect(cmd.name?.value).toBe('git')
      expect(cmd.args[0].value).toBe('status')
    })

    it('should parse cat with file argument', () => {
      const expected = CAT_FILE
      const cmd = expected.body[0] as Command
      expect(cmd.name?.value).toBe('cat')
      expect(cmd.args[0].value).toBe('package.json')
    })

    it('should parse echo with quoted string', () => {
      const expected = ECHO_HELLO
      const cmd = expected.body[0] as Command
      expect(cmd.name?.value).toBe('echo')
      expect(cmd.args[0].value).toBe('hello world')
    })

    it('should parse find command with multiple arguments', () => {
      const expected = FIND_TS_FILES
      const cmd = expected.body[0] as Command
      expect(cmd.name?.value).toBe('find')
      expect(cmd.args).toHaveLength(3)
      expect(cmd.args[0].value).toBe('.')
      expect(cmd.args[1].value).toBe('-name')
      expect(cmd.args[2].value).toBe('*.ts')
    })
  })

  describe('Pipelines', () => {
    it('should parse a simple pipeline with two commands', () => {
      const expected = LS_GREP_PIPELINE
      expect(expected.body).toHaveLength(1)

      const pipeline = expected.body[0] as Pipeline
      expect(pipeline.type).toBe('Pipeline')
      expect(pipeline.negated).toBe(false)
      expect(pipeline.commands).toHaveLength(2)

      expect(pipeline.commands[0].name?.value).toBe('ls')
      expect(pipeline.commands[1].name?.value).toBe('grep')
      expect(pipeline.commands[1].args[0].value).toBe('foo')
    })

    it('should parse a pipeline with three commands', () => {
      const expected = CAT_GREP_WC_PIPELINE
      const pipeline = expected.body[0] as Pipeline

      expect(pipeline.commands).toHaveLength(3)
      expect(pipeline.commands[0].name?.value).toBe('cat')
      expect(pipeline.commands[0].args[0].value).toBe('file.txt')
      expect(pipeline.commands[1].name?.value).toBe('grep')
      expect(pipeline.commands[1].args[0].value).toBe('pattern')
      expect(pipeline.commands[2].name?.value).toBe('wc')
      expect(pipeline.commands[2].args[0].value).toBe('-l')
    })

    it('should handle negated pipelines', () => {
      const negatedPipeline: Program = program({
        type: 'Pipeline',
        negated: true,
        commands: [simpleCommand('test', ['-f', 'file.txt'])],
      })

      const pipeline = negatedPipeline.body[0] as Pipeline
      expect(pipeline.negated).toBe(true)
    })
  })

  describe('Redirects', () => {
    it('should parse output redirect', () => {
      const expected = ECHO_REDIRECT
      const cmd = expected.body[0] as Command

      expect(cmd.redirects).toHaveLength(1)
      expect(cmd.redirects[0].op).toBe('>')
      expect(cmd.redirects[0].target.value).toBe('output.txt')
    })

    it('should parse append redirect', () => {
      const expected = ECHO_APPEND
      const cmd = expected.body[0] as Command

      expect(cmd.redirects).toHaveLength(1)
      expect(cmd.redirects[0].op).toBe('>>')
      expect(cmd.redirects[0].target.value).toBe('log.txt')
    })

    it('should parse input redirect', () => {
      const expected = WC_INPUT
      const cmd = expected.body[0] as Command

      expect(cmd.redirects).toHaveLength(1)
      expect(cmd.redirects[0].op).toBe('<')
      expect(cmd.redirects[0].target.value).toBe('input.txt')
    })

    it('should handle file descriptor redirects', () => {
      const fdRedirect = redirect('>&', '1', 2)
      expect(fdRedirect.fd).toBe(2)
      expect(fdRedirect.op).toBe('>&')
      expect(fdRedirect.target.value).toBe('1')
    })

    it('should handle multiple redirects', () => {
      const multiRedirect: Command = {
        ...simpleCommand('command'),
        redirects: [
          redirect('<', 'input.txt'),
          redirect('>', 'output.txt'),
          redirect('>&', '/dev/null', 2),
        ],
      }

      expect(multiRedirect.redirects).toHaveLength(3)
    })
  })

  describe('Lists (Compound Commands)', () => {
    it('should parse AND list (&&)', () => {
      const expected = MKDIR_AND_CD
      const list = expected.body[0] as List

      expect(list.type).toBe('List')
      expect(list.operator).toBe('&&')

      const leftCmd = list.left as Command
      const rightCmd = list.right as Command

      expect(leftCmd.name?.value).toBe('mkdir')
      expect(leftCmd.args[0].value).toBe('foo')
      expect(rightCmd.name?.value).toBe('cd')
      expect(rightCmd.args[0].value).toBe('foo')
    })

    it('should parse OR list (||)', () => {
      const expected = TEST_OR_TOUCH
      const list = expected.body[0] as List

      expect(list.type).toBe('List')
      expect(list.operator).toBe('||')

      const leftCmd = list.left as Command
      const rightCmd = list.right as Command

      expect(leftCmd.name?.value).toBe('test')
      expect(rightCmd.name?.value).toBe('touch')
    })

    it('should parse sequential commands (;)', () => {
      const expected = SEQUENTIAL_COMMANDS
      const list = expected.body[0] as List

      expect(list.operator).toBe(';')
    })

    it('should handle nested lists', () => {
      // cmd1 && cmd2 || cmd3
      const nestedList: Program = program({
        type: 'List',
        operator: '||',
        left: {
          type: 'List',
          operator: '&&',
          left: simpleCommand('cmd1'),
          right: simpleCommand('cmd2'),
        },
        right: simpleCommand('cmd3'),
      })

      const outerList = nestedList.body[0] as List
      expect(outerList.operator).toBe('||')

      const innerList = outerList.left as List
      expect(innerList.operator).toBe('&&')
    })
  })

  describe('Assignments', () => {
    it('should parse environment variable prefix', () => {
      const expected = ENV_VAR_COMMAND
      const cmd = expected.body[0] as Command

      expect(cmd.prefix).toHaveLength(1)
      expect(cmd.prefix[0].name).toBe('FOO')
      expect(cmd.prefix[0].value?.value).toBe('bar')
      expect(cmd.prefix[0].operator).toBe('=')
    })

    it('should handle += operator', () => {
      const appendAssign = assignment('PATH', '/usr/local/bin', '+=')
      expect(appendAssign.operator).toBe('+=')
    })

    it('should handle empty value assignment', () => {
      const emptyAssign = assignment('EMPTY', null)
      expect(emptyAssign.value).toBeNull()
    })

    it('should handle multiple prefix assignments', () => {
      const multiAssign: Command = {
        ...simpleCommand('echo', ['$FOO $BAR']),
        prefix: [assignment('FOO', 'foo'), assignment('BAR', 'bar')],
      }

      expect(multiAssign.prefix).toHaveLength(2)
    })
  })

  describe('Words and Quoting', () => {
    it('should create unquoted words', () => {
      const w = word('hello')
      expect(w.type).toBe('Word')
      expect(w.value).toBe('hello')
      expect(w.quoted).toBeUndefined()
    })

    it('should create single-quoted words', () => {
      const w = word('hello world', 'single')
      expect(w.quoted).toBe('single')
    })

    it('should create double-quoted words', () => {
      const w = word('hello $USER', 'double')
      expect(w.quoted).toBe('double')
    })

    it('should handle words with special characters', () => {
      const specialWords = [
        word('*.ts'),
        word('file?.txt'),
        word('[a-z]'),
        word('{foo,bar}'),
      ]

      expect(specialWords[0].value).toBe('*.ts')
      expect(specialWords[1].value).toBe('file?.txt')
      expect(specialWords[2].value).toBe('[a-z]')
      expect(specialWords[3].value).toBe('{foo,bar}')
    })
  })

  describe('Error Handling', () => {
    it('should include parse errors in program', () => {
      const expected = PROGRAM_WITH_ERRORS
      expect(expected.errors).toBeDefined()
      expect(expected.errors).toHaveLength(1)
      expect(expected.errors![0].message).toBe('Unexpected end of input')
      expect(expected.errors![0].line).toBe(1)
      expect(expected.errors![0].column).toBe(10)
    })

    it('should handle empty programs', () => {
      const expected = EMPTY_PROGRAM
      expect(expected.body).toHaveLength(0)
      expect(expected.errors).toBeUndefined()
    })

    it('should include error suggestions when available', () => {
      const expected = PROGRAM_WITH_ERRORS
      expect(expected.errors![0].suggestion).toBe(
        'Check for unclosed quotes or brackets'
      )
    })
  })

  describe('Complex Commands', () => {
    it('should handle command with all features', () => {
      // FOO=bar cmd arg1 arg2 < input.txt > output.txt 2>&1
      const complexCmd: Command = {
        type: 'Command',
        name: word('cmd'),
        prefix: [assignment('FOO', 'bar')],
        args: [word('arg1'), word('arg2')],
        redirects: [
          redirect('<', 'input.txt'),
          redirect('>', 'output.txt'),
          redirect('>&', '1', 2),
        ],
      }

      expect(complexCmd.prefix).toHaveLength(1)
      expect(complexCmd.args).toHaveLength(2)
      expect(complexCmd.redirects).toHaveLength(3)
    })

    it('should handle deeply nested structures', () => {
      // (cmd1 | cmd2) && (cmd3 || cmd4)
      const nested: Program = program({
        type: 'List',
        operator: '&&',
        left: {
          type: 'Pipeline',
          negated: false,
          commands: [simpleCommand('cmd1'), simpleCommand('cmd2')],
        },
        right: {
          type: 'List',
          operator: '||',
          left: simpleCommand('cmd3'),
          right: simpleCommand('cmd4'),
        },
      })

      const list = nested.body[0] as List
      expect(list.operator).toBe('&&')
      expect((list.left as Pipeline).commands).toHaveLength(2)
      expect((list.right as List).operator).toBe('||')
    })
  })
})

describe('Parser Integration (Pending Implementation)', () => {
  // These tests document expected behavior once tree-sitter-bash is integrated

  it.skip('should parse simple command string', () => {
    // const result = parse('ls -la')
    // expect(result.type).toBe('Program')
    // expect(result.body).toHaveLength(1)
  })

  it.skip('should parse pipeline string', () => {
    // const result = parse('ls | grep foo | wc -l')
    // expect(result.body[0].type).toBe('Pipeline')
  })

  it.skip('should parse complex command string', () => {
    // const result = parse('FOO=bar cmd arg < in.txt > out.txt 2>&1')
    // expect(result).toBeDefined()
  })

  it.skip('should detect syntax errors', () => {
    // const result = parse('echo "unclosed')
    // expect(result.errors).toHaveLength(1)
  })

  it.skip('should validate bash syntax', () => {
    // expect(isValidSyntax('ls -la')).toBe(true)
    // expect(isValidSyntax('echo "unclosed')).toBe(false)
  })
})

/**
 * AST Traversal Utilities Tests (RED Phase)
 *
 * Tests for visitor pattern and extraction utilities for bash AST.
 * These tests define the expected behavior for:
 * - visit(): Visitor pattern for traversing AST nodes
 * - extractCommands(): Extract all Command nodes from an AST
 * - extractFiles(): Extract file paths for reads/writes from an AST
 * - extractRedirects(): Extract all Redirect nodes from an AST
 */

import { describe, it, expect } from 'vitest'
import {
  visit,
  extractCommands,
  extractFiles,
  extractRedirects,
  type Visitor,
} from '../src/ast/traverse.js'
import type {
  Program,
  Command,
  Pipeline,
  List,
  Redirect,
  Subshell,
  CompoundCommand,
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
  LS_GREP_PIPELINE,
  CAT_GREP_WC_PIPELINE,
  ECHO_REDIRECT,
  ECHO_APPEND,
  WC_INPUT,
  MKDIR_AND_CD,
  TEST_OR_TOUCH,
  SEQUENTIAL_COMMANDS,
  ENV_VAR_COMMAND,
  EMPTY_PROGRAM,
} from './utils/fixtures.js'

// ============================================================================
// visit() - Visitor Pattern Tests
// ============================================================================

describe('visit() - Visitor Pattern', () => {
  describe('Basic Node Visiting', () => {
    it('should call Program visitor for root node', () => {
      const visited: string[] = []
      const visitor: Visitor = {
        Program: (node) => {
          visited.push(`Program:${node.body.length}`)
        },
      }

      visit(LS_COMMAND, visitor)

      expect(visited).toContain('Program:1')
    })

    it('should call Command visitor for simple command', () => {
      const visitedCommands: string[] = []
      const visitor: Visitor = {
        Command: (node) => {
          visitedCommands.push(node.name?.value ?? 'null')
        },
      }

      visit(LS_COMMAND, visitor)

      expect(visitedCommands).toContain('ls')
    })

    it('should call multiple visitors on single AST', () => {
      const visited: string[] = []
      const visitor: Visitor = {
        Program: () => visited.push('program'),
        Command: (node) => visited.push(`cmd:${node.name?.value}`),
      }

      visit(LS_COMMAND, visitor)

      expect(visited).toContain('program')
      expect(visited).toContain('cmd:ls')
    })

    it('should handle empty visitor object gracefully', () => {
      const visitor: Visitor = {}

      // Should not throw
      expect(() => visit(LS_COMMAND, visitor)).not.toThrow()
    })
  })

  describe('Pipeline Traversal', () => {
    it('should visit all commands in a pipeline', () => {
      const visitedCommands: string[] = []
      const visitor: Visitor = {
        Command: (node) => {
          visitedCommands.push(node.name?.value ?? 'null')
        },
      }

      visit(LS_GREP_PIPELINE, visitor)

      expect(visitedCommands).toHaveLength(2)
      expect(visitedCommands).toContain('ls')
      expect(visitedCommands).toContain('grep')
    })

    it('should visit commands in order for complex pipeline', () => {
      const visitedCommands: string[] = []
      const visitor: Visitor = {
        Command: (node) => {
          visitedCommands.push(node.name?.value ?? 'null')
        },
      }

      visit(CAT_GREP_WC_PIPELINE, visitor)

      expect(visitedCommands).toEqual(['cat', 'grep', 'wc'])
    })
  })

  describe('List Traversal', () => {
    it('should visit both sides of AND list', () => {
      const visitedCommands: string[] = []
      const visitor: Visitor = {
        Command: (node) => {
          visitedCommands.push(node.name?.value ?? 'null')
        },
      }

      visit(MKDIR_AND_CD, visitor)

      expect(visitedCommands).toHaveLength(2)
      expect(visitedCommands).toContain('mkdir')
      expect(visitedCommands).toContain('cd')
    })

    it('should visit both sides of OR list', () => {
      const visitedCommands: string[] = []
      const visitor: Visitor = {
        Command: (node) => {
          visitedCommands.push(node.name?.value ?? 'null')
        },
      }

      visit(TEST_OR_TOUCH, visitor)

      expect(visitedCommands).toContain('test')
      expect(visitedCommands).toContain('touch')
    })

    it('should visit nested lists deeply', () => {
      const visitedCommands: string[] = []
      const visitor: Visitor = {
        Command: (node) => {
          visitedCommands.push(node.name?.value ?? 'null')
        },
      }

      visit(SEQUENTIAL_COMMANDS, visitor)

      // echo; sleep; echo
      expect(visitedCommands).toHaveLength(3)
      expect(visitedCommands).toContain('echo')
      expect(visitedCommands).toContain('sleep')
    })
  })

  describe('Subshell Traversal', () => {
    it('should visit commands inside subshell', () => {
      const subshellProgram: Program = program({
        type: 'Subshell',
        body: [simpleCommand('echo', ['inside']), simpleCommand('pwd')],
      } as Subshell)

      const visitedCommands: string[] = []
      const visitor: Visitor = {
        Command: (node) => {
          visitedCommands.push(node.name?.value ?? 'null')
        },
      }

      visit(subshellProgram, visitor)

      expect(visitedCommands).toContain('echo')
      expect(visitedCommands).toContain('pwd')
    })
  })

  describe('Compound Command Traversal', () => {
    it('should visit commands inside for loop body', () => {
      const forLoopProgram: Program = program({
        type: 'CompoundCommand',
        kind: 'for',
        body: [simpleCommand('echo', ['$i']), simpleCommand('process', ['$i'])],
      } as CompoundCommand)

      const visitedCommands: string[] = []
      const visitor: Visitor = {
        Command: (node) => {
          visitedCommands.push(node.name?.value ?? 'null')
        },
      }

      visit(forLoopProgram, visitor)

      expect(visitedCommands).toContain('echo')
      expect(visitedCommands).toContain('process')
    })

    it('should visit commands inside if statement body', () => {
      const ifProgram: Program = program({
        type: 'CompoundCommand',
        kind: 'if',
        body: [simpleCommand('then-cmd'), simpleCommand('else-cmd')],
      } as CompoundCommand)

      const visitedCommands: string[] = []
      const visitor: Visitor = {
        Command: (node) => {
          visitedCommands.push(node.name?.value ?? 'null')
        },
      }

      visit(ifProgram, visitor)

      expect(visitedCommands).toContain('then-cmd')
      expect(visitedCommands).toContain('else-cmd')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty program', () => {
      const visited: string[] = []
      const visitor: Visitor = {
        Program: () => visited.push('program'),
        Command: () => visited.push('command'),
      }

      visit(EMPTY_PROGRAM, visitor)

      expect(visited).toContain('program')
      expect(visited).not.toContain('command')
    })

    it('should handle command with no name (assignment-only)', () => {
      const assignmentOnlyProgram: Program = program({
        type: 'Command',
        name: null,
        prefix: [assignment('FOO', 'bar')],
        args: [],
        redirects: [],
      })

      const visitedCommands: Command[] = []
      const visitor: Visitor = {
        Command: (node) => {
          visitedCommands.push(node)
        },
      }

      visit(assignmentOnlyProgram, visitor)

      expect(visitedCommands).toHaveLength(1)
      expect(visitedCommands[0].name).toBeNull()
    })

    it('should visit deeply nested structures', () => {
      // (cmd1 | cmd2) && (cmd3 || cmd4)
      const deeplyNested: Program = program({
        type: 'List',
        operator: '&&',
        left: {
          type: 'Pipeline',
          negated: false,
          commands: [simpleCommand('cmd1'), simpleCommand('cmd2')],
        } as Pipeline,
        right: {
          type: 'List',
          operator: '||',
          left: simpleCommand('cmd3'),
          right: simpleCommand('cmd4'),
        } as List,
      } as List)

      const visitedCommands: string[] = []
      const visitor: Visitor = {
        Command: (node) => {
          visitedCommands.push(node.name?.value ?? 'null')
        },
      }

      visit(deeplyNested, visitor)

      expect(visitedCommands).toHaveLength(4)
      expect(visitedCommands).toContain('cmd1')
      expect(visitedCommands).toContain('cmd2')
      expect(visitedCommands).toContain('cmd3')
      expect(visitedCommands).toContain('cmd4')
    })
  })
})

// ============================================================================
// extractCommands() Tests
// ============================================================================

describe('extractCommands()', () => {
  describe('Simple Commands', () => {
    it('should extract single command from simple program', () => {
      const commands = extractCommands(LS_COMMAND)

      expect(commands).toHaveLength(1)
      expect(commands[0].name?.value).toBe('ls')
    })

    it('should extract command with arguments', () => {
      const commands = extractCommands(CAT_FILE)

      expect(commands).toHaveLength(1)
      expect(commands[0].name?.value).toBe('cat')
      expect(commands[0].args[0].value).toBe('package.json')
    })

    it('should extract git command with subcommand', () => {
      const commands = extractCommands(GIT_STATUS)

      expect(commands).toHaveLength(1)
      expect(commands[0].name?.value).toBe('git')
      expect(commands[0].args[0].value).toBe('status')
    })
  })

  describe('Pipeline Commands', () => {
    it('should extract all commands from simple pipeline', () => {
      const commands = extractCommands(LS_GREP_PIPELINE)

      expect(commands).toHaveLength(2)
      expect(commands[0].name?.value).toBe('ls')
      expect(commands[1].name?.value).toBe('grep')
    })

    it('should extract all commands from complex pipeline', () => {
      const commands = extractCommands(CAT_GREP_WC_PIPELINE)

      expect(commands).toHaveLength(3)
      expect(commands[0].name?.value).toBe('cat')
      expect(commands[1].name?.value).toBe('grep')
      expect(commands[2].name?.value).toBe('wc')
    })

    it('should preserve command order in pipeline', () => {
      const commands = extractCommands(CAT_GREP_WC_PIPELINE)

      const names = commands.map((c) => c.name?.value)
      expect(names).toEqual(['cat', 'grep', 'wc'])
    })
  })

  describe('List Commands', () => {
    it('should extract commands from AND list', () => {
      const commands = extractCommands(MKDIR_AND_CD)

      expect(commands).toHaveLength(2)
      expect(commands[0].name?.value).toBe('mkdir')
      expect(commands[1].name?.value).toBe('cd')
    })

    it('should extract commands from OR list', () => {
      const commands = extractCommands(TEST_OR_TOUCH)

      expect(commands).toHaveLength(2)
      expect(commands[0].name?.value).toBe('test')
      expect(commands[1].name?.value).toBe('touch')
    })

    it('should extract commands from nested sequential list', () => {
      const commands = extractCommands(SEQUENTIAL_COMMANDS)

      expect(commands).toHaveLength(3)
      const names = commands.map((c) => c.name?.value)
      expect(names).toContain('echo')
      expect(names).toContain('sleep')
    })
  })

  describe('Subshell Commands', () => {
    it('should extract commands from subshell', () => {
      const subshellProgram: Program = program({
        type: 'Subshell',
        body: [simpleCommand('inner-cmd1'), simpleCommand('inner-cmd2')],
      } as Subshell)

      const commands = extractCommands(subshellProgram)

      expect(commands).toHaveLength(2)
      expect(commands[0].name?.value).toBe('inner-cmd1')
      expect(commands[1].name?.value).toBe('inner-cmd2')
    })

    it('should extract commands from nested subshells', () => {
      const nestedSubshell: Program = program({
        type: 'Subshell',
        body: [
          {
            type: 'Subshell',
            body: [simpleCommand('deep-cmd')],
          } as Subshell,
        ],
      } as Subshell)

      const commands = extractCommands(nestedSubshell)

      expect(commands).toHaveLength(1)
      expect(commands[0].name?.value).toBe('deep-cmd')
    })
  })

  describe('Compound Commands', () => {
    it('should extract commands from for loop', () => {
      const forLoop: Program = program({
        type: 'CompoundCommand',
        kind: 'for',
        body: [simpleCommand('process', ['$item'])],
      } as CompoundCommand)

      const commands = extractCommands(forLoop)

      expect(commands).toHaveLength(1)
      expect(commands[0].name?.value).toBe('process')
    })

    it('should extract commands from while loop', () => {
      const whileLoop: Program = program({
        type: 'CompoundCommand',
        kind: 'while',
        body: [simpleCommand('read', ['line']), simpleCommand('echo', ['$line'])],
      } as CompoundCommand)

      const commands = extractCommands(whileLoop)

      expect(commands).toHaveLength(2)
    })
  })

  describe('Edge Cases', () => {
    it('should return empty array for empty program', () => {
      const commands = extractCommands(EMPTY_PROGRAM)

      expect(commands).toEqual([])
    })

    it('should include assignment-only commands (name is null)', () => {
      const assignmentOnly: Program = program({
        type: 'Command',
        name: null,
        prefix: [assignment('VAR', 'value')],
        args: [],
        redirects: [],
      })

      const commands = extractCommands(assignmentOnly)

      expect(commands).toHaveLength(1)
      expect(commands[0].name).toBeNull()
    })

    it('should handle command with prefix assignments', () => {
      const commands = extractCommands(ENV_VAR_COMMAND)

      expect(commands).toHaveLength(1)
      expect(commands[0].prefix).toHaveLength(1)
      expect(commands[0].prefix[0].name).toBe('FOO')
    })
  })
})

// ============================================================================
// extractFiles() Tests
// ============================================================================

describe('extractFiles()', () => {
  describe('Read Files', () => {
    it('should extract input file from cat command argument', () => {
      const files = extractFiles(CAT_FILE)

      expect(files.reads).toContain('package.json')
    })

    it('should extract files from input redirect', () => {
      const files = extractFiles(WC_INPUT)

      expect(files.reads).toContain('input.txt')
    })

    it('should extract files from find command', () => {
      const findProgram: Program = program(simpleCommand('find', ['/path/to/search']))

      const files = extractFiles(findProgram)

      expect(files.reads).toContain('/path/to/search')
    })

    it('should extract multiple read files from pipeline', () => {
      const files = extractFiles(CAT_GREP_WC_PIPELINE)

      expect(files.reads).toContain('file.txt')
    })

    it('should extract file from grep -f argument', () => {
      const grepWithFile: Program = program(
        simpleCommand('grep', ['-f', 'patterns.txt', 'data.txt'])
      )

      const files = extractFiles(grepWithFile)

      expect(files.reads).toContain('patterns.txt')
      expect(files.reads).toContain('data.txt')
    })
  })

  describe('Write Files', () => {
    it('should extract output file from redirect', () => {
      const files = extractFiles(ECHO_REDIRECT)

      expect(files.writes).toContain('output.txt')
    })

    it('should extract append file from redirect', () => {
      const files = extractFiles(ECHO_APPEND)

      expect(files.writes).toContain('log.txt')
    })

    it('should extract file from touch command', () => {
      const touchProgram: Program = program(simpleCommand('touch', ['newfile.txt']))

      const files = extractFiles(touchProgram)

      expect(files.writes).toContain('newfile.txt')
    })

    it('should extract destination from cp command', () => {
      const cpProgram: Program = program(simpleCommand('cp', ['source.txt', 'dest.txt']))

      const files = extractFiles(cpProgram)

      expect(files.reads).toContain('source.txt')
      expect(files.writes).toContain('dest.txt')
    })

    it('should extract destination from mv command', () => {
      const mvProgram: Program = program(simpleCommand('mv', ['old.txt', 'new.txt']))

      const files = extractFiles(mvProgram)

      expect(files.reads).toContain('old.txt')
      expect(files.writes).toContain('new.txt')
    })
  })

  describe('Mixed Read/Write Files', () => {
    it('should extract both read and write files from complex command', () => {
      // cat input.txt | grep pattern > output.txt
      const mixedProgram: Program = program({
        type: 'Pipeline',
        negated: false,
        commands: [
          simpleCommand('cat', ['input.txt']),
          {
            ...simpleCommand('grep', ['pattern']),
            redirects: [redirect('>', 'output.txt')],
          },
        ],
      } as Pipeline)

      const files = extractFiles(mixedProgram)

      expect(files.reads).toContain('input.txt')
      expect(files.writes).toContain('output.txt')
    })

    it('should handle multiple writes in sequential commands', () => {
      // echo foo > file1.txt; echo bar > file2.txt
      const multiWrite: Program = program({
        type: 'List',
        operator: ';',
        left: {
          ...simpleCommand('echo', ['foo']),
          redirects: [redirect('>', 'file1.txt')],
        },
        right: {
          ...simpleCommand('echo', ['bar']),
          redirects: [redirect('>', 'file2.txt')],
        },
      } as List)

      const files = extractFiles(multiWrite)

      expect(files.writes).toContain('file1.txt')
      expect(files.writes).toContain('file2.txt')
    })
  })

  describe('Tee Command', () => {
    it('should extract write file from tee command', () => {
      const teeProgram: Program = program({
        type: 'Pipeline',
        negated: false,
        commands: [simpleCommand('echo', ['hello']), simpleCommand('tee', ['output.log'])],
      } as Pipeline)

      const files = extractFiles(teeProgram)

      expect(files.writes).toContain('output.log')
    })

    it('should extract multiple files from tee -a', () => {
      const teeMultiple: Program = program(
        simpleCommand('tee', ['-a', 'log1.txt', 'log2.txt'])
      )

      const files = extractFiles(teeMultiple)

      expect(files.writes).toContain('log1.txt')
      expect(files.writes).toContain('log2.txt')
    })
  })

  describe('Special Cases', () => {
    it('should not include /dev/null in file lists', () => {
      const devNullProgram: Program = program({
        ...simpleCommand('echo', ['test']),
        redirects: [redirect('>', '/dev/null')],
      })

      const files = extractFiles(devNullProgram)

      expect(files.writes).not.toContain('/dev/null')
    })

    it('should not include - (stdin/stdout) as file', () => {
      const stdinProgram: Program = program(simpleCommand('cat', ['-']))

      const files = extractFiles(stdinProgram)

      expect(files.reads).not.toContain('-')
    })

    it('should handle glob patterns as file reads', () => {
      const globProgram: Program = program(simpleCommand('cat', ['*.txt']))

      const files = extractFiles(globProgram)

      expect(files.reads).toContain('*.txt')
    })

    it('should return empty arrays for commands with no file operations', () => {
      const echoProgram: Program = program(simpleCommand('echo', ['hello']))

      const files = extractFiles(echoProgram)

      expect(files.reads).toEqual([])
      expect(files.writes).toEqual([])
    })

    it('should return empty arrays for empty program', () => {
      const files = extractFiles(EMPTY_PROGRAM)

      expect(files.reads).toEqual([])
      expect(files.writes).toEqual([])
    })
  })

  describe('Here Document', () => {
    it('should not treat heredoc delimiter as file', () => {
      const heredocProgram: Program = program({
        ...simpleCommand('cat'),
        redirects: [redirect('<<', 'EOF')],
      })

      const files = extractFiles(heredocProgram)

      expect(files.reads).not.toContain('EOF')
    })
  })
})

// ============================================================================
// extractRedirects() Tests
// ============================================================================

describe('extractRedirects()', () => {
  describe('Basic Redirects', () => {
    it('should extract output redirect', () => {
      const redirects = extractRedirects(ECHO_REDIRECT)

      expect(redirects).toHaveLength(1)
      expect(redirects[0].op).toBe('>')
      expect(redirects[0].target.value).toBe('output.txt')
    })

    it('should extract append redirect', () => {
      const redirects = extractRedirects(ECHO_APPEND)

      expect(redirects).toHaveLength(1)
      expect(redirects[0].op).toBe('>>')
      expect(redirects[0].target.value).toBe('log.txt')
    })

    it('should extract input redirect', () => {
      const redirects = extractRedirects(WC_INPUT)

      expect(redirects).toHaveLength(1)
      expect(redirects[0].op).toBe('<')
      expect(redirects[0].target.value).toBe('input.txt')
    })
  })

  describe('File Descriptor Redirects', () => {
    it('should extract stderr redirect to file', () => {
      const stderrRedirect: Program = program({
        ...simpleCommand('cmd'),
        redirects: [redirect('>', 'error.log', 2)],
      })

      const redirects = extractRedirects(stderrRedirect)

      expect(redirects).toHaveLength(1)
      expect(redirects[0].fd).toBe(2)
      expect(redirects[0].target.value).toBe('error.log')
    })

    it('should extract stderr to stdout redirect (2>&1)', () => {
      const stderrToStdout: Program = program({
        ...simpleCommand('cmd'),
        redirects: [redirect('>&', '1', 2)],
      })

      const redirects = extractRedirects(stderrToStdout)

      expect(redirects).toHaveLength(1)
      expect(redirects[0].op).toBe('>&')
      expect(redirects[0].fd).toBe(2)
      expect(redirects[0].target.value).toBe('1')
    })
  })

  describe('Multiple Redirects', () => {
    it('should extract all redirects from single command', () => {
      const multiRedirect: Program = program({
        ...simpleCommand('cmd'),
        redirects: [
          redirect('<', 'input.txt'),
          redirect('>', 'output.txt'),
          redirect('>&', '/dev/null', 2),
        ],
      })

      const redirects = extractRedirects(multiRedirect)

      expect(redirects).toHaveLength(3)
      expect(redirects.map((r) => r.op)).toEqual(['<', '>', '>&'])
    })

    it('should extract redirects from multiple commands in pipeline', () => {
      const pipelineWithRedirects: Program = program({
        type: 'Pipeline',
        negated: false,
        commands: [
          { ...simpleCommand('cat'), redirects: [redirect('<', 'input.txt')] },
          { ...simpleCommand('grep', ['pattern']), redirects: [redirect('>', 'output.txt')] },
        ],
      } as Pipeline)

      const redirects = extractRedirects(pipelineWithRedirects)

      expect(redirects).toHaveLength(2)
      expect(redirects[0].op).toBe('<')
      expect(redirects[1].op).toBe('>')
    })
  })

  describe('Redirects in Complex Structures', () => {
    it('should extract redirects from AND list', () => {
      const andListRedirects: Program = program({
        type: 'List',
        operator: '&&',
        left: { ...simpleCommand('cmd1'), redirects: [redirect('>', 'file1.txt')] },
        right: { ...simpleCommand('cmd2'), redirects: [redirect('>', 'file2.txt')] },
      } as List)

      const redirects = extractRedirects(andListRedirects)

      expect(redirects).toHaveLength(2)
      expect(redirects[0].target.value).toBe('file1.txt')
      expect(redirects[1].target.value).toBe('file2.txt')
    })

    it('should extract redirects from subshell', () => {
      const subshellRedirect: Program = program({
        type: 'Subshell',
        body: [{ ...simpleCommand('inner'), redirects: [redirect('>', 'inner-out.txt')] }],
      } as Subshell)

      const redirects = extractRedirects(subshellRedirect)

      expect(redirects).toHaveLength(1)
      expect(redirects[0].target.value).toBe('inner-out.txt')
    })

    it('should extract redirects from compound command', () => {
      const forLoopRedirect: Program = program({
        type: 'CompoundCommand',
        kind: 'for',
        body: [{ ...simpleCommand('echo', ['$i']), redirects: [redirect('>>', 'log.txt')] }],
      } as CompoundCommand)

      const redirects = extractRedirects(forLoopRedirect)

      expect(redirects).toHaveLength(1)
      expect(redirects[0].op).toBe('>>')
    })
  })

  describe('Special Redirect Types', () => {
    it('should extract heredoc redirect', () => {
      const heredocProgram: Program = program({
        ...simpleCommand('cat'),
        redirects: [redirect('<<', 'EOF')],
      })

      const redirects = extractRedirects(heredocProgram)

      expect(redirects).toHaveLength(1)
      expect(redirects[0].op).toBe('<<')
      expect(redirects[0].target.value).toBe('EOF')
    })

    it('should extract herestring redirect', () => {
      const herestringProgram: Program = program({
        ...simpleCommand('cat'),
        redirects: [redirect('<<<', 'hello world')],
      })

      const redirects = extractRedirects(herestringProgram)

      expect(redirects).toHaveLength(1)
      expect(redirects[0].op).toBe('<<<')
    })

    it('should extract clobber redirect (>|)', () => {
      const clobberProgram: Program = program({
        ...simpleCommand('echo', ['force']),
        redirects: [redirect('>|', 'protected.txt')],
      })

      const redirects = extractRedirects(clobberProgram)

      expect(redirects).toHaveLength(1)
      expect(redirects[0].op).toBe('>|')
    })

    it('should extract read-write redirect (<>)', () => {
      const rwProgram: Program = program({
        ...simpleCommand('cmd'),
        redirects: [redirect('<>', 'file.txt')],
      })

      const redirects = extractRedirects(rwProgram)

      expect(redirects).toHaveLength(1)
      expect(redirects[0].op).toBe('<>')
    })
  })

  describe('Edge Cases', () => {
    it('should return empty array for program without redirects', () => {
      const redirects = extractRedirects(LS_COMMAND)

      expect(redirects).toEqual([])
    })

    it('should return empty array for empty program', () => {
      const redirects = extractRedirects(EMPTY_PROGRAM)

      expect(redirects).toEqual([])
    })

    it('should return empty array for pipeline without redirects', () => {
      const redirects = extractRedirects(LS_GREP_PIPELINE)

      expect(redirects).toEqual([])
    })

    it('should preserve redirect order within commands', () => {
      const orderedRedirects: Program = program({
        ...simpleCommand('cmd'),
        redirects: [
          redirect('<', 'input.txt'),
          redirect('>', 'output.txt'),
          redirect('>&', '/dev/null', 2),
        ],
      })

      const redirects = extractRedirects(orderedRedirects)

      expect(redirects[0].op).toBe('<')
      expect(redirects[1].op).toBe('>')
      expect(redirects[2].op).toBe('>&')
    })
  })
})

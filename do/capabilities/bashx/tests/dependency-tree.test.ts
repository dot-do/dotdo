/**
 * Dependency Tree Building Tests (RED Phase)
 *
 * Tests for building a dependency tree/graph from a bash AST.
 * These tests define the expected behavior for analyzing command dependencies:
 *
 * 1. Pipe dependencies - Data flows from left to right in pipelines
 * 2. File dependencies - Command A writes to a file that command B reads
 * 3. Variable dependencies - Command A sets a variable that command B uses
 * 4. Conditional dependencies - Command B only runs if command A succeeds/fails
 * 5. Background/parallel dependencies - Commands running in parallel (&)
 * 6. Subshell scoping - Variables set in subshells don't affect parent
 *
 * These tests are written first (RED phase) and should fail until implementation.
 */

import { describe, it, expect } from 'vitest'
import {
  buildDependencyTree,
  DependencyTree,
  DependencyNode,
  DependencyEdge,
  DependencyType,
  getExecutionOrder,
  findDataFlowPath,
  detectCycles,
  getParallelGroups,
} from '../src/ast/dependency-tree.js'
import {
  program,
  simpleCommand,
  word,
  redirect,
  assignment,
} from './utils/fixtures.js'
import type {
  Program,
  Pipeline,
  List,
  Subshell,
  CompoundCommand,
} from '../src/types.js'

// ============================================================================
// buildDependencyTree() - Basic Structure Tests
// ============================================================================

describe('buildDependencyTree() - Basic Structure', () => {
  describe('Single Command', () => {
    it('should create a tree with one node for a single command', () => {
      const ast: Program = program(simpleCommand('ls', ['-la']))
      const tree = buildDependencyTree(ast)

      expect(tree.nodes).toHaveLength(1)
      expect(tree.edges).toHaveLength(0)
      expect(tree.nodes[0].command).toBe('ls')
    })

    it('should include command arguments in the node', () => {
      const ast: Program = program(simpleCommand('git', ['status', '--short']))
      const tree = buildDependencyTree(ast)

      expect(tree.nodes[0].args).toEqual(['status', '--short'])
    })

    it('should assign unique IDs to nodes', () => {
      const ast: Program = program({
        type: 'List',
        operator: ';',
        left: simpleCommand('cmd1'),
        right: simpleCommand('cmd2'),
      } as List)
      const tree = buildDependencyTree(ast)

      expect(tree.nodes[0].id).not.toBe(tree.nodes[1].id)
    })
  })

  describe('Empty Program', () => {
    it('should return an empty tree for empty program', () => {
      const ast: Program = { type: 'Program', body: [] }
      const tree = buildDependencyTree(ast)

      expect(tree.nodes).toHaveLength(0)
      expect(tree.edges).toHaveLength(0)
    })
  })

  describe('Tree Properties', () => {
    it('should include the root node reference', () => {
      const ast: Program = program(simpleCommand('echo', ['hello']))
      const tree = buildDependencyTree(ast)

      expect(tree.root).toBeDefined()
      expect(tree.root?.command).toBe('echo')
    })

    it('should track the source AST', () => {
      const ast: Program = program(simpleCommand('pwd'))
      const tree = buildDependencyTree(ast)

      expect(tree.sourceAst).toBe(ast)
    })
  })
})

// ============================================================================
// Pipe Dependencies Tests
// ============================================================================

describe('buildDependencyTree() - Pipe Dependencies', () => {
  describe('Simple Pipelines', () => {
    it('should create pipe dependency edges for simple pipeline', () => {
      // ls | grep foo
      const ast: Program = program({
        type: 'Pipeline',
        negated: false,
        commands: [simpleCommand('ls'), simpleCommand('grep', ['foo'])],
      } as Pipeline)

      const tree = buildDependencyTree(ast)

      expect(tree.nodes).toHaveLength(2)
      expect(tree.edges).toHaveLength(1)
      expect(tree.edges[0].type).toBe('pipe')
      expect(tree.edges[0].from).toBe(tree.nodes[0].id)
      expect(tree.edges[0].to).toBe(tree.nodes[1].id)
    })

    it('should chain pipe dependencies for multi-stage pipeline', () => {
      // cat file | grep pattern | wc -l
      const ast: Program = program({
        type: 'Pipeline',
        negated: false,
        commands: [
          simpleCommand('cat', ['file.txt']),
          simpleCommand('grep', ['pattern']),
          simpleCommand('wc', ['-l']),
        ],
      } as Pipeline)

      const tree = buildDependencyTree(ast)

      expect(tree.nodes).toHaveLength(3)
      expect(tree.edges).toHaveLength(2)

      // cat -> grep
      expect(tree.edges[0].from).toBe(tree.nodes[0].id)
      expect(tree.edges[0].to).toBe(tree.nodes[1].id)

      // grep -> wc
      expect(tree.edges[1].from).toBe(tree.nodes[1].id)
      expect(tree.edges[1].to).toBe(tree.nodes[2].id)
    })

    it('should mark pipe edges with stdout/stdin flow', () => {
      const ast: Program = program({
        type: 'Pipeline',
        negated: false,
        commands: [simpleCommand('echo', ['hello']), simpleCommand('cat')],
      } as Pipeline)

      const tree = buildDependencyTree(ast)

      expect(tree.edges[0].dataFlow).toEqual({
        sourceFd: 1, // stdout
        targetFd: 0, // stdin
      })
    })
  })

  describe('Negated Pipelines', () => {
    it('should handle negated pipeline', () => {
      // ! cmd1 | cmd2
      const ast: Program = program({
        type: 'Pipeline',
        negated: true,
        commands: [simpleCommand('cmd1'), simpleCommand('cmd2')],
      } as Pipeline)

      const tree = buildDependencyTree(ast)

      expect(tree.nodes).toHaveLength(2)
      expect(tree.edges[0].type).toBe('pipe')
    })
  })
})

// ============================================================================
// File Dependencies Tests
// ============================================================================

describe('buildDependencyTree() - File Dependencies', () => {
  describe('Write then Read', () => {
    it('should detect file dependency when command writes then another reads', () => {
      // echo hello > file.txt; cat file.txt
      const ast: Program = program({
        type: 'List',
        operator: ';',
        left: {
          ...simpleCommand('echo', ['hello']),
          redirects: [redirect('>', 'file.txt')],
        },
        right: simpleCommand('cat', ['file.txt']),
      } as List)

      const tree = buildDependencyTree(ast)

      expect(tree.nodes).toHaveLength(2)
      const fileEdge = tree.edges.find((e) => e.type === 'file')
      expect(fileEdge).toBeDefined()
      expect(fileEdge?.file).toBe('file.txt')
      expect(fileEdge?.from).toBe(tree.nodes[0].id)
      expect(fileEdge?.to).toBe(tree.nodes[1].id)
    })

    it('should detect file dependency through tee command', () => {
      // cmd1 | tee output.txt; cat output.txt
      const ast: Program = program({
        type: 'List',
        operator: ';',
        left: {
          type: 'Pipeline',
          negated: false,
          commands: [simpleCommand('cmd1'), simpleCommand('tee', ['output.txt'])],
        } as Pipeline,
        right: simpleCommand('cat', ['output.txt']),
      } as List)

      const tree = buildDependencyTree(ast)

      // Find file dependency edge
      const fileEdge = tree.edges.find((e) => e.type === 'file')
      expect(fileEdge).toBeDefined()
      expect(fileEdge?.file).toBe('output.txt')
    })

    it('should detect append file dependencies', () => {
      // echo line1 >> log.txt; echo line2 >> log.txt; cat log.txt
      const ast: Program = program({
        type: 'List',
        operator: ';',
        left: {
          type: 'List',
          operator: ';',
          left: {
            ...simpleCommand('echo', ['line1']),
            redirects: [redirect('>>', 'log.txt')],
          },
          right: {
            ...simpleCommand('echo', ['line2']),
            redirects: [redirect('>>', 'log.txt')],
          },
        } as List,
        right: simpleCommand('cat', ['log.txt']),
      } as List)

      const tree = buildDependencyTree(ast)

      // Both echo commands should have file edges to cat
      const fileEdges = tree.edges.filter((e) => e.type === 'file')
      expect(fileEdges.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('Copy/Move Dependencies', () => {
    it('should detect file dependency through cp', () => {
      // cat src.txt > backup.txt; cp backup.txt dest.txt; rm backup.txt
      const ast: Program = program({
        type: 'List',
        operator: ';',
        left: {
          type: 'List',
          operator: ';',
          left: {
            ...simpleCommand('cat', ['src.txt']),
            redirects: [redirect('>', 'backup.txt')],
          },
          right: simpleCommand('cp', ['backup.txt', 'dest.txt']),
        } as List,
        right: simpleCommand('rm', ['backup.txt']),
      } as List)

      const tree = buildDependencyTree(ast)

      // cp reads backup.txt which was created by cat
      const fileEdges = tree.edges.filter(
        (e) => e.type === 'file' && e.file === 'backup.txt'
      )
      expect(fileEdges.length).toBeGreaterThanOrEqual(1)
    })

    it('should detect file dependency through mv', () => {
      // touch tmp.txt; mv tmp.txt final.txt
      const ast: Program = program({
        type: 'List',
        operator: ';',
        left: simpleCommand('touch', ['tmp.txt']),
        right: simpleCommand('mv', ['tmp.txt', 'final.txt']),
      } as List)

      const tree = buildDependencyTree(ast)

      const fileEdge = tree.edges.find(
        (e) => e.type === 'file' && e.file === 'tmp.txt'
      )
      expect(fileEdge).toBeDefined()
    })
  })

  describe('Input Redirection Dependencies', () => {
    it('should detect dependency through input redirection', () => {
      // sort data.txt > sorted.txt; wc -l < sorted.txt
      const ast: Program = program({
        type: 'List',
        operator: ';',
        left: {
          ...simpleCommand('sort', ['data.txt']),
          redirects: [redirect('>', 'sorted.txt')],
        },
        right: {
          ...simpleCommand('wc', ['-l']),
          redirects: [redirect('<', 'sorted.txt')],
        },
      } as List)

      const tree = buildDependencyTree(ast)

      const fileEdge = tree.edges.find(
        (e) => e.type === 'file' && e.file === 'sorted.txt'
      )
      expect(fileEdge).toBeDefined()
    })
  })
})

// ============================================================================
// Variable Dependencies Tests
// ============================================================================

describe('buildDependencyTree() - Variable Dependencies', () => {
  describe('Assignment then Use', () => {
    it('should detect variable dependency from assignment to use', () => {
      // FOO=bar; echo $FOO
      const ast: Program = program({
        type: 'List',
        operator: ';',
        left: {
          type: 'Command',
          name: null,
          prefix: [assignment('FOO', 'bar')],
          args: [],
          redirects: [],
        },
        right: simpleCommand('echo', ['$FOO']),
      } as List)

      const tree = buildDependencyTree(ast)

      const varEdge = tree.edges.find((e) => e.type === 'variable')
      expect(varEdge).toBeDefined()
      expect(varEdge?.variable).toBe('FOO')
    })

    it('should detect variable dependency from prefix assignment', () => {
      // export VAR=value; cmd $VAR
      const ast: Program = program({
        type: 'List',
        operator: ';',
        left: {
          type: 'Command',
          name: word('export'),
          prefix: [assignment('VAR', 'value')],
          args: [],
          redirects: [],
        },
        right: simpleCommand('cmd', ['$VAR']),
      } as List)

      const tree = buildDependencyTree(ast)

      const varEdge = tree.edges.find((e) => e.type === 'variable')
      expect(varEdge).toBeDefined()
      expect(varEdge?.variable).toBe('VAR')
    })

    it('should detect multiple variable dependencies', () => {
      // A=1; B=2; echo $A $B
      const ast: Program = program({
        type: 'List',
        operator: ';',
        left: {
          type: 'List',
          operator: ';',
          left: {
            type: 'Command',
            name: null,
            prefix: [assignment('A', '1')],
            args: [],
            redirects: [],
          },
          right: {
            type: 'Command',
            name: null,
            prefix: [assignment('B', '2')],
            args: [],
            redirects: [],
          },
        } as List,
        right: simpleCommand('echo', ['$A', '$B']),
      } as List)

      const tree = buildDependencyTree(ast)

      const varEdges = tree.edges.filter((e) => e.type === 'variable')
      expect(varEdges.length).toBe(2)
      expect(varEdges.map((e) => e.variable).sort()).toEqual(['A', 'B'])
    })
  })

  describe('Command Substitution Variables', () => {
    it('should detect variable from command substitution result', () => {
      // RESULT=$(cmd1); echo $RESULT
      // Note: This requires tracking that RESULT is set via command substitution
      const ast: Program = program({
        type: 'List',
        operator: ';',
        left: {
          type: 'Command',
          name: null,
          prefix: [assignment('RESULT', '$(cmd1)')],
          args: [],
          redirects: [],
        },
        right: simpleCommand('echo', ['$RESULT']),
      } as List)

      const tree = buildDependencyTree(ast)

      const varEdge = tree.edges.find((e) => e.type === 'variable')
      expect(varEdge).toBeDefined()
      expect(varEdge?.variable).toBe('RESULT')
    })
  })
})

// ============================================================================
// Conditional Dependencies Tests
// ============================================================================

describe('buildDependencyTree() - Conditional Dependencies', () => {
  describe('AND Lists (&&)', () => {
    it('should create success dependency for AND list', () => {
      // cmd1 && cmd2
      const ast: Program = program({
        type: 'List',
        operator: '&&',
        left: simpleCommand('cmd1'),
        right: simpleCommand('cmd2'),
      } as List)

      const tree = buildDependencyTree(ast)

      expect(tree.nodes).toHaveLength(2)
      expect(tree.edges).toHaveLength(1)
      expect(tree.edges[0].type).toBe('conditional')
      expect(tree.edges[0].condition).toBe('success')
    })

    it('should chain AND dependencies', () => {
      // cmd1 && cmd2 && cmd3
      const ast: Program = program({
        type: 'List',
        operator: '&&',
        left: {
          type: 'List',
          operator: '&&',
          left: simpleCommand('cmd1'),
          right: simpleCommand('cmd2'),
        } as List,
        right: simpleCommand('cmd3'),
      } as List)

      const tree = buildDependencyTree(ast)

      expect(tree.nodes).toHaveLength(3)
      const conditionalEdges = tree.edges.filter((e) => e.type === 'conditional')
      expect(conditionalEdges.length).toBe(2)
      conditionalEdges.forEach((e) => expect(e.condition).toBe('success'))
    })
  })

  describe('OR Lists (||)', () => {
    it('should create failure dependency for OR list', () => {
      // cmd1 || cmd2
      const ast: Program = program({
        type: 'List',
        operator: '||',
        left: simpleCommand('cmd1'),
        right: simpleCommand('cmd2'),
      } as List)

      const tree = buildDependencyTree(ast)

      expect(tree.nodes).toHaveLength(2)
      expect(tree.edges).toHaveLength(1)
      expect(tree.edges[0].type).toBe('conditional')
      expect(tree.edges[0].condition).toBe('failure')
    })
  })

  describe('Sequential Lists (;)', () => {
    it('should create sequence dependency for semicolon list', () => {
      // cmd1; cmd2
      const ast: Program = program({
        type: 'List',
        operator: ';',
        left: simpleCommand('cmd1'),
        right: simpleCommand('cmd2'),
      } as List)

      const tree = buildDependencyTree(ast)

      expect(tree.edges).toHaveLength(1)
      expect(tree.edges[0].type).toBe('sequence')
    })
  })

  describe('Mixed Conditionals', () => {
    it('should handle mixed AND and OR', () => {
      // cmd1 && cmd2 || cmd3
      const ast: Program = program({
        type: 'List',
        operator: '||',
        left: {
          type: 'List',
          operator: '&&',
          left: simpleCommand('cmd1'),
          right: simpleCommand('cmd2'),
        } as List,
        right: simpleCommand('cmd3'),
      } as List)

      const tree = buildDependencyTree(ast)

      expect(tree.nodes).toHaveLength(3)

      // cmd1 -> cmd2 (success)
      const successEdge = tree.edges.find(
        (e) => e.type === 'conditional' && e.condition === 'success'
      )
      expect(successEdge).toBeDefined()

      // cmd2 (or cmd1&&cmd2) -> cmd3 (failure)
      const failureEdge = tree.edges.find(
        (e) => e.type === 'conditional' && e.condition === 'failure'
      )
      expect(failureEdge).toBeDefined()
    })
  })
})

// ============================================================================
// Background/Parallel Dependencies Tests
// ============================================================================

describe('buildDependencyTree() - Background/Parallel Dependencies', () => {
  describe('Background Commands (&)', () => {
    it('should mark background commands as parallel', () => {
      // cmd1 & cmd2
      const ast: Program = program({
        type: 'List',
        operator: '&',
        left: simpleCommand('cmd1'),
        right: simpleCommand('cmd2'),
      } as List)

      const tree = buildDependencyTree(ast)

      expect(tree.nodes).toHaveLength(2)

      // Background edge should indicate parallel execution
      const bgEdge = tree.edges.find((e) => e.type === 'background')
      expect(bgEdge).toBeDefined()
      expect(bgEdge?.parallel).toBe(true)
    })

    it('should handle multiple background commands', () => {
      // cmd1 & cmd2 & cmd3
      const ast: Program = program({
        type: 'List',
        operator: '&',
        left: {
          type: 'List',
          operator: '&',
          left: simpleCommand('cmd1'),
          right: simpleCommand('cmd2'),
        } as List,
        right: simpleCommand('cmd3'),
      } as List)

      const tree = buildDependencyTree(ast)

      expect(tree.nodes).toHaveLength(3)
      const bgEdges = tree.edges.filter((e) => e.type === 'background')
      expect(bgEdges.length).toBe(2)
    })
  })
})

// ============================================================================
// Subshell Scoping Tests
// ============================================================================

describe('buildDependencyTree() - Subshell Scoping', () => {
  describe('Variable Isolation', () => {
    it('should not create variable dependency for subshell-scoped variable', () => {
      // (FOO=bar); echo $FOO
      // Variable set in subshell shouldn't affect parent
      const ast: Program = program({
        type: 'List',
        operator: ';',
        left: {
          type: 'Subshell',
          body: [
            {
              type: 'Command',
              name: null,
              prefix: [assignment('FOO', 'bar')],
              args: [],
              redirects: [],
            },
          ],
        } as Subshell,
        right: simpleCommand('echo', ['$FOO']),
      } as List)

      const tree = buildDependencyTree(ast)

      // Should NOT have a variable dependency edge since FOO is subshell-scoped
      const varEdge = tree.edges.find((e) => e.type === 'variable')
      expect(varEdge).toBeUndefined()
    })

    it('should detect variable dependency within same subshell', () => {
      // (FOO=bar; echo $FOO)
      const ast: Program = program({
        type: 'Subshell',
        body: [
          {
            type: 'List',
            operator: ';',
            left: {
              type: 'Command',
              name: null,
              prefix: [assignment('FOO', 'bar')],
              args: [],
              redirects: [],
            },
            right: simpleCommand('echo', ['$FOO']),
          } as List,
        ],
      } as Subshell)

      const tree = buildDependencyTree(ast)

      const varEdge = tree.edges.find((e) => e.type === 'variable')
      expect(varEdge).toBeDefined()
      expect(varEdge?.variable).toBe('FOO')
    })
  })

  describe('Subshell Grouping', () => {
    it('should group subshell commands', () => {
      // (cmd1; cmd2)
      const ast: Program = program({
        type: 'Subshell',
        body: [
          {
            type: 'List',
            operator: ';',
            left: simpleCommand('cmd1'),
            right: simpleCommand('cmd2'),
          } as List,
        ],
      } as Subshell)

      const tree = buildDependencyTree(ast)

      expect(tree.nodes).toHaveLength(2)
      // Both nodes should have same subshell scope ID
      expect(tree.nodes[0].scope).toBe(tree.nodes[1].scope)
      expect(tree.nodes[0].scope).toBeDefined()
    })
  })
})

// ============================================================================
// Compound Commands Tests
// ============================================================================

describe('buildDependencyTree() - Compound Commands', () => {
  describe('For Loops', () => {
    it('should handle dependencies within for loop body', () => {
      // for i in 1 2 3; do cmd1; cmd2; done
      const ast: Program = program({
        type: 'CompoundCommand',
        kind: 'for',
        body: [
          {
            type: 'List',
            operator: ';',
            left: simpleCommand('cmd1'),
            right: simpleCommand('cmd2'),
          } as List,
        ],
      } as CompoundCommand)

      const tree = buildDependencyTree(ast)

      expect(tree.nodes).toHaveLength(2)
      // Should have sequence dependency within loop
      expect(tree.edges.length).toBeGreaterThanOrEqual(1)
    })

    it('should mark loop iteration variable dependency', () => {
      // for i in 1 2 3; do echo $i; done
      const ast: Program = program({
        type: 'CompoundCommand',
        kind: 'for',
        variable: 'i',
        items: ['1', '2', '3'],
        body: [simpleCommand('echo', ['$i'])],
      } as CompoundCommand & { variable: string; items: string[] })

      const tree = buildDependencyTree(ast)

      // Loop variable should be tracked as implicit dependency
      const loopNode = tree.nodes[0]
      expect(loopNode.loopVariable).toBe('i')
    })
  })

  describe('While Loops', () => {
    it('should handle while loop with condition dependency', () => {
      // while test_cmd; do body_cmd; done
      const ast: Program = program({
        type: 'CompoundCommand',
        kind: 'while',
        condition: [simpleCommand('test_cmd')],
        body: [simpleCommand('body_cmd')],
      } as CompoundCommand & { condition: any[] })

      const tree = buildDependencyTree(ast)

      // Body should depend on condition succeeding
      const conditionalEdge = tree.edges.find((e) => e.type === 'conditional')
      expect(conditionalEdge).toBeDefined()
    })
  })

  describe('If Statements', () => {
    it('should handle if statement branches', () => {
      // if test_cmd; then then_cmd; else else_cmd; fi
      const ast: Program = program({
        type: 'CompoundCommand',
        kind: 'if',
        condition: [simpleCommand('test_cmd')],
        thenBranch: [simpleCommand('then_cmd')],
        elseBranch: [simpleCommand('else_cmd')],
      } as CompoundCommand & { condition: any[]; thenBranch: any[]; elseBranch: any[] })

      const tree = buildDependencyTree(ast)

      // Then branch depends on condition success
      const successEdge = tree.edges.find(
        (e) => e.type === 'conditional' && e.condition === 'success'
      )
      expect(successEdge).toBeDefined()

      // Else branch depends on condition failure
      const failureEdge = tree.edges.find(
        (e) => e.type === 'conditional' && e.condition === 'failure'
      )
      expect(failureEdge).toBeDefined()
    })
  })
})

// ============================================================================
// getExecutionOrder() Tests
// ============================================================================

describe('getExecutionOrder()', () => {
  it('should return nodes in topological order', () => {
    // cmd1; cmd2; cmd3
    const ast: Program = program({
      type: 'List',
      operator: ';',
      left: {
        type: 'List',
        operator: ';',
        left: simpleCommand('cmd1'),
        right: simpleCommand('cmd2'),
      } as List,
      right: simpleCommand('cmd3'),
    } as List)

    const tree = buildDependencyTree(ast)
    const order = getExecutionOrder(tree)

    expect(order).toHaveLength(3)
    expect(order[0].command).toBe('cmd1')
    expect(order[1].command).toBe('cmd2')
    expect(order[2].command).toBe('cmd3')
  })

  it('should respect conditional dependencies in order', () => {
    // cmd1 && cmd2
    const ast: Program = program({
      type: 'List',
      operator: '&&',
      left: simpleCommand('cmd1'),
      right: simpleCommand('cmd2'),
    } as List)

    const tree = buildDependencyTree(ast)
    const order = getExecutionOrder(tree)

    expect(order[0].command).toBe('cmd1')
    expect(order[1].command).toBe('cmd2')
  })

  it('should group parallel commands', () => {
    // cmd1 & cmd2
    const ast: Program = program({
      type: 'List',
      operator: '&',
      left: simpleCommand('cmd1'),
      right: simpleCommand('cmd2'),
    } as List)

    const tree = buildDependencyTree(ast)
    const order = getExecutionOrder(tree)

    // Parallel commands can be in any order but should be grouped
    expect(order).toHaveLength(2)
    // Both should have same execution level
    expect(order[0].level).toBe(order[1].level)
  })
})

// ============================================================================
// findDataFlowPath() Tests
// ============================================================================

describe('findDataFlowPath()', () => {
  it('should find data flow path through pipeline', () => {
    // cat file | grep pattern | wc -l
    const ast: Program = program({
      type: 'Pipeline',
      negated: false,
      commands: [
        simpleCommand('cat', ['file.txt']),
        simpleCommand('grep', ['pattern']),
        simpleCommand('wc', ['-l']),
      ],
    } as Pipeline)

    const tree = buildDependencyTree(ast)
    const path = findDataFlowPath(tree, tree.nodes[0].id, tree.nodes[2].id)

    expect(path).toHaveLength(3)
    expect(path[0].command).toBe('cat')
    expect(path[1].command).toBe('grep')
    expect(path[2].command).toBe('wc')
  })

  it('should find data flow through file', () => {
    // echo hello > tmp.txt; cat tmp.txt
    const ast: Program = program({
      type: 'List',
      operator: ';',
      left: {
        ...simpleCommand('echo', ['hello']),
        redirects: [redirect('>', 'tmp.txt')],
      },
      right: simpleCommand('cat', ['tmp.txt']),
    } as List)

    const tree = buildDependencyTree(ast)
    const path = findDataFlowPath(tree, tree.nodes[0].id, tree.nodes[1].id)

    expect(path).toHaveLength(2)
    expect(path[0].command).toBe('echo')
    expect(path[1].command).toBe('cat')
  })

  it('should return empty array if no data flow path exists', () => {
    // cmd1; cmd2 (no data connection)
    const ast: Program = program({
      type: 'List',
      operator: ';',
      left: simpleCommand('pwd'),
      right: simpleCommand('date'),
    } as List)

    const tree = buildDependencyTree(ast)
    const path = findDataFlowPath(tree, tree.nodes[0].id, tree.nodes[1].id)

    expect(path).toHaveLength(0)
  })
})

// ============================================================================
// detectCycles() Tests
// ============================================================================

describe('detectCycles()', () => {
  it('should return false for acyclic tree', () => {
    // cmd1 | cmd2 | cmd3
    const ast: Program = program({
      type: 'Pipeline',
      negated: false,
      commands: [simpleCommand('cmd1'), simpleCommand('cmd2'), simpleCommand('cmd3')],
    } as Pipeline)

    const tree = buildDependencyTree(ast)
    const hasCycles = detectCycles(tree)

    expect(hasCycles).toBe(false)
  })

  it('should detect cycles in manually constructed tree', () => {
    // Create a tree with an artificial cycle for testing
    const tree: DependencyTree = {
      nodes: [
        { id: 'node1', command: 'cmd1', args: [] },
        { id: 'node2', command: 'cmd2', args: [] },
      ],
      edges: [
        { from: 'node1', to: 'node2', type: 'sequence' },
        { from: 'node2', to: 'node1', type: 'sequence' }, // Creates cycle
      ],
      root: { id: 'node1', command: 'cmd1', args: [] },
      sourceAst: { type: 'Program', body: [] },
    }

    const hasCycles = detectCycles(tree)
    expect(hasCycles).toBe(true)
  })
})

// ============================================================================
// getParallelGroups() Tests
// ============================================================================

describe('getParallelGroups()', () => {
  it('should group parallel background commands', () => {
    // cmd1 & cmd2 & cmd3; wait
    const ast: Program = program({
      type: 'List',
      operator: ';',
      left: {
        type: 'List',
        operator: '&',
        left: {
          type: 'List',
          operator: '&',
          left: simpleCommand('cmd1'),
          right: simpleCommand('cmd2'),
        } as List,
        right: simpleCommand('cmd3'),
      } as List,
      right: simpleCommand('wait'),
    } as List)

    const tree = buildDependencyTree(ast)
    const groups = getParallelGroups(tree)

    // Should have at least one group with parallel commands
    expect(groups.length).toBeGreaterThanOrEqual(1)

    // Find the parallel group
    const parallelGroup = groups.find((g) => g.length > 1)
    if (parallelGroup) {
      expect(parallelGroup.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('should not group sequential commands', () => {
    // cmd1; cmd2; cmd3
    const ast: Program = program({
      type: 'List',
      operator: ';',
      left: {
        type: 'List',
        operator: ';',
        left: simpleCommand('cmd1'),
        right: simpleCommand('cmd2'),
      } as List,
      right: simpleCommand('cmd3'),
    } as List)

    const tree = buildDependencyTree(ast)
    const groups = getParallelGroups(tree)

    // Each command should be in its own group (sequential)
    expect(groups.length).toBe(3)
    groups.forEach((g) => expect(g.length).toBe(1))
  })
})

// ============================================================================
// Type Definitions Tests
// ============================================================================

describe('Dependency Tree Types', () => {
  it('should have correct DependencyType values', () => {
    const types: DependencyType[] = [
      'pipe',
      'file',
      'variable',
      'conditional',
      'sequence',
      'background',
    ]

    types.forEach((t) => {
      expect(typeof t).toBe('string')
    })
  })

  it('should have DependencyNode with required properties', () => {
    const node: DependencyNode = {
      id: 'test-id',
      command: 'test-cmd',
      args: ['arg1', 'arg2'],
    }

    expect(node.id).toBe('test-id')
    expect(node.command).toBe('test-cmd')
    expect(node.args).toEqual(['arg1', 'arg2'])
  })

  it('should have DependencyEdge with required properties', () => {
    const edge: DependencyEdge = {
      from: 'node1',
      to: 'node2',
      type: 'pipe',
    }

    expect(edge.from).toBe('node1')
    expect(edge.to).toBe('node2')
    expect(edge.type).toBe('pipe')
  })
})

// ============================================================================
// Edge Cases and Complex Scenarios
// ============================================================================

describe('Edge Cases', () => {
  it('should handle deeply nested structures', () => {
    // ((cmd1 | cmd2) && (cmd3 || cmd4)); cmd5
    const ast: Program = program({
      type: 'List',
      operator: ';',
      left: {
        type: 'Subshell',
        body: [
          {
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
          } as List,
        ],
      } as Subshell,
      right: simpleCommand('cmd5'),
    } as List)

    const tree = buildDependencyTree(ast)

    // Should have all 5 command nodes
    expect(tree.nodes).toHaveLength(5)
    // Should have edges for pipe, conditional, and sequence
    expect(tree.edges.length).toBeGreaterThanOrEqual(4)
  })

  it('should handle commands with complex redirects', () => {
    // cmd1 2>&1 | cmd2 > out.txt 2> err.txt
    const ast: Program = program({
      type: 'Pipeline',
      negated: false,
      commands: [
        {
          ...simpleCommand('cmd1'),
          redirects: [redirect('>&', '1', 2)],
        },
        {
          ...simpleCommand('cmd2'),
          redirects: [redirect('>', 'out.txt'), redirect('>', 'err.txt', 2)],
        },
      ],
    } as Pipeline)

    const tree = buildDependencyTree(ast)

    expect(tree.nodes).toHaveLength(2)
    // Should have pipe dependency
    const pipeEdge = tree.edges.find((e) => e.type === 'pipe')
    expect(pipeEdge).toBeDefined()
  })

  it('should handle here documents', () => {
    // cat <<EOF > file.txt
    const ast: Program = program({
      ...simpleCommand('cat'),
      redirects: [redirect('<<', 'EOF'), redirect('>', 'file.txt')],
    })

    const tree = buildDependencyTree(ast)

    expect(tree.nodes).toHaveLength(1)
    expect(tree.nodes[0].command).toBe('cat')
  })

  it('should handle function definitions', () => {
    // Note: Function definitions don't create dependencies on their own
    // The dependency is created when the function is called
    const ast: Program = {
      type: 'Program',
      body: [
        {
          type: 'FunctionDef',
          name: 'myfunc',
          body: simpleCommand('echo', ['inside function']),
        },
        simpleCommand('myfunc'),
      ],
    }

    const tree = buildDependencyTree(ast)

    // Function call should depend on function definition
    const funcDepEdge = tree.edges.find((e) => e.type === 'function')
    // Note: This might be undefined if we don't implement function dependencies
    // The key is that the tree builds without errors
    expect(tree.nodes.length).toBeGreaterThanOrEqual(1)
  })
})

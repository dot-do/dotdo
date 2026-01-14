/**
 * Tree-sitter-bash WASM Integration Tests (RED Phase)
 *
 * These tests define the expected behavior for tree-sitter-bash WASM integration.
 * They are written first (RED phase) and should fail until the implementation is complete.
 *
 * Key areas tested:
 * 1. Loading tree-sitter-bash WASM module
 * 2. Parsing bash commands into syntax tree
 * 3. Traversing syntax tree nodes
 * 4. Extracting command components from tree
 * 5. Error recovery on malformed input
 */

import { describe, it, expect, beforeAll } from 'vitest'

// These imports will fail initially - they define the expected API
// The implementation will be in src/ast/tree-sitter.ts
import {
  initTreeSitter,
  createParser,
  parseWithTreeSitter,
  TreeSitterNode,
  TreeSitterTree,
  TreeSitterParser,
  isTreeSitterReady,
  getTreeSitterLanguage,
} from '../src/ast/tree-sitter.js'

// ============================================================================
// Module Loading Tests
// ============================================================================

describe('Tree-sitter WASM Module Loading', () => {
  describe('initialization', () => {
    it('should initialize tree-sitter WASM module', async () => {
      // Initialize the WASM module
      await initTreeSitter()

      // After initialization, tree-sitter should be ready
      expect(isTreeSitterReady()).toBe(true)
    })

    it('should load the bash language grammar', async () => {
      await initTreeSitter()

      const language = getTreeSitterLanguage()
      expect(language).toBeDefined()
      expect(language).not.toBeNull()
    })

    it('should be safe to call initTreeSitter multiple times', async () => {
      await initTreeSitter()
      await initTreeSitter()
      await initTreeSitter()

      expect(isTreeSitterReady()).toBe(true)
    })

    it('should create a parser instance', async () => {
      await initTreeSitter()

      const parser = createParser()
      expect(parser).toBeDefined()
      expect(parser).toBeInstanceOf(Object)
    })
  })
})

// ============================================================================
// Basic Parsing Tests
// ============================================================================

describe('Tree-sitter Bash Parsing', () => {
  beforeAll(async () => {
    await initTreeSitter()
  })

  describe('simple commands', () => {
    it('should parse a simple command with no arguments', async () => {
      const tree = parseWithTreeSitter('ls')

      expect(tree).toBeDefined()
      expect(tree.rootNode).toBeDefined()
      expect(tree.rootNode.type).toBe('program')
    })

    it('should parse a command with arguments', async () => {
      const tree = parseWithTreeSitter('ls -la /tmp')

      expect(tree.rootNode.type).toBe('program')

      // Navigate to command
      const commandNode = tree.rootNode.firstChild
      expect(commandNode).toBeDefined()
      expect(commandNode!.type).toBe('command')

      // Command should have command_name and arguments
      const children = commandNode!.children
      expect(children.length).toBeGreaterThanOrEqual(1)
    })

    it('should parse echo with string argument', async () => {
      const tree = parseWithTreeSitter('echo "hello world"')

      expect(tree.rootNode.type).toBe('program')
      const commandNode = tree.rootNode.firstChild
      expect(commandNode!.type).toBe('command')
    })

    it('should parse command with environment variable', async () => {
      const tree = parseWithTreeSitter('echo $HOME')

      expect(tree.rootNode.type).toBe('program')
      const commandNode = tree.rootNode.firstChild
      expect(commandNode!.type).toBe('command')
    })

    it('should parse command with command substitution', async () => {
      const tree = parseWithTreeSitter('echo $(pwd)')

      expect(tree.rootNode.type).toBe('program')
    })
  })

  describe('pipelines', () => {
    it('should parse a simple pipeline', async () => {
      const tree = parseWithTreeSitter('ls | grep foo')

      expect(tree.rootNode.type).toBe('program')
      const pipelineNode = tree.rootNode.firstChild
      expect(pipelineNode!.type).toBe('pipeline')
    })

    it('should parse a multi-stage pipeline', async () => {
      const tree = parseWithTreeSitter('cat file.txt | grep pattern | wc -l')

      const pipelineNode = tree.rootNode.firstChild
      expect(pipelineNode!.type).toBe('pipeline')

      // Pipeline should contain multiple commands
      const commands = pipelineNode!.children.filter(
        (n: TreeSitterNode) => n.type === 'command'
      )
      expect(commands.length).toBe(3)
    })

    it('should parse pipeline with redirects', async () => {
      const tree = parseWithTreeSitter('cat file.txt | sort > sorted.txt')

      expect(tree.rootNode.type).toBe('program')
    })
  })

  describe('redirections', () => {
    it('should parse output redirection', async () => {
      const tree = parseWithTreeSitter('echo hello > output.txt')

      expect(tree.rootNode.type).toBe('program')
      const commandNode = tree.rootNode.firstChild

      // Should have a redirect node
      const redirects = findNodes(commandNode!, 'file_redirect')
      expect(redirects.length).toBeGreaterThanOrEqual(1)
    })

    it('should parse append redirection', async () => {
      const tree = parseWithTreeSitter('echo more >> log.txt')

      const commandNode = tree.rootNode.firstChild
      const redirects = findNodes(commandNode!, 'file_redirect')
      expect(redirects.length).toBeGreaterThanOrEqual(1)
    })

    it('should parse input redirection', async () => {
      const tree = parseWithTreeSitter('wc -l < input.txt')

      const commandNode = tree.rootNode.firstChild
      const redirects = findNodes(commandNode!, 'file_redirect')
      expect(redirects.length).toBeGreaterThanOrEqual(1)
    })

    it('should parse stderr redirection', async () => {
      const tree = parseWithTreeSitter('command 2> error.log')

      expect(tree.rootNode.type).toBe('program')
    })

    it('should parse combined stdout and stderr redirection', async () => {
      const tree = parseWithTreeSitter('command > output.txt 2>&1')

      expect(tree.rootNode.type).toBe('program')
    })

    it('should parse here document', async () => {
      const input = `cat <<EOF
hello
world
EOF`
      const tree = parseWithTreeSitter(input)

      expect(tree.rootNode.type).toBe('program')
      const heredocs = findNodes(tree.rootNode, 'heredoc_redirect')
      expect(heredocs.length).toBeGreaterThanOrEqual(1)
    })

    it('should parse here string', async () => {
      const tree = parseWithTreeSitter('cat <<< "hello world"')

      expect(tree.rootNode.type).toBe('program')
    })
  })

  describe('compound commands', () => {
    it('should parse if statement', async () => {
      const input = `if [ -f file.txt ]; then
  echo exists
fi`
      const tree = parseWithTreeSitter(input)

      expect(tree.rootNode.type).toBe('program')
      const ifNode = tree.rootNode.firstChild
      expect(ifNode!.type).toBe('if_statement')
    })

    it('should parse if-else statement', async () => {
      const input = `if [ -f file.txt ]; then
  echo exists
else
  echo missing
fi`
      const tree = parseWithTreeSitter(input)

      const ifNode = tree.rootNode.firstChild
      expect(ifNode!.type).toBe('if_statement')
    })

    it('should parse for loop', async () => {
      const input = `for i in 1 2 3; do
  echo $i
done`
      const tree = parseWithTreeSitter(input)

      const forNode = tree.rootNode.firstChild
      expect(forNode!.type).toBe('for_statement')
    })

    it('should parse while loop', async () => {
      const input = `while true; do
  echo loop
  break
done`
      const tree = parseWithTreeSitter(input)

      const whileNode = tree.rootNode.firstChild
      expect(whileNode!.type).toBe('while_statement')
    })

    it('should parse case statement', async () => {
      const input = `case $1 in
  start) echo starting;;
  stop) echo stopping;;
  *) echo unknown;;
esac`
      const tree = parseWithTreeSitter(input)

      const caseNode = tree.rootNode.firstChild
      expect(caseNode!.type).toBe('case_statement')
    })

    it('should parse subshell', async () => {
      const tree = parseWithTreeSitter('(cd /tmp && ls)')

      const subshellNode = tree.rootNode.firstChild
      expect(subshellNode!.type).toBe('subshell')
    })

    it('should parse brace group', async () => {
      const tree = parseWithTreeSitter('{ echo hello; echo world; }')

      const groupNode = tree.rootNode.firstChild
      expect(groupNode!.type).toBe('compound_statement')
    })
  })

  describe('lists and conditionals', () => {
    it('should parse AND list (&&)', async () => {
      const tree = parseWithTreeSitter('mkdir foo && cd foo')

      expect(tree.rootNode.type).toBe('program')
      const listNode = tree.rootNode.firstChild
      expect(listNode!.type).toBe('list')
    })

    it('should parse OR list (||)', async () => {
      const tree = parseWithTreeSitter('test -f file.txt || touch file.txt')

      const listNode = tree.rootNode.firstChild
      expect(listNode!.type).toBe('list')
    })

    it('should parse semicolon-separated commands', async () => {
      const tree = parseWithTreeSitter('echo start; sleep 1; echo done')

      expect(tree.rootNode.type).toBe('program')
    })

    it('should parse background command', async () => {
      const tree = parseWithTreeSitter('sleep 10 &')

      expect(tree.rootNode.type).toBe('program')
    })

    it('should parse nested conditionals', async () => {
      const tree = parseWithTreeSitter('cmd1 && cmd2 || cmd3')

      expect(tree.rootNode.type).toBe('program')
    })
  })

  describe('function definitions', () => {
    it('should parse function with function keyword', async () => {
      const input = `function greet {
  echo "Hello, $1"
}`
      const tree = parseWithTreeSitter(input)

      const funcNode = tree.rootNode.firstChild
      expect(funcNode!.type).toBe('function_definition')
    })

    it('should parse function with parentheses syntax', async () => {
      const input = `greet() {
  echo "Hello, $1"
}`
      const tree = parseWithTreeSitter(input)

      const funcNode = tree.rootNode.firstChild
      expect(funcNode!.type).toBe('function_definition')
    })
  })

  describe('variable assignments', () => {
    it('should parse simple assignment', async () => {
      const tree = parseWithTreeSitter('FOO=bar')

      expect(tree.rootNode.type).toBe('program')
      const assignNode = tree.rootNode.firstChild
      expect(assignNode!.type).toBe('variable_assignment')
    })

    it('should parse assignment with command', async () => {
      const tree = parseWithTreeSitter('FOO=bar echo $FOO')

      expect(tree.rootNode.type).toBe('program')
    })

    it('should parse array assignment', async () => {
      const tree = parseWithTreeSitter('arr=(one two three)')

      expect(tree.rootNode.type).toBe('program')
    })

    it('should parse append assignment', async () => {
      const tree = parseWithTreeSitter('PATH+=/usr/local/bin')

      expect(tree.rootNode.type).toBe('program')
    })
  })
})

// ============================================================================
// Node Traversal Tests
// ============================================================================

describe('Tree-sitter Node Traversal', () => {
  beforeAll(async () => {
    await initTreeSitter()
  })

  describe('node properties', () => {
    it('should access node type', async () => {
      const tree = parseWithTreeSitter('ls -la')
      const node = tree.rootNode

      expect(typeof node.type).toBe('string')
      expect(node.type).toBe('program')
    })

    it('should access node text', async () => {
      const tree = parseWithTreeSitter('ls -la')
      const commandNode = tree.rootNode.firstChild!

      expect(typeof commandNode.text).toBe('string')
      expect(commandNode.text).toBe('ls -la')
    })

    it('should access start and end positions', async () => {
      const tree = parseWithTreeSitter('echo hello')
      const node = tree.rootNode.firstChild!

      expect(node.startPosition).toBeDefined()
      expect(node.endPosition).toBeDefined()
      expect(typeof node.startPosition.row).toBe('number')
      expect(typeof node.startPosition.column).toBe('number')
    })

    it('should access start and end indices', async () => {
      const tree = parseWithTreeSitter('echo hello')
      const node = tree.rootNode.firstChild!

      expect(typeof node.startIndex).toBe('number')
      expect(typeof node.endIndex).toBe('number')
      expect(node.startIndex).toBe(0)
      expect(node.endIndex).toBe(10)
    })

    it('should check if node is named', async () => {
      const tree = parseWithTreeSitter('ls')
      const node = tree.rootNode

      expect(typeof node.isNamed).toBe('boolean')
      expect(node.isNamed).toBe(true)
    })
  })

  describe('child navigation', () => {
    it('should access first child', async () => {
      const tree = parseWithTreeSitter('ls -la')
      const firstChild = tree.rootNode.firstChild

      expect(firstChild).toBeDefined()
      expect(firstChild!.type).toBe('command')
    })

    it('should access last child', async () => {
      const tree = parseWithTreeSitter('ls; pwd')
      const lastChild = tree.rootNode.lastChild

      expect(lastChild).toBeDefined()
    })

    it('should access children array', async () => {
      const tree = parseWithTreeSitter('ls | grep foo')
      const pipeline = tree.rootNode.firstChild!

      expect(Array.isArray(pipeline.children)).toBe(true)
      expect(pipeline.children.length).toBeGreaterThan(0)
    })

    it('should access named children', async () => {
      const tree = parseWithTreeSitter('ls -la')
      const command = tree.rootNode.firstChild!

      expect(Array.isArray(command.namedChildren)).toBe(true)
    })

    it('should access child by index', async () => {
      const tree = parseWithTreeSitter('ls | grep foo')
      const pipeline = tree.rootNode.firstChild!

      const child0 = pipeline.child(0)
      expect(child0).toBeDefined()
    })

    it('should access child count', async () => {
      const tree = parseWithTreeSitter('ls -la')
      const command = tree.rootNode.firstChild!

      expect(typeof command.childCount).toBe('number')
      expect(command.childCount).toBeGreaterThan(0)
    })
  })

  describe('sibling navigation', () => {
    it('should access next sibling', async () => {
      const tree = parseWithTreeSitter('echo hello; echo world')
      const firstCmd = tree.rootNode.firstChild!

      const nextSibling = firstCmd.nextSibling
      // May have semicolon between or direct sibling
      expect(nextSibling).toBeDefined()
    })

    it('should access previous sibling', async () => {
      const tree = parseWithTreeSitter('echo hello; echo world')
      const lastCmd = tree.rootNode.lastChild!

      const prevSibling = lastCmd.previousSibling
      expect(prevSibling).toBeDefined()
    })

    it('should access next named sibling', async () => {
      const tree = parseWithTreeSitter('ls | grep foo')
      const pipeline = tree.rootNode.firstChild!
      const firstCmd = pipeline.firstChild!

      const nextNamed = firstCmd.nextNamedSibling
      // Skip pipe symbol to get next command
      expect(nextNamed).toBeDefined()
    })
  })

  describe('parent navigation', () => {
    it('should access parent node', async () => {
      const tree = parseWithTreeSitter('ls -la')
      const command = tree.rootNode.firstChild!

      expect(command.parent).toBeDefined()
      expect(command.parent!.type).toBe('program')
    })

    it('should have null parent for root', async () => {
      const tree = parseWithTreeSitter('ls')

      expect(tree.rootNode.parent).toBeNull()
    })
  })

  describe('field access', () => {
    it('should access child by field name', async () => {
      const tree = parseWithTreeSitter('ls -la')
      const command = tree.rootNode.firstChild!

      // Command should have a 'name' field
      const nameNode = command.childForFieldName('name')
      expect(nameNode).toBeDefined()
      expect(nameNode!.text).toBe('ls')
    })

    it('should access children by field name', async () => {
      const tree = parseWithTreeSitter('ls -la /tmp')
      const command = tree.rootNode.firstChild!

      // Command may have multiple argument fields
      const args = command.childrenForFieldName('argument')
      expect(Array.isArray(args)).toBe(true)
    })
  })
})

// ============================================================================
// Command Component Extraction Tests
// ============================================================================

describe('Command Component Extraction', () => {
  beforeAll(async () => {
    await initTreeSitter()
  })

  describe('extracting command names', () => {
    it('should extract command name from simple command', async () => {
      const tree = parseWithTreeSitter('git status')
      const command = tree.rootNode.firstChild!

      const nameNode = command.childForFieldName('name')
      expect(nameNode).toBeDefined()
      expect(nameNode!.text).toBe('git')
    })

    it('should extract command name from path', async () => {
      const tree = parseWithTreeSitter('/usr/bin/ls')
      const command = tree.rootNode.firstChild!

      const nameNode = command.childForFieldName('name')
      expect(nameNode).toBeDefined()
      expect(nameNode!.text).toBe('/usr/bin/ls')
    })
  })

  describe('extracting arguments', () => {
    it('should extract all arguments', async () => {
      const tree = parseWithTreeSitter('grep -r --include="*.ts" pattern .')
      const command = tree.rootNode.firstChild!

      const args = command.childrenForFieldName('argument')
      expect(args.length).toBeGreaterThanOrEqual(4)
    })

    it('should extract quoted arguments correctly', async () => {
      const tree = parseWithTreeSitter('echo "hello world"')
      const command = tree.rootNode.firstChild!

      const args = command.childrenForFieldName('argument')
      expect(args.length).toBeGreaterThanOrEqual(1)

      // Find the quoted string
      const quotedArg = args.find(
        (arg: TreeSitterNode) =>
          arg.type === 'string' || arg.type === 'raw_string'
      )
      expect(quotedArg).toBeDefined()
    })
  })

  describe('extracting redirects', () => {
    it('should extract redirect operator and target', async () => {
      const tree = parseWithTreeSitter('echo hello > output.txt')
      const command = tree.rootNode.firstChild!

      const redirects = findNodes(command, 'file_redirect')
      expect(redirects.length).toBe(1)

      const redirect = redirects[0]
      expect(redirect.text).toContain('>')
      expect(redirect.text).toContain('output.txt')
    })

    it('should extract file descriptor number', async () => {
      const tree = parseWithTreeSitter('command 2> error.log')
      const command = tree.rootNode.firstChild!

      const redirects = findNodes(command, 'file_redirect')
      expect(redirects.length).toBe(1)

      // Should have file descriptor info
      const redirect = redirects[0]
      const fdNode = redirect.childForFieldName('descriptor')
      if (fdNode) {
        expect(fdNode.text).toBe('2')
      }
    })
  })

  describe('extracting pipeline components', () => {
    it('should extract all commands from pipeline', async () => {
      const tree = parseWithTreeSitter('cat file | grep pattern | sort | uniq')
      const pipeline = tree.rootNode.firstChild!

      expect(pipeline.type).toBe('pipeline')

      const commands = pipeline.namedChildren.filter(
        (n: TreeSitterNode) => n.type === 'command'
      )
      expect(commands.length).toBe(4)
    })
  })

  describe('extracting variable references', () => {
    it('should identify variable expansions', async () => {
      const tree = parseWithTreeSitter('echo $HOME')
      const command = tree.rootNode.firstChild!

      const expansions = findNodes(command, 'simple_expansion')
      expect(expansions.length).toBe(1)
      expect(expansions[0].text).toBe('$HOME')
    })

    it('should identify parameter expansions', async () => {
      const tree = parseWithTreeSitter('echo ${HOME:-/home/user}')
      const command = tree.rootNode.firstChild!

      const expansions = findNodes(command, 'expansion')
      expect(expansions.length).toBeGreaterThanOrEqual(1)
    })

    it('should identify command substitutions', async () => {
      const tree = parseWithTreeSitter('echo $(pwd)')
      const command = tree.rootNode.firstChild!

      const substitutions = findNodes(command, 'command_substitution')
      expect(substitutions.length).toBe(1)
    })
  })
})

// ============================================================================
// Error Recovery Tests
// ============================================================================

describe('Error Recovery on Malformed Input', () => {
  beforeAll(async () => {
    await initTreeSitter()
  })

  describe('syntax error detection', () => {
    it('should detect unclosed double quote', async () => {
      const tree = parseWithTreeSitter('echo "hello')

      // Tree should still parse, but have error nodes
      expect(tree.rootNode.type).toBe('program')
      expect(tree.rootNode.hasError).toBe(true)
    })

    it('should detect unclosed single quote', async () => {
      const tree = parseWithTreeSitter("echo 'hello")

      expect(tree.rootNode.hasError).toBe(true)
    })

    it('should detect unclosed parenthesis', async () => {
      const tree = parseWithTreeSitter('(echo hello')

      expect(tree.rootNode.hasError).toBe(true)
    })

    it('should detect unclosed brace', async () => {
      const tree = parseWithTreeSitter('{ echo hello')

      expect(tree.rootNode.hasError).toBe(true)
    })

    it('should detect missing fi in if statement', async () => {
      const tree = parseWithTreeSitter('if true; then echo yes')

      expect(tree.rootNode.hasError).toBe(true)
    })

    it('should detect missing done in for loop', async () => {
      const tree = parseWithTreeSitter('for i in 1 2 3; do echo $i')

      expect(tree.rootNode.hasError).toBe(true)
    })

    it('should detect missing esac in case statement', async () => {
      const tree = parseWithTreeSitter('case $1 in foo) echo bar;;')

      expect(tree.rootNode.hasError).toBe(true)
    })
  })

  describe('partial parsing', () => {
    it('should parse valid parts despite errors', async () => {
      const tree = parseWithTreeSitter('ls -la; echo "unterminated')

      // First command should be parseable
      expect(tree.rootNode.type).toBe('program')

      const children = tree.rootNode.namedChildren
      // Should have at least one valid command node
      const commands = children.filter(
        (n: TreeSitterNode) => n.type === 'command' && !n.hasError
      )
      expect(commands.length).toBeGreaterThanOrEqual(1)
    })

    it('should identify error node locations', async () => {
      const tree = parseWithTreeSitter('echo "hello')

      // Find error nodes
      const errors = findNodes(tree.rootNode, 'ERROR')
      expect(errors.length).toBeGreaterThan(0)

      // Error node should have position info
      const error = errors[0]
      expect(error.startPosition).toBeDefined()
      expect(error.endPosition).toBeDefined()
    })

    it('should continue parsing after pipe error', async () => {
      const tree = parseWithTreeSitter('| grep foo')

      // Should detect error at start
      expect(tree.rootNode.hasError).toBe(true)
    })

    it('should handle consecutive pipes', async () => {
      const tree = parseWithTreeSitter('ls || grep foo')

      // This is actually valid OR
      expect(tree.rootNode.type).toBe('program')
    })
  })

  describe('error node properties', () => {
    it('should mark error nodes correctly', async () => {
      const tree = parseWithTreeSitter('echo "unclosed')

      const errors = findNodes(tree.rootNode, 'ERROR')
      for (const error of errors) {
        expect(error.isError || error.type === 'ERROR').toBe(true)
      }
    })

    it('should have accurate error spans', async () => {
      const input = 'echo "unclosed'
      const tree = parseWithTreeSitter(input)

      // The error should be at or near the unclosed quote
      const hasError = tree.rootNode.hasError
      expect(hasError).toBe(true)
    })
  })
})

// ============================================================================
// Tree Mutation Tests (Incremental Parsing)
// ============================================================================

describe('Incremental Parsing', () => {
  beforeAll(async () => {
    await initTreeSitter()
  })

  it('should support tree editing', async () => {
    const parser = createParser()
    const tree1 = parser.parse('ls')

    expect(tree1.rootNode.text).toBe('ls')

    // Edit the tree
    tree1.edit({
      startIndex: 2,
      oldEndIndex: 2,
      newEndIndex: 5,
      startPosition: { row: 0, column: 2 },
      oldEndPosition: { row: 0, column: 2 },
      newEndPosition: { row: 0, column: 5 },
    })

    // Parse with the edited tree for faster incremental parsing
    const tree2 = parser.parse('ls -la', tree1)
    expect(tree2.rootNode.text).toBe('ls -la')
  })

  it('should efficiently reparse small changes', async () => {
    const parser = createParser()
    const original = 'echo hello'
    const modified = 'echo hello world'

    const tree1 = parser.parse(original)

    // Apply edit
    tree1.edit({
      startIndex: 10,
      oldEndIndex: 10,
      newEndIndex: 16,
      startPosition: { row: 0, column: 10 },
      oldEndPosition: { row: 0, column: 10 },
      newEndPosition: { row: 0, column: 16 },
    })

    const tree2 = parser.parse(modified, tree1)

    // New tree should reflect the change
    const command = tree2.rootNode.firstChild!
    expect(command.text).toBe('echo hello world')
  })
})

// ============================================================================
// Query/Pattern Matching Tests
// ============================================================================

describe('Tree-sitter Query API', () => {
  beforeAll(async () => {
    await initTreeSitter()
  })

  it('should support basic queries', async () => {
    const tree = parseWithTreeSitter('ls -la | grep foo')
    const language = getTreeSitterLanguage()

    // Create a query to find all commands
    const query = language.query('(command) @cmd')

    const matches = query.matches(tree.rootNode)
    expect(matches.length).toBeGreaterThanOrEqual(2)
  })

  it('should capture named nodes', async () => {
    const tree = parseWithTreeSitter('echo "hello"')
    const language = getTreeSitterLanguage()

    // Query for command name
    const query = language.query('(command name: (command_name) @name)')

    const matches = query.matches(tree.rootNode)
    expect(matches.length).toBe(1)

    const capture = matches[0].captures.find(
      (c: { name: string; node: TreeSitterNode }) => c.name === 'name'
    )
    expect(capture).toBeDefined()
    expect(capture!.node.text).toBe('echo')
  })
})

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Recursively find all nodes of a given type in the tree
 */
function findNodes(node: TreeSitterNode, type: string): TreeSitterNode[] {
  const results: TreeSitterNode[] = []

  function traverse(n: TreeSitterNode) {
    if (n.type === type) {
      results.push(n)
    }
    for (const child of n.children) {
      traverse(child)
    }
  }

  traverse(node)
  return results
}

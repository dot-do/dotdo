# @dotdo/bashx

Pure library for bash command parsing, safety analysis, and shell escaping. Zero Cloudflare dependencies - works in any JavaScript environment.

## Installation

```bash
npm install @dotdo/bashx
```

## Quick Start

```typescript
import {
  shellEscape,
  classifyInput,
  analyze,
  createProgram,
  createCommand,
} from '@dotdo/bashx'

// Escape values for safe shell interpolation
const file = 'my file.txt'
const escaped = shellEscape(file)  // => 'my file.txt'

// Classify input as command or natural language
const result = await classifyInput('ls -la')
// { type: 'command', confidence: 0.95, ... }

// Analyze AST for safety classification
const ast = createProgram([createCommand('rm', ['-rf', 'temp'])])
const { classification, intent } = analyze(ast)
// classification: { type: 'delete', impact: 'high', reversible: false, ... }
// intent: { commands: ['rm'], deletes: ['temp'], ... }
```

## Modules

### Shell Escaping (`@dotdo/bashx/escape`)

Safe escaping of values for shell interpolation using POSIX-compliant single-quote escaping.

```typescript
import {
  shellEscape,
  shellEscapeArg,
  safeTemplate,
  rawTemplate,
  createShellTemplate,
} from '@dotdo/bashx/escape'

// Escape a single argument
shellEscapeArg('hello world')     // => 'hello world'
shellEscapeArg("it's fine")       // => 'it'"'"'s fine'
shellEscapeArg('file; rm -rf /')  // => 'file; rm -rf /'

// Escape multiple arguments
shellEscape('ls', '-la', '/path with spaces')
// => "ls -la '/path with spaces'"

// Template literals with auto-escaping
const dangerous = '; rm -rf /'
safeTemplate`echo ${dangerous}`  // => "echo '; rm -rf /'" (injection prevented)

// Raw template (no escaping - use with caution)
const pattern = '*.ts'
rawTemplate`find . -name ${pattern}`  // => 'find . -name *.ts'
```

### Input Classification (`@dotdo/bashx/classify`)

Distinguish bash commands from natural language intent.

```typescript
import { classifyInput } from '@dotdo/bashx/classify'

// Clear commands
const cmd = await classifyInput('ls -la')
// { type: 'command', confidence: 0.95, reason: 'Contains bash syntax elements' }

// Natural language intent
const intent = await classifyInput('show me all files')
// { type: 'intent', confidence: 0.9, suggestedCommand: 'ls -la', ... }

// Ambiguous single words
const ambiguous = await classifyInput('list')
// { type: 'command', confidence: 0.5, ambiguous: true, alternatives: [...] }
```

The `InputClassification` result includes:
- `type`: 'command' | 'intent' | 'invalid'
- `confidence`: 0-1 score
- `reason`: Human-readable explanation
- `ambiguous`: Whether interpretation is uncertain
- `suggestedCommand`: For intents, a suggested command
- `alternatives`: For ambiguous inputs, possible interpretations

### Safety Analysis (`@dotdo/bashx/safety`)

Structural AST-based safety analysis (not regex pattern matching).

```typescript
import {
  analyze,
  isDangerous,
  classifyCommand,
  extractIntent,
  describeIntent,
} from '@dotdo/bashx/safety'

// Classify a single command
classifyCommand('rm', ['-rf', '/'])
// { type: 'delete', impact: 'critical', reversible: false, reason: 'Recursively deletes critical path' }

classifyCommand('ls', ['-la'])
// { type: 'read', impact: 'none', reversible: true, reason: 'Read-only command' }

// Check if a command is dangerous
const ast = createProgram([createCommand('rm', ['-rf', '/'])])
isDangerous(ast)  // { dangerous: true, reason: '...' }

// Extract semantic intent
const intent = extractIntent([createCommand('mv', ['a.txt', 'b.txt'])])
// { commands: ['mv'], reads: ['a.txt'], writes: ['b.txt'], deletes: ['a.txt'], ... }

// Generate human-readable description
describeIntent(intent)  // => 'move a.txt to b.txt'
```

**Classification Types:**
- `read`: Only reads data (ls, cat, grep)
- `write`: Creates or modifies data (cp, mv, touch)
- `delete`: Removes data (rm, rmdir)
- `execute`: Runs other programs (exec, eval, source)
- `network`: Network operations (curl, wget, ssh)
- `system`: Modifies system state (chmod, chown, mount)
- `mixed`: Combination of multiple types

**Impact Levels:**
- `none`: No side effects
- `low`: Minor, easily reversible changes
- `medium`: Significant but recoverable changes
- `high`: Substantial changes that are difficult to reverse
- `critical`: Potentially catastrophic, irreversible changes

### AST Utilities (`@dotdo/bashx/ast`)

Type guards, factory functions, and serialization for bash AST nodes.

```typescript
import {
  // Type guards
  isProgram,
  isCommand,
  isPipeline,
  isList,
  isWord,
  isRedirect,
  isBashNode,
  getNodeType,

  // Factory functions
  createProgram,
  createCommand,
  createPipeline,
  createList,
  createWord,
  createRedirect,
  createAssignment,

  // Serialization
  serializeAST,
  deserializeAST,

  // Constants
  NodeType,
  NODE_TYPES,
} from '@dotdo/bashx/ast'

// Create AST nodes programmatically
const program = createProgram([
  createCommand('git', ['status']),
  createCommand('git', ['diff']),
])

// Type guards for safe traversal
if (isCommand(node)) {
  console.log('Command:', node.name?.value)
}

// Serialize/deserialize for storage
const json = serializeAST(program)
const restored = deserializeAST(json)
```

### Backend Interface (`@dotdo/bashx/backend`)

Abstract interface for shell execution backends. Platform-specific implementations should live outside the core package.

```typescript
import type { ShellBackend, ShellOptions, ShellResult, BackendInfo } from '@dotdo/bashx/backend'

// Implement a custom backend
class MyBackend implements ShellBackend {
  async execute(command: string, options?: ShellOptions): Promise<ShellResult> {
    // Platform-specific execution logic
    return {
      exitCode: 0,
      stdout: '...',
      stderr: '',
      success: true,
    }
  }

  async isReady(): Promise<boolean> {
    return true
  }

  async getInfo(): Promise<BackendInfo> {
    return {
      name: 'my-backend',
      version: '1.0.0',
      platform: 'node',
      shells: ['/bin/bash', '/bin/sh'],
    }
  }
}
```

### PTY Emulation (`@dotdo/bashx/pty`)

Virtual terminal emulation with ANSI sequence parsing.

```typescript
import { VirtualPTY, ANSIParser, TerminalBuffer } from '@dotdo/bashx/pty'

// Create a virtual PTY
const pty = new VirtualPTY({ rows: 24, cols: 80 })

// Write data (handles ANSI sequences)
pty.write('Hello, World!\r\n')
pty.write('\x1b[31mRed text\x1b[0m')

// Get screen content
const screen = pty.getScreen()
console.log(screen.lines)

// Listen for events
pty.onScreenChange((event) => {
  console.log('Screen changed:', event)
})
```

## API Reference

### Types

```typescript
// AST Node Types
type BashNode = Program | List | Pipeline | Command | Subshell | CompoundCommand | FunctionDef | Word | Redirect | Assignment

interface Program {
  type: 'Program'
  body: BashNode[]
  errors?: ParseError[]
}

interface Command {
  type: 'Command'
  name: Word | null
  prefix: Assignment[]
  args: Word[]
  redirects: Redirect[]
}

// Classification Types
interface SafetyClassification {
  type: 'read' | 'write' | 'delete' | 'execute' | 'network' | 'system' | 'mixed'
  impact: 'none' | 'low' | 'medium' | 'high' | 'critical'
  reversible: boolean
  reason: string
}

interface Intent {
  commands: string[]
  reads: string[]
  writes: string[]
  deletes: string[]
  network: boolean
  elevated: boolean
}

// Input Classification Types
interface InputClassification {
  type: 'command' | 'intent' | 'invalid'
  confidence: number
  input: string
  reason: string
  ambiguous: boolean
  suggestedCommand?: string
  alternatives?: ClassificationAlternative[]
}
```

### Functions

| Function | Description |
|----------|-------------|
| `shellEscape(...args)` | Escape arguments for safe shell use |
| `shellEscapeArg(value)` | Escape a single argument |
| `safeTemplate` | Tagged template with auto-escaping |
| `classifyInput(input)` | Classify input as command or intent |
| `analyze(ast)` | Analyze AST for safety and intent |
| `isDangerous(ast)` | Check if command is dangerous |
| `classifyCommand(name, args)` | Classify a single command |
| `extractIntent(commands)` | Extract semantic intent |
| `describeIntent(intent)` | Generate human-readable description |
| `createProgram(body)` | Create Program AST node |
| `createCommand(name, args)` | Create Command AST node |
| `serializeAST(ast)` | Serialize AST to JSON |
| `deserializeAST(json)` | Deserialize JSON to AST |

## Design Principles

1. **Zero platform dependencies** - Works in Node.js, Deno, Bun, browsers, and edge runtimes
2. **Structural analysis** - Uses AST-based analysis, not regex pattern matching
3. **Type-safe** - Full TypeScript support with strict types
4. **Composable** - Each module can be used independently
5. **Secure by default** - Escape functions prevent shell injection

## Related

- [bashx.do](https://bashx.do) - Full platform with execution
- [Platform.do](https://platform.do) - Durable Object platform

## License

MIT

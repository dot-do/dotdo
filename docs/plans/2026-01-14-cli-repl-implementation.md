# CLI REPL Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a mongosh-style REPL for interacting with Durable Objects with OAuth auth, DO listing, type generation, and TypeScript autocomplete.

**Architecture:** CLI uses oauth.do/node for auth, workers.do for DO registry, Bun+Ink for TUI, TypeScript Language Service for autocomplete, and ai-evaluate for secure code execution via capnweb RPC.

**Tech Stack:** Bun, Ink (React TUI), oauth.do, TypeScript, capnweb, ai-evaluate

---

## Task 1: Add Dependencies

**Files:**
- Modify: `cli/package.json`
- Modify: `package.json` (root)

**Step 1: Add Ink and oauth.do to CLI package.json**

```bash
cd cli && pnpm add ink react oauth.do
```

**Step 2: Verify installation**

Run: `cd cli && pnpm list ink oauth.do`
Expected: Both packages listed

**Step 3: Commit**

```bash
git add cli/package.json pnpm-lock.yaml
git commit -m "feat(cli): add ink and oauth.do dependencies"
```

---

## Task 2: Create DO.Config Types

**Files:**
- Create: `cli/types/config.ts`
- Test: `cli/tests/config-types.test.ts`

**Step 1: Write failing test for config types**

```typescript
// cli/tests/config-types.test.ts
import { describe, it, expect } from 'bun:test'
import type { DO } from '../types/config'

describe('DO.Config types', () => {
  it('accepts valid config with $id', () => {
    const config: DO.Config = {
      $id: 'https://startups.studio'
    }
    expect(config.$id).toBe('https://startups.studio')
  })

  it('accepts config with optional env', () => {
    const config: DO.Config = {
      $id: 'https://startups.studio',
      env: 'production'
    }
    expect(config.env).toBe('production')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd cli && bun test tests/config-types.test.ts`
Expected: FAIL - cannot find module '../types/config'

**Step 3: Create config types**

```typescript
// cli/types/config.ts
/**
 * DO Configuration Types
 *
 * Used in do.config.ts files to configure the active DO.
 */

export namespace DO {
  /**
   * Configuration for do.config.ts
   */
  export interface Config {
    /** The DO's namespace URL - its globally unique identity */
    $id: string
    /** Environment (optional) */
    env?: 'production' | 'staging' | 'development'
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd cli && bun test tests/config-types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add cli/types/config.ts cli/tests/config-types.test.ts
git commit -m "feat(cli): add DO.Config types for do.config.ts"
```

---

## Task 3: Create Config Loader

**Files:**
- Create: `cli/utils/do-config.ts`
- Test: `cli/tests/do-config.test.ts`

**Step 1: Write failing test for config loader**

```typescript
// cli/tests/do-config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { loadConfig, getConfigPath } from '../utils/do-config'
import { writeFileSync, unlinkSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'

describe('do-config loader', () => {
  const testDir = '/tmp/dotdo-config-test'

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('returns null when no config exists', async () => {
    const config = await loadConfig(testDir)
    expect(config).toBeNull()
  })

  it('loads do.config.ts with $id', async () => {
    const configContent = `
      export default {
        $id: 'https://test.example.com'
      }
    `
    writeFileSync(join(testDir, 'do.config.ts'), configContent)

    const config = await loadConfig(testDir)
    expect(config?.$id).toBe('https://test.example.com')
  })

  it('getConfigPath returns correct path', () => {
    const path = getConfigPath(testDir)
    expect(path).toBe(join(testDir, 'do.config.ts'))
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd cli && bun test tests/do-config.test.ts`
Expected: FAIL - cannot find module '../utils/do-config'

**Step 3: Create config loader**

```typescript
// cli/utils/do-config.ts
/**
 * DO Config Loader
 *
 * Loads do.config.ts from the current directory or specified path.
 */

import { existsSync } from 'fs'
import { join } from 'path'
import type { DO } from '../types/config'

const CONFIG_FILENAME = 'do.config.ts'

/**
 * Get the path to do.config.ts
 */
export function getConfigPath(dir: string = process.cwd()): string {
  return join(dir, CONFIG_FILENAME)
}

/**
 * Check if do.config.ts exists
 */
export function configExists(dir: string = process.cwd()): boolean {
  return existsSync(getConfigPath(dir))
}

/**
 * Load do.config.ts from directory
 * Returns null if no config found
 */
export async function loadConfig(dir: string = process.cwd()): Promise<DO.Config | null> {
  const configPath = getConfigPath(dir)

  if (!existsSync(configPath)) {
    return null
  }

  try {
    // Use Bun's native TypeScript import
    const module = await import(configPath)
    return module.default as DO.Config
  } catch (error) {
    console.error(`Failed to load ${CONFIG_FILENAME}:`, error)
    return null
  }
}

/**
 * Write do.config.ts to directory
 */
export async function writeConfig(config: DO.Config, dir: string = process.cwd()): Promise<void> {
  const configPath = getConfigPath(dir)
  const content = `import type { DO } from 'dotdo'

export default {
  $id: '${config.$id}',${config.env ? `\n  env: '${config.env}',` : ''}
} satisfies DO.Config
`
  await Bun.write(configPath, content)
}
```

**Step 4: Run test to verify it passes**

Run: `cd cli && bun test tests/do-config.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add cli/utils/do-config.ts cli/tests/do-config.test.ts
git commit -m "feat(cli): add do.config.ts loader"
```

---

## Task 4: Create workers.do Client

**Files:**
- Create: `cli/services/workers-do.ts`
- Test: `cli/tests/workers-do.test.ts`

**Step 1: Write failing test for workers.do client**

```typescript
// cli/tests/workers-do.test.ts
import { describe, it, expect, mock } from 'bun:test'
import { WorkersDoClient, type Worker } from '../services/workers-do'

describe('WorkersDoClient', () => {
  it('creates client with auth token', () => {
    const client = new WorkersDoClient('test-token')
    expect(client).toBeDefined()
  })

  it('has list method', () => {
    const client = new WorkersDoClient('test-token')
    expect(typeof client.list).toBe('function')
  })

  it('has link method', () => {
    const client = new WorkersDoClient('test-token')
    expect(typeof client.link).toBe('function')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd cli && bun test tests/workers-do.test.ts`
Expected: FAIL - cannot find module '../services/workers-do'

**Step 3: Create workers.do client**

```typescript
// cli/services/workers-do.ts
/**
 * workers.do Client
 *
 * Client for interacting with workers.do registry.
 * Handles listing DOs, linking folders, and deployments.
 */

import { $Context } from '@dotdo/client'

export interface Worker {
  $id: string
  name: string
  url: string
  createdAt: string
  deployedAt?: string
  accessedAt?: string
  linkedFolders?: string[]
}

export interface ListOptions {
  sortBy?: 'created' | 'deployed' | 'accessed'
  limit?: number
}

export interface LinkOptions {
  folder: string
  workerId: string
}

const WORKERS_DO_URL = 'https://workers.do'

export class WorkersDoClient {
  private token: string
  private $: ReturnType<typeof $Context>

  constructor(token: string) {
    this.token = token
    // TODO: Pass auth token to capnweb session
    this.$ = $Context(WORKERS_DO_URL)
  }

  /**
   * List user's workers sorted by activity
   */
  async list(options: ListOptions = {}): Promise<Worker[]> {
    const { sortBy = 'accessed', limit = 20 } = options

    try {
      const workers = await this.$.workers.list({ sortBy, limit })
      return workers as Worker[]
    } catch (error) {
      console.error('Failed to list workers:', error)
      return []
    }
  }

  /**
   * Link a folder to a worker
   */
  async link(options: LinkOptions): Promise<boolean> {
    const { folder, workerId } = options

    try {
      await this.$.workers.link({ folder, workerId })
      return true
    } catch (error) {
      console.error('Failed to link folder:', error)
      return false
    }
  }

  /**
   * Get a specific worker by ID
   */
  async get(workerId: string): Promise<Worker | null> {
    try {
      const worker = await this.$.workers.get(workerId)
      return worker as Worker
    } catch (error) {
      return null
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd cli && bun test tests/workers-do.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add cli/services/workers-do.ts cli/tests/workers-do.test.ts
git commit -m "feat(cli): add workers.do client for DO registry"
```

---

## Task 5: Create Type Generator

**Files:**
- Create: `cli/commands/generate.ts`
- Test: `cli/tests/commands/generate.test.ts`

**Step 1: Write failing test for generate command**

```typescript
// cli/tests/commands/generate.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { generateTypes, fetchTypes } from '../commands/generate'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'

describe('generate command', () => {
  const testDir = '/tmp/dotdo-generate-test'

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('creates .do directory if not exists', async () => {
    await generateTypes({
      $id: 'https://test.example.com',
      outputDir: testDir,
      mockTypes: true  // Use mock for testing
    })

    expect(existsSync(join(testDir, '.do'))).toBe(true)
  })

  it('writes types.d.ts file', async () => {
    await generateTypes({
      $id: 'https://test.example.com',
      outputDir: testDir,
      mockTypes: true
    })

    expect(existsSync(join(testDir, '.do', 'types.d.ts'))).toBe(true)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd cli && bun test tests/commands/generate.test.ts`
Expected: FAIL - cannot find module '../commands/generate'

**Step 3: Create generate command**

```typescript
// cli/commands/generate.ts
/**
 * Generate Command
 *
 * Fetches types from connected DO and writes to .do/types.d.ts
 */

import { Command } from 'commander'
import { mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { loadConfig } from '../utils/do-config'
import { createLogger } from '../utils/logger'

const logger = createLogger('generate')

export interface GenerateOptions {
  $id: string
  outputDir?: string
  mockTypes?: boolean  // For testing
}

/**
 * Fetch types from a DO
 */
export async function fetchTypes($id: string): Promise<string> {
  const typesUrl = `${$id}/.do/types.d.ts`

  try {
    const response = await fetch(typesUrl)
    if (!response.ok) {
      throw new Error(`Failed to fetch types: ${response.status}`)
    }
    return await response.text()
  } catch (error) {
    logger.warn(`Could not fetch types from ${typesUrl}, using defaults`)
    return getDefaultTypes($id)
  }
}

/**
 * Get default types when DO doesn't expose custom types
 */
function getDefaultTypes($id: string): string {
  return `// Generated by dotdo - do not edit
// Source: ${$id}

declare module 'dotdo' {
  export namespace DO {
    export interface Config {
      $id: string
      env?: 'production' | 'staging' | 'development'
    }

    // Add your custom types here or run 'dotdo generate'
    // after the DO exposes types at /.do/types.d.ts
  }
}
`
}

/**
 * Generate types and write to .do/types.d.ts
 */
export async function generateTypes(options: GenerateOptions): Promise<void> {
  const { $id, outputDir = process.cwd(), mockTypes = false } = options

  const doDir = join(outputDir, '.do')
  const typesPath = join(doDir, 'types.d.ts')

  // Create .do directory
  if (!existsSync(doDir)) {
    mkdirSync(doDir, { recursive: true })
  }

  // Fetch or mock types
  const types = mockTypes ? getDefaultTypes($id) : await fetchTypes($id)

  // Write types file
  await Bun.write(typesPath, types)
  logger.success(`Types written to ${typesPath}`)
}

/**
 * Commander command for 'dotdo generate'
 */
export const generateCommand = new Command('generate')
  .description('Generate types from connected DO')
  .option('-d, --dir <dir>', 'Output directory', process.cwd())
  .action(async (options) => {
    const config = await loadConfig(options.dir)

    if (!config) {
      logger.error('No do.config.ts found. Run "dotdo connect" first.')
      process.exit(1)
    }

    await generateTypes({
      $id: config.$id,
      outputDir: options.dir
    })
  })

export default generateCommand
```

**Step 4: Run test to verify it passes**

Run: `cd cli && bun test tests/commands/generate.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add cli/commands/generate.ts cli/tests/commands/generate.test.ts
git commit -m "feat(cli): add generate command for type generation"
```

---

## Task 6: Create Connect Command

**Files:**
- Create: `cli/commands/connect.ts`
- Test: `cli/tests/commands/connect.test.ts`

**Step 1: Write failing test**

```typescript
// cli/tests/commands/connect.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { connectToDO } from '../commands/connect'
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'

describe('connect command', () => {
  const testDir = '/tmp/dotdo-connect-test'

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('creates do.config.ts with $id', async () => {
    await connectToDO({
      $id: 'https://test.example.com',
      dir: testDir,
      skipTypes: true
    })

    const configPath = join(testDir, 'do.config.ts')
    expect(existsSync(configPath)).toBe(true)

    const content = readFileSync(configPath, 'utf-8')
    expect(content).toContain('https://test.example.com')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd cli && bun test tests/commands/connect.test.ts`
Expected: FAIL

**Step 3: Create connect command**

```typescript
// cli/commands/connect.ts
/**
 * Connect Command
 *
 * Links current folder to a DO by creating do.config.ts
 */

import { Command } from 'commander'
import { writeConfig, configExists } from '../utils/do-config'
import { generateTypes } from './generate'
import { createLogger } from '../utils/logger'
import type { DO } from '../types/config'

const logger = createLogger('connect')

export interface ConnectOptions {
  $id: string
  dir?: string
  skipTypes?: boolean
  force?: boolean
}

/**
 * Connect folder to a DO
 */
export async function connectToDO(options: ConnectOptions): Promise<void> {
  const { $id, dir = process.cwd(), skipTypes = false, force = false } = options

  // Check for existing config
  if (configExists(dir) && !force) {
    logger.warn('do.config.ts already exists. Use --force to overwrite.')
    return
  }

  // Create config
  const config: DO.Config = { $id }
  await writeConfig(config, dir)
  logger.success(`Connected to ${$id}`)

  // Generate types
  if (!skipTypes) {
    await generateTypes({ $id, outputDir: dir })
  }
}

/**
 * Commander command for 'dotdo connect'
 */
export const connectCommand = new Command('connect')
  .description('Connect current folder to a DO')
  .argument('[url]', 'DO URL to connect to')
  .option('-f, --force', 'Overwrite existing config')
  .option('--no-types', 'Skip type generation')
  .action(async (url, options) => {
    if (!url) {
      // TODO: Interactive picker using workers.do
      logger.error('Please provide a DO URL: dotdo connect <url>')
      process.exit(1)
    }

    await connectToDO({
      $id: url,
      force: options.force,
      skipTypes: !options.types
    })
  })

export default connectCommand
```

**Step 4: Run test to verify it passes**

Run: `cd cli && bun test tests/commands/connect.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add cli/commands/connect.ts cli/tests/commands/connect.test.ts
git commit -m "feat(cli): add connect command for folder linking"
```

---

## Task 7: Create Ink REPL Components

**Files:**
- Create: `cli/ink/App.tsx`
- Create: `cli/ink/Header.tsx`
- Create: `cli/ink/Input.tsx`
- Create: `cli/ink/Output.tsx`

**Step 1: Create Header component**

```typescript
// cli/ink/Header.tsx
import React from 'react'
import { Box, Text } from 'ink'

interface HeaderProps {
  doName: string
  user?: string
}

export function Header({ doName, user }: HeaderProps) {
  return (
    <Box borderStyle="single" paddingX={1}>
      <Text color="cyan" bold>{doName}</Text>
      {user && (
        <>
          <Text> </Text>
          <Text color="gray">{user}</Text>
        </>
      )}
    </Box>
  )
}
```

**Step 2: Create Input component**

```typescript
// cli/ink/Input.tsx
import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'

interface InputProps {
  prompt: string
  onSubmit: (value: string) => void
  completions?: string[]
}

export function Input({ prompt, onSubmit, completions = [] }: InputProps) {
  const [value, setValue] = useState('')
  const [showCompletions, setShowCompletions] = useState(false)

  useInput((input, key) => {
    if (key.return) {
      onSubmit(value)
      setValue('')
      setShowCompletions(false)
    } else if (key.backspace || key.delete) {
      setValue(v => v.slice(0, -1))
    } else if (key.tab) {
      setShowCompletions(true)
    } else if (key.escape) {
      setShowCompletions(false)
    } else if (!key.ctrl && !key.meta && input) {
      setValue(v => v + input)
    }
  })

  const filteredCompletions = completions.filter(c =>
    c.toLowerCase().startsWith(value.toLowerCase())
  ).slice(0, 5)

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="green">{prompt}</Text>
        <Text>{value}</Text>
        <Text color="gray">│</Text>
      </Box>
      {showCompletions && filteredCompletions.length > 0 && (
        <Box flexDirection="column" marginLeft={prompt.length}>
          {filteredCompletions.map((c, i) => (
            <Text key={i} color="yellow">{c}</Text>
          ))}
        </Box>
      )}
    </Box>
  )
}
```

**Step 3: Create Output component**

```typescript
// cli/ink/Output.tsx
import React from 'react'
import { Box, Text } from 'ink'

interface OutputEntry {
  type: 'input' | 'output' | 'error'
  content: string
}

interface OutputProps {
  entries: OutputEntry[]
}

export function Output({ entries }: OutputProps) {
  return (
    <Box flexDirection="column">
      {entries.map((entry, i) => (
        <Box key={i}>
          {entry.type === 'input' && (
            <Text color="gray">&gt; {entry.content}</Text>
          )}
          {entry.type === 'output' && (
            <Text>{entry.content}</Text>
          )}
          {entry.type === 'error' && (
            <Text color="red">{entry.content}</Text>
          )}
        </Box>
      ))}
    </Box>
  )
}
```

**Step 4: Create main App component**

```typescript
// cli/ink/App.tsx
import React, { useState, useCallback } from 'react'
import { Box } from 'ink'
import { Header } from './Header'
import { Input } from './Input'
import { Output } from './Output'

interface AppProps {
  doName: string
  user?: string
  onExecute: (code: string) => Promise<string>
}

interface OutputEntry {
  type: 'input' | 'output' | 'error'
  content: string
}

export function App({ doName, user, onExecute }: AppProps) {
  const [entries, setEntries] = useState<OutputEntry[]>([])
  const [completions] = useState<string[]>([
    '$.things',
    '$.events',
    '$.actions',
    '$.on',
    '$.every',
    'await',
  ])

  const handleSubmit = useCallback(async (code: string) => {
    if (!code.trim()) return

    // Handle special commands
    if (code.startsWith('.')) {
      if (code === '.help') {
        setEntries(e => [...e, {
          type: 'output',
          content: `Commands:
  .help    - Show this help
  .clear   - Clear output
  .types   - Regenerate types
  .switch  - Switch DO
  Ctrl+C   - Exit`
        }])
        return
      }
      if (code === '.clear') {
        setEntries([])
        return
      }
    }

    // Add input to history
    setEntries(e => [...e, { type: 'input', content: code }])

    try {
      const result = await onExecute(code)
      setEntries(e => [...e, { type: 'output', content: result }])
    } catch (error) {
      setEntries(e => [...e, {
        type: 'error',
        content: error instanceof Error ? error.message : String(error)
      }])
    }
  }, [onExecute])

  return (
    <Box flexDirection="column" padding={1}>
      <Header doName={doName} user={user} />
      <Output entries={entries} />
      <Input
        prompt={`${doName}> `}
        onSubmit={handleSubmit}
        completions={completions}
      />
    </Box>
  )
}
```

**Step 5: Commit**

```bash
git add cli/ink/
git commit -m "feat(cli): add Ink REPL components"
```

---

## Task 8: Create REPL Command

**Files:**
- Create: `cli/commands/repl.ts`
- Modify: `cli/main.ts`

**Step 1: Create REPL command**

```typescript
// cli/commands/repl.ts
/**
 * REPL Command
 *
 * Interactive TypeScript REPL connected to a DO.
 */

import { Command } from 'commander'
import React from 'react'
import { render } from 'ink'
import { ensureLoggedIn } from 'oauth.do/node'
import { App } from '../ink/App'
import { loadConfig } from '../utils/do-config'
import { WorkersDoClient } from '../services/workers-do'
import { createLogger } from '../utils/logger'

const logger = createLogger('repl')

/**
 * Execute code against a DO using ai-evaluate
 * TODO: Integrate actual ai-evaluate
 */
async function executeCode($id: string, code: string): Promise<string> {
  // For now, just echo back - will integrate ai-evaluate
  return `[Would execute against ${$id}]: ${code}`
}

/**
 * Start the REPL
 */
export async function startRepl($id: string, user?: string): Promise<void> {
  const doName = new URL($id).hostname

  const { waitUntilExit } = render(
    React.createElement(App, {
      doName,
      user,
      onExecute: (code: string) => executeCode($id, code)
    })
  )

  await waitUntilExit()
}

/**
 * Commander command for 'dotdo' (default) and 'dotdo repl'
 */
export const replCommand = new Command('repl')
  .description('Start interactive REPL')
  .option('--url <url>', 'Connect to specific DO')
  .action(async (options) => {
    // Ensure logged in
    let user: string | undefined
    try {
      const auth = await ensureLoggedIn()
      user = auth.user?.email
    } catch (error) {
      logger.error('Authentication failed. Run "dotdo login" first.')
      process.exit(1)
    }

    // Get DO URL
    let $id = options.url

    if (!$id) {
      // Try loading from do.config.ts
      const config = await loadConfig()
      if (config) {
        $id = config.$id
      }
    }

    if (!$id) {
      // Interactive picker
      logger.info('No DO configured. Fetching your workers...')

      const token = '' // TODO: Get from oauth.do
      const client = new WorkersDoClient(token)
      const workers = await client.list({ sortBy: 'accessed', limit: 10 })

      if (workers.length === 0) {
        logger.error('No workers found. Deploy a DO first.')
        process.exit(1)
      }

      // For now, just use first worker
      // TODO: Interactive selection with Ink
      $id = workers[0].url
      logger.info(`Connecting to ${$id}`)
    }

    await startRepl($id, user)
  })

export default replCommand
```

**Step 2: Add to main.ts**

Add these lines to `cli/main.ts` after other command imports:

```typescript
import { replCommand } from './commands/repl'
import { connectCommand } from './commands/connect'
import { generateCommand } from './commands/generate'
```

And add after other program.addCommand() calls:

```typescript
program.addCommand(replCommand)
program.addCommand(connectCommand)
program.addCommand(generateCommand)

// Make REPL the default when no command given
program.action(async () => {
  const { action } = replCommand
  if (action) await action({})
})
```

**Step 3: Commit**

```bash
git add cli/commands/repl.ts cli/main.ts
git commit -m "feat(cli): add REPL command with Ink UI"
```

---

## Task 9: Wire Up Package Exports

**Files:**
- Modify: `package.json` (root exports)
- Create: `types/DO.ts` (if not exists)

**Step 1: Add DO namespace export**

Ensure `types/DO.ts` exports the DO namespace for use in do.config.ts:

```typescript
// In types/index.ts or create types/DO.ts
export namespace DO {
  export interface Config {
    $id: string
    env?: 'production' | 'staging' | 'development'
  }
}
```

**Step 2: Verify export from dotdo package**

Ensure `package.json` exports include types:

```json
{
  "exports": {
    ".": {
      "types": "./dist/do/index.d.ts",
      "default": "./dist/do/index.js"
    }
  }
}
```

**Step 3: Commit**

```bash
git add package.json types/
git commit -m "feat: export DO namespace for do.config.ts"
```

---

## Task 10: Integration Test

**Files:**
- Create: `cli/tests/integration/repl-flow.test.ts`

**Step 1: Write integration test**

```typescript
// cli/tests/integration/repl-flow.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { connectToDO } from '../../commands/connect'
import { loadConfig } from '../../utils/do-config'
import { generateTypes } from '../../commands/generate'

describe('REPL integration flow', () => {
  const testDir = '/tmp/dotdo-integration-test'

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('complete flow: connect → config → types', async () => {
    // 1. Connect to DO
    await connectToDO({
      $id: 'https://test.example.com',
      dir: testDir,
      skipTypes: true
    })

    // 2. Verify config created
    const config = await loadConfig(testDir)
    expect(config).not.toBeNull()
    expect(config?.$id).toBe('https://test.example.com')

    // 3. Generate types
    await generateTypes({
      $id: config!.$id,
      outputDir: testDir,
      mockTypes: true
    })

    // 4. Verify types created
    expect(existsSync(join(testDir, '.do', 'types.d.ts'))).toBe(true)
  })
})
```

**Step 2: Run integration test**

Run: `cd cli && bun test tests/integration/repl-flow.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add cli/tests/integration/
git commit -m "test(cli): add REPL integration tests"
```

---

## Summary

**Files Created:**
- `cli/types/config.ts` - DO.Config types
- `cli/utils/do-config.ts` - Config loader
- `cli/services/workers-do.ts` - workers.do client
- `cli/commands/generate.ts` - Type generation
- `cli/commands/connect.ts` - Folder linking
- `cli/commands/repl.ts` - REPL command
- `cli/ink/App.tsx` - Main REPL component
- `cli/ink/Header.tsx` - Header component
- `cli/ink/Input.tsx` - Input with completions
- `cli/ink/Output.tsx` - Output display

**Files Modified:**
- `cli/package.json` - Added dependencies
- `cli/main.ts` - Added new commands

**Next Steps (not in this plan):**
1. Integrate TypeScript Language Service for real autocomplete
2. Integrate ai-evaluate for secure code execution
3. Add interactive DO picker using Ink
4. Add workers.do authentication passing

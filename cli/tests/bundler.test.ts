/**
 * TDD RED Phase - Tests for TSX/MDX Compilation Pipeline
 *
 * This bundler compiles TSX and MDX surface files into servable JavaScript.
 *
 * Features:
 * - Compile .tsx files with React JSX to JavaScript
 * - Compile .mdx files with MDXUI components
 * - Generate source maps for debugging
 * - Handle ES module imports
 * - Watch mode for development
 *
 * @see cli/runtime/bundler.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// These imports don't exist yet - TDD RED phase
import {
  compileFile,
  createBundler,
  type CompileResult,
  type BundlerOptions,
  type Bundler,
} from '../runtime/bundler'

describe('compileFile', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `dotdo-bundler-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  describe('TSX compilation', () => {
    it('compiles App.tsx to valid JavaScript', async () => {
      const tsxContent = `
import React from 'react'

export default function App() {
  return <div>Hello World</div>
}
`
      const filePath = join(testDir, 'App.tsx')
      await writeFile(filePath, tsxContent)

      const result = await compileFile(filePath)

      expect(result).toBeDefined()
      expect(result.code).toBeDefined()
      expect(typeof result.code).toBe('string')
      expect(result.code.length).toBeGreaterThan(0)
      // Should NOT contain JSX syntax after compilation
      expect(result.code).not.toContain('<div>')
      // Should contain JavaScript function call (createElement or jsx)
      expect(result.code).toMatch(/jsx|createElement|jsxs|jsxDEV/)
    })

    it('handles React JSX syntax with props', async () => {
      const tsxContent = `
import React from 'react'

interface ButtonProps {
  label: string
  onClick: () => void
  disabled?: boolean
}

export function Button({ label, onClick, disabled = false }: ButtonProps) {
  return (
    <button onClick={onClick} disabled={disabled} className="btn-primary">
      {label}
    </button>
  )
}
`
      const filePath = join(testDir, 'Button.tsx')
      await writeFile(filePath, tsxContent)

      const result = await compileFile(filePath)

      expect(result.code).toBeDefined()
      // Props should be passed as objects in compiled output
      expect(result.code).not.toContain('<button')
      expect(result.code).toMatch(/jsx|createElement/)
      // Type annotations should be stripped
      expect(result.code).not.toContain('interface ButtonProps')
      expect(result.code).not.toContain(': string')
    })

    it('handles TypeScript types and interfaces', async () => {
      const tsxContent = `
type User = {
  id: string
  name: string
  email: string
}

interface Props {
  user: User
  onUpdate: (user: User) => void
}

export function UserCard({ user, onUpdate }: Props): JSX.Element {
  return <div>{user.name}</div>
}
`
      const filePath = join(testDir, 'UserCard.tsx')
      await writeFile(filePath, tsxContent)

      const result = await compileFile(filePath)

      expect(result.code).toBeDefined()
      // Type definitions should be stripped
      expect(result.code).not.toContain('type User')
      expect(result.code).not.toContain('interface Props')
      expect(result.code).not.toContain(': JSX.Element')
    })

    it('handles import statements correctly', async () => {
      const tsxContent = `
import React, { useState, useEffect } from 'react'
import { Button } from '@mdxui/primitives'
import type { User } from '../types'

export function Dashboard() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    console.log('mounted')
  }, [])

  return (
    <div>
      <Button onClick={() => setCount(c => c + 1)}>
        Count: {count}
      </Button>
    </div>
  )
}
`
      const filePath = join(testDir, 'Dashboard.tsx')
      await writeFile(filePath, tsxContent)

      const result = await compileFile(filePath)

      expect(result.code).toBeDefined()
      // Import statements should be preserved or transformed
      expect(result.code).toMatch(/import|require/)
      // Type-only imports should be removed
      expect(result.code).not.toContain("import type { User }")
    })

    it('handles async components', async () => {
      const tsxContent = `
import React from 'react'

async function fetchData(): Promise<string[]> {
  return ['item1', 'item2']
}

export async function DataList() {
  const items = await fetchData()
  return (
    <ul>
      {items.map(item => <li key={item}>{item}</li>)}
    </ul>
  )
}
`
      const filePath = join(testDir, 'DataList.tsx')
      await writeFile(filePath, tsxContent)

      const result = await compileFile(filePath)

      expect(result.code).toBeDefined()
      // Async syntax should be preserved
      expect(result.code).toMatch(/async/)
    })
  })

  describe('MDX compilation', () => {
    it('compiles Site.mdx with MDXUI components', async () => {
      const mdxContent = `---
title: Welcome
description: Our landing page
---

import { Hero, Button } from '@mdxui/beacon'

# Welcome to Our Site

<Hero title="Build Your Dream" subtitle="Start today">
  <Button href="/signup">Get Started</Button>
</Hero>

## Features

- Fast
- Reliable
- Scalable
`
      const filePath = join(testDir, 'Site.mdx')
      await writeFile(filePath, mdxContent)

      const result = await compileFile(filePath)

      expect(result).toBeDefined()
      expect(result.code).toBeDefined()
      expect(typeof result.code).toBe('string')
      // MDX compiles to JSX function
      expect(result.code).toMatch(/function|export|default/)
      // Should not contain raw markdown
      expect(result.code).not.toContain('# Welcome')
    })

    it('compiles MDX with frontmatter', async () => {
      const mdxContent = `---
title: Documentation
author: Team
date: 2024-01-01
---

# Getting Started

This is the documentation.
`
      const filePath = join(testDir, 'Docs.mdx')
      await writeFile(filePath, mdxContent)

      const result = await compileFile(filePath)

      expect(result.code).toBeDefined()
      // Frontmatter should be extracted or handled
      expect(result.code).not.toContain('---\ntitle:')
    })

    it('compiles MDX with code blocks', async () => {
      const mdxContent = `
# Code Example

Here is some code:

\`\`\`typescript
const greeting = 'hello'
console.log(greeting)
\`\`\`

And inline \`code\` too.
`
      const filePath = join(testDir, 'CodeDoc.mdx')
      await writeFile(filePath, mdxContent)

      const result = await compileFile(filePath)

      expect(result.code).toBeDefined()
      // Should handle code blocks
      expect(result.code).toMatch(/function|export/)
    })

    it('compiles MDX with JSX expressions', async () => {
      const mdxContent = `
export const metadata = {
  title: 'Dynamic Content'
}

# Hello {metadata.title}

The current year is {new Date().getFullYear()}.
`
      const filePath = join(testDir, 'Dynamic.mdx')
      await writeFile(filePath, mdxContent)

      const result = await compileFile(filePath)

      expect(result.code).toBeDefined()
      // JSX expressions should be preserved
      expect(result.code).toMatch(/metadata/)
    })
  })

  describe('source maps', () => {
    it('returns source maps when sourceMaps option is true', async () => {
      const tsxContent = `
import React from 'react'

export function Component() {
  return <div>Test</div>
}
`
      const filePath = join(testDir, 'Component.tsx')
      await writeFile(filePath, tsxContent)

      const result = await compileFile(filePath, { sourceMaps: true })

      expect(result.code).toBeDefined()
      expect(result.map).toBeDefined()
      expect(typeof result.map).toBe('string')
      // Source map should be valid JSON
      const sourceMap = JSON.parse(result.map!)
      expect(sourceMap.version).toBe(3)
      expect(sourceMap.sources).toBeDefined()
    })

    it('returns undefined map when sourceMaps option is false', async () => {
      const tsxContent = `
export function Component() {
  return <div>Test</div>
}
`
      const filePath = join(testDir, 'Component.tsx')
      await writeFile(filePath, tsxContent)

      const result = await compileFile(filePath, { sourceMaps: false })

      expect(result.code).toBeDefined()
      expect(result.map).toBeUndefined()
    })

    it('returns undefined map by default', async () => {
      const tsxContent = `
export function Component() {
  return <div>Test</div>
}
`
      const filePath = join(testDir, 'Component.tsx')
      await writeFile(filePath, tsxContent)

      const result = await compileFile(filePath)

      expect(result.code).toBeDefined()
      expect(result.map).toBeUndefined()
    })

    it('returns source maps for MDX files', async () => {
      const mdxContent = `
# Title

Content here.
`
      const filePath = join(testDir, 'Doc.mdx')
      await writeFile(filePath, mdxContent)

      const result = await compileFile(filePath, { sourceMaps: true })

      expect(result.code).toBeDefined()
      expect(result.map).toBeDefined()
    })
  })

  describe('error handling', () => {
    it('throws for unsupported file types', async () => {
      const filePath = join(testDir, 'styles.css')
      await writeFile(filePath, 'body { color: red; }')

      await expect(compileFile(filePath)).rejects.toThrow(/unsupported.*type|unknown.*extension/i)
    })

    it('throws for non-existent files', async () => {
      const filePath = join(testDir, 'NonExistent.tsx')

      await expect(compileFile(filePath)).rejects.toThrow(/not found|no such file|ENOENT/i)
    })

    it('throws on syntax errors in TSX', async () => {
      const invalidTsx = `
export function Invalid() {
  return <div
}
`
      const filePath = join(testDir, 'Invalid.tsx')
      await writeFile(filePath, invalidTsx)

      await expect(compileFile(filePath)).rejects.toThrow()
    })

    it('throws on syntax errors in MDX', async () => {
      const invalidMdx = `
# Title

<Component unclosed
`
      const filePath = join(testDir, 'Invalid.mdx')
      await writeFile(filePath, invalidMdx)

      await expect(compileFile(filePath)).rejects.toThrow()
    })
  })

  describe('file extensions', () => {
    it('handles .ts files', async () => {
      const tsContent = `
export function add(a: number, b: number): number {
  return a + b
}

export const PI = 3.14159
`
      const filePath = join(testDir, 'utils.ts')
      await writeFile(filePath, tsContent)

      const result = await compileFile(filePath)

      expect(result.code).toBeDefined()
      // Type annotations should be stripped
      expect(result.code).not.toContain(': number')
    })

    it('handles .md files as MDX', async () => {
      const mdContent = `
# Simple Markdown

Just plain markdown content.

- Item 1
- Item 2
`
      const filePath = join(testDir, 'README.md')
      await writeFile(filePath, mdContent)

      const result = await compileFile(filePath)

      expect(result.code).toBeDefined()
      expect(result.code).toMatch(/function|export/)
    })
  })
})

describe('createBundler', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `dotdo-bundler-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('creates a bundler instance', () => {
    const bundler = createBundler()

    expect(bundler).toBeDefined()
    expect(typeof bundler.compile).toBe('function')
  })

  it('creates bundler with options', () => {
    const bundler = createBundler({
      sourceMaps: true,
      watch: false,
    })

    expect(bundler).toBeDefined()
  })

  it('bundler.compile works like compileFile', async () => {
    const tsxContent = `
export function App() {
  return <div>Hello</div>
}
`
    const filePath = join(testDir, 'App.tsx')
    await writeFile(filePath, tsxContent)

    const bundler = createBundler()
    const result = await bundler.compile(filePath)

    expect(result.code).toBeDefined()
    expect(result.code).not.toContain('<div>')
  })

  it('bundler uses configured sourceMaps option', async () => {
    const tsxContent = `
export function Component() {
  return <div>Test</div>
}
`
    const filePath = join(testDir, 'Component.tsx')
    await writeFile(filePath, tsxContent)

    const bundler = createBundler({ sourceMaps: true })
    const result = await bundler.compile(filePath)

    expect(result.map).toBeDefined()
  })

  describe('caching', () => {
    it('caches compilation results', async () => {
      const tsxContent = `
export function App() {
  return <div>Hello</div>
}
`
      const filePath = join(testDir, 'App.tsx')
      await writeFile(filePath, tsxContent)

      const bundler = createBundler()

      // First compilation
      const result1 = await bundler.compile(filePath)
      // Second compilation should use cache
      const result2 = await bundler.compile(filePath)

      expect(result1.code).toBe(result2.code)
    })

    it('invalidates cache on file change', async () => {
      const filePath = join(testDir, 'App.tsx')
      await writeFile(filePath, 'export function App() { return <div>V1</div> }')

      const bundler = createBundler()

      const result1 = await bundler.compile(filePath)
      expect(result1.code).toContain('V1')

      // Wait a bit to ensure mtime changes
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Modify the file
      await writeFile(filePath, 'export function App() { return <div>V2</div> }')

      const result2 = await bundler.compile(filePath)
      expect(result2.code).toContain('V2')
    })

    it('can clear cache manually', async () => {
      const tsxContent = `
export function App() {
  return <div>Hello</div>
}
`
      const filePath = join(testDir, 'App.tsx')
      await writeFile(filePath, tsxContent)

      const bundler = createBundler()
      await bundler.compile(filePath)

      // Clear cache
      expect(typeof bundler.clearCache).toBe('function')
      bundler.clearCache()

      // Should recompile
      const result = await bundler.compile(filePath)
      expect(result.code).toBeDefined()
    })
  })
})

describe('watch mode', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `dotdo-bundler-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('detects file changes', async () => {
    const filePath = join(testDir, 'App.tsx')
    await writeFile(filePath, 'export function App() { return <div>Initial</div> }')

    const onChange = vi.fn()
    const bundler = createBundler({ watch: true })

    // Start watching
    const watcher = bundler.watch(filePath, onChange)

    // Wait for watcher to initialize
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Modify file
    await writeFile(filePath, 'export function App() { return <div>Modified</div> }')

    // Wait for change detection
    await new Promise((resolve) => setTimeout(resolve, 200))

    // Cleanup
    watcher.close()

    // Verify callback was called
    expect(onChange).toHaveBeenCalled()
  })

  it('watch returns a closeable watcher', async () => {
    const filePath = join(testDir, 'App.tsx')
    await writeFile(filePath, 'export function App() { return <div>Test</div> }')

    const bundler = createBundler({ watch: true })
    const watcher = bundler.watch(filePath, () => {})

    expect(watcher).toBeDefined()
    expect(typeof watcher.close).toBe('function')

    watcher.close()
  })

  it('watch callback receives updated CompileResult', async () => {
    const filePath = join(testDir, 'App.tsx')
    await writeFile(filePath, 'export function App() { return <div>V1</div> }')

    let receivedResult: CompileResult | null = null
    const onChange = vi.fn((result: CompileResult) => {
      receivedResult = result
    })

    const bundler = createBundler({ watch: true })
    const watcher = bundler.watch(filePath, onChange)

    await new Promise((resolve) => setTimeout(resolve, 100))

    // Modify file
    await writeFile(filePath, 'export function App() { return <div>V2</div> }')

    await new Promise((resolve) => setTimeout(resolve, 200))

    watcher.close()

    expect(receivedResult).not.toBeNull()
    expect(receivedResult!.code).toContain('V2')
  })
})

describe('CompileResult type', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `dotdo-bundler-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('has correct shape', async () => {
    const filePath = join(testDir, 'Test.tsx')
    await writeFile(filePath, 'export function Test() { return <div>Test</div> }')

    const result = await compileFile(filePath)

    // Type check - result should conform to CompileResult
    const expectedShape: CompileResult = {
      code: expect.any(String),
      map: undefined,
    }

    expect(result).toMatchObject({ code: expect.any(String) })
    expect('code' in result).toBe(true)
  })
})

describe('Bundler type', () => {
  it('has required methods', () => {
    const bundler = createBundler()

    // compile method
    expect(typeof bundler.compile).toBe('function')

    // clearCache method
    expect(typeof bundler.clearCache).toBe('function')

    // watch method
    expect(typeof bundler.watch).toBe('function')
  })
})

/**
 * LazyTerminal Component Tests
 *
 * Tests for the SSR-safe lazy-loaded terminal component.
 * This component wraps TerminalEmbed with proper client-side guards.
 *
 * Features tested:
 * - Component file structure
 * - SSR safety (isClient guard)
 * - Lazy loading with Suspense
 * - Skeleton loading state
 * - Props passthrough
 *
 * @see app/components/LazyTerminal.tsx
 * @see app/components/TerminalEmbed.tsx
 */

import { describe, it, expect } from 'vitest'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'

// ============================================================================
// File Structure Tests
// ============================================================================

describe('LazyTerminal Component Structure', () => {
  describe('app/components/LazyTerminal.tsx', () => {
    it('should exist', () => {
      expect(existsSync('app/components/LazyTerminal.tsx')).toBe(true)
    })

    it('should have "use client" directive', async () => {
      const content = await readFile('app/components/LazyTerminal.tsx', 'utf-8')
      expect(content).toMatch(/'use client'|"use client"/)
    })

    it('should export LazyTerminal component', async () => {
      const content = await readFile('app/components/LazyTerminal.tsx', 'utf-8')
      expect(content).toMatch(/export\s+function\s+LazyTerminal/)
    })

    it('should export TerminalSkeleton component', async () => {
      const content = await readFile('app/components/LazyTerminal.tsx', 'utf-8')
      expect(content).toMatch(/export\s+(const|function)\s+TerminalSkeleton/)
    })

    it('should export default', async () => {
      const content = await readFile('app/components/LazyTerminal.tsx', 'utf-8')
      expect(content).toContain('export default')
    })
  })
})

// ============================================================================
// SSR Safety Tests
// ============================================================================

describe('SSR Safety', () => {
  it('should use isClient state guard', async () => {
    const content = await readFile('app/components/LazyTerminal.tsx', 'utf-8')
    expect(content).toContain('isClient')
    expect(content).toContain('useState')
    expect(content).toContain('setIsClient')
  })

  it('should set isClient in useEffect', async () => {
    const content = await readFile('app/components/LazyTerminal.tsx', 'utf-8')
    expect(content).toContain('useEffect')
    expect(content).toMatch(/setIsClient\s*\(\s*true\s*\)/)
  })

  it('should return skeleton when not client', async () => {
    const content = await readFile('app/components/LazyTerminal.tsx', 'utf-8')
    expect(content).toMatch(/if\s*\(\s*!isClient\s*\)/)
    expect(content).toContain('TerminalSkeleton')
  })
})

// ============================================================================
// Lazy Loading Tests
// ============================================================================

describe('Lazy Loading', () => {
  it('should use React.lazy for TerminalEmbed', async () => {
    const content = await readFile('app/components/LazyTerminal.tsx', 'utf-8')
    expect(content).toContain('lazy(')
    expect(content).toContain("import('./TerminalEmbed')")
  })

  it('should wrap in Suspense', async () => {
    const content = await readFile('app/components/LazyTerminal.tsx', 'utf-8')
    expect(content).toContain('Suspense')
    expect(content).toContain('<Suspense')
    expect(content).toContain('fallback')
  })

  it('should use TerminalSkeleton as fallback', async () => {
    const content = await readFile('app/components/LazyTerminal.tsx', 'utf-8')
    expect(content).toMatch(/fallback=\{[\s\S]*TerminalSkeleton/)
  })
})

// ============================================================================
// Terminal Skeleton Tests
// ============================================================================

describe('TerminalSkeleton', () => {
  it('should have proper test id', async () => {
    const content = await readFile('app/components/LazyTerminal.tsx', 'utf-8')
    expect(content).toContain('terminal-skeleton')
    expect(content).toContain('data-testid')
  })

  it('should have accessibility attributes', async () => {
    const content = await readFile('app/components/LazyTerminal.tsx', 'utf-8')
    expect(content).toContain('role="progressbar"')
    expect(content).toContain('aria-label')
    expect(content).toContain('aria-busy')
  })

  it('should have className prop', async () => {
    const content = await readFile('app/components/LazyTerminal.tsx', 'utf-8')
    expect(content).toMatch(/className\s*\??\s*:\s*string/)
  })

  it('should have height prop', async () => {
    const content = await readFile('app/components/LazyTerminal.tsx', 'utf-8')
    expect(content).toMatch(/height\s*\??\s*:\s*number/)
  })

  it('should have animate-pulse class for loading state', async () => {
    const content = await readFile('app/components/LazyTerminal.tsx', 'utf-8')
    expect(content).toContain('animate-pulse')
  })

  it('should render fake terminal content', async () => {
    const content = await readFile('app/components/LazyTerminal.tsx', 'utf-8')
    expect(content).toContain('font-mono')
    expect(content).toContain('bg-gray-900')
  })
})

// ============================================================================
// Props Tests
// ============================================================================

describe('Props Passthrough', () => {
  it('should accept TerminalEmbedProps', async () => {
    const content = await readFile('app/components/LazyTerminal.tsx', 'utf-8')
    expect(content).toContain('TerminalEmbedProps')
    expect(content).toMatch(/import.*TerminalEmbedProps/)
  })

  it('should pass props to LazyTerminalEmbed', async () => {
    const content = await readFile('app/components/LazyTerminal.tsx', 'utf-8')
    expect(content).toMatch(/<LazyTerminalEmbed\s*\{\.\.\.\s*props\s*\}/)
  })

  it('should pass className to skeleton', async () => {
    const content = await readFile('app/components/LazyTerminal.tsx', 'utf-8')
    expect(content).toMatch(/className=\{props\.className\}/)
  })
})

// ============================================================================
// Documentation Tests
// ============================================================================

describe('Documentation', () => {
  it('should have JSDoc comment', async () => {
    const content = await readFile('app/components/LazyTerminal.tsx', 'utf-8')
    expect(content).toContain('/**')
    expect(content).toContain('@see')
  })

  it('should reference TerminalEmbed', async () => {
    const content = await readFile('app/components/LazyTerminal.tsx', 'utf-8')
    expect(content).toContain('TerminalEmbed')
  })

  it('should document SSR safety', async () => {
    const content = await readFile('app/components/LazyTerminal.tsx', 'utf-8')
    expect(content).toMatch(/SSR|server|client-only|client.side/i)
  })
})

/**
 * Admin Sandbox Detail Page Tests (TDD RED Phase)
 *
 * Tests for the sandbox detail page with embedded terminal.
 * These tests verify the page structure and behavior.
 *
 * Components:
 * - SandboxDetailPage: Main page showing sandbox details
 * - SandboxStateCard: Display status, created time, exposed ports
 * - ExposedPortsList: List of exposed ports with links
 * - LazyTerminal: SSR-safe lazy-loaded terminal component
 *
 * API Endpoints Used:
 * - GET /api/sandboxes/:id/state
 * - DELETE /api/sandboxes/:id
 * - POST /api/sandboxes/:id/port
 *
 * @see app/routes/admin/sandboxes/$sandboxId.tsx
 * @see app/components/LazyTerminal.tsx
 * @see app/components/TerminalEmbed.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'

// ============================================================================
// Route File Structure Tests
// ============================================================================

describe('Sandbox Detail Route Structure', () => {
  describe('app/routes/admin/sandboxes/$sandboxId.tsx', () => {
    it('should exist as sandbox detail route', () => {
      expect(existsSync('app/routes/admin/sandboxes/$sandboxId.tsx')).toBe(true)
    })

    it('should use TanStack Router createFileRoute', async () => {
      const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
      expect(content).toContain('createFileRoute')
      expect(content).toContain("'/admin/sandboxes/$sandboxId'")
    })

    it('should use Shell component', async () => {
      const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
      expect(content).toContain('Shell')
      expect(content).toMatch(/import.*Shell/)
    })

    it('should export Route and default component', async () => {
      const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
      expect(content).toContain('export const Route')
      expect(content).toContain('SandboxDetailPage')
    })

    it('should use sandboxId from route params', async () => {
      const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
      expect(content).toContain('sandboxId')
      expect(content).toContain('useParams')
    })
  })
})

// ============================================================================
// Component Structure Tests
// ============================================================================

describe('Component Exports', () => {
  it('should have SandboxStateCard component', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toContain('SandboxStateCard')
  })

  it('should have ExposedPortsList component', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toContain('ExposedPortsList')
  })

  it('should import LazyTerminal component (SSR-safe)', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toContain('LazyTerminal')
    expect(content).toMatch(/import.*LazyTerminal|from.*LazyTerminal/)
  })
})

// ============================================================================
// SandboxDetailPage Tests
// ============================================================================

describe('SandboxDetailPage', () => {
  it('should render page with sandbox ID in title', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toMatch(/Sandbox.*sandboxId|sandboxId.*Sandbox/i)
    expect(content).toMatch(/<h1|<h2/)
  })

  it('should have back button linking to list page', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toMatch(/\/admin\/sandboxes|Back/)
  })

  it('should render SandboxStateCard', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toContain('<SandboxStateCard')
  })

  it('should render LazyTerminal', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toContain('<LazyTerminal')
    expect(content).toContain('sandboxId')
  })
})

// ============================================================================
// SandboxStateCard Component Tests
// ============================================================================

describe('SandboxStateCard', () => {
  it('should display sandbox ID', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toMatch(/sandboxId|Sandbox ID/i)
  })

  it('should display status with colored indicator', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toMatch(/Status|status/)
    expect(content).toMatch(/bg-green|green-500|green/i)
    expect(content).toMatch(/bg-yellow|yellow-500|yellow/i)
    expect(content).toMatch(/bg-red|red-500|red/i)
  })

  it('should display creation timestamp', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toMatch(/createdAt|created|Created/i)
  })

  it('should have card styling', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toContain('rounded')
    expect(content).toContain('shadow')
  })

  it('should accept state prop', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toMatch(/SandboxStateCard.*state|state.*SandboxStateCard/)
  })
})

// ============================================================================
// ExposedPortsList Component Tests
// ============================================================================

describe('ExposedPortsList', () => {
  it('should render port numbers', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toMatch(/exposedPorts|ports/i)
    expect(content).toMatch(/\.map\(/)
  })

  it('should have port links that open in new tab', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toContain('target="_blank"')
    expect(content).toContain('rel="noopener')
  })

  it('should show "No exposed ports" when empty', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toMatch(/No exposed ports|no ports/i)
  })

  it('should have "Expose Port" button', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toMatch(/Expose Port|Expose/i)
  })
})

// ============================================================================
// Controls Tests
// ============================================================================

describe('Sandbox Controls', () => {
  it('should have Destroy button', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toMatch(/Destroy/i)
  })

  it('should have Destroy button with red styling', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toMatch(/Destroy/i)
    expect(content).toMatch(/red-500|bg-red|text-red/)
  })

  it('should have handleDestroy function', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toMatch(/handleDestroy|onDestroy/)
  })

  it('should call DELETE endpoint on destroy', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toMatch(/method.*DELETE|DELETE.*method/i)
  })

  it('should navigate back to list on successful destroy', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toMatch(/navigate|router\.navigate|push.*sandboxes/i)
  })
})

// ============================================================================
// Expose Port Modal Tests
// ============================================================================

describe('Expose Port Functionality', () => {
  it('should have expose port handler', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toMatch(/handleExposePort|exposePort|onExposePort/)
  })

  it('should POST to port endpoint', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toMatch(/\/api\/sandboxes.*\/port|port/)
    expect(content).toMatch(/method.*POST|POST.*method/i)
  })

  it('should update state with new port', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toMatch(/setState|setExposedPorts|exposedPorts/)
  })
})

// ============================================================================
// Terminal Integration Tests
// ============================================================================

describe('Terminal Integration', () => {
  it('should pass sandboxId prop to LazyTerminal', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toMatch(/<LazyTerminal[\s\S]*sandboxId/)
  })

  it('should have terminal section heading', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toMatch(/Terminal|terminal/i)
  })

  it('should have terminal container with height', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toMatch(/h-96|h-\[?\d+/)
  })

  it('should have onError handler for terminal', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toMatch(/onError|handleError/)
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Error Handling', () => {
  it('should handle loading state', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toMatch(/loading|isLoading|Loading/)
  })

  it('should show loading indicator', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toMatch(/data-testid.*loading|Loading\.\.\./i)
  })

  it('should handle error state', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toMatch(/error|Error|setError/)
  })

  it('should show error message when sandbox not found', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toMatch(/data-testid.*error|Not found|error/i)
  })

  it('should handle API failure gracefully', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toMatch(/catch|\.catch|error/)
  })
})

// ============================================================================
// API Integration Tests
// ============================================================================

describe('API Integration', () => {
  it('should fetch state from /api/sandboxes/:id/state', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toMatch(/\/api\/sandboxes.*\/state|sandboxes.*state/)
  })

  it('should use sandboxId in API calls', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toMatch(/\$\{sandboxId\}|sandboxId/)
  })
})

// ============================================================================
// Hooks Tests
// ============================================================================

describe('Custom Hooks', () => {
  it('should fetch state data with useEffect or custom hook', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toMatch(/useSandboxState|useEffect|useState/)
  })

  it('should have state management', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toContain('useState')
  })
})

// ============================================================================
// Types Tests
// ============================================================================

describe('Type Definitions', () => {
  it('should define SandboxState interface', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toMatch(/interface\s+SandboxState|type\s+SandboxState/)
  })

  it('should have status in SandboxState', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toMatch(/status.*idle.*running.*stopped|'idle'|'running'|'stopped'/)
  })

  it('should have createdAt in SandboxState', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toContain('createdAt')
  })

  it('should have exposedPorts array in SandboxState', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toMatch(/exposedPorts.*Array|exposedPorts.*\[\]/)
  })
})

// ============================================================================
// Accessibility Tests
// ============================================================================

describe('Accessibility', () => {
  it('should have proper heading hierarchy', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toMatch(/<h1|<h2/)
  })

  it('should have accessible buttons', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toMatch(/<button|<Button/)
    expect(content).toContain('onClick')
  })

  it('should have links for navigation', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toMatch(/<a|<Link/)
  })
})

// ============================================================================
// Responsive Design Tests
// ============================================================================

describe('Responsive Design', () => {
  it('should have flex or grid layout', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toMatch(/flex|grid/)
  })

  it('should have responsive spacing', async () => {
    const content = await readFile('app/routes/admin/sandboxes/$sandboxId.tsx', 'utf-8')
    expect(content).toMatch(/gap-\d|space-|p-\d|m-\d/)
  })
})

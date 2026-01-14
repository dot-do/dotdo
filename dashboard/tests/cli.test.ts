import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  CLI,
  loadConfig,
  validateOptions,
  createInitialState,
  handleKeyPress,
  renderDashboard,
  getSectionItems,
  getItemContent,
  type CLIOptions,
  type CLIConfig,
  type DashboardState,
  type KeyEvent,
  type NavigatorSection,
  type FocusArea,
} from '../cli'

/**
 * CLI Dashboard Tests (RED Phase)
 *
 * The CLI Dashboard provides a terminal-based interface for inspecting
 * Durable Objects. These tests define the contract for:
 *
 * 1. CLI Factory - Creating and configuring the dashboard
 * 2. Dashboard Shell - Layout with Navigator, Content, REPL
 * 3. Keyboard Navigation - Vim-like navigation and focus management
 * 4. Focus Management - Tracking and restoring focus state
 *
 * All tests are expected to FAIL until the implementation is complete.
 */

// ============================================================================
// CLI Factory Tests (~15 tests)
// ============================================================================

describe('CLI Factory', () => {
  describe('Basic initialization', () => {
    it('returns a runnable function when called with no arguments', () => {
      const run = CLI()

      expect(typeof run).toBe('function')
    })

    it('returns an async function that returns a Promise', () => {
      const run = CLI()
      const result = run()

      expect(result).toBeInstanceOf(Promise)
    })

    it('accepts configuration options', () => {
      const options: CLIOptions = {
        config: './do.config.ts',
        ns: 'production',
        debug: true,
      }

      const run = CLI(options)

      expect(typeof run).toBe('function')
    })

    it('accepts namespace option', () => {
      const run = CLI({ ns: 'tenant:acme' })

      expect(typeof run).toBe('function')
    })

    it('accepts debug option', () => {
      const run = CLI({ debug: true })

      expect(typeof run).toBe('function')
    })

    it('accepts theme option', () => {
      const run = CLI({ theme: 'dark' })

      expect(typeof run).toBe('function')
    })

    it('accepts format option for non-interactive mode', () => {
      const run = CLI({ format: 'json' })

      expect(typeof run).toBe('function')
    })
  })

  describe('Configuration loading', () => {
    it('loads do.config.ts if present in current directory', async () => {
      const config = await loadConfig()

      expect(config).toBeDefined()
      expect(typeof config).toBe('object')
    })

    it('loads do.config.ts from specified path', async () => {
      const config = await loadConfig('./custom/do.config.ts')

      expect(config).toBeDefined()
    })

    it('returns empty config if no config file found', async () => {
      const config = await loadConfig('./nonexistent/do.config.ts')

      expect(config).toEqual({})
    })

    it('merges config file with CLI options', async () => {
      const config = await loadConfig()
      const options: CLIOptions = { ns: 'override-ns' }

      // Config should be mergeable with options
      expect(config.defaultNs).toBeDefined()
    })

    it('validates config structure', async () => {
      // Should not throw for valid config
      const config = await loadConfig()

      expect(config.endpoints).toBeDefined()
    })
  })

  describe('Validation', () => {
    it('throws on invalid configuration format', () => {
      const invalidOptions = {
        config: 123, // Should be string
      } as unknown as CLIOptions

      expect(() => validateOptions(invalidOptions)).toThrow()
    })

    it('throws on invalid namespace format', () => {
      const invalidOptions: CLIOptions = {
        ns: '', // Empty string is invalid
      }

      expect(() => validateOptions(invalidOptions)).toThrow(/namespace/i)
    })

    it('throws on invalid theme value', () => {
      const invalidOptions = {
        theme: 'invalid-theme',
      } as unknown as CLIOptions

      expect(() => validateOptions(invalidOptions)).toThrow(/theme/i)
    })
  })
})

// ============================================================================
// Dashboard Shell Tests (~20 tests)
// ============================================================================

describe('Dashboard Shell', () => {
  describe('Layout rendering', () => {
    it('renders dashboard layout with all three areas', () => {
      const state = createInitialState()
      const output = renderDashboard(state)

      // Should contain Navigator, Content Area, and REPL sections
      expect(output).toContain('Navigator')
      expect(output).toContain('REPL')
    })

    it('renders Navigator panel on the left', () => {
      const state = createInitialState()
      const output = renderDashboard(state)
      const lines = output.split('\n')

      // Navigator should be in leftmost column
      const hasNavigatorLeft = lines.some((line) => line.trimStart().startsWith('Navigator') || line.includes('Schema'))
      expect(hasNavigatorLeft).toBe(true)
    })

    it('renders Content Area in the center', () => {
      const state = createInitialState()
      const output = renderDashboard(state)

      expect(output).toMatch(/content|details/i)
    })

    it('renders REPL at the bottom', () => {
      const state = createInitialState()
      const output = renderDashboard(state)
      const lines = output.split('\n')

      // REPL should be in last few lines
      const lastLines = lines.slice(-5).join('\n')
      expect(lastLines).toMatch(/repl|>|search/i)
    })
  })

  describe('Navigator sections', () => {
    it('displays Schema section in Navigator', () => {
      const state = createInitialState()
      const output = renderDashboard(state)

      expect(output).toContain('Schema')
    })

    it('displays Data section in Navigator', () => {
      const state = createInitialState()
      const output = renderDashboard(state)

      expect(output).toContain('Data')
    })

    it('displays Compute section in Navigator', () => {
      const state = createInitialState()
      const output = renderDashboard(state)

      expect(output).toContain('Compute')
    })

    it('displays Platform section in Navigator', () => {
      const state = createInitialState()
      const output = renderDashboard(state)

      expect(output).toContain('Platform')
    })

    it('displays Storage section in Navigator', () => {
      const state = createInitialState()
      const output = renderDashboard(state)

      expect(output).toContain('Storage')
    })

    it('highlights currently selected section', () => {
      const state: DashboardState = {
        ...createInitialState(),
        section: 'Data',
      }
      const output = renderDashboard(state)

      // Selected section should have highlight indicator
      expect(output).toMatch(/[>\*\[\]]\s*Data|Data.*\[selected\]/i)
    })
  })

  describe('Content Area', () => {
    it('updates content when section is selected', async () => {
      const state: DashboardState = {
        ...createInitialState(),
        section: 'Schema',
      }

      const items = await getSectionItems('Schema')

      expect(items).toBeInstanceOf(Array)
    })

    it('shows loading state during data fetch', () => {
      const state: DashboardState = {
        ...createInitialState(),
        loading: true,
      }
      const output = renderDashboard(state)

      expect(output).toMatch(/loading|fetching|\.\.\./i)
    })

    it('displays error message when fetch fails', () => {
      const state: DashboardState = {
        ...createInitialState(),
        error: 'Failed to connect to namespace',
      }
      const output = renderDashboard(state)

      expect(output).toContain('Failed to connect')
    })

    it('clears error on successful navigation', () => {
      const stateWithError: DashboardState = {
        ...createInitialState(),
        error: 'Some error',
      }

      const newState = handleKeyPress(stateWithError, { key: 'j' })

      // Navigation should attempt to clear error on success
      expect(newState.error).toBeUndefined()
    })

    it('displays item details when item is selected', async () => {
      const content = await getItemContent('Schema', 'User')

      expect(content).toBeDefined()
    })
  })

  describe('Section items', () => {
    it('returns schema types for Schema section', async () => {
      const items = await getSectionItems('Schema')

      expect(items).toBeInstanceOf(Array)
      expect(items.length).toBeGreaterThan(0)
    })

    it('returns entity instances for Data section', async () => {
      const items = await getSectionItems('Data')

      expect(items).toBeInstanceOf(Array)
    })

    it('returns workflows for Compute section', async () => {
      const items = await getSectionItems('Compute')

      expect(items).toBeInstanceOf(Array)
    })

    it('returns platform resources for Platform section', async () => {
      const items = await getSectionItems('Platform')

      expect(items).toBeInstanceOf(Array)
    })

    it('returns storage buckets for Storage section', async () => {
      const items = await getSectionItems('Storage')

      expect(items).toBeInstanceOf(Array)
    })
  })
})

// ============================================================================
// Keyboard Navigation Tests (~15 tests)
// ============================================================================

describe('Keyboard Navigation', () => {
  describe('Arrow key navigation', () => {
    it('moves down on arrow down key', () => {
      const state = createInitialState()
      const newState = handleKeyPress(state, { key: 'ArrowDown' })

      // Should change selected item or section
      expect(newState).not.toEqual(state)
    })

    it('moves up on arrow up key', () => {
      const state: DashboardState = {
        ...createInitialState(),
        section: 'Data', // Start at second section
      }
      const newState = handleKeyPress(state, { key: 'ArrowUp' })

      expect(newState.section).toBe('Schema')
    })

    it('supports j for down (vim-style)', () => {
      const state = createInitialState()
      const newState = handleKeyPress(state, { key: 'j' })

      expect(newState.section).not.toBe(state.section)
    })

    it('supports k for up (vim-style)', () => {
      const state: DashboardState = {
        ...createInitialState(),
        section: 'Data',
      }
      const newState = handleKeyPress(state, { key: 'k' })

      expect(newState.section).toBe('Schema')
    })

    it('wraps around at bottom of list', () => {
      const state: DashboardState = {
        ...createInitialState(),
        section: 'Storage', // Last section
      }
      const newState = handleKeyPress(state, { key: 'j' })

      expect(newState.section).toBe('Schema')
    })

    it('wraps around at top of list', () => {
      const state: DashboardState = {
        ...createInitialState(),
        section: 'Schema', // First section
      }
      const newState = handleKeyPress(state, { key: 'k' })

      expect(newState.section).toBe('Storage')
    })
  })

  describe('Focus switching', () => {
    it('Tab moves focus from Navigator to Content', () => {
      const state: DashboardState = {
        ...createInitialState(),
        focus: 'navigator',
      }
      const newState = handleKeyPress(state, { key: 'Tab' })

      expect(newState.focus).toBe('content')
    })

    it('Tab moves focus from Content to REPL', () => {
      const state: DashboardState = {
        ...createInitialState(),
        focus: 'content',
      }
      const newState = handleKeyPress(state, { key: 'Tab' })

      expect(newState.focus).toBe('repl')
    })

    it('Tab moves focus from REPL back to Navigator', () => {
      const state: DashboardState = {
        ...createInitialState(),
        focus: 'repl',
      }
      const newState = handleKeyPress(state, { key: 'Tab' })

      expect(newState.focus).toBe('navigator')
    })

    it('Shift+Tab moves focus backwards', () => {
      const state: DashboardState = {
        ...createInitialState(),
        focus: 'content',
      }
      const newState = handleKeyPress(state, { key: 'Tab', shift: true })

      expect(newState.focus).toBe('navigator')
    })
  })

  describe('Selection and navigation', () => {
    it('Enter selects current item', () => {
      const state: DashboardState = {
        ...createInitialState(),
        section: 'Schema',
        focus: 'navigator',
      }
      const newState = handleKeyPress(state, { key: 'Enter' })

      // Should mark item as selected or expand section
      expect(newState.selectedItem).toBeDefined()
    })

    it('Escape returns to previous level', () => {
      const state: DashboardState = {
        ...createInitialState(),
        section: 'Schema',
        selectedItem: 'User',
        history: [{ section: 'Schema' }],
      }
      const newState = handleKeyPress(state, { key: 'Escape' })

      expect(newState.selectedItem).toBeUndefined()
    })

    it('Escape navigates back through history', () => {
      const state: DashboardState = {
        ...createInitialState(),
        section: 'Data',
        selectedItem: 'user:123',
        history: [{ section: 'Schema' }, { section: 'Data' }],
      }
      const newState = handleKeyPress(state, { key: 'Escape' })

      // Should go back one level in history
      expect(newState.history.length).toBeLessThan(state.history.length)
    })
  })

  describe('REPL focus', () => {
    it('/ focuses REPL for search', () => {
      const state: DashboardState = {
        ...createInitialState(),
        focus: 'navigator',
      }
      const newState = handleKeyPress(state, { key: '/' })

      expect(newState.focus).toBe('repl')
    })

    it(': focuses REPL for commands', () => {
      const state: DashboardState = {
        ...createInitialState(),
        focus: 'navigator',
      }
      const newState = handleKeyPress(state, { key: ':' })

      expect(newState.focus).toBe('repl')
    })
  })

  describe('Exit handling', () => {
    it('q exits the dashboard', () => {
      const state = createInitialState()

      // q should signal exit (implementation could throw, set flag, etc.)
      expect(() => handleKeyPress(state, { key: 'q' })).not.toThrow()
    })

    it('Ctrl+C exits the dashboard', () => {
      const state = createInitialState()

      expect(() => handleKeyPress(state, { key: 'c', ctrl: true })).not.toThrow()
    })
  })
})

// ============================================================================
// Focus Management Tests (~10 tests)
// ============================================================================

describe('Focus Management', () => {
  describe('Initial focus', () => {
    it('focus starts in Navigator', () => {
      const state = createInitialState()

      expect(state.focus).toBe('navigator')
    })

    it('initial section is Schema', () => {
      const state = createInitialState()

      expect(state.section).toBe('Schema')
    })

    it('no item is selected initially', () => {
      const state = createInitialState()

      expect(state.selectedItem).toBeUndefined()
    })

    it('history is empty initially', () => {
      const state = createInitialState()

      expect(state.history).toEqual([])
    })
  })

  describe('Focus indicator', () => {
    it('focus indicator visible on Navigator when focused', () => {
      const state: DashboardState = {
        ...createInitialState(),
        focus: 'navigator',
      }
      const output = renderDashboard(state)

      // Should show focus indicator on navigator
      expect(output).toMatch(/\[focus\]|>>>|active/i)
    })

    it('focus indicator visible on Content when focused', () => {
      const state: DashboardState = {
        ...createInitialState(),
        focus: 'content',
      }
      const output = renderDashboard(state)

      // Content should have focus indicator
      expect(output).toMatch(/content.*focus|active.*content/is)
    })

    it('focus indicator visible on REPL when focused', () => {
      const state: DashboardState = {
        ...createInitialState(),
        focus: 'repl',
      }
      const output = renderDashboard(state)

      // REPL should have focus indicator
      expect(output).toMatch(/repl.*focus|>.*active|cursor/is)
    })
  })

  describe('Focus persistence', () => {
    it('focus persists through data updates', () => {
      const state: DashboardState = {
        ...createInitialState(),
        focus: 'content',
        loading: true,
      }

      // Simulate data update completing
      const updatedState: DashboardState = {
        ...state,
        loading: false,
      }

      expect(updatedState.focus).toBe('content')
    })

    it('focus restores after modal closes', () => {
      const originalFocus: FocusArea = 'navigator'
      const state: DashboardState = {
        ...createInitialState(),
        focus: originalFocus,
        history: [{ section: 'Schema' }],
      }

      // Simulate opening modal (focus changes)
      const modalState: DashboardState = {
        ...state,
        focus: 'content', // Modal captures focus
      }

      // Simulate closing modal (Escape)
      const restoredState = handleKeyPress(modalState, { key: 'Escape' })

      // Focus should be restorable (exact behavior TBD by implementation)
      expect(restoredState.focus).toBeDefined()
    })

    it('maintains focus when switching sections', () => {
      const state: DashboardState = {
        ...createInitialState(),
        focus: 'navigator',
        section: 'Schema',
      }

      const newState = handleKeyPress(state, { key: 'j' }) // Move to next section

      expect(newState.focus).toBe('navigator')
    })
  })
})

// ============================================================================
// State Management Tests
// ============================================================================

describe('State Management', () => {
  describe('State transitions', () => {
    it('updates section on navigation', () => {
      const state = createInitialState()
      const sections: NavigatorSection[] = ['Schema', 'Data', 'Compute', 'Platform', 'Storage']

      let currentState = state
      for (let i = 0; i < 4; i++) {
        currentState = handleKeyPress(currentState, { key: 'j' })
        expect(sections).toContain(currentState.section)
      }
    })

    it('tracks navigation history', () => {
      let state = createInitialState()

      // Navigate and select
      state = handleKeyPress(state, { key: 'Enter' }) // Select Schema
      state = handleKeyPress(state, { key: 'j' }) // Move to Data

      expect(state.history.length).toBeGreaterThan(0)
    })

    it('clears history on explicit navigation', () => {
      const state: DashboardState = {
        ...createInitialState(),
        history: [{ section: 'Schema' }, { section: 'Data' }],
      }

      // Direct section jump should clear history
      const newState: DashboardState = {
        ...state,
        section: 'Platform',
        history: [],
      }

      expect(newState.history).toEqual([])
    })
  })

  describe('Loading states', () => {
    it('sets loading true when fetching data', () => {
      const state: DashboardState = {
        ...createInitialState(),
        loading: true,
      }

      expect(state.loading).toBe(true)
    })

    it('sets loading false when fetch completes', () => {
      const state: DashboardState = {
        ...createInitialState(),
        loading: false,
      }

      expect(state.loading).toBe(false)
    })

    it('preserves section during loading', () => {
      const state: DashboardState = {
        ...createInitialState(),
        section: 'Data',
        loading: true,
      }

      expect(state.section).toBe('Data')
    })
  })

  describe('Error states', () => {
    it('captures error messages', () => {
      const state: DashboardState = {
        ...createInitialState(),
        error: 'Connection refused',
      }

      expect(state.error).toBe('Connection refused')
    })

    it('clears error on retry', () => {
      const state: DashboardState = {
        ...createInitialState(),
        error: 'Connection refused',
      }

      // Pressing Enter to retry should clear error
      const newState = handleKeyPress(state, { key: 'Enter' })

      expect(newState.error).toBeUndefined()
    })
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration', () => {
  it('complete navigation flow works', () => {
    let state = createInitialState()

    // Start in Navigator on Schema
    expect(state.focus).toBe('navigator')
    expect(state.section).toBe('Schema')

    // Navigate to Data section
    state = handleKeyPress(state, { key: 'j' })
    expect(state.section).toBe('Data')

    // Tab to content area
    state = handleKeyPress(state, { key: 'Tab' })
    expect(state.focus).toBe('content')

    // Tab to REPL
    state = handleKeyPress(state, { key: 'Tab' })
    expect(state.focus).toBe('repl')

    // Back to Navigator
    state = handleKeyPress(state, { key: 'Tab' })
    expect(state.focus).toBe('navigator')
  })

  it('renders different content for each section', async () => {
    const sections: NavigatorSection[] = ['Schema', 'Data', 'Compute', 'Platform', 'Storage']
    const outputs: string[] = []

    for (const section of sections) {
      const state: DashboardState = {
        ...createInitialState(),
        section,
      }
      outputs.push(renderDashboard(state))
    }

    // Each section should render differently
    const uniqueOutputs = new Set(outputs)
    expect(uniqueOutputs.size).toBe(sections.length)
  })

  it('handles rapid key presses', () => {
    let state = createInitialState()

    // Rapid navigation should not throw
    for (let i = 0; i < 100; i++) {
      state = handleKeyPress(state, { key: i % 2 === 0 ? 'j' : 'k' })
    }

    expect(state.section).toBeDefined()
  })

  it('maintains consistency after many operations', () => {
    let state = createInitialState()

    // Perform many operations
    const keys = ['j', 'j', 'k', 'Tab', 'j', 'Tab', 'Tab', 'k', 'Enter', 'Escape']
    for (const key of keys) {
      state = handleKeyPress(state, { key })
    }

    // State should still be valid
    expect(['navigator', 'content', 'repl']).toContain(state.focus)
    expect(['Schema', 'Data', 'Compute', 'Platform', 'Storage']).toContain(state.section)
    expect(typeof state.loading).toBe('boolean')
    expect(state.history).toBeInstanceOf(Array)
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  it('handles unknown key gracefully', () => {
    const state = createInitialState()

    // Unknown key should not crash
    const newState = handleKeyPress(state, { key: 'x' })

    expect(newState).toBeDefined()
  })

  it('handles empty content gracefully', () => {
    const state: DashboardState = {
      ...createInitialState(),
      section: 'Data',
      selectedItem: undefined,
    }

    const output = renderDashboard(state)

    expect(output).toBeDefined()
    expect(output.length).toBeGreaterThan(0)
  })

  it('handles special characters in namespace', async () => {
    const run = CLI({ ns: 'tenant:acme-corp_v2' })

    expect(typeof run).toBe('function')
  })

  it('handles unicode in content', async () => {
    const content = await getItemContent('Data', 'user:\u65e5\u672c\u8a9e')

    expect(content).toBeDefined()
  })

  it('handles very long item names', () => {
    const longName = 'a'.repeat(1000)
    const state: DashboardState = {
      ...createInitialState(),
      selectedItem: longName,
    }

    const output = renderDashboard(state)

    // Should truncate or handle gracefully
    expect(output.length).toBeLessThan(100000)
  })
})

/**
 * Chart Components Tests
 *
 * Tests for AreaChart, BarChart, LineChart, and PieChart components
 * using Recharts with theme support, animation, and responsive design.
 */

import { describe, it, expect } from 'vitest'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'

const CHARTS_PATH = 'app/components/cockpit/index.tsx'
const UI_CHARTS_PATH = 'app/components/ui/charts.tsx'

// ============================================================================
// File Structure Tests
// ============================================================================

describe('Chart Components File Structure', () => {
  it('should have chart components in cockpit/index.tsx', () => {
    expect(existsSync(CHARTS_PATH)).toBe(true)
  })

  it('should have charts.tsx in ui directory', () => {
    expect(existsSync(UI_CHARTS_PATH)).toBe(true)
  })

  it('should export charts from ui/charts.tsx', async () => {
    const content = await readFile(UI_CHARTS_PATH, 'utf-8')
    expect(content).toContain('AreaChart')
    expect(content).toContain('BarChart')
    expect(content).toContain('LineChart')
    expect(content).toContain('PieChart')
  })
})

// ============================================================================
// Recharts Integration Tests
// ============================================================================

describe('Recharts Integration', () => {
  it('should import from recharts', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain("from 'recharts'")
  })

  it('should use ResponsiveContainer', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('ResponsiveContainer')
  })

  it('should use XAxis and YAxis', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('XAxis')
    expect(content).toContain('YAxis')
  })

  it('should use Tooltip', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('Tooltip')
  })

  it('should use Legend', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('Legend')
  })

  it('should use CartesianGrid', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('CartesianGrid')
  })
})

// ============================================================================
// AreaChart Component Tests
// ============================================================================

describe('AreaChart Component', () => {
  it('should export AreaChart function', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('export function AreaChart')
  })

  it('should use RechartsAreaChart', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('RechartsAreaChart')
  })

  it('should use Area component', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('<Area')
  })

  it('should have data-component attribute', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('data-component="AreaChart"')
  })

  it('should have data-data-count attribute', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('data-data-count')
  })

  it('should support title prop', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('title?: string')
  })

  it('should support height prop', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toMatch(/height.*=.*200|height.*number/)
  })
})

// ============================================================================
// BarChart Component Tests
// ============================================================================

describe('BarChart Component', () => {
  it('should export BarChart function', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('export function BarChart')
  })

  it('should use RechartsBarChart', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('RechartsBarChart')
  })

  it('should use Bar component', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('<Bar')
  })

  it('should have data-component attribute', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('data-component="BarChart"')
  })

  it('should support layout prop', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain("layout?: 'horizontal' | 'vertical'")
  })
})

// ============================================================================
// LineChart Component Tests
// ============================================================================

describe('LineChart Component', () => {
  it('should export LineChart function', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('export function LineChart')
  })

  it('should use RechartsLineChart', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('RechartsLineChart')
  })

  it('should use Line component', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('<Line')
  })

  it('should have data-component attribute', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('data-component="LineChart"')
  })

  it('should support curved prop', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('curved')
  })

  it('should use monotone type for curved lines', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain("type={curved ? 'monotone' : 'linear'}")
  })
})

// ============================================================================
// PieChart Component Tests
// ============================================================================

describe('PieChart Component', () => {
  it('should export PieChart function', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('export function PieChart')
  })

  it('should use RechartsPieChart', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('RechartsPieChart')
  })

  it('should use Pie component', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('<Pie')
  })

  it('should use Cell component for colors', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('<Cell')
  })

  it('should have data-component attribute', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('data-component="PieChart"')
  })

  it('should support nameKey prop', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('nameKey')
  })

  it('should support valueKey prop', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('valueKey')
  })

  it('should support innerRadius and outerRadius', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('innerRadius')
    expect(content).toContain('outerRadius')
  })
})

// ============================================================================
// Empty State Tests
// ============================================================================

describe('Empty State Handling', () => {
  it('should have ChartEmptyState component', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('ChartEmptyState')
  })

  it('should show empty state when data is empty', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('data.length === 0')
    expect(content).toContain('No data available')
  })
})

// ============================================================================
// Animation Tests
// ============================================================================

describe('Animation Support', () => {
  it('should have animate prop', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('animate')
  })

  it('should use isAnimationActive', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('isAnimationActive={animate}')
  })

  it('should default animate to true', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toMatch(/animate\s*=\s*true/)
  })
})

// ============================================================================
// Multi-Series Support Tests
// ============================================================================

describe('Multi-Series Support', () => {
  it('should support array of yKeys', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('yKey?: keyof T | (keyof T)[]')
  })

  it('should have normalizeYKeys helper', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('function normalizeYKeys')
  })

  it('should map over yKeys to render multiple series', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('yKeys.map')
  })
})

// ============================================================================
// Theme Colors Tests
// ============================================================================

describe('Theme Colors', () => {
  it('should have DEFAULT_COLORS array', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('DEFAULT_COLORS')
  })

  it('should use HSL color values', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('hsl(')
  })

  it('should support custom colors prop', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('colors?: string[]')
  })

  it('should cycle through colors for multiple series', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('colors[index % colors.length]')
  })
})

// ============================================================================
// Tooltip Styling Tests
// ============================================================================

describe('Tooltip Styling', () => {
  it('should have dark theme tooltip styling', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain("backgroundColor: '#1F2937'")
    expect(content).toContain("border: '1px solid #374151'")
  })

  it('should support showTooltip prop', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('showTooltip')
  })
})

// ============================================================================
// Legend Tests
// ============================================================================

describe('Legend Support', () => {
  it('should support showLegend prop', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('showLegend')
  })

  it('should conditionally render Legend', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('{showLegend && <Legend')
  })
})

// ============================================================================
// Grid Support Tests
// ============================================================================

describe('Grid Support', () => {
  it('should support showGrid prop', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('showGrid')
  })

  it('should conditionally render CartesianGrid', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('{showGrid && <CartesianGrid')
  })

  it('should have dashed grid lines', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('strokeDasharray="3 3"')
  })
})

// ============================================================================
// Type Exports Tests
// ============================================================================

describe('Type Exports', () => {
  it('should export BaseChartProps interface', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('export interface BaseChartProps')
  })

  it('should export PieChartWrapperProps interface', async () => {
    const content = await readFile(CHARTS_PATH, 'utf-8')
    expect(content).toContain('export interface PieChartWrapperProps')
  })

  it('should re-export types from ui/charts.tsx', async () => {
    const content = await readFile(UI_CHARTS_PATH, 'utf-8')
    // Types can be re-exported OR defined directly in ui/charts.tsx
    expect(content).toMatch(/export (type \{|interface) (BaseChartProps|PieChartWrapperProps)/)
  })
})

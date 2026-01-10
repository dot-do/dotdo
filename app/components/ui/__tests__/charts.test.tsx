/**
 * Chart Components Tests
 *
 * Tests for shadcn/ui chart components using Recharts primitives.
 * Verifies proper exports from @mdxui/primitives and Recharts.
 */

import { describe, it, expect } from 'vitest'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'

const UI_CHARTS_PATH = 'app/components/ui/charts.tsx'
const COCKPIT_PATH = 'app/components/cockpit/index.tsx'

// ============================================================================
// File Structure Tests
// ============================================================================

describe('Chart Components File Structure', () => {
  it('should have charts.tsx in ui directory', () => {
    expect(existsSync(UI_CHARTS_PATH)).toBe(true)
  })

  it('should have cockpit/index.tsx with chart wrappers', () => {
    expect(existsSync(COCKPIT_PATH)).toBe(true)
  })
})

// ============================================================================
// shadcn/ui Chart Exports Tests
// ============================================================================

describe('shadcn Chart Exports', () => {
  it('should export ChartContainer from @mdxui/primitives', async () => {
    const content = await readFile(UI_CHARTS_PATH, 'utf-8')
    expect(content).toContain('ChartContainer')
    expect(content).toContain('@mdxui/primitives/chart')
  })

  it('should export ChartConfig type', async () => {
    const content = await readFile(UI_CHARTS_PATH, 'utf-8')
    expect(content).toContain('ChartConfig')
  })

  it('should export ChartTooltip and ChartTooltipContent', async () => {
    const content = await readFile(UI_CHARTS_PATH, 'utf-8')
    expect(content).toContain('ChartTooltip')
    expect(content).toContain('ChartTooltipContent')
  })

  it('should export ChartLegend and ChartLegendContent', async () => {
    const content = await readFile(UI_CHARTS_PATH, 'utf-8')
    expect(content).toContain('ChartLegend')
    expect(content).toContain('ChartLegendContent')
  })

  it('should export ChartStyle', async () => {
    const content = await readFile(UI_CHARTS_PATH, 'utf-8')
    expect(content).toContain('ChartStyle')
  })
})

// ============================================================================
// Recharts Re-exports Tests
// ============================================================================

describe('Recharts Re-exports', () => {
  it('should re-export AreaChart from recharts', async () => {
    const content = await readFile(UI_CHARTS_PATH, 'utf-8')
    expect(content).toContain('AreaChart')
    expect(content).toContain("from 'recharts'")
  })

  it('should re-export BarChart from recharts', async () => {
    const content = await readFile(UI_CHARTS_PATH, 'utf-8')
    expect(content).toContain('BarChart')
  })

  it('should re-export LineChart from recharts', async () => {
    const content = await readFile(UI_CHARTS_PATH, 'utf-8')
    expect(content).toContain('LineChart')
  })

  it('should re-export PieChart from recharts', async () => {
    const content = await readFile(UI_CHARTS_PATH, 'utf-8')
    expect(content).toContain('PieChart')
  })

  it('should re-export XAxis and YAxis', async () => {
    const content = await readFile(UI_CHARTS_PATH, 'utf-8')
    expect(content).toContain('XAxis')
    expect(content).toContain('YAxis')
  })

  it('should re-export Area, Bar, Line, Pie components', async () => {
    const content = await readFile(UI_CHARTS_PATH, 'utf-8')
    expect(content).toContain('Area,')
    expect(content).toContain('Bar,')
    expect(content).toContain('Line,')
    expect(content).toContain('Pie,')
  })

  it('should re-export CartesianGrid', async () => {
    const content = await readFile(UI_CHARTS_PATH, 'utf-8')
    expect(content).toContain('CartesianGrid')
  })

  it('should re-export Cell for pie charts', async () => {
    const content = await readFile(UI_CHARTS_PATH, 'utf-8')
    expect(content).toContain('Cell')
  })
})

// ============================================================================
// Cockpit Chart Wrapper Tests
// ============================================================================

describe('Cockpit AreaChart Wrapper', () => {
  it('should export AreaChart function', async () => {
    const content = await readFile(COCKPIT_PATH, 'utf-8')
    expect(content).toContain('export function AreaChart')
  })

  it('should use ChartContainer from shadcn', async () => {
    const content = await readFile(COCKPIT_PATH, 'utf-8')
    expect(content).toContain('ChartContainer')
    expect(content).toContain('@mdxui/primitives/chart')
  })

  it('should have data-component attribute', async () => {
    const content = await readFile(COCKPIT_PATH, 'utf-8')
    expect(content).toContain('data-component="AreaChart"')
  })

  it('should build chartConfig from yKeys', async () => {
    const content = await readFile(COCKPIT_PATH, 'utf-8')
    expect(content).toContain('const chartConfig = React.useMemo')
  })

  it('should use CSS variable for fill colors', async () => {
    const content = await readFile(COCKPIT_PATH, 'utf-8')
    expect(content).toContain('var(--color-')
  })
})

describe('Cockpit BarChart Wrapper', () => {
  it('should export BarChart function', async () => {
    const content = await readFile(COCKPIT_PATH, 'utf-8')
    expect(content).toContain('export function BarChart')
  })

  it('should have data-component attribute', async () => {
    const content = await readFile(COCKPIT_PATH, 'utf-8')
    expect(content).toContain('data-component="BarChart"')
  })

  it('should support layout prop', async () => {
    const content = await readFile(COCKPIT_PATH, 'utf-8')
    expect(content).toContain("layout?: 'horizontal' | 'vertical'")
  })
})

describe('Cockpit LineChart Wrapper', () => {
  it('should export LineChart function', async () => {
    const content = await readFile(COCKPIT_PATH, 'utf-8')
    expect(content).toContain('export function LineChart')
  })

  it('should have data-component attribute', async () => {
    const content = await readFile(COCKPIT_PATH, 'utf-8')
    expect(content).toContain('data-component="LineChart"')
  })

  it('should support curved prop', async () => {
    const content = await readFile(COCKPIT_PATH, 'utf-8')
    expect(content).toContain('curved?: boolean')
  })
})

describe('Cockpit PieChart Wrapper', () => {
  it('should export PieChart function', async () => {
    const content = await readFile(COCKPIT_PATH, 'utf-8')
    expect(content).toContain('export function PieChart')
  })

  it('should have data-component attribute', async () => {
    const content = await readFile(COCKPIT_PATH, 'utf-8')
    expect(content).toContain('data-component="PieChart"')
  })

  it('should support nameKey and valueKey props', async () => {
    const content = await readFile(COCKPIT_PATH, 'utf-8')
    expect(content).toContain('nameKey')
    expect(content).toContain('valueKey')
  })

  it('should support innerRadius and outerRadius', async () => {
    const content = await readFile(COCKPIT_PATH, 'utf-8')
    expect(content).toContain('innerRadius')
    expect(content).toContain('outerRadius')
  })
})

// ============================================================================
// Empty State Tests
// ============================================================================

describe('Empty State Handling', () => {
  it('should have ChartEmptyState component', async () => {
    const content = await readFile(COCKPIT_PATH, 'utf-8')
    expect(content).toContain('ChartEmptyState')
  })

  it('should show empty state when data is empty', async () => {
    const content = await readFile(COCKPIT_PATH, 'utf-8')
    expect(content).toContain('data.length === 0')
    expect(content).toContain('No data available')
  })
})

// ============================================================================
// Animation Tests
// ============================================================================

describe('Animation Support', () => {
  it('should have animate prop', async () => {
    const content = await readFile(COCKPIT_PATH, 'utf-8')
    expect(content).toContain('animate?: boolean')
  })

  it('should use isAnimationActive', async () => {
    const content = await readFile(COCKPIT_PATH, 'utf-8')
    expect(content).toContain('isAnimationActive={animate}')
  })

  it('should default animate to true', async () => {
    const content = await readFile(COCKPIT_PATH, 'utf-8')
    expect(content).toMatch(/animate\s*=\s*true/)
  })
})

// ============================================================================
// Multi-Series Support Tests
// ============================================================================

describe('Multi-Series Support', () => {
  it('should support array of yKeys', async () => {
    const content = await readFile(COCKPIT_PATH, 'utf-8')
    expect(content).toContain('yKey?: keyof T | (keyof T)[]')
  })

  it('should have normalizeYKeys helper', async () => {
    const content = await readFile(COCKPIT_PATH, 'utf-8')
    expect(content).toContain('function normalizeYKeys')
  })

  it('should map over yKeys to render multiple series', async () => {
    const content = await readFile(COCKPIT_PATH, 'utf-8')
    expect(content).toContain('yKeys.map')
  })
})

// ============================================================================
// Theme Colors Tests
// ============================================================================

describe('Theme Colors', () => {
  it('should have DEFAULT_COLORS array', async () => {
    const content = await readFile(COCKPIT_PATH, 'utf-8')
    expect(content).toContain('DEFAULT_COLORS')
  })

  it('should use HSL color values', async () => {
    const content = await readFile(COCKPIT_PATH, 'utf-8')
    expect(content).toContain('hsl(')
  })

  it('should support custom colors prop', async () => {
    const content = await readFile(COCKPIT_PATH, 'utf-8')
    expect(content).toContain('colors?: string[]')
  })

  it('should cycle through colors for multiple series', async () => {
    const content = await readFile(COCKPIT_PATH, 'utf-8')
    expect(content).toContain('colors[index % colors.length]')
  })
})

// ============================================================================
// shadcn Integration Tests
// ============================================================================

describe('shadcn Integration', () => {
  it('should use ChartTooltip with ChartTooltipContent', async () => {
    const content = await readFile(COCKPIT_PATH, 'utf-8')
    expect(content).toContain('<ChartTooltip content={<ChartTooltipContent />}')
  })

  it('should use ChartLegend with ChartLegendContent', async () => {
    const content = await readFile(COCKPIT_PATH, 'utf-8')
    expect(content).toContain('<ChartLegend content={<ChartLegendContent />}')
  })

  it('should use bg-background class', async () => {
    const content = await readFile(COCKPIT_PATH, 'utf-8')
    expect(content).toContain('bg-background')
  })

  it('should use text-muted-foreground class', async () => {
    const content = await readFile(COCKPIT_PATH, 'utf-8')
    expect(content).toContain('text-muted-foreground')
  })

  it('should use stroke-border class for grid', async () => {
    const content = await readFile(COCKPIT_PATH, 'utf-8')
    expect(content).toContain('stroke-border')
  })
})

// ============================================================================
// Type Exports Tests
// ============================================================================

describe('Type Exports', () => {
  it('should export BaseChartProps interface', async () => {
    const content = await readFile(COCKPIT_PATH, 'utf-8')
    expect(content).toContain('export interface BaseChartProps')
  })

  it('should export PieChartWrapperProps interface', async () => {
    const content = await readFile(COCKPIT_PATH, 'utf-8')
    expect(content).toContain('export interface PieChartWrapperProps')
  })
})

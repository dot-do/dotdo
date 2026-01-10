/**
 * Chart Components
 *
 * Re-exports chart components from the cockpit module for use in UI.
 * These are real Recharts implementations with theme support.
 *
 * Features:
 * - Responsive (uses ResponsiveContainer)
 * - Theme-aware (uses HSL colors compatible with CSS variables)
 * - Animated (respects prefers-reduced-motion via animate prop)
 * - Empty state handling
 * - Multi-series support (yKey can be array)
 *
 * @example
 * ```tsx
 * import { AreaChart, BarChart, LineChart, PieChart } from './charts'
 *
 * // Area chart with single series
 * <AreaChart
 *   data={[{ month: 'Jan', sales: 100 }, { month: 'Feb', sales: 200 }]}
 *   xKey="month"
 *   yKey="sales"
 *   title="Monthly Sales"
 * />
 *
 * // Bar chart with multiple series
 * <BarChart
 *   data={data}
 *   xKey="date"
 *   yKey={['revenue', 'expenses']}
 *   showLegend
 * />
 *
 * // Pie chart
 * <PieChart
 *   data={[{ name: 'A', value: 40 }, { name: 'B', value: 60 }]}
 *   nameKey="name"
 *   valueKey="value"
 * />
 * ```
 */

export {
  AreaChart,
  BarChart,
  LineChart,
  PieChart,
} from '../cockpit/index'

// Re-export types for consumers
export type { BaseChartProps, PieChartWrapperProps } from '../cockpit/index'

/**
 * Chart Components (shadcn/ui)
 *
 * Re-exports shadcn chart primitives from @mdxui/primitives.
 * Built on top of Recharts with theme support and accessible defaults.
 *
 * @example
 * ```tsx
 * import {
 *   ChartContainer,
 *   ChartTooltip,
 *   ChartTooltipContent,
 *   ChartLegend,
 *   ChartLegendContent,
 *   type ChartConfig,
 * } from './charts'
 * import { AreaChart, Area, XAxis, YAxis } from 'recharts'
 *
 * const chartConfig = {
 *   sales: { label: 'Sales', color: 'hsl(var(--chart-1))' },
 * } satisfies ChartConfig
 *
 * <ChartContainer config={chartConfig}>
 *   <AreaChart data={data}>
 *     <XAxis dataKey="month" />
 *     <YAxis />
 *     <ChartTooltip content={<ChartTooltipContent />} />
 *     <Area dataKey="sales" fill="var(--color-sales)" />
 *   </AreaChart>
 * </ChartContainer>
 * ```
 */

// Re-export shadcn chart primitives from @mdxui/primitives
export {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  ChartStyle,
  type ChartConfig,
} from '@mdxui/primitives/chart'

// Re-export Recharts primitives for convenience
export {
  AreaChart,
  BarChart,
  LineChart,
  PieChart,
  RadarChart,
  RadialBarChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Area,
  Bar,
  Line,
  Pie,
  Radar,
  RadialBar,
  Cell,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
} from 'recharts'

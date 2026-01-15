/**
 * `do cost` CLI Command
 *
 * Calculate Cloudflare Pipeline costs at various scale points.
 *
 * Commands:
 *   do cost analyze     - Analyze cost for given parameters
 *   do cost compare     - Compare single vs multi-pipeline costs
 *   do cost recommend   - Get recommendation based on volume
 *
 * Options:
 *   --events <number>      - Events per day (default: 1,000,000)
 *   --size <number>        - Average event size in bytes (default: 500)
 *   --queries <number>     - Queries per day (default: 1,000)
 *   --retention <number>   - Retention days (default: 30)
 *   --region <region>      - Deployment region (default: global)
 *   --format <json|table>  - Output format (default: table)
 */

import { Command } from 'commander'

// ============================================================================
// Region Constants
// ============================================================================

/**
 * Supported deployment regions for cost calculation.
 * - global: Cloudflare's global network (default, baseline pricing)
 * - us-east/us-west: US regions
 * - eu-west/eu-central: European regions (higher for data sovereignty)
 * - ap-southeast/ap-northeast: APAC regions
 */
export const SUPPORTED_REGIONS = [
  'global',
  'us-east',
  'us-west',
  'eu-west',
  'eu-central',
  'ap-southeast',
  'ap-northeast',
] as const

export type Region = (typeof SUPPORTED_REGIONS)[number]

/**
 * Regional pricing multipliers relative to global baseline.
 * These reflect:
 * - Data sovereignty requirements (EU regions)
 * - Infrastructure costs per region
 * - Egress pricing variations
 */
export const REGION_MULTIPLIERS: Record<Region, number> = {
  global: 1.0,
  'us-east': 1.0,
  'us-west': 1.02,
  'eu-west': 1.15,
  'eu-central': 1.18,
  'ap-southeast': 1.08,
  'ap-northeast': 1.12,
} as const

// ============================================================================
// Pricing Constants
// ============================================================================

/**
 * Cloudflare pricing as of 2025
 * All prices are in USD per unit (global/baseline)
 */
export const PRICING = {
  // R2 Storage (per GB per month)
  r2StoragePerGbMonth: 0.015,
  r2InfrequentPerGbMonth: 0.01,

  // R2 Operations (per million)
  r2ClassAPerMillion: 4.50, // PUT, POST, LIST, etc.
  r2ClassBPerMillion: 0.36, // GET, HEAD

  // Pipeline (per million operations / per GB written)
  pipelinePerMillion: 0.50,
  pipelinePerGbWritten: 0.10,

  // Egress (per GB)
  egressPerGb: 0.045,
} as const

export type Pricing = typeof PRICING

/**
 * Get pricing adjusted for a specific region.
 *
 * @param region - The deployment region
 * @returns Pricing object with regional multiplier applied
 * @throws Error if region is invalid
 */
export function getRegionPricing(region: Region): Pricing {
  if (!SUPPORTED_REGIONS.includes(region)) {
    throw new Error(`Invalid region: ${region}. Supported regions: ${SUPPORTED_REGIONS.join(', ')}`)
  }

  const multiplier = REGION_MULTIPLIERS[region]

  return {
    r2StoragePerGbMonth: PRICING.r2StoragePerGbMonth * multiplier,
    r2InfrequentPerGbMonth: PRICING.r2InfrequentPerGbMonth * multiplier,
    r2ClassAPerMillion: PRICING.r2ClassAPerMillion * multiplier,
    r2ClassBPerMillion: PRICING.r2ClassBPerMillion * multiplier,
    pipelinePerMillion: PRICING.pipelinePerMillion * multiplier,
    pipelinePerGbWritten: PRICING.pipelinePerGbWritten * multiplier,
    egressPerGb: PRICING.egressPerGb * multiplier,
  }
}

// ============================================================================
// Types
// ============================================================================

export interface CostInputs {
  eventsPerDay: number
  avgEventSizeBytes: number
  queriesPerDay: number
  retentionDays: number
  typeSpecificQueryRatio?: number // 0-1, ratio of queries that are type-specific
  infrequentAccessPercent?: number // 0-1, percent of data in infrequent access tier
  region?: Region // Deployment region (defaults to 'global')
}

export interface CostBreakdown {
  storage: number
  pipelineOps: number
  r2Writes: number
  r2Reads: number
  egress: number
  total: number
}

export interface ComparisonResult {
  single: CostBreakdown
  multi: CostBreakdown
  savings: number // Percentage, positive = single cheaper, negative = multi cheaper
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Calculate monthly cost for a given configuration and pipeline mode.
 *
 * @param inputs - Cost calculation inputs
 * @param mode - 'single' for one pipeline, 'multi' for type-specific pipelines
 * @returns Cost breakdown in USD per month
 */
export function calculateCost(inputs: CostInputs, mode: 'single' | 'multi'): CostBreakdown {
  const {
    eventsPerDay,
    avgEventSizeBytes,
    queriesPerDay,
    retentionDays,
    infrequentAccessPercent = 0,
    region = 'global',
  } = inputs

  // Get region-specific pricing
  const pricing = getRegionPricing(region)

  // Calculate monthly volumes
  const eventsPerMonth = eventsPerDay * 30
  const bytesPerMonth = eventsPerDay * avgEventSizeBytes * 30
  const gbPerMonth = bytesPerMonth / (1024 ** 3)

  // Storage: based on retention period
  const storedGb = gbPerMonth * (retentionDays / 30)
  const standardStorageGb = storedGb * (1 - infrequentAccessPercent)
  const infrequentStorageGb = storedGb * infrequentAccessPercent
  const storage =
    standardStorageGb * pricing.r2StoragePerGbMonth +
    infrequentStorageGb * pricing.r2InfrequentPerGbMonth

  // Pipeline operations: multi-pipeline has one pipeline per event type (assume 4 types)
  const pipelineCount = mode === 'multi' ? 4 : 1
  const pipelineOps = (eventsPerMonth / 1_000_000) * pricing.pipelinePerMillion * pipelineCount

  // R2 Writes: Class A operations for storing events
  const r2Writes = (eventsPerMonth / 1_000_000) * pricing.r2ClassAPerMillion

  // R2 Reads: Class B operations for queries
  const queriesPerMonth = queriesPerDay * 30
  const r2Reads = (queriesPerMonth / 1_000_000) * pricing.r2ClassBPerMillion

  // Egress: simplified to 0 for internal operations (most R2 access is within Cloudflare)
  const egress = 0

  const total = storage + pipelineOps + r2Writes + r2Reads + egress

  return {
    storage,
    pipelineOps,
    r2Writes,
    r2Reads,
    egress,
    total,
  }
}

/**
 * Compare costs between single and multi-pipeline configurations.
 *
 * @param inputs - Cost calculation inputs
 * @returns Comparison with both breakdowns and savings percentage
 */
export function compareCosts(inputs: CostInputs): ComparisonResult {
  const single = calculateCost(inputs, 'single')
  const multi = calculateCost(inputs, 'multi')

  // Savings: positive means single is cheaper, negative means multi is cheaper
  const savings = ((single.total - multi.total) / single.total) * 100

  return { single, multi, savings }
}

/**
 * Get a recommendation based on events per day.
 *
 * - Low volume (<1M): Use single pipeline for simplicity
 * - Medium volume (1M-10M): Evaluate based on query patterns
 * - High volume (>10M): Consider multi-pipeline for efficiency
 *
 * @param eventsPerDay - Number of events per day
 * @returns Recommendation: 'single', 'multi', or 'evaluate'
 */
export function getRecommendation(eventsPerDay: number): 'single' | 'multi' | 'evaluate' {
  if (eventsPerDay < 1_000_000) {
    return 'single'
  }
  if (eventsPerDay > 10_000_000) {
    return 'multi'
  }
  return 'evaluate'
}

// ============================================================================
// Formatting Helpers
// ============================================================================

/**
 * Format a number as USD currency.
 */
function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`
}

/**
 * Format a number with commas for readability.
 */
function formatNumber(value: number): string {
  return value.toLocaleString()
}

/**
 * Format cost breakdown as a markdown table.
 */
export function formatBreakdownTable(breakdown: CostBreakdown, mode: string): string {
  const lines = [
    `## ${mode === 'single' ? 'Single Pipeline' : 'Multi-Pipeline'} Cost Breakdown`,
    '',
    '| Component | Monthly Cost |',
    '|-----------|-------------|',
    `| Storage | ${formatCurrency(breakdown.storage)} |`,
    `| Pipeline Ops | ${formatCurrency(breakdown.pipelineOps)} |`,
    `| R2 Writes | ${formatCurrency(breakdown.r2Writes)} |`,
    `| R2 Reads | ${formatCurrency(breakdown.r2Reads)} |`,
    `| Egress | ${formatCurrency(breakdown.egress)} |`,
    '|-----------|-------------|',
    `| **Total** | **${formatCurrency(breakdown.total)}** |`,
    '',
  ]
  return lines.join('\n')
}

/**
 * Format comparison result as markdown.
 */
export function formatComparison(result: ComparisonResult, inputs: CostInputs): string {
  const recommendation = getRecommendation(inputs.eventsPerDay)
  const region = inputs.region ?? 'global'
  const lines = [
    '# Pipeline Cost Comparison',
    '',
    '## Configuration',
    '',
    `- Events per day: ${formatNumber(inputs.eventsPerDay)}`,
    `- Avg event size: ${formatNumber(inputs.avgEventSizeBytes)} bytes`,
    `- Queries per day: ${formatNumber(inputs.queriesPerDay)}`,
    `- Retention: ${inputs.retentionDays} days`,
    `- Region: ${region}${region !== 'global' ? ` (${((REGION_MULTIPLIERS[region] - 1) * 100).toFixed(0)}% regional adjustment)` : ''}`,
    '',
    formatBreakdownTable(result.single, 'single'),
    formatBreakdownTable(result.multi, 'multi'),
    '## Summary',
    '',
    `| Mode | Monthly Cost |`,
    `|------|-------------|`,
    `| Single Pipeline | ${formatCurrency(result.single.total)} |`,
    `| Multi-Pipeline | ${formatCurrency(result.multi.total)} |`,
    '',
    result.savings > 0
      ? `Single pipeline is ${Math.abs(result.savings).toFixed(1)}% cheaper.`
      : `Multi-pipeline is ${Math.abs(result.savings).toFixed(1)}% cheaper.`,
    '',
    '## Recommendation',
    '',
    recommendation === 'single'
      ? 'Use **single pipeline** for simplicity at this volume.'
      : recommendation === 'multi'
        ? 'Consider **multi-pipeline** for better query efficiency at this scale.'
        : 'At this volume, **evaluate** your query patterns to decide.',
    '',
  ]
  return lines.join('\n')
}

/**
 * Format result as JSON.
 */
export function formatJSON(result: ComparisonResult, inputs: CostInputs): string {
  return JSON.stringify(
    {
      inputs,
      single: result.single,
      multi: result.multi,
      savings: result.savings,
      recommendation: getRecommendation(inputs.eventsPerDay),
    },
    null,
    2
  )
}

// ============================================================================
// Input Validation
// ============================================================================

interface ValidationResult {
  valid: boolean
  error?: string
}

/**
 * Validates CLI input options for cost calculations.
 * Throws an error if validation fails.
 *
 * @param options - Raw string options from CLI
 * @throws Error with descriptive message if validation fails
 */
export function validateCostInputs(options: {
  events: string
  size: string
  queries: string
  retention: string
}): ValidationResult {
  const eventsPerDay = parseInt(options.events, 10)
  if (isNaN(eventsPerDay) || eventsPerDay <= 0) {
    throw new Error('Invalid events: Events per day must be a positive number')
  }

  const avgEventSize = parseInt(options.size, 10)
  if (isNaN(avgEventSize) || avgEventSize <= 0) {
    throw new Error('Invalid size: Event size must be a positive number')
  }

  const queriesPerDay = parseInt(options.queries, 10)
  if (isNaN(queriesPerDay) || queriesPerDay < 0) {
    throw new Error('Invalid queries: Queries per day must be non-negative')
  }

  const retentionDays = parseInt(options.retention, 10)
  if (isNaN(retentionDays) || retentionDays <= 0 || retentionDays > 365) {
    throw new Error('Invalid retention: Retention must be between 1 and 365 days')
  }

  return { valid: true }
}

// ============================================================================
// Configurable Pipeline Calculation
// ============================================================================

export interface CostCalculationOptions {
  pipelineCount?: number
}

/**
 * Calculate monthly cost with configurable pipeline count.
 *
 * @param inputs - Cost calculation inputs
 * @param mode - 'single' for one pipeline, 'multi' for type-specific pipelines
 * @param options - Additional options including custom pipeline count
 * @returns Cost breakdown in USD per month
 */
export function calculateCostWithOptions(
  inputs: CostInputs,
  mode: 'single' | 'multi',
  options: CostCalculationOptions = {}
): CostBreakdown {
  const {
    eventsPerDay,
    avgEventSizeBytes,
    queriesPerDay,
    retentionDays,
    infrequentAccessPercent = 0,
    region = 'global',
  } = inputs

  // Get region-specific pricing
  const pricing = getRegionPricing(region)

  // Calculate monthly volumes
  const eventsPerMonth = eventsPerDay * 30
  const bytesPerMonth = eventsPerDay * avgEventSizeBytes * 30
  const gbPerMonth = bytesPerMonth / (1024 ** 3)

  // Storage: based on retention period
  const storedGb = gbPerMonth * (retentionDays / 30)
  const standardStorageGb = storedGb * (1 - infrequentAccessPercent)
  const infrequentStorageGb = storedGb * infrequentAccessPercent
  const storage =
    standardStorageGb * pricing.r2StoragePerGbMonth +
    infrequentStorageGb * pricing.r2InfrequentPerGbMonth

  // Pipeline operations: use custom count or default (4 for multi, 1 for single)
  const defaultPipelineCount = mode === 'multi' ? 4 : 1
  const pipelineCount = options.pipelineCount ?? defaultPipelineCount
  const pipelineOps = (eventsPerMonth / 1_000_000) * pricing.pipelinePerMillion * pipelineCount

  // R2 Writes: Class A operations for storing events
  const r2Writes = (eventsPerMonth / 1_000_000) * pricing.r2ClassAPerMillion

  // R2 Reads: Class B operations for queries
  const queriesPerMonth = queriesPerDay * 30
  const r2Reads = (queriesPerMonth / 1_000_000) * pricing.r2ClassBPerMillion

  // Egress: simplified to 0 for internal operations (most R2 access is within Cloudflare)
  const egress = 0

  const total = storage + pipelineOps + r2Writes + r2Reads + egress

  return {
    storage,
    pipelineOps,
    r2Writes,
    r2Reads,
    egress,
    total,
  }
}

// ============================================================================
// CLI Commands
// ============================================================================

/**
 * Create the cost command with subcommands.
 */
export const costCommand = new Command('cost')
  .description('Calculate Cloudflare Pipeline costs at various scale points')

// Analyze subcommand
costCommand
  .command('analyze')
  .description('Analyze cost for given parameters')
  .option('-e, --events <number>', 'Events per day', '1000000')
  .option('-s, --size <number>', 'Average event size in bytes', '500')
  .option('-q, --queries <number>', 'Queries per day', '1000')
  .option('-r, --retention <number>', 'Retention days', '30')
  .option('-m, --mode <mode>', 'Pipeline mode (single/multi)', 'single')
  .option('--region <region>', `Deployment region (${SUPPORTED_REGIONS.join('/')})`, 'global')
  .option('-f, --format <format>', 'Output format (table/json)', 'table')
  .action((options) => {
    // Validate inputs first
    validateCostInputs(options)

    const region = options.region as Region
    if (!SUPPORTED_REGIONS.includes(region)) {
      console.error(`Invalid region: ${region}. Supported: ${SUPPORTED_REGIONS.join(', ')}`)
      process.exit(1)
    }

    const inputs: CostInputs = {
      eventsPerDay: parseInt(options.events, 10),
      avgEventSizeBytes: parseInt(options.size, 10),
      queriesPerDay: parseInt(options.queries, 10),
      retentionDays: parseInt(options.retention, 10),
      region,
    }

    const mode = options.mode as 'single' | 'multi'
    const result = calculateCost(inputs, mode)

    if (options.format === 'json') {
      console.log(JSON.stringify({ inputs, mode, region, ...result }, null, 2))
    } else {
      console.log(formatBreakdownTable(result, mode))
      if (region !== 'global') {
        console.log(`Region: ${region} (${((REGION_MULTIPLIERS[region] - 1) * 100).toFixed(0)}% regional adjustment)`)
        console.log()
      }
    }
  })

// Compare subcommand
costCommand
  .command('compare')
  .description('Compare single vs multi-pipeline costs')
  .option('-e, --events <number>', 'Events per day', '1000000')
  .option('-s, --size <number>', 'Average event size in bytes', '500')
  .option('-q, --queries <number>', 'Queries per day', '1000')
  .option('-r, --retention <number>', 'Retention days', '30')
  .option('--region <region>', `Deployment region (${SUPPORTED_REGIONS.join('/')})`, 'global')
  .option('-f, --format <format>', 'Output format (table/json)', 'table')
  .action((options) => {
    // Validate inputs first
    validateCostInputs(options)

    const region = options.region as Region
    if (!SUPPORTED_REGIONS.includes(region)) {
      console.error(`Invalid region: ${region}. Supported: ${SUPPORTED_REGIONS.join(', ')}`)
      process.exit(1)
    }

    const inputs: CostInputs = {
      eventsPerDay: parseInt(options.events, 10),
      avgEventSizeBytes: parseInt(options.size, 10),
      queriesPerDay: parseInt(options.queries, 10),
      retentionDays: parseInt(options.retention, 10),
      region,
    }

    const result = compareCosts(inputs)

    if (options.format === 'json') {
      console.log(formatJSON(result, inputs))
    } else {
      console.log(formatComparison(result, inputs))
    }
  })

// Recommend subcommand
costCommand
  .command('recommend')
  .description('Get recommendation based on volume')
  .argument('<events>', 'Events per day')
  .action((events) => {
    const eventsPerDay = parseInt(events, 10)
    const recommendation = getRecommendation(eventsPerDay)

    console.log(`\nFor ${formatNumber(eventsPerDay)} events/day:`)
    console.log()

    switch (recommendation) {
      case 'single':
        console.log('Recommendation: SINGLE PIPELINE')
        console.log('At this volume, a single pipeline provides the best simplicity-to-cost ratio.')
        break
      case 'multi':
        console.log('Recommendation: MULTI-PIPELINE')
        console.log('At this scale, consider multiple type-specific pipelines for query efficiency.')
        break
      case 'evaluate':
        console.log('Recommendation: EVALUATE')
        console.log('At this volume, the best choice depends on your query patterns.')
        console.log('Use `do cost compare` to see detailed breakdown.')
        break
    }
    console.log()
  })

export default costCommand

// Example: Cost and token tracking with @dotdo/ai
//
// This example demonstrates how to track AI usage, costs,
// and set budget limits with the tracking module.

import { ai } from '../template'
import {
  UsageTracker,
  calculateCost,
  countTokens,
  globalTracker,
  BudgetExceededError,
} from '../tracking'

// Example 1: Basic usage tracking
async function basicTracking() {
  console.log('=== Basic Tracking ===')

  const tracker = new UsageTracker()

  // Make an AI request
  const result = await ai`Explain TypeScript generics`

  // Record usage from AIPromise $meta
  tracker.recordFromMeta('openai', result.$meta)

  // Get usage report
  const report = tracker.getReport()
  console.log(`Total cost: $${report.totalCost.toFixed(6)}`)
  console.log(`Total tokens: ${report.totalTokens}`)
  console.log(`Requests: ${report.requestCount}`)
}

// Example 2: Multi-provider tracking
async function multiProviderTracking() {
  console.log('\n=== Multi-Provider Tracking ===')

  const tracker = new UsageTracker()

  // Simulate requests to different providers
  tracker.record({
    provider: 'openai',
    model: 'gpt-4o',
    tokens: { input: 1000, output: 500 },
    cost: calculateCost('openai', 'gpt-4o', { input: 1000, output: 500 }),
    timestamp: Date.now(),
  })

  tracker.record({
    provider: 'anthropic',
    model: 'claude-sonnet-4',
    tokens: { input: 1500, output: 750 },
    cost: calculateCost('anthropic', 'claude-sonnet-4', { input: 1500, output: 750 }),
    timestamp: Date.now(),
  })

  // Get breakdown by provider
  const report = tracker.getReport()
  console.log(`Total cost: $${report.totalCost.toFixed(6)}`)
  console.log('\nBy Provider:')
  for (const [provider, stats] of Object.entries(report.byProvider)) {
    console.log(`  ${provider}: $${stats.cost.toFixed(6)} (${stats.tokens} tokens, ${stats.requests} requests)`)
  }

  console.log('\nBy Model:')
  for (const [model, stats] of Object.entries(report.byModel)) {
    console.log(`  ${model}: $${stats.cost.toFixed(6)} (${stats.tokens} tokens, ${stats.requests} requests)`)
  }
}

// Example 3: Budget limits
async function budgetLimits() {
  console.log('\n=== Budget Limits ===')

  const tracker = new UsageTracker()
  tracker.setBudgetLimit(0.01) // $0.01 budget

  console.log(`Budget limit: $${tracker.getBudgetLimit()}`)

  try {
    // This should succeed
    tracker.record({
      provider: 'openai',
      model: 'gpt-4o-mini',
      tokens: { input: 100, output: 50 },
      cost: calculateCost('openai', 'gpt-4o-mini', { input: 100, output: 50 }),
      timestamp: Date.now(),
    })
    console.log('First request succeeded')

    // This should throw BudgetExceededError
    tracker.record({
      provider: 'openai',
      model: 'gpt-4o',
      tokens: { input: 10000, output: 5000 },
      cost: calculateCost('openai', 'gpt-4o', { input: 10000, output: 5000 }),
      timestamp: Date.now(),
    })
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      console.log(`Budget exceeded! Current: $${err.currentCost.toFixed(6)}, Limit: $${err.budgetLimit}`)
    }
  }
}

// Example 4: Budget alerts
async function budgetAlerts() {
  console.log('\n=== Budget Alerts ===')

  const tracker = new UsageTracker()
  tracker.setBudgetLimit(1.0)

  // Set up alerts at different thresholds
  tracker.onBudgetThreshold(0.5, (cost) => {
    console.log(`⚠️  Warning: 50% of budget used ($${cost.toFixed(6)})`)
  })

  tracker.onBudgetThreshold(0.8, (cost) => {
    console.log(`⚠️  Alert: 80% of budget used ($${cost.toFixed(6)})`)
  })

  // Simulate usage that triggers alerts
  tracker.record({
    provider: 'openai',
    model: 'gpt-4o',
    tokens: { input: 100000, output: 50000 },
    cost: 0.6,
    timestamp: Date.now(),
  })

  tracker.record({
    provider: 'openai',
    model: 'gpt-4o',
    tokens: { input: 50000, output: 25000 },
    cost: 0.3,
    timestamp: Date.now(),
  })
}

// Example 5: Time-filtered reports
async function timeFilteredReports() {
  console.log('\n=== Time-Filtered Reports ===')

  const tracker = new UsageTracker()
  const now = Date.now()
  const hourAgo = now - 3600 * 1000

  // Simulate usage over time
  tracker.record({
    provider: 'openai',
    model: 'gpt-4o',
    tokens: { input: 1000, output: 500 },
    cost: 0.01,
    timestamp: hourAgo,
  })

  tracker.record({
    provider: 'openai',
    model: 'gpt-4o',
    tokens: { input: 1000, output: 500 },
    cost: 0.01,
    timestamp: now,
  })

  // Get report for last 30 minutes
  const recent = tracker.getReport({ since: now - 1800 * 1000 })
  console.log(`Last 30 minutes: $${recent.totalCost.toFixed(6)} (${recent.requestCount} requests)`)

  // Get full report
  const full = tracker.getReport()
  console.log(`All time: $${full.totalCost.toFixed(6)} (${full.requestCount} requests)`)
}

// Example 6: Export and import records
async function exportImportRecords() {
  console.log('\n=== Export/Import Records ===')

  const tracker1 = new UsageTracker()

  tracker1.record({
    provider: 'openai',
    model: 'gpt-4o',
    tokens: { input: 1000, output: 500 },
    cost: 0.01,
    timestamp: Date.now(),
  })

  // Export records (for persistence)
  const records = tracker1.exportRecords()
  console.log(`Exported ${records.length} records`)

  // Import into new tracker
  const tracker2 = new UsageTracker()
  tracker2.importRecords(records)

  const report = tracker2.getReport()
  console.log(`Imported tracker has: $${report.totalCost.toFixed(6)} total cost`)
}

// Example 7: Global tracker singleton
async function globalTrackerExample() {
  console.log('\n=== Global Tracker ===')

  // Use the global singleton tracker
  globalTracker.setBudgetLimit(10.0)

  const result = await ai`Hello world`
  globalTracker.recordFromMeta('openai', result.$meta)

  const report = globalTracker.getReport()
  console.log(`Global tracker: $${report.totalCost.toFixed(6)}`)
}

// Example 8: Token counting
function tokenCountingExample() {
  console.log('\n=== Token Counting ===')

  const texts = [
    'Hello, world!',
    'This is a longer sentence with more words.',
    'TypeScript is a strongly typed programming language that builds on JavaScript.',
  ]

  for (const text of texts) {
    const tokens = countTokens(text)
    console.log(`"${text.slice(0, 50)}..." → ~${tokens} tokens`)
  }
}

// Example 9: Cost calculation
function costCalculationExample() {
  console.log('\n=== Cost Calculation ===')

  const tokens = { input: 10000, output: 5000 }

  const models = [
    { provider: 'openai' as const, model: 'gpt-4o' },
    { provider: 'openai' as const, model: 'gpt-4o-mini' },
    { provider: 'anthropic' as const, model: 'claude-sonnet-4' },
    { provider: 'anthropic' as const, model: 'claude-haiku-4' },
  ]

  console.log(`For ${tokens.input} input + ${tokens.output} output tokens:\n`)
  for (const { provider, model } of models) {
    const cost = calculateCost(provider, model, tokens)
    console.log(`  ${provider}/${model}: $${cost.toFixed(6)}`)
  }
}

// Run all examples
async function main() {
  await basicTracking()
  await multiProviderTracking()
  await budgetLimits()
  await budgetAlerts()
  await timeFilteredReports()
  await exportImportRecords()
  await globalTrackerExample()
  tokenCountingExample()
  costCalculationExample()
}

// Uncomment to run:
// main().catch(console.error)

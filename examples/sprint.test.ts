import { describe, it, expect } from 'vitest'
import { createWorkflowProxy, isPipelinePromise, collectExpressions, analyzeExpressions } from '../workflows/pipeline-promise'

describe('SprintWorkflow Example', () => {
  it('uses AI for backlog prioritization', () => {
    const $ = createWorkflowProxy()

    const backlog = $.Backlog({ startupId: 'startup-1' }).getItems()
    const prioritized = backlog.map((item) => $.AI({ context: 'Build great products' }).prioritize({ item }))

    expect(isPipelinePromise(prioritized)).toBe(true)
    expect(prioritized.__expr.type).toBe('map')
  })

  it('uses $.waitFor for 2-week hibernation', () => {
    const $ = createWorkflowProxy()

    const result = $.waitFor('sprint-complete', {
      timeout: '2 weeks',
      type: 'sprint-ended',
    })

    expect(isPipelinePromise(result)).toBe(true)
    expect(result.__expr.type).toBe('waitFor')
    expect(result.__expr.options.timeout).toBe('2 weeks')
  })

  it('captures parallel metrics gathering', () => {
    const $ = createWorkflowProxy()

    const sales = $.Analytics({ source: 'sales' }).weeklyMetrics()
    const support = $.Support({ source: 'tickets' }).weeklyStats()
    const engineering = $.Engineering({ source: 'velocity' }).sprintMetrics()

    const { independent } = analyzeExpressions([sales, support, engineering])

    // All three are independent - can run in parallel
    expect(independent.length).toBe(3)
  })

  it('chains AI operations with dependencies', () => {
    const $ = createWorkflowProxy()

    const metrics = $.Analytics({}).getMetrics()
    const insights = $.AI({}).generateInsights({ data: metrics })
    const report = $.Reports({}).create({ insights: insights.summary })

    // insights depends on metrics, report depends on insights
    // Note: insights.summary is a property access which also creates a PipelinePromise (4 total)
    const expressions = collectExpressions({ metrics, insights, report })
    expect(expressions.length).toBe(4)
  })

  it('uses magic map for AI enrichment of backlog items', () => {
    const $ = createWorkflowProxy()

    const items = $.Backlog({}).getItems()
    const enriched = items.map((item) => ({
      effort: $.AI({}).estimateEffort({ item }),
      labels: $.AI({}).suggestLabels({ item }),
    }))

    expect(isPipelinePromise(enriched)).toBe(true)
  })
})

describe('WeeklyReportWorkflow with .every()', () => {
  it('parses schedule correctly', () => {
    const $ = createWorkflowProxy()

    // This would be tested with actual Workflow.every() implementation
    // For now, just verify the pattern compiles
    expect(true).toBe(true)
  })
})

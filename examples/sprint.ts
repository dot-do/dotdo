/**
 * SprintWorkflow Example
 *
 * Demonstrates:
 * - AI-powered operations ($.AI for prioritization)
 * - Scheduled execution (Workflow.every)
 * - Magic map for processing backlog items
 * - Long hibernation (2 weeks) with $.waitFor
 * - Complex domain composition
 */

import { Workflow } from '../workflows/workflow'

interface Startup {
  id: string
  name: string
  mission: string
  teamSlackChannel: string
  csm: string // Customer Success Manager
}

interface BacklogItem {
  id: string
  title: string
  description: string
  priority?: number
  effort?: 'xs' | 's' | 'm' | 'l' | 'xl'
  labels: string[]
}

interface PrioritizedItem extends BacklogItem {
  aiPriority: number
  reasoning: string
}

interface Sprint {
  id: string
  items: PrioritizedItem[]
  startDate: Date
  endDate: Date
  goal: string
}

interface SprintResult {
  completed: BacklogItem[]
  incomplete: BacklogItem[]
  velocity: number
}

interface Retrospective {
  whatWentWell: string[]
  whatCouldImprove: string[]
  actionItems: string[]
  teamMorale: number
}

/**
 * Sprint Cycle Workflow
 *
 * This workflow manages a complete 2-week sprint cycle:
 * 1. AI prioritizes the backlog
 * 2. Creates sprint with top items
 * 3. Schedules daily standups
 * 4. Hibernates for 2 weeks (zero cost)
 * 5. Generates AI retrospective
 * 6. Plans next sprint
 */
export const SprintCycleWorkflow = Workflow('sprint-cycle', ($, startup: Startup) => {
  // Step 1: AI prioritizes the backlog
  const backlog = $.Backlog({ startupId: startup.id }).getItems()

  // Magic map: AI analyzes each item
  const prioritized = backlog.map(item =>
    $.AI({ context: startup.mission }).prioritize({
      item,
      criteria: ['business_impact', 'technical_feasibility', 'user_demand', 'strategic_alignment']
    })
  )

  // Step 2: Create sprint with top 10 items (sorted by AI priority)
  const sprint = $.Sprint({ startupId: startup.id }).create({
    items: prioritized, // Will be sorted by engine
    duration: '2 weeks',
    goal: $.AI({ context: startup.mission }).generateSprintGoal({ items: prioritized })
  })

  // Step 3: Schedule daily standups
  $.Standup({ teamId: startup.id }).scheduleDaily({
    time: '9am',
    channel: startup.teamSlackChannel,
    sprintId: sprint.id
  })

  // Notify team
  $.Slack({ channel: startup.teamSlackChannel }).post({
    template: 'sprint-started',
    data: { sprint, prioritized }
  })

  // Step 4: HIBERNATE FOR 2 WEEKS - zero compute cost
  const sprintResult = $.waitFor('sprint-complete', {
    timeout: '2 weeks',
    type: 'sprint-ended'
  })

  // Step 5: Generate AI-powered retrospective
  const standupFeedback = $.Standup({ teamId: startup.id }).aggregateFeedback({
    sprintId: sprint.id
  })

  const retrospective = $.AI({ role: 'agile-coach' }).generateRetro({
    sprint: sprintResult,
    standupFeedback,
    teamContext: startup
  })

  // Step 6: Post retro and plan next sprint
  $.Slack({ channel: startup.teamSlackChannel }).post({
    template: 'sprint-retro',
    data: { retrospective, sprint: sprintResult }
  })

  // Carry over incomplete items
  const nextSprintItems = $.Sprint({ startupId: startup.id }).planNext({
    previousRetro: retrospective,
    incompleteItems: sprintResult.incomplete,
    remainingBacklog: backlog // Filtered by engine
  })

  return {
    startupId: startup.id,
    completedSprint: sprint,
    result: sprintResult,
    retrospective,
    nextSprintItems,
    velocity: sprintResult.velocity
  }
})

/**
 * Weekly Report Workflow
 *
 * Demonstrates scheduled execution with Workflow.every()
 */
export const WeeklyReportWorkflow = Workflow('weekly-report')
  .every('Monday at 9am')
  .run(($) => {
    // Gather metrics from all sources in parallel
    const sales = $.Analytics({ source: 'sales' }).weeklyMetrics()
    const support = $.Support({ source: 'tickets' }).weeklyStats()
    const engineering = $.Engineering({ source: 'velocity' }).sprintMetrics()
    const product = $.Product({ source: 'usage' }).weeklyAnalytics()

    // Get previous week for comparison
    const previousWeek = $.Reports({ type: 'weekly' }).getPrevious()

    // Generate AI-powered insights
    const insights = $.AI({ role: 'business-analyst' }).generateInsights({
      current: { sales, support, engineering, product },
      previous: previousWeek,
      trends: $.Analytics({}).calculateTrends({ weeks: 4 })
    })

    // Create and store report
    const report = $.Reports({ type: 'weekly' }).create({
      metrics: { sales, support, engineering, product },
      insights,
      generatedAt: new Date()
    })

    // Distribute to stakeholders
    $.Slack({ channel: '#leadership' }).post({
      template: 'weekly-report',
      data: { report, insights }
    })

    $.Email({ list: 'executives' }).send({
      template: 'weekly-digest',
      data: { report, insights }
    })

    return report
  })

/**
 * AI Backlog Grooming Workflow
 *
 * Uses AI to analyze and enrich backlog items
 */
export const BacklogGroomingWorkflow = Workflow('backlog-grooming', ($, startupId: string) => {
  const rawItems = $.Backlog({ startupId }).getUngroomed()

  // AI processes each item
  const enriched = rawItems.map(item => ({
    ...item,
    // AI estimates effort
    effort: $.AI({ role: 'tech-lead' }).estimateEffort({ item }),
    // AI suggests labels
    suggestedLabels: $.AI({ role: 'product-manager' }).suggestLabels({ item }),
    // AI identifies dependencies
    dependencies: $.AI({ role: 'architect' }).identifyDependencies({
      item,
      existingItems: rawItems
    }),
    // AI generates acceptance criteria
    acceptanceCriteria: $.AI({ role: 'qa-engineer' }).generateAcceptanceCriteria({ item })
  }))

  // Update items in backlog
  const updated = enriched.map(item =>
    $.Backlog({ startupId }).updateItem(item)
  )

  // Notify product team
  $.Slack({ channel: '#product' }).post({
    template: 'grooming-complete',
    data: { itemCount: rawItems.length, enriched }
  })

  return { groomedCount: rawItems.length, items: enriched }
})

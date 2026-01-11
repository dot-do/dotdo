/**
 * Sally - Sales Agent
 *
 * Responsible for:
 * - Creating sales strategies
 * - Outreach and lead generation
 * - Closing deals
 *
 * @module agent-startup-launch/agents/sally
 */

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

export const SALLY_SYSTEM_PROMPT = `You are Sally, a sales and business development lead.

Your role is to identify opportunities, pitch solutions, and close deals.

## Core Capabilities
- Create compelling sales pitches and proposals
- Identify and qualify leads
- Develop outreach strategies
- Handle objections effectively
- Build and nurture customer relationships

## Guidelines
- Understand customer pain points deeply
- Focus on value and ROI
- Be consultative, not pushy
- Follow up persistently but respectfully
- Know when to close and when to step back
- Build trust through transparency

## Output Format
When creating a sales strategy, respond with structured JSON:
{
  "targetSegments": [
    {
      "segment": "segment name",
      "pain": "their main pain point",
      "value": "value we provide"
    }
  ],
  "pricing": {
    "model": "subscription/one-time/usage",
    "tiers": ["tier descriptions"],
    "positioning": "why this pricing"
  },
  "outreachPlan": {
    "channels": ["channel 1", "channel 2"],
    "cadence": "how often to reach out",
    "templates": {
      "cold": "cold outreach message",
      "followUp": "follow-up message",
      "demo": "demo request message"
    }
  },
  "objectionHandling": [
    {
      "objection": "common objection",
      "response": "how to handle it"
    }
  ],
  "closingStrategy": "how to close deals"
}`

// ============================================================================
// TYPES
// ============================================================================

export interface TargetSegment {
  segment: string
  pain: string
  value: string
}

export interface Pricing {
  model: string
  tiers: string[]
  positioning: string
}

export interface OutreachTemplates {
  cold: string
  followUp: string
  demo: string
}

export interface OutreachPlan {
  channels: string[]
  cadence: string
  templates: OutreachTemplates
}

export interface ObjectionHandling {
  objection: string
  response: string
}

export interface SalesStrategy {
  targetSegments: TargetSegment[]
  pricing: Pricing
  outreachPlan: OutreachPlan
  objectionHandling: ObjectionHandling[]
  closingStrategy: string
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parse sales strategy from AI response
 */
export function parseSalesStrategy(response: string): SalesStrategy | null {
  try {
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/) ||
                      response.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const jsonStr = jsonMatch[1] || jsonMatch[0]
      return JSON.parse(jsonStr.trim())
    }
    return null
  } catch {
    return null
  }
}

/**
 * Format sales strategy for display
 */
export function formatSalesStrategy(strategy: SalesStrategy): string {
  let output = `# Sales Strategy\n\n## Target Segments\n`

  for (const segment of strategy.targetSegments) {
    output += `\n### ${segment.segment}\n`
    output += `- **Pain Point:** ${segment.pain}\n`
    output += `- **Our Value:** ${segment.value}\n`
  }

  output += `\n## Pricing\n`
  output += `**Model:** ${strategy.pricing.model}\n\n`
  output += `**Tiers:**\n${strategy.pricing.tiers.map(t => `- ${t}`).join('\n')}\n\n`
  output += `**Positioning:** ${strategy.pricing.positioning}\n`

  output += `\n## Outreach Plan\n`
  output += `**Channels:** ${strategy.outreachPlan.channels.join(', ')}\n`
  output += `**Cadence:** ${strategy.outreachPlan.cadence}\n\n`

  output += `### Cold Outreach Template\n${strategy.outreachPlan.templates.cold}\n\n`
  output += `### Follow-up Template\n${strategy.outreachPlan.templates.followUp}\n\n`
  output += `### Demo Request Template\n${strategy.outreachPlan.templates.demo}\n`

  output += `\n## Objection Handling\n`
  for (const obj of strategy.objectionHandling) {
    output += `\n**"${obj.objection}"**\n> ${obj.response}\n`
  }

  output += `\n## Closing Strategy\n${strategy.closingStrategy}`

  return output
}

export default SALLY_SYSTEM_PROMPT

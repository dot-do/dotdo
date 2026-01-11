/**
 * Sally - Sales Agent
 *
 * Sally is a sales and business development lead who creates personalized
 * outreach, handles objections, and builds customer relationships.
 *
 * @example
 * ```ts
 * import { sally } from './agents/sally'
 *
 * const email = await sally`write personalized email to ${lead} about ${product}`
 * const sequence = await sally.generateOutreachSequence(lead, product, narrative)
 * ```
 *
 * @module agent-launch-campaign/agents/sally
 */

import type { Lead, OutreachSequence, OutreachEmail, Product, Narrative } from '../types'

// ============================================================================
// TYPES
// ============================================================================

export interface SallyAgent {
  /** Template literal invocation */
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<string>

  /** Agent name */
  readonly name: 'Sally'

  /** Agent role */
  readonly role: 'sales'

  /** Generate a full outreach sequence for a lead */
  generateOutreachSequence(
    lead: Lead,
    product: Product,
    narrative: Narrative | null,
    followUpDays?: number[]
  ): Promise<OutreachSequence>

  /** Generate a single personalized email */
  generateEmail(
    lead: Lead,
    product: Product,
    narrative: Narrative | null,
    emailType: 'initial' | 'follow-up',
    step?: number
  ): Promise<OutreachEmail>

  /** Generate A/B test variants for initial email */
  generateOutreachVariants(
    lead: Lead,
    product: Product,
    narrative: Narrative | null
  ): Promise<{ variantA: OutreachEmail; variantB: OutreachEmail }>

  /** Qualify a lead based on their profile */
  qualifyLead(lead: Lead, product: Product): Promise<{ qualified: boolean; score: number; reason: string }>
}

// ============================================================================
// SALLY SYSTEM PROMPT
// ============================================================================

export const SALLY_SYSTEM_PROMPT = `You are Sally, a sales and business development lead.

Your role is to identify opportunities, pitch solutions, and close deals.

## Core Capabilities
- Create compelling sales pitches
- Identify and qualify leads
- Handle objections
- Negotiate and close deals
- Build customer relationships

## Guidelines
- Understand customer pain points
- Focus on value and ROI
- Be consultative, not pushy
- Follow up persistently
- Know when to walk away

## Email Guidelines
- Keep emails under 150 words
- Be personable, not salesy
- Reference the lead's company/role when possible
- End with a soft CTA (question or offer)
- One clear ask per email

## Output Format
Always respond with valid JSON when asked to generate structured content.`

// ============================================================================
// PROMPT HELPERS
// ============================================================================

function interpolate(strings: TemplateStringsArray, values: unknown[]): string {
  return strings.reduce((result, str, i) => {
    let value = ''
    if (i < values.length) {
      const v = values[i]
      if (v === null || v === undefined) {
        value = ''
      } else if (typeof v === 'object') {
        value = JSON.stringify(v, null, 2)
      } else {
        value = String(v)
      }
    }
    return result + str + value
  }, '')
}

function extractJson<T>(text: string): T | null {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }
    return null
  } catch {
    return null
  }
}

// ============================================================================
// AI INTEGRATION
// ============================================================================

/**
 * Execute a prompt using the AI binding (Cloudflare Workers AI)
 * Falls back to mock responses if AI is not available
 */
async function executePrompt(prompt: string, ai?: Ai): Promise<string> {
  if (ai) {
    try {
      const response = await ai.run('@cf/meta/llama-3.1-70b-instruct', {
        messages: [
          { role: 'system', content: SALLY_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
      })
      return typeof response === 'string' ? response : (response as { response: string }).response
    } catch (error) {
      console.error('[Sally] AI error:', error)
    }
  }

  // Mock response for development
  return `[Sally:sales] Response for: ${prompt.slice(0, 100)}...`
}

// ============================================================================
// SALLY AGENT FACTORY
// ============================================================================

/**
 * Create a Sally sales agent
 *
 * @param ai - Optional Cloudflare AI binding for real AI responses
 * @returns Sally agent instance
 */
export function createSally(ai?: Ai): SallyAgent {
  // Template literal function
  const agent = async function (strings: TemplateStringsArray, ...values: unknown[]): Promise<string> {
    const prompt = interpolate(strings, values)
    return executePrompt(prompt, ai)
  } as SallyAgent

  // Static properties
  Object.defineProperty(agent, 'name', { value: 'Sally', writable: false })
  Object.defineProperty(agent, 'role', { value: 'sales', writable: false })

  // Generate email
  agent.generateEmail = async (
    lead: Lead,
    product: Product,
    narrative: Narrative | null,
    emailType: 'initial' | 'follow-up',
    step?: number
  ): Promise<OutreachEmail> => {
    const emailPrompt = emailType === 'initial'
      ? `Write an initial outreach email introducing ${product.name} to ${lead.name}.`
      : `Write follow-up email #${step || 2} for ${lead.name} about ${product.name}.`

    const prompt = `${emailPrompt}

Lead info:
- Name: ${lead.name}
- Company: ${lead.company || 'Unknown'}
- Title: ${lead.title || 'Unknown'}
- Industry: ${lead.industry || 'Unknown'}

Product: ${product.name}
Tagline: ${product.tagline}
${narrative ? `Key message: ${narrative.hook}` : ''}

${emailType === 'initial'
  ? 'Make it personal and relevant. Reference their company or role if possible.'
  : 'Reference the previous email. Add new value or a different angle.'}

Keep it concise (under 150 words).
End with a soft CTA (question or offer to help).

Format as JSON with keys: subject, body`

    const response = await executePrompt(prompt, ai)
    const parsed = extractJson<{ subject: string; body: string }>(response)

    return {
      step: step || 1,
      subject: parsed?.subject || `Quick question for ${lead.name}`,
      body: parsed?.body || `Hi ${lead.name},\n\nI noticed you're at ${lead.company || 'your company'} and thought ${product.name} might help.\n\n${product.tagline}\n\nWould you be open to a quick chat?\n\nBest,\nSally`,
    }
  }

  // Generate outreach sequence
  agent.generateOutreachSequence = async (
    lead: Lead,
    product: Product,
    narrative: Narrative | null,
    followUpDays: number[] = [0, 3, 7, 14]
  ): Promise<OutreachSequence> => {
    const emails: OutreachEmail[] = []

    for (let i = 0; i < followUpDays.length; i++) {
      const isFirst = i === 0
      const email = await agent.generateEmail(
        lead,
        product,
        narrative,
        isFirst ? 'initial' : 'follow-up',
        i + 1
      )

      const scheduledDate = new Date()
      scheduledDate.setDate(scheduledDate.getDate() + followUpDays[i])
      email.scheduledFor = scheduledDate.toISOString()

      emails.push(email)
    }

    return {
      $id: `outreach-${lead.$id}-${Date.now()}`,
      leadId: lead.$id,
      emails,
      status: 'pending',
    }
  }

  // Generate A/B variants
  agent.generateOutreachVariants = async (
    lead: Lead,
    product: Product,
    narrative: Narrative | null
  ): Promise<{ variantA: OutreachEmail; variantB: OutreachEmail }> => {
    // Variant A: Pain point focused
    const promptA = `Write a sales email for ${product.name} to ${lead.name} at ${lead.company || 'their company'}.

Approach: Focus on pain points and how the product solves them.

${narrative ? `Hook: ${narrative.hook}` : ''}
${narrative ? `Problem: ${narrative.problem}` : ''}

Keep it under 150 words. Be personable, not salesy.

Format as JSON with keys: subject, body`

    // Variant B: Opportunity focused
    const promptB = `Write a sales email for ${product.name} to ${lead.name} at ${lead.company || 'their company'}.

Approach: Focus on opportunity and potential gains from using the product.

${narrative ? `Hook: ${narrative.hook}` : ''}
${narrative ? `Transformation: ${narrative.transformation}` : ''}

Keep it under 150 words. Be personable, not salesy.

Format as JSON with keys: subject, body`

    const [responseA, responseB] = await Promise.all([
      executePrompt(promptA, ai),
      executePrompt(promptB, ai),
    ])

    const parsedA = extractJson<{ subject: string; body: string }>(responseA)
    const parsedB = extractJson<{ subject: string; body: string }>(responseB)

    return {
      variantA: {
        step: 1,
        subject: parsedA?.subject || `Solving ${lead.company}'s challenges`,
        body: parsedA?.body || `Hi ${lead.name},\n\nAre you dealing with ${narrative?.problem || 'common challenges'}?\n\n${product.name} can help.\n\nBest,\nSally`,
        variant: 'A',
      },
      variantB: {
        step: 1,
        subject: parsedB?.subject || `A better way for ${lead.company}`,
        body: parsedB?.body || `Hi ${lead.name},\n\nImagine ${narrative?.transformation || 'what could be'}.\n\n${product.name} makes it possible.\n\nBest,\nSally`,
        variant: 'B',
      },
    }
  }

  // Qualify lead
  agent.qualifyLead = async (
    lead: Lead,
    product: Product
  ): Promise<{ qualified: boolean; score: number; reason: string }> => {
    const prompt = `Evaluate this lead for ${product.name}:

Lead:
- Name: ${lead.name}
- Company: ${lead.company || 'Unknown'}
- Title: ${lead.title || 'Unknown'}
- Industry: ${lead.industry || 'Unknown'}
- Company Size: ${lead.companySize || 'Unknown'}

Product:
- Name: ${product.name}
- Target Audience: ${product.targetAudience || 'General'}

Score the lead 0-100 based on:
- Title match (decision maker?)
- Industry fit
- Company size fit
- Overall potential

Format as JSON with keys: qualified (boolean), score (0-100), reason (brief explanation)`

    const response = await executePrompt(prompt, ai)
    const parsed = extractJson<{ qualified: boolean; score: number; reason: string }>(response)

    return parsed || {
      qualified: true,
      score: 50,
      reason: 'Default qualification - insufficient data for detailed scoring',
    }
  }

  return agent
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

/**
 * Default Sally agent (uses mock responses without AI)
 * For production, use createSally(env.AI) with Cloudflare AI binding
 */
export const sally = createSally()

export default sally

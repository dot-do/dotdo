/**
 * Mark - Marketing Agent
 *
 * Mark is a marketing and communications lead who creates compelling content,
 * plans product launches, and communicates value to your audience.
 *
 * @example
 * ```ts
 * import { mark } from './agents/mark'
 *
 * const narrative = await mark`write launch story for ${product}`
 * const blog = await mark`write blog post from ${narrative}`
 * const social = await mark`create social campaign from ${narrative}`
 * ```
 *
 * @module agent-launch-campaign/agents/mark
 */

import type { Narrative, Content, Product, ContentMetrics } from '../types'

// ============================================================================
// TYPES
// ============================================================================

export interface MarkAgent {
  /** Template literal invocation */
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<string>

  /** Agent name */
  readonly name: 'Mark'

  /** Agent role */
  readonly role: 'marketing'

  /** Generate a StoryBrand-style launch narrative */
  generateNarrative(product: Product): Promise<Narrative>

  /** Generate blog post content */
  generateBlogPost(product: Product, narrative: Narrative, variant?: 'A' | 'B'): Promise<Content>

  /** Generate Twitter/X thread */
  generateTwitterThread(product: Product, narrative: Narrative): Promise<Content>

  /** Generate LinkedIn post */
  generateLinkedInPost(product: Product, narrative: Narrative): Promise<Content>

  /** Generate landing page copy */
  generateLandingPage(product: Product, narrative: Narrative): Promise<Content>

  /** Optimize messaging based on metrics */
  optimizeMessaging(metrics: ContentMetrics, abResults: unknown): Promise<string>
}

// ============================================================================
// MARK SYSTEM PROMPT
// ============================================================================

export const MARK_SYSTEM_PROMPT = `You are Mark, a marketing and communications lead.

Your role is to create content, plan launches, and communicate value.

## Core Capabilities
- Write compelling copy and content
- Plan product launches
- Create announcements and updates
- Communicate technical concepts clearly
- Build brand voice and messaging

## Guidelines
- Focus on benefits, not features
- Use clear, engaging language
- Know your audience
- Create urgency when appropriate
- Be authentic and trustworthy

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
          { role: 'system', content: MARK_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
      })
      return typeof response === 'string' ? response : (response as { response: string }).response
    } catch (error) {
      console.error('[Mark] AI error:', error)
    }
  }

  // Mock response for development
  return `[Mark:marketing] Response for: ${prompt.slice(0, 100)}...`
}

// ============================================================================
// MARK AGENT FACTORY
// ============================================================================

/**
 * Create a Mark marketing agent
 *
 * @param ai - Optional Cloudflare AI binding for real AI responses
 * @returns Mark agent instance
 */
export function createMark(ai?: Ai): MarkAgent {
  // Template literal function
  const agent = async function (strings: TemplateStringsArray, ...values: unknown[]): Promise<string> {
    const prompt = interpolate(strings, values)
    return executePrompt(prompt, ai)
  } as MarkAgent

  // Static properties
  Object.defineProperty(agent, 'name', { value: 'Mark', writable: false })
  Object.defineProperty(agent, 'role', { value: 'marketing', writable: false })

  // Generate narrative
  agent.generateNarrative = async (product: Product): Promise<Narrative> => {
    const prompt = `Create a compelling launch narrative for ${product.name}.

Product: ${product.name}
Tagline: ${product.tagline}
${product.description ? `Description: ${product.description}` : ''}
${product.targetAudience ? `Target Audience: ${product.targetAudience}` : ''}

Generate a StoryBrand-style narrative with:
1. A hook that grabs attention
2. The problem/pain point your audience faces
3. How the product solves it
4. The transformation (before -> after)
5. A clear call to action
6. 3-5 key messages for consistent messaging

Format as JSON with keys: hook, problem, solution, transformation, callToAction, keyMessages`

    const response = await executePrompt(prompt, ai)
    const parsed = extractJson<Narrative>(response)

    return parsed || {
      hook: `Introducing ${product.name}: ${product.tagline}`,
      problem: 'The problem your audience faces every day.',
      solution: `${product.name} solves this by providing a better way.`,
      transformation: 'Go from frustrated to empowered.',
      callToAction: 'Get started today.',
      keyMessages: [
        `${product.name} makes it easy`,
        'Save time and effort',
        'Join thousands of happy users',
      ],
    }
  }

  // Generate blog post
  agent.generateBlogPost = async (product: Product, narrative: Narrative, variant?: 'A' | 'B'): Promise<Content> => {
    const variantInstruction = variant === 'B'
      ? 'Use a more technical, feature-focused approach.'
      : 'Use a story-driven, benefit-focused approach.'

    const prompt = `Write a launch blog post for ${product.name}.

Use this narrative:
Hook: ${narrative.hook}
Problem: ${narrative.problem}
Solution: ${narrative.solution}
Transformation: ${narrative.transformation}
Key Messages: ${narrative.keyMessages.join(', ')}

${variantInstruction}

Include:
- Compelling headline
- Opening that hooks readers
- Problem/solution structure
- Social proof or examples
- Clear CTA

Format as JSON with keys: title, body`

    const response = await executePrompt(prompt, ai)
    const parsed = extractJson<{ title: string; body: string }>(response)

    return {
      $id: `blog-${variant?.toLowerCase() || 'a'}-${Date.now()}`,
      type: 'blog',
      title: parsed?.title || `Introducing ${product.name}`,
      body: parsed?.body || `${narrative.hook}\n\n${narrative.problem}\n\n${narrative.solution}`,
      variant: variant || 'A',
      status: 'draft',
    }
  }

  // Generate Twitter thread
  agent.generateTwitterThread = async (product: Product, narrative: Narrative): Promise<Content> => {
    const prompt = `Create a Twitter/X thread announcing ${product.name}.

Key messages: ${narrative.keyMessages.join(', ')}
Hook: ${narrative.hook}
CTA: ${narrative.callToAction}

Create a 5-7 tweet thread that:
- Opens with a bold statement
- Explains the problem
- Introduces the solution
- Highlights key benefits
- Ends with a CTA

Format as JSON with keys: title (first tweet), body (all tweets separated by ---)`

    const response = await executePrompt(prompt, ai)
    const parsed = extractJson<{ title: string; body: string }>(response)

    return {
      $id: `twitter-${Date.now()}`,
      type: 'twitter-thread',
      title: parsed?.title || narrative.hook,
      body: parsed?.body || `${narrative.hook}\n---\n${narrative.problem}\n---\n${narrative.solution}\n---\n${narrative.callToAction}`,
      status: 'draft',
    }
  }

  // Generate LinkedIn post
  agent.generateLinkedInPost = async (product: Product, narrative: Narrative): Promise<Content> => {
    const prompt = `Create a LinkedIn post announcing ${product.name}.

Narrative: ${narrative.hook} ${narrative.transformation}
Target: ${product.targetAudience || 'professionals'}

Write a professional but engaging post that:
- Tells a brief story or shares an insight
- Introduces the product naturally
- Includes relevant hashtags
- Has a clear CTA

Format as JSON with keys: title (hook line), body (full post)`

    const response = await executePrompt(prompt, ai)
    const parsed = extractJson<{ title: string; body: string }>(response)

    return {
      $id: `linkedin-${Date.now()}`,
      type: 'linkedin-post',
      title: parsed?.title || narrative.hook,
      body: parsed?.body || `${narrative.hook}\n\n${narrative.transformation}\n\n${narrative.callToAction}\n\n#launch #${product.name.replace(/\s+/g, '')}`,
      status: 'draft',
    }
  }

  // Generate landing page
  agent.generateLandingPage = async (product: Product, narrative: Narrative): Promise<Content> => {
    const prompt = `Write landing page copy for ${product.name}.

Narrative:
Hook: ${narrative.hook}
Problem: ${narrative.problem}
Solution: ${narrative.solution}
Transformation: ${narrative.transformation}
CTA: ${narrative.callToAction}

Create sections for:
1. Hero (headline + subheadline)
2. Problem section
3. Solution/Features
4. Benefits (transformation)
5. Social proof section
6. CTA section

Format as JSON with keys: title (headline), body (all sections in markdown)`

    const response = await executePrompt(prompt, ai)
    const parsed = extractJson<{ title: string; body: string }>(response)

    return {
      $id: `landing-${Date.now()}`,
      type: 'landing-page',
      title: parsed?.title || product.tagline,
      body: parsed?.body || `# ${narrative.hook}\n\n## The Problem\n${narrative.problem}\n\n## The Solution\n${narrative.solution}\n\n## Transform Your Work\n${narrative.transformation}\n\n## Get Started\n${narrative.callToAction}`,
      status: 'draft',
    }
  }

  // Optimize messaging
  agent.optimizeMessaging = async (metrics: ContentMetrics, abResults: unknown): Promise<string> => {
    const prompt = `Analyze these campaign metrics and suggest optimizations:

Campaign Metrics:
- Views: ${metrics.views}
- Clicks: ${metrics.clicks}
- Engagement Rate: ${metrics.engagementRate.toFixed(1)}%
- Conversions: ${metrics.conversions}

A/B Test Results: ${JSON.stringify(abResults)}

Suggest:
1. Which variant is performing better and why
2. Specific changes to improve metrics
3. New messaging angles to test`

    return executePrompt(prompt, ai)
  }

  return agent
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

/**
 * Default Mark agent (uses mock responses without AI)
 * For production, use createMark(env.AI) with Cloudflare AI binding
 */
export const mark = createMark()

export default mark

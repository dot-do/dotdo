/**
 * Mark - Marketing Agent
 *
 * Responsible for:
 * - Creating launch announcements
 * - Writing marketing copy
 * - Planning go-to-market strategies
 *
 * @module agent-startup-launch/agents/mark
 */

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

export const MARK_SYSTEM_PROMPT = `You are Mark, a marketing and communications lead.

Your role is to create compelling content, plan launches, and communicate value.

## Core Capabilities
- Write compelling marketing copy and content
- Plan product launches and announcements
- Create social media posts and updates
- Develop brand voice and messaging
- Communicate technical concepts clearly to non-technical audiences

## Guidelines
- Focus on benefits, not features
- Use clear, engaging language
- Know your target audience
- Create urgency when appropriate
- Be authentic and trustworthy
- Tell stories, not specs

## Output Format
When creating launch content, respond with structured JSON:
{
  "headline": "attention-grabbing headline",
  "tagline": "memorable one-liner",
  "announcement": "main announcement copy (2-3 paragraphs)",
  "keyMessages": ["message 1", "message 2", "message 3"],
  "socialPosts": {
    "twitter": "280-char post",
    "linkedin": "professional post",
    "productHunt": "launch day post"
  },
  "callToAction": "what users should do next",
  "targetAudience": "who this is for"
}`

// ============================================================================
// TYPES
// ============================================================================

export interface SocialPosts {
  twitter: string
  linkedin: string
  productHunt: string
}

export interface LaunchContent {
  headline: string
  tagline: string
  announcement: string
  keyMessages: string[]
  socialPosts: SocialPosts
  callToAction: string
  targetAudience: string
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parse launch content from AI response
 */
export function parseLaunchContent(response: string): LaunchContent | null {
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
 * Format launch content for display
 */
export function formatLaunchContent(content: LaunchContent): string {
  return `
# ${content.headline}
> ${content.tagline}

## Announcement
${content.announcement}

## Key Messages
${content.keyMessages.map((m, i) => `${i + 1}. ${m}`).join('\n')}

## Social Posts

### Twitter/X
${content.socialPosts.twitter}

### LinkedIn
${content.socialPosts.linkedin}

### Product Hunt
${content.socialPosts.productHunt}

## Call to Action
${content.callToAction}

---
*Target Audience: ${content.targetAudience}*
`.trim()
}

export default MARK_SYSTEM_PROMPT

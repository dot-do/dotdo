/**
 * Agent Launch Campaign Worker
 *
 * Mark (Marketing) + Sally (Sales) teamwork:
 * AI agents handle your entire product launch while you have breakfast.
 *
 * @example
 * ```ts
 * import { mark, sally } from 'agents.do'
 *
 * const product = { name: 'TaxAI', tagline: 'Taxes done while you code' }
 *
 * // Mark writes the launch story
 * const narrative = await mark`write launch story for ${product}`
 * const blog = await mark`write blog post from ${narrative}`
 * const social = await mark`create social campaign from ${narrative}`
 *
 * // Sally personalizes outreach for every lead
 * const leads = await $.CRM.leads.where({ status: 'qualified' })
 * const emails = await Promise.all(
 *   leads.map(lead => sally`write personalized email to ${lead} about ${product}`)
 * )
 *
 * // Send and optimize
 * await $.Email.send(emails)
 *
 * $.every.day.at('9am')(async () => {
 *   const metrics = await $.Analytics.campaign('launch')
 *   await mark`optimize messaging based on ${metrics}`
 * })
 * ```
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { LaunchCampaignDO, type CampaignConfig, type Lead } from './LaunchCampaignDO'

// Re-export agents for direct use
export { mark, createMark } from './agents/mark'
export { sally, createSally } from './agents/sally'

// Re-export workflow
export { createLaunchWorkflow, launchWorkflow } from './workflows/launch'

// Re-export DO
export { LaunchCampaignDO }

// Re-export types
export type {
  Product,
  Narrative,
  Content,
  ContentMetrics,
  Lead,
  OutreachSequence,
  OutreachEmail,
  CampaignConfig,
  CampaignState,
  CampaignMetrics,
} from './types'

// ============================================================================
// TYPES
// ============================================================================

interface Env {
  CAMPAIGN: DurableObjectNamespace
  AI?: Ai
}

// ============================================================================
// APP
// ============================================================================

const app = new Hono<{ Bindings: Env }>()

// Middleware
app.use('*', cors())

// ============================================================================
// ROUTES
// ============================================================================

/**
 * Landing page with API documentation
 */
app.get('/', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Agent Launch Campaign - Mark + Sally</title>
  <style>
    :root { --bg: #0a0a0a; --fg: #fafafa; --accent: #f97316; --accent2: #8b5cf6; --muted: #71717a; --code-bg: #1f1f1f; }
    body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--fg); margin: 0; padding: 2rem; line-height: 1.8; max-width: 900px; margin: 0 auto; }
    h1 { font-size: 2.5rem; margin-bottom: 0; }
    .tagline { font-size: 1.5rem; color: var(--accent); margin: 0.5rem 0 2rem 0; font-weight: 600; }
    .hero { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 2rem; border-radius: 12px; margin: 2rem 0; border: 1px solid #333; }
    .hero pre { background: var(--code-bg); padding: 1.5rem; border-radius: 8px; overflow-x: auto; font-size: 0.9rem; line-height: 1.6; }
    .hero code { color: #e2e8f0; }
    .comment { color: #6b7280; }
    .keyword { color: #c084fc; }
    .string { color: #86efac; }
    .variable { color: #93c5fd; }
    .function { color: #fbbf24; }
    .result { margin-top: 1.5rem; padding: 1rem; background: rgba(249, 115, 22, 0.1); border-left: 4px solid var(--accent); border-radius: 4px; }
    .result-text { font-size: 1.25rem; font-weight: 600; color: var(--accent); }
    h2 { color: var(--accent2); margin-top: 3rem; }
    .agents { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin: 2rem 0; }
    .agent { background: var(--code-bg); padding: 1.5rem; border-radius: 8px; border-top: 3px solid; }
    .agent.mark { border-color: var(--accent); }
    .agent.sally { border-color: var(--accent2); }
    .agent h3 { margin: 0 0 0.5rem 0; }
    .agent p { margin: 0; color: var(--muted); font-size: 0.9rem; }
    .endpoints { background: var(--code-bg); padding: 1.5rem; border-radius: 8px; margin: 2rem 0; }
    .endpoint { padding: 0.75rem 0; border-bottom: 1px solid #333; }
    .endpoint:last-child { border-bottom: none; }
    .endpoint code { background: #2a2a2a; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.85rem; }
    .endpoint .method { color: var(--accent); font-weight: 600; margin-right: 0.5rem; }
    pre.install { background: var(--code-bg); padding: 1rem; border-radius: 8px; overflow-x: auto; }
    footer { margin-top: 4rem; color: var(--muted); border-top: 1px solid #333; padding-top: 1rem; text-align: center; }
    a { color: var(--accent); }
  </style>
</head>
<body>
  <h1>Agent Launch Campaign</h1>
  <p class="tagline">Launch day handled. You just showed up.</p>

  <div class="hero">
    <pre><code><span class="comment">// Mark writes the launch story. Sally handles outreach.</span>
<span class="keyword">const</span> <span class="variable">narrative</span> = <span class="keyword">await</span> mark<span class="string">\`write launch story for \${product}\`</span>
<span class="keyword">const</span> <span class="variable">blog</span> = <span class="keyword">await</span> mark<span class="string">\`write blog post from \${narrative}\`</span>
<span class="keyword">const</span> <span class="variable">social</span> = <span class="keyword">await</span> mark<span class="string">\`create social campaign from \${narrative}\`</span>

<span class="comment">// Sally personalizes outreach for every lead</span>
<span class="keyword">const</span> <span class="variable">emails</span> = <span class="keyword">await</span> Promise.<span class="function">all</span>(
  leads.<span class="function">map</span>(<span class="variable">lead</span> => sally<span class="string">\`write email to \${lead} about \${product}\`</span>)
)

<span class="comment">// Send and optimize daily</span>
$.<span class="function">every</span>.<span class="function">day</span>.<span class="function">at</span>(<span class="string">'9am'</span>)(<span class="keyword">async</span> () => {
  <span class="keyword">await</span> mark<span class="string">\`optimize messaging based on \${metrics}\`</span>
})</code></pre>
    <div class="result">
      <span class="result-text">Your product launched. 47 personalized emails sent. You had breakfast.</span>
    </div>
  </div>

  <h2>The Agents</h2>
  <div class="agents">
    <div class="agent mark">
      <h3>Mark - Marketing</h3>
      <p>Creates the launch narrative, writes all content (blog, social, landing pages), A/B tests messaging, optimizes based on metrics.</p>
    </div>
    <div class="agent sally">
      <h3>Sally - Sales</h3>
      <p>Generates personalized outreach sequences for every lead, handles follow-ups, tracks engagement, qualifies prospects.</p>
    </div>
  </div>

  <h2>API Endpoints</h2>
  <div class="endpoints">
    <div class="endpoint">
      <span class="method">POST</span><code>/campaigns</code>
      <p style="margin: 0.5rem 0 0 0; color: var(--muted);">Create a new campaign with product info</p>
    </div>
    <div class="endpoint">
      <span class="method">GET</span><code>/campaigns/:id</code>
      <p style="margin: 0.5rem 0 0 0; color: var(--muted);">Get campaign state</p>
    </div>
    <div class="endpoint">
      <span class="method">POST</span><code>/campaigns/:id/workflow</code>
      <p style="margin: 0.5rem 0 0 0; color: var(--muted);">Execute full launch workflow</p>
    </div>
    <div class="endpoint">
      <span class="method">POST</span><code>/campaigns/:id/narrative</code>
      <p style="margin: 0.5rem 0 0 0; color: var(--muted);">Generate launch narrative (Mark)</p>
    </div>
    <div class="endpoint">
      <span class="method">POST</span><code>/campaigns/:id/content</code>
      <p style="margin: 0.5rem 0 0 0; color: var(--muted);">Generate all content (Mark)</p>
    </div>
    <div class="endpoint">
      <span class="method">POST</span><code>/campaigns/:id/leads</code>
      <p style="margin: 0.5rem 0 0 0; color: var(--muted);">Add leads to campaign</p>
    </div>
    <div class="endpoint">
      <span class="method">POST</span><code>/campaigns/:id/outreach</code>
      <p style="margin: 0.5rem 0 0 0; color: var(--muted);">Generate outreach for all leads (Sally)</p>
    </div>
    <div class="endpoint">
      <span class="method">POST</span><code>/campaigns/:id/launch</code>
      <p style="margin: 0.5rem 0 0 0; color: var(--muted);">Launch the campaign</p>
    </div>
    <div class="endpoint">
      <span class="method">GET</span><code>/campaigns/:id/metrics</code>
      <p style="margin: 0.5rem 0 0 0; color: var(--muted);">Get campaign metrics</p>
    </div>
    <div class="endpoint">
      <span class="method">POST</span><code>/campaigns/:id/optimize</code>
      <p style="margin: 0.5rem 0 0 0; color: var(--muted);">Get optimization recommendations (Mark)</p>
    </div>
  </div>

  <h2>Try It</h2>
  <pre class="install"><code># Create a campaign
curl -X POST https://agent-launch-campaign.workers.dev/campaigns \\
  -H "Content-Type: application/json" \\
  -d '{
    "product": {
      "name": "TaxAI",
      "tagline": "Taxes done while you code",
      "targetAudience": "Developers and indie hackers"
    },
    "abTestingEnabled": true
  }'

# Execute full workflow (Mark + Sally collaboration)
curl -X POST https://agent-launch-campaign.workers.dev/campaigns/{id}/workflow

# Or step by step...
curl -X POST .../campaigns/{id}/narrative
curl -X POST .../campaigns/{id}/content
curl -X POST .../campaigns/{id}/leads -d '{"leads": [...]}'
curl -X POST .../campaigns/{id}/outreach
curl -X POST .../campaigns/{id}/launch</code></pre>

  <footer>
    <p>Part of <a href="https://dotdo.dev">dotdo</a> - Build your 1-Person Unicorn</p>
    <p>Powered by Mark + Sally from <a href="https://agents.do">agents.do</a></p>
  </footer>
</body>
</html>
  `)
})

/**
 * Health check
 */
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'agent-launch-campaign',
    version: '1.0.0',
    agents: ['mark', 'sally'],
  })
})

/**
 * Create a new campaign
 */
app.post('/campaigns', async (c) => {
  const config = await c.req.json<CampaignConfig>()

  if (!config.product?.name || !config.product?.tagline) {
    return c.json({ error: 'Product name and tagline are required' }, 400)
  }

  // Create a new campaign DO
  const id = c.env.CAMPAIGN.newUniqueId()
  const stub = c.env.CAMPAIGN.get(id)

  // Initialize the campaign
  const state = await (stub as unknown as LaunchCampaignDO).create(config)

  return c.json({
    id: id.toString(),
    ...state,
  }, 201)
})

/**
 * Get campaign state
 */
app.get('/campaigns/:id', async (c) => {
  const campaignId = c.req.param('id')

  try {
    const id = c.env.CAMPAIGN.idFromString(campaignId)
    const stub = c.env.CAMPAIGN.get(id)
    const state = await (stub as unknown as LaunchCampaignDO).getState()

    return c.json({ id: campaignId, ...state })
  } catch (error) {
    return c.json({ error: 'Campaign not found' }, 404)
  }
})

/**
 * Execute full launch workflow
 */
app.post('/campaigns/:id/workflow', async (c) => {
  const campaignId = c.req.param('id')

  try {
    const id = c.env.CAMPAIGN.idFromString(campaignId)
    const stub = c.env.CAMPAIGN.get(id)
    const state = await (stub as unknown as LaunchCampaignDO).executeWorkflow()

    return c.json({
      message: 'Workflow executed successfully',
      campaign: state,
    })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

/**
 * Get workflow progress
 */
app.get('/campaigns/:id/workflow/progress', async (c) => {
  const campaignId = c.req.param('id')

  try {
    const id = c.env.CAMPAIGN.idFromString(campaignId)
    const stub = c.env.CAMPAIGN.get(id)
    const progress = await (stub as unknown as LaunchCampaignDO).getWorkflowProgress()

    return c.json(progress)
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

/**
 * Generate launch narrative
 */
app.post('/campaigns/:id/narrative', async (c) => {
  const campaignId = c.req.param('id')

  try {
    const id = c.env.CAMPAIGN.idFromString(campaignId)
    const stub = c.env.CAMPAIGN.get(id)
    const narrative = await (stub as unknown as LaunchCampaignDO).generateNarrative()

    return c.json(narrative)
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

/**
 * Generate all content
 */
app.post('/campaigns/:id/content', async (c) => {
  const campaignId = c.req.param('id')

  try {
    const id = c.env.CAMPAIGN.idFromString(campaignId)
    const stub = c.env.CAMPAIGN.get(id)
    const content = await (stub as unknown as LaunchCampaignDO).generateAllContent()

    return c.json({ content, count: content.length })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

/**
 * Generate blog post (optionally with A/B variant)
 */
app.post('/campaigns/:id/content/blog', async (c) => {
  const campaignId = c.req.param('id')
  const body = await c.req.json<{ variant?: 'A' | 'B' }>().catch(() => ({} as { variant?: 'A' | 'B' }))
  const variant = body.variant

  try {
    const id = c.env.CAMPAIGN.idFromString(campaignId)
    const stub = c.env.CAMPAIGN.get(id)
    const blog = await (stub as unknown as LaunchCampaignDO).generateBlogPost({ variant })

    return c.json(blog)
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

/**
 * Generate social content
 */
app.post('/campaigns/:id/content/social', async (c) => {
  const campaignId = c.req.param('id')

  try {
    const id = c.env.CAMPAIGN.idFromString(campaignId)
    const stub = c.env.CAMPAIGN.get(id)
    const social = await (stub as unknown as LaunchCampaignDO).generateSocialContent()

    return c.json({ content: social })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

/**
 * Generate landing page
 */
app.post('/campaigns/:id/content/landing', async (c) => {
  const campaignId = c.req.param('id')

  try {
    const id = c.env.CAMPAIGN.idFromString(campaignId)
    const stub = c.env.CAMPAIGN.get(id)
    const landing = await (stub as unknown as LaunchCampaignDO).generateLandingPage()

    return c.json(landing)
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

/**
 * Add leads to campaign
 */
app.post('/campaigns/:id/leads', async (c) => {
  const campaignId = c.req.param('id')
  const { leads } = await c.req.json<{ leads: Omit<Lead, '$id' | 'status'>[] }>()

  if (!leads || !Array.isArray(leads)) {
    return c.json({ error: 'leads array is required' }, 400)
  }

  try {
    const id = c.env.CAMPAIGN.idFromString(campaignId)
    const stub = c.env.CAMPAIGN.get(id)
    const addedLeads = await (stub as unknown as LaunchCampaignDO).addLeads(leads)

    return c.json({ leads: addedLeads, count: addedLeads.length })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

/**
 * Generate outreach for all leads
 */
app.post('/campaigns/:id/outreach', async (c) => {
  const campaignId = c.req.param('id')

  try {
    const id = c.env.CAMPAIGN.idFromString(campaignId)
    const stub = c.env.CAMPAIGN.get(id)
    const outreach = await (stub as unknown as LaunchCampaignDO).generateAllOutreach()

    return c.json({ sequences: outreach, count: outreach.length })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

/**
 * Generate outreach for a specific lead
 */
app.post('/campaigns/:id/outreach/:leadId', async (c) => {
  const campaignId = c.req.param('id')
  const leadId = c.req.param('leadId')

  try {
    const id = c.env.CAMPAIGN.idFromString(campaignId)
    const stub = c.env.CAMPAIGN.get(id)
    const sequence = await (stub as unknown as LaunchCampaignDO).generateOutreachForLead(leadId)

    return c.json(sequence)
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

/**
 * Generate A/B outreach variants for a lead
 */
app.post('/campaigns/:id/outreach/:leadId/variants', async (c) => {
  const campaignId = c.req.param('id')
  const leadId = c.req.param('leadId')

  try {
    const id = c.env.CAMPAIGN.idFromString(campaignId)
    const stub = c.env.CAMPAIGN.get(id)
    const variants = await (stub as unknown as LaunchCampaignDO).generateOutreachVariants(leadId)

    return c.json({ variants })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

/**
 * Launch the campaign
 */
app.post('/campaigns/:id/launch', async (c) => {
  const campaignId = c.req.param('id')

  try {
    const id = c.env.CAMPAIGN.idFromString(campaignId)
    const stub = c.env.CAMPAIGN.get(id)
    const state = await (stub as unknown as LaunchCampaignDO).launch()

    return c.json({
      message: 'Campaign launched!',
      launchedAt: state.launchedAt,
      contentPublished: state.content.filter(c => c.status === 'published').length,
      outreachActive: state.outreach.filter(o => o.status === 'active').length,
    })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

/**
 * Get campaign metrics
 */
app.get('/campaigns/:id/metrics', async (c) => {
  const campaignId = c.req.param('id')

  try {
    const id = c.env.CAMPAIGN.idFromString(campaignId)
    const stub = c.env.CAMPAIGN.get(id)
    const metrics = await (stub as unknown as LaunchCampaignDO).getMetrics()

    return c.json(metrics)
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

/**
 * Get A/B test results
 */
app.get('/campaigns/:id/ab-results', async (c) => {
  const campaignId = c.req.param('id')

  try {
    const id = c.env.CAMPAIGN.idFromString(campaignId)
    const stub = c.env.CAMPAIGN.get(id)
    const results = await (stub as unknown as LaunchCampaignDO).getABTestResults()

    return c.json(results)
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

/**
 * Optimize messaging based on metrics
 */
app.post('/campaigns/:id/optimize', async (c) => {
  const campaignId = c.req.param('id')

  try {
    const id = c.env.CAMPAIGN.idFromString(campaignId)
    const stub = c.env.CAMPAIGN.get(id)
    const optimization = await (stub as unknown as LaunchCampaignDO).optimizeMessaging()

    return c.json({ recommendations: optimization })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

/**
 * Tracking webhooks
 */
app.post('/campaigns/:id/track/open', async (c) => {
  const campaignId = c.req.param('id')
  const { sequenceId, step } = await c.req.json<{ sequenceId: string; step: number }>()

  try {
    const id = c.env.CAMPAIGN.idFromString(campaignId)
    const stub = c.env.CAMPAIGN.get(id)
    await (stub as unknown as LaunchCampaignDO).recordOpen(sequenceId, step)

    return c.json({ recorded: true })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

app.post('/campaigns/:id/track/click', async (c) => {
  const campaignId = c.req.param('id')
  const { sequenceId, step } = await c.req.json<{ sequenceId: string; step: number }>()

  try {
    const id = c.env.CAMPAIGN.idFromString(campaignId)
    const stub = c.env.CAMPAIGN.get(id)
    await (stub as unknown as LaunchCampaignDO).recordClick(sequenceId, step)

    return c.json({ recorded: true })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

app.post('/campaigns/:id/track/reply', async (c) => {
  const campaignId = c.req.param('id')
  const { sequenceId, step } = await c.req.json<{ sequenceId: string; step: number }>()

  try {
    const id = c.env.CAMPAIGN.idFromString(campaignId)
    const stub = c.env.CAMPAIGN.get(id)
    await (stub as unknown as LaunchCampaignDO).recordReply(sequenceId, step)

    return c.json({ recorded: true })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

app.post('/campaigns/:id/track/conversion', async (c) => {
  const campaignId = c.req.param('id')
  const { leadId } = await c.req.json<{ leadId: string }>()

  try {
    const id = c.env.CAMPAIGN.idFromString(campaignId)
    const stub = c.env.CAMPAIGN.get(id)
    await (stub as unknown as LaunchCampaignDO).recordConversion(leadId)

    return c.json({ recorded: true })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

// ============================================================================
// EXPORTS
// ============================================================================

export default app

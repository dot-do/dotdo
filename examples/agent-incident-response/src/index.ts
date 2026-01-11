/**
 * Agent Incident Response - Worker Entry Point
 *
 * Routes incoming alerts to the IncidentResponseDO for AI-powered
 * incident response with Ralph, Tom, and Quinn.
 */

import { Hono } from 'hono'
import { IncidentResponseDO, type Alert, type Incident } from './IncidentResponseDO'

// Export the DO class for Wrangler
export { IncidentResponseDO }

// Types
interface Env {
  INCIDENT_RESPONSE_DO: DurableObjectNamespace
  ENVIRONMENT: string
}

// Create Hono app
const app = new Hono<{ Bindings: Env }>()

// ============================================================================
// MIDDLEWARE
// ============================================================================

// Request logging
app.use('*', async (c, next) => {
  const start = Date.now()
  await next()
  const duration = Date.now() - start
  console.log(`${c.req.method} ${c.req.path} - ${c.res.status} (${duration}ms)`)
})

// ============================================================================
// ROUTES
// ============================================================================

/**
 * Health check
 */
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'agent-incident-response',
    environment: c.env.ENVIRONMENT,
    timestamp: new Date().toISOString(),
  })
})

/**
 * Receive alert from monitoring systems (Datadog, PagerDuty, etc.)
 *
 * POST /alerts
 * {
 *   "service": "api-gateway",
 *   "severity": "critical",
 *   "summary": "Error rate > 5%",
 *   "description": "...",
 *   "source": "datadog"
 * }
 */
app.post('/alerts', async (c) => {
  const body = await c.req.json<Omit<Alert, 'id' | 'timestamp'>>()

  // Validate required fields
  if (!body.service || !body.severity || !body.summary) {
    return c.json(
      { error: 'Missing required fields: service, severity, summary' },
      400
    )
  }

  // Validate severity
  const validSeverities = ['critical', 'high', 'medium', 'low']
  if (!validSeverities.includes(body.severity)) {
    return c.json(
      { error: `Invalid severity. Must be one of: ${validSeverities.join(', ')}` },
      400
    )
  }

  // Build alert
  const alert: Alert = {
    id: crypto.randomUUID().slice(0, 8),
    service: body.service,
    severity: body.severity,
    summary: body.summary,
    description: body.description || body.summary,
    timestamp: new Date(),
    source: body.source || 'custom',
    metrics: body.metrics,
    context: body.context,
  }

  // Get or create the incident response DO
  const id = c.env.INCIDENT_RESPONSE_DO.idFromName('main')
  const stub = c.env.INCIDENT_RESPONSE_DO.get(id) as unknown as IncidentResponseDO

  // Handle alert based on severity
  if (alert.severity === 'critical' || alert.severity === 'high') {
    // Critical/High: Trigger full automated response
    const incident = await stub.handleCriticalAlert(alert)

    return c.json({
      message: 'Incident response initiated',
      incidentId: incident.id,
      status: incident.status,
      alert: {
        id: alert.id,
        severity: alert.severity,
        service: alert.service,
      },
    }, 201)
  } else {
    // Medium/Low: Log and acknowledge
    console.log(`[Alert] ${alert.severity.toUpperCase()}: ${alert.summary}`)

    return c.json({
      message: 'Alert acknowledged',
      alert: {
        id: alert.id,
        severity: alert.severity,
        service: alert.service,
      },
      note: 'Non-critical alerts logged but not triggering automated response',
    }, 200)
  }
})

/**
 * List incidents
 *
 * GET /incidents
 * GET /incidents?status=resolved
 */
app.get('/incidents', async (c) => {
  const status = c.req.query('status') as Incident['status'] | undefined

  const id = c.env.INCIDENT_RESPONSE_DO.idFromName('main')
  const stub = c.env.INCIDENT_RESPONSE_DO.get(id) as unknown as IncidentResponseDO

  const incidents = await stub.listIncidents(status ? { status } : undefined)

  return c.json({
    count: incidents.length,
    incidents: incidents.map((i) => ({
      id: i.id,
      status: i.status,
      service: i.alert.service,
      severity: i.alert.severity,
      summary: i.alert.summary,
      createdAt: i.createdAt,
      resolvedAt: i.resolvedAt,
      escalatedAt: i.escalatedAt,
    })),
  })
})

/**
 * Get incident details
 *
 * GET /incidents/:id
 */
app.get('/incidents/:id', async (c) => {
  const incidentId = c.req.param('id')

  const id = c.env.INCIDENT_RESPONSE_DO.idFromName('main')
  const stub = c.env.INCIDENT_RESPONSE_DO.get(id) as unknown as IncidentResponseDO

  const incident = await stub.getIncident(incidentId)

  if (!incident) {
    return c.json({ error: 'Incident not found' }, 404)
  }

  return c.json(incident)
})

/**
 * Manually escalate an incident
 *
 * POST /incidents/:id/escalate
 * { "reason": "Need human review for sensitive data" }
 */
app.post('/incidents/:id/escalate', async (c) => {
  const incidentId = c.req.param('id')
  const { reason } = await c.req.json<{ reason: string }>()

  if (!reason) {
    return c.json({ error: 'Reason is required for escalation' }, 400)
  }

  const id = c.env.INCIDENT_RESPONSE_DO.idFromName('main')
  const stub = c.env.INCIDENT_RESPONSE_DO.get(id) as unknown as IncidentResponseDO

  try {
    await stub.escalate(incidentId, reason)
    return c.json({ message: 'Incident escalated', incidentId })
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return c.json({ error: 'Incident not found' }, 404)
    }
    throw error
  }
})

/**
 * Manually resolve an incident
 *
 * POST /incidents/:id/resolve
 * { "resolution": "Deployed hotfix manually after review" }
 */
app.post('/incidents/:id/resolve', async (c) => {
  const incidentId = c.req.param('id')
  const { resolution } = await c.req.json<{ resolution: string }>()

  if (!resolution) {
    return c.json({ error: 'Resolution description is required' }, 400)
  }

  const id = c.env.INCIDENT_RESPONSE_DO.idFromName('main')
  const stub = c.env.INCIDENT_RESPONSE_DO.get(id) as unknown as IncidentResponseDO

  try {
    await stub.resolve(incidentId, resolution)
    return c.json({ message: 'Incident resolved', incidentId })
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return c.json({ error: 'Incident not found' }, 404)
    }
    throw error
  }
})

/**
 * Webhook for Datadog alerts
 *
 * POST /webhooks/datadog
 */
app.post('/webhooks/datadog', async (c) => {
  const body = await c.req.json<{
    title: string
    body: string
    alertType: string
    scope: string
    priority?: string
    hostname?: string
  }>()

  // Map Datadog priority to our severity
  const severityMap: Record<string, Alert['severity']> = {
    P1: 'critical',
    P2: 'high',
    P3: 'medium',
    P4: 'low',
  }

  const alert: Alert = {
    id: crypto.randomUUID().slice(0, 8),
    service: body.scope || 'unknown',
    severity: severityMap[body.priority || ''] || 'medium',
    summary: body.title,
    description: body.body,
    timestamp: new Date(),
    source: 'datadog',
    context: {
      alertType: body.alertType,
      hostname: body.hostname,
    },
  }

  // Forward to main alert handler
  const id = c.env.INCIDENT_RESPONSE_DO.idFromName('main')
  const stub = c.env.INCIDENT_RESPONSE_DO.get(id) as unknown as IncidentResponseDO

  if (alert.severity === 'critical' || alert.severity === 'high') {
    const incident = await stub.handleCriticalAlert(alert)
    return c.json({ incidentId: incident.id, status: incident.status })
  }

  return c.json({ message: 'Alert acknowledged', alertId: alert.id })
})

/**
 * Webhook for PagerDuty alerts
 *
 * POST /webhooks/pagerduty
 */
app.post('/webhooks/pagerduty', async (c) => {
  const body = await c.req.json<{
    messages: Array<{
      incident: {
        id: string
        title: string
        urgency: 'high' | 'low'
        service: { name: string }
        description?: string
      }
    }>
  }>()

  const responses = []

  for (const message of body.messages) {
    const { incident: pdIncident } = message

    const alert: Alert = {
      id: pdIncident.id.slice(0, 8),
      service: pdIncident.service.name,
      severity: pdIncident.urgency === 'high' ? 'critical' : 'medium',
      summary: pdIncident.title,
      description: pdIncident.description || pdIncident.title,
      timestamp: new Date(),
      source: 'pagerduty',
    }

    const id = c.env.INCIDENT_RESPONSE_DO.idFromName('main')
    const stub = c.env.INCIDENT_RESPONSE_DO.get(id) as unknown as IncidentResponseDO

    if (alert.severity === 'critical') {
      const incident = await stub.handleCriticalAlert(alert)
      responses.push({ incidentId: incident.id, status: incident.status })
    } else {
      responses.push({ message: 'Alert acknowledged', alertId: alert.id })
    }
  }

  return c.json({ processed: responses.length, responses })
})

// ============================================================================
// ERROR HANDLING
// ============================================================================

app.onError((err, c) => {
  console.error('Unhandled error:', err)
  return c.json(
    {
      error: 'Internal server error',
      message: c.env.ENVIRONMENT === 'development' ? err.message : undefined,
    },
    500
  )
})

app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404)
})

// Export the app
export default app

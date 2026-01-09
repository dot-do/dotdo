import { Hono } from 'hono'
import { HUNCHMetrics } from '../metrics/hunch'
import type { Env } from './types'

/**
 * HUNCH Metrics API Routes
 *
 * Provides endpoints for accessing HUNCH metrics:
 * - GET /hunch - Get complete HUNCH dashboard data
 * - GET /hunch/nps - Get NPS metrics
 * - GET /hunch/churn - Get churn metrics
 * - GET /hunch/ltv-cac - Get LTV/CAC metrics
 * - GET /hunch/alerts - Get current metric alerts
 */

export const hunchRoutes = new Hono<{ Bindings: Env }>()

// Get complete HUNCH dashboard
hunchRoutes.get('/', async (c) => {
  const dashboard = await HUNCHMetrics.getHUNCHDashboard()
  return c.json(dashboard)
})

// Get NPS metrics
hunchRoutes.get('/nps', async (c) => {
  const days = parseInt(c.req.query('days') || '30', 10)
  const trend = await HUNCHMetrics.getNPSTrend(days)
  return c.json({
    trend,
    latest: trend[trend.length - 1] || null,
  })
})

// Get churn metrics
hunchRoutes.get('/churn', async (c) => {
  const now = new Date()
  const monthlyChurnRate = await HUNCHMetrics.calculateChurnRate({
    start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
    end: now,
  })

  return c.json({
    monthlyChurnRate,
    annualChurnRate: 1 - Math.pow(1 - monthlyChurnRate, 12),
  })
})

// Get LTV/CAC metrics
hunchRoutes.get('/ltv-cac', async (c) => {
  const segment = c.req.query('segment')
  const ratio = await HUNCHMetrics.calculateLTVCACRatio(segment || undefined)
  return c.json(ratio)
})

// Get current alerts
hunchRoutes.get('/alerts', async (c) => {
  const alerts = await HUNCHMetrics.checkThresholds()
  return c.json({ alerts })
})

// Get customer LTV
hunchRoutes.get('/customers/:customerId/ltv', async (c) => {
  const customerId = c.req.param('customerId')
  const ltv = await HUNCHMetrics.calculateCustomerLTV(customerId)
  return c.json(ltv)
})

// Get customer churn prediction
hunchRoutes.get('/customers/:customerId/churn-prediction', async (c) => {
  const customerId = c.req.param('customerId')
  const prediction = await HUNCHMetrics.predictChurn(customerId)
  return c.json(prediction)
})

// Get experiment significance
hunchRoutes.get('/experiments/:experimentId/significance', async (c) => {
  const experimentId = c.req.param('experimentId')
  const metric = c.req.query('metric') || 'conversion_rate'
  const variant = c.req.query('variant') || 'variant_a'
  const control = c.req.query('control') || 'control'

  const result = await HUNCHMetrics.calculateSignificance(experimentId, metric, variant, control)
  return c.json(result)
})

// Calculate required sample size
hunchRoutes.get('/sample-size', (c) => {
  const baseline = parseFloat(c.req.query('baseline') || '0.05')
  const mde = parseFloat(c.req.query('mde') || '0.20')
  const power = parseFloat(c.req.query('power') || '0.80')
  const significance = parseFloat(c.req.query('significance') || '0.05')

  const sampleSize = HUNCHMetrics.calculateSampleSize(baseline, mde, power, significance)
  return c.json({ sampleSize })
})

export default hunchRoutes

import { defineNoun } from '../types'
import { IntegrationSchema } from 'digital-tools'

/**
 * Integration - External service connection (Stripe, Slack, GitHub, etc.)
 *
 * Integrations represent connections to third-party APIs and services,
 * providing standardized access to external platforms like payment processors,
 * code repositories, communication tools, and cloud services.
 *
 * Integrations differ from Tools in that they represent persistent connections
 * to external services that may require authentication and maintain state.
 *
 * @see https://schema.org.ai/Integration
 */
export const Integration = defineNoun({
  noun: 'Integration',
  plural: 'Integrations',
  $type: 'https://schema.org.ai/Integration',
  schema: IntegrationSchema,
})

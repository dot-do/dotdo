import { z } from 'zod'
import { defineNoun } from '../types'
import { CurrencySchema, TimePeriodSchema } from './Business'

/**
 * Service pricing model
 */
export const ServicePricingModelSchema = z.enum([
  'hourly',
  'fixed',
  'retainer',
  'value-based',
  'subscription',
  'milestone',
  'success-fee',
  'hybrid',
])
export type ServicePricingModel = z.infer<typeof ServicePricingModelSchema>

/**
 * Service category
 */
export const ServiceCategorySchema = z.enum([
  'consulting',
  'professional',
  'creative',
  'technical',
  'maintenance',
  'support',
  'training',
  'managed',
  'advisory',
  'implementation',
  'custom',
])
export type ServiceCategory = z.infer<typeof ServiceCategorySchema>

/**
 * Service level agreement schema
 */
export const ServiceLevelAgreementSchema = z.object({
  uptime: z.number().optional(),
  responseTime: z.string().optional(),
  resolutionTime: z.string().optional(),
  supportHours: z.string().optional(),
  supportChannels: z.array(z.enum(['email', 'phone', 'chat', 'ticket', 'slack'])).optional(),
  penalties: z.string().optional(),
  credits: z.number().optional(),
})
export type ServiceLevelAgreement = z.infer<typeof ServiceLevelAgreementSchema>

/**
 * Service deliverable schema
 */
export const ServiceDeliverableSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  estimatedDuration: z.string().optional(),
  dependencies: z.array(z.string()).optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
})
export type ServiceDeliverable = z.infer<typeof ServiceDeliverableSchema>

/**
 * Service-specific metrics schema
 */
export const ServiceMetricsSchema = z.object({
  // Utilization metrics
  utilization: z.number().optional(),
  billableHours: z.number().optional(),
  nonBillableHours: z.number().optional(),
  billableRate: z.number().optional(),

  // Revenue metrics
  revenue: z.number().optional(),
  revenuePerHour: z.number().optional(),
  averageProjectValue: z.number().optional(),
  recurringRevenue: z.number().optional(),

  // Project metrics
  activeProjects: z.number().optional(),
  completedProjects: z.number().optional(),
  projectSuccessRate: z.number().optional(),
  onTimeDeliveryRate: z.number().optional(),
  onBudgetRate: z.number().optional(),
  scopeCreepRate: z.number().optional(),

  // Client metrics
  activeClients: z.number().optional(),
  newClients: z.number().optional(),
  clientRetentionRate: z.number().optional(),
  clientSatisfaction: z.number().optional(),
  nps: z.number().optional(),
  referralRate: z.number().optional(),

  // Quality metrics
  defectRate: z.number().optional(),
  reworkRate: z.number().optional(),
  firstTimeRightRate: z.number().optional(),

  period: TimePeriodSchema.optional(),
})
export type ServiceMetrics = z.infer<typeof ServiceMetricsSchema>

/**
 * Service entity schema
 */
export const ServiceSchema = z.object({
  $id: z.string(),
  $type: z.literal('https://schema.org.ai/Service'),
  name: z.string(),
  slug: z.string().optional(),
  description: z.string().optional(),
  category: ServiceCategorySchema.optional(),
  targetSegment: z.string().optional(),
  valueProposition: z.string().optional(),

  // Pricing
  pricingModel: ServicePricingModelSchema.optional(),
  price: z.number().optional(),
  currency: CurrencySchema.optional(),
  hourlyRate: z.number().optional(),
  minimumEngagement: z.number().optional(),
  estimatedDuration: z.string().optional(),

  // Deliverables
  deliverables: z.array(ServiceDeliverableSchema).optional(),
  scope: z.string().optional(),
  outOfScope: z.array(z.string()).optional(),

  // SLA
  sla: ServiceLevelAgreementSchema.optional(),

  // Metrics
  metrics: ServiceMetricsSchema.optional(),

  // Requirements
  prerequisites: z.array(z.string()).optional(),
  requiredResources: z.array(z.string()).optional(),
  teamSize: z.number().optional(),
  skills: z.array(z.string()).optional(),

  // Status
  status: z.enum(['draft', 'active', 'paused', 'deprecated', 'retired']).optional(),
  availableFrom: z.coerce.date().optional(),
  availableUntil: z.coerce.date().optional(),

  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type ServiceType = z.infer<typeof ServiceSchema>

/**
 * Service Noun - service offering
 *
 * Represents a service with its pricing, deliverables, SLA,
 * and service-specific metrics like utilization and client satisfaction.
 */
export const Service = defineNoun({
  noun: 'Service',
  plural: 'Services',
  $type: 'https://schema.org.ai/Service',
  schema: ServiceSchema,
  extends: 'Business',
  okrs: [
    'Revenue', 'Utilization', 'BillableHours', 'BillableRate',
    'ProjectSuccessRate', 'OnTimeDelivery', 'OnBudget',
    'ClientSatisfaction', 'NPS', 'ClientRetention', 'ReferralRate',
    'ActiveProjects', 'ActiveClients', 'NewClients',
    'FirstTimeRight', 'ReworkRate',
  ],
})

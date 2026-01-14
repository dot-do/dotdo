/**
 * @module nouns
 * @description Convenient import path for Noun definitions
 *
 * Usage:
 * ```typescript
 * import { Startup, Worker, Collection, defineNoun } from 'dotdo/nouns'
 * ```
 *
 * This module re-exports all nouns from the nouns/ directory for convenient access.
 */

// Core types and utilities
export { defineNoun, Collection, type Noun } from './nouns/types'

// Core nouns
export { Thing, ThingSchema } from './nouns/core'

// Business domain nouns
export {
  Business,
  BusinessSchema,
  BusinessPlanSchema,
  CurrencySchema,
  TimePeriodSchema,
  FinancialMetricsSchema,
} from './nouns/business/Business'

export {
  Organization,
  OrganizationSchema,
} from './nouns/business/Organization'

export {
  SaaS,
  SaaSSchema,
  SaaSPricingModelSchema,
  SaaSMetricsSchema,
  PricingTierSchema,
} from './nouns/business/SaaS'

export {
  Startup,
  StartupSchema,
  FundingStageSchema,
  FundingRoundSchema,
  StartupMetricsSchema,
  InvestorSchema,
} from './nouns/business/Startup'

// Workers domain nouns
export {
  Worker,
  WorkerSchema,
  isWorker,
} from './nouns/workers/Worker'

export {
  Agent,
  AgentSchema,
  isAgent,
} from './nouns/workers/Agent'

export {
  Human,
  HumanSchema,
  isHuman,
} from './nouns/workers/Human'

export {
  Team,
  TeamSchema,
  isTeam,
} from './nouns/workers/Team'

// Products domain nouns
export * from './nouns/products'

// Identity domain nouns
export * from './nouns/identity'

// Tools domain nouns
export * from './nouns/tools'

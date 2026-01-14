/**
 * Business Domain Durable Objects
 *
 * This module exports all business-related DO classes:
 * - Organization: Top-level org structure with departments, teams, positions
 * - Business: Base business container with OKRs for Revenue, Costs, Profit
 * - DigitalBusiness: Extends Business with Traffic, Conversion, Engagement OKRs
 * - SaaS: Software-as-a-Service with MRR, Churn, NRR, CAC, LTV metrics
 * - Startup: SaaS with startup-specific metrics (Runway, Burn, GrowthRate, PMFScore)
 * - Marketplace: Two-sided marketplace with GMV, TakeRate, Liquidity metrics
 * - Service: AI-delivered Services-as-Software with task and agent management
 */

// Organization structure
export {
  Organization,
  type OrganizationConfig,
  type OrganizationSettings,
  type Department,
  type Team,
  type Position,
  type PositionRef,
  type Budget,
  type Address,
  type TeamResources,
  type TeamChannels,
  type ApprovalChain,
  type ApprovalLevel,
  type ApproverSpec,
  type EscalationRule,
  type ResourceHierarchy,
  type ResourceHierarchyNode,
} from './Organization'

// Base business class
export { Business, type BusinessConfig } from './Business'

// Digital business with online metrics
export { DigitalBusiness, type DigitalBusinessConfig } from './DigitalBusiness'

// SaaS business with subscription metrics
export {
  SaaS,
  type SaaSConfig,
  type SaaSPlan,
  type SaaSSubscription,
  type UsageRecord,
} from './SaaS'

// Startup with runway and growth metrics
export { Startup } from './Startup'

// Marketplace with GMV and liquidity metrics
export {
  Marketplace,
  type MarketplaceConfig,
  type MarketplaceSeller,
  type MarketplaceBuyer,
  type MarketplaceListing,
  type MarketplaceTransaction,
  type MarketplaceReview,
  type CommissionConfig,
} from './Marketplace'

// Service with task and agent management
export {
  Service,
  type ServiceConfig,
  type ServiceTask,
  type TaskResult,
  type TaskCompletionOptions,
  type AgentAssignment,
  type ServiceMetrics,
  type ServiceEscalationConfig,
  type EscalationOptions,
  type QualityRatingOptions,
  type PricingModel,
  type PricingTier,
} from './Service'

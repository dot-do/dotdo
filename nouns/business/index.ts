/**
 * Business Domain Nouns
 *
 * Core business entities for business-as-code primitives.
 * These nouns model business structures, SaaS metrics, marketplaces,
 * and OKR/goal tracking.
 */

// Business - core business entity
export {
  Business,
  BusinessSchema,
  BusinessPlanSchema,
  TimePeriodSchema,
  CurrencySchema,
  FinancialMetricsSchema,
  type BusinessType,
  type BusinessPlan,
  type TimePeriod,
  type Currency,
  type FinancialMetrics,
} from './Business'

// Organization - legal/structural entity
export {
  Organization,
  OrganizationSchema,
  DepartmentSchema,
  TeamSchema,
  OrganizationalStructureSchema,
  type OrganizationType,
  type Department,
  type Team,
  type OrganizationalStructure,
} from './Organization'

// DigitalBusiness - digital business with online metrics
export {
  DigitalBusiness,
  DigitalBusinessSchema,
  SocialPlatformSchema,
  SocialMediaPresenceSchema,
  OnlinePresenceStatusSchema,
  SEOMetricsSchema,
  TrafficMetricsSchema,
  ConversionMetricsSchema,
  EngagementMetricsSchema,
  type DigitalBusinessType,
  type SocialPlatform,
  type SocialMediaPresence,
  type OnlinePresenceStatus,
  type SEOMetrics,
  type TrafficMetrics,
  type ConversionMetrics,
  type EngagementMetrics,
} from './DigitalBusiness'

// SaaS - Software as a Service business
export {
  SaaS,
  SaaSSchema,
  SaaSPricingModelSchema,
  SaaSMetricsSchema,
  PricingTierSchema,
  type SaaSType,
  type SaaSPricingModel,
  type SaaSMetrics,
  type PricingTier,
} from './SaaS'

// Startup - venture-backed startup
export {
  Startup,
  StartupSchema,
  FundingStageSchema,
  FundingRoundSchema,
  StartupMetricsSchema,
  InvestorSchema,
  type StartupType,
  type FundingStage,
  type FundingRound,
  type StartupMetrics,
  type Investor,
} from './Startup'

// Marketplace - two-sided marketplace
export {
  Marketplace,
  MarketplaceSchema,
  MarketplaceTypeSchema,
  MarketplaceRevenueModelSchema,
  MarketplaceMetricsSchema,
  CommissionTierSchema,
  type MarketplaceSchemaType,
  type MarketplaceType,
  type MarketplaceRevenueModel,
  type MarketplaceMetrics,
  type CommissionTier,
} from './Marketplace'

// Service - service offering
export {
  Service,
  ServiceSchema,
  ServicePricingModelSchema,
  ServiceCategorySchema,
  ServiceLevelAgreementSchema,
  ServiceDeliverableSchema,
  ServiceMetricsSchema,
  type ServiceType,
  type ServicePricingModel,
  type ServiceCategory,
  type ServiceLevelAgreement,
  type ServiceDeliverable,
  type ServiceMetrics,
} from './Service'

// Goal/OKR - objective and key results
export {
  Goal,
  OKR,
  GoalSchema,
  GoalCategorySchema,
  GoalStatusSchema,
  KeyResultSchema,
  KPIDefinitionSchema,
  MilestoneSchema,
  type GoalType,
  type GoalCategory,
  type GoalStatus,
  type KeyResult,
  type KPIDefinition,
  type Milestone,
} from './Goal'

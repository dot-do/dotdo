import { z } from 'zod'
import { defineNoun } from '../types'
import { BusinessPlanSchema, CurrencySchema, TimePeriodSchema, FinancialMetricsSchema } from './Business'

/**
 * Social media platform types
 */
export const SocialPlatformSchema = z.enum([
  'twitter',
  'linkedin',
  'facebook',
  'instagram',
  'youtube',
  'tiktok',
  'pinterest',
  'reddit',
  'threads',
  'mastodon',
  'bluesky',
  'other',
])
export type SocialPlatform = z.infer<typeof SocialPlatformSchema>

/**
 * Social media presence schema
 */
export const SocialMediaPresenceSchema = z.object({
  platform: SocialPlatformSchema,
  handle: z.string(),
  url: z.string().url().optional(),
  followers: z.number().optional(),
  verified: z.boolean().optional(),
})
export type SocialMediaPresence = z.infer<typeof SocialMediaPresenceSchema>

/**
 * Online presence status
 */
export const OnlinePresenceStatusSchema = z.enum([
  'active',
  'inactive',
  'under-construction',
  'coming-soon',
  'deprecated',
])
export type OnlinePresenceStatus = z.infer<typeof OnlinePresenceStatusSchema>

/**
 * SEO metrics schema
 */
export const SEOMetricsSchema = z.object({
  domainAuthority: z.number().min(0).max(100).optional(),
  pageAuthority: z.number().min(0).max(100).optional(),
  backlinks: z.number().optional(),
  organicKeywords: z.number().optional(),
  organicTraffic: z.number().optional(),
  spamScore: z.number().min(0).max(100).optional(),
})
export type SEOMetrics = z.infer<typeof SEOMetricsSchema>

/**
 * Traffic metrics schema
 */
export const TrafficMetricsSchema = z.object({
  monthlyVisitors: z.number().optional(),
  uniqueVisitors: z.number().optional(),
  pageViews: z.number().optional(),
  bounceRate: z.number().optional(),
  avgSessionDuration: z.number().optional(),
  pagesPerSession: z.number().optional(),
  trafficSources: z.object({
    organic: z.number().optional(),
    direct: z.number().optional(),
    referral: z.number().optional(),
    social: z.number().optional(),
    paid: z.number().optional(),
    email: z.number().optional(),
  }).optional(),
  period: TimePeriodSchema.optional(),
})
export type TrafficMetrics = z.infer<typeof TrafficMetricsSchema>

/**
 * Conversion metrics schema
 */
export const ConversionMetricsSchema = z.object({
  visitorToSignup: z.number().optional(),
  signupToCustomer: z.number().optional(),
  overallConversion: z.number().optional(),
  cartAbandonmentRate: z.number().optional(),
  checkoutCompletionRate: z.number().optional(),
  period: TimePeriodSchema.optional(),
})
export type ConversionMetrics = z.infer<typeof ConversionMetricsSchema>

/**
 * Engagement metrics schema
 */
export const EngagementMetricsSchema = z.object({
  dau: z.number().optional(),
  mau: z.number().optional(),
  dauMauRatio: z.number().optional(),
  avgSessionDuration: z.number().optional(),
  sessionsPerUser: z.number().optional(),
  retentionDay1: z.number().optional(),
  retentionDay7: z.number().optional(),
  retentionDay30: z.number().optional(),
  period: TimePeriodSchema.optional(),
})
export type EngagementMetrics = z.infer<typeof EngagementMetricsSchema>

/**
 * Digital business entity schema
 */
export const DigitalBusinessSchema = z.object({
  $id: z.string(),
  $type: z.literal('https://schema.org.ai/DigitalBusiness'),
  name: z.string(),
  slug: z.string().optional(),
  description: z.string().optional(),
  plan: BusinessPlanSchema.optional(),
  industry: z.string().optional(),
  mission: z.string().optional(),
  values: z.array(z.string()).optional(),
  targetMarket: z.string().optional(),
  foundedAt: z.coerce.date().optional(),
  teamSize: z.number().optional(),
  currency: CurrencySchema.optional(),
  financials: FinancialMetricsSchema.optional(),

  // Digital presence fields
  website: z.string().url().optional(),
  domain: z.string().optional(),
  socialMedia: z.array(SocialMediaPresenceSchema).optional(),
  onlinePresence: OnlinePresenceStatusSchema.optional(),

  // Contact and communication
  supportEmail: z.string().email().optional(),
  contactEmail: z.string().email().optional(),
  supportUrl: z.string().url().optional(),
  blogUrl: z.string().url().optional(),
  docsUrl: z.string().url().optional(),

  // Analytics and tracking
  analyticsId: z.string().optional(),
  googleAnalyticsId: z.string().optional(),
  facebookPixelId: z.string().optional(),

  // Digital metrics
  seo: SEOMetricsSchema.optional(),
  traffic: TrafficMetricsSchema.optional(),
  conversion: ConversionMetricsSchema.optional(),
  engagement: EngagementMetricsSchema.optional(),

  // Technology stack
  techStack: z.array(z.string()).optional(),
  hostingProvider: z.string().optional(),
  cdnProvider: z.string().optional(),

  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type DigitalBusinessType = z.infer<typeof DigitalBusinessSchema>

/**
 * DigitalBusiness Noun - Digital business entity
 *
 * Extends Business with digital-specific metrics and presence:
 * - Website and domain management
 * - Social media presence tracking
 * - Traffic, conversion, and engagement metrics
 * - SEO metrics and analytics integration
 *
 * Base class for SaaS, Marketplace, API, and Directory business types.
 */
export const DigitalBusiness = defineNoun({
  noun: 'DigitalBusiness',
  plural: 'DigitalBusinesses',
  $type: 'https://schema.org.ai/DigitalBusiness',
  schema: DigitalBusinessSchema,
  extends: 'Business',
  okrs: [
    // Business OKRs
    'Revenue', 'Costs', 'Profit', 'GrossMargin', 'NetMargin',
    // Digital Business OKRs
    'Traffic', 'Conversion', 'Engagement',
    'SEO', 'SocialReach', 'BrandAwareness',
    'DAU', 'MAU', 'Retention',
  ],
})

/**
 * @dotdo/business - Type Definitions
 *
 * Types for Business-as-Code implementation.
 */

import type { AnalyticsClient } from '@dotdo/clickhouse'
import type { SaaSMetrics } from '@dotdo/finance'

// =============================================================================
// Configuration
// =============================================================================

export interface BusinessConfig {
  /**
   * Database backend for DO storage
   * @default 'db4'
   */
  backend?: 'db4' | 'sqlite' | 'postgres'

  /**
   * Analytics configuration
   */
  analytics?: {
    enabled?: boolean
    /** ClickHouse WASM build profile */
    profile?: 'minimal' | 'standard' | 'full'
    /** R2 bucket for cold storage */
    r2?: R2Bucket
  }

  /**
   * Financial configuration
   */
  finance?: {
    enabled?: boolean
    stripeApiKey?: string
    webhookSecret?: string
  }

  /**
   * Experiments configuration
   */
  experiments?: {
    enabled?: boolean
    /** Auto-assign users to experiments */
    autoAssign?: boolean
  }

  /**
   * OKRs configuration
   */
  okrs?: {
    enabled?: boolean
    /** AI-guided recommendations */
    aiRecommendations?: boolean
  }
}

// =============================================================================
// Product & Service
// =============================================================================

/**
 * Product entity with analytics
 */
export interface Product {
  id: string
  name: string
  description?: string
  price?: number
  currency?: string
  active: boolean
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

/**
 * Service entity with analytics
 */
export interface Service {
  id: string
  name: string
  description?: string
  pricing?: ServicePricing
  active: boolean
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export interface ServicePricing {
  type: 'one-time' | 'recurring' | 'usage-based'
  amount?: number
  currency?: string
  interval?: 'day' | 'week' | 'month' | 'year'
  usageUnit?: string
  usageRate?: number
}

// =============================================================================
// Experiments
// =============================================================================

export interface Experiment {
  id: string
  key: string
  name: string
  description?: string
  status: 'draft' | 'running' | 'paused' | 'completed'
  variants: Variant[]
  targetMetric: string
  startDate?: Date
  endDate?: Date
  minSampleSize?: number
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export interface Variant {
  key: string
  name: string
  weight: number
  isControl?: boolean
  config?: Record<string, unknown>
}

export interface ExperimentAssignment {
  experimentKey: string
  variantKey: string
  userId: string
  assignedAt: Date
}

// =============================================================================
// Feature Flags
// =============================================================================

export interface FeatureFlag {
  id: string
  key: string
  name: string
  description?: string
  enabled: boolean
  /** Percentage rollout (0-100) */
  rolloutPercentage?: number
  /** User segments to target */
  targetSegments?: string[]
  /** Override values for specific users */
  overrides?: Record<string, boolean | string | number>
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

// =============================================================================
// OKRs
// =============================================================================

export interface Objective {
  id: string
  name: string
  description?: string
  owner?: string
  period: OKRPeriod
  status: 'on-track' | 'at-risk' | 'behind' | 'completed'
  keyResults: KeyResult[]
  parentId?: string
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export interface KeyResult {
  id: string
  name: string
  description?: string
  targetValue: number
  currentValue: number
  unit?: string
  /** Metric to track for auto-update */
  metricKey?: string
  status: 'on-track' | 'at-risk' | 'behind' | 'completed'
  metadata?: Record<string, unknown>
}

export interface OKRPeriod {
  type: 'quarter' | 'month' | 'year' | 'custom'
  start: Date
  end: Date
  name?: string
}

// =============================================================================
// Business Metrics
// =============================================================================

export interface BusinessMetrics extends SaaSMetrics {
  /** Product metrics */
  products?: {
    totalProducts: number
    activeProducts: number
    topProducts: Array<{ id: string; name: string; revenue: number }>
  }

  /** Service metrics */
  services?: {
    totalServices: number
    activeServices: number
    topServices: Array<{ id: string; name: string; revenue: number }>
  }

  /** Experiment metrics */
  experiments?: {
    running: number
    completed: number
    significant: number
  }

  /** OKR health */
  okrs?: {
    totalObjectives: number
    onTrack: number
    atRisk: number
    behind: number
    averageProgress: number
  }
}

// =============================================================================
// Analytics Events
// =============================================================================

export interface BusinessEvent {
  type: BusinessEventType
  timestamp: Date
  properties: Record<string, unknown>
  userId?: string
  sessionId?: string
  productId?: string
  serviceId?: string
  experimentKey?: string
  variantKey?: string
}

export type BusinessEventType =
  | 'product.viewed'
  | 'product.purchased'
  | 'product.added_to_cart'
  | 'product.removed_from_cart'
  | 'service.viewed'
  | 'service.purchased'
  | 'service.started'
  | 'service.completed'
  | 'experiment.assigned'
  | 'experiment.converted'
  | 'feature.enabled'
  | 'feature.disabled'
  | 'okr.progress_updated'
  | 'okr.completed'
  | string

// =============================================================================
// Client Interfaces
// =============================================================================

export interface BusinessAnalytics extends AnalyticsClient {
  /** Get business-specific metrics */
  getBusinessMetrics(period: DateRange): Promise<BusinessMetrics>

  /** Track business event */
  trackBusinessEvent(event: Omit<BusinessEvent, 'timestamp'>): Promise<void>
}

export interface DateRange {
  start: Date
  end: Date
}

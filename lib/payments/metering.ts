/**
 * Usage Metering System (TDD STUB)
 *
 * This file contains stub implementations for the usage metering system.
 * These stubs are designed to fail tests, enabling TDD RED phase.
 *
 * @module lib/payments/metering
 */

// ============================================================================
// Types (defined locally for now, can be moved to types.ts later)
// ============================================================================

/**
 * A single usage event recorded by the metering system
 */
export interface UsageEvent {
  id?: string
  tenantId: string
  service: string
  metric: string
  value: number
  timestamp?: Date
  metadata?: Record<string, unknown>
}

export interface UsageEventQuery {
  tenantId: string
  service?: string
  metric?: string
  from?: Date
  to?: Date
  limit?: number
  offset?: number
}

export type UsagePeriod = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly'

export interface AggregatedUsage {
  tenantId: string
  service: string
  metric: string
  period: UsagePeriod
  periodStart: Date
  periodEnd: Date
  totalValue: number
  eventCount: number
  minValue: number
  maxValue: number
  avgValue: number
}

export interface AggregationOptions {
  groupBy?: ('service' | 'metric' | 'tenantId')[]
}

export interface PricingTier {
  upTo: number | null
  unitPrice: number
  name?: string
}

export interface TieredPricing {
  type: 'flat' | 'volume' | 'graduated' | 'package'
  unitPrice?: number
  tiers?: PricingTier[]
  packageSize?: number
  packagePrice?: number
  includedUnits?: number
  minimumCharge?: number
  maximumCharge?: number
}

export type OverageAction = 'block' | 'charge' | 'warn'

export interface OveragePolicy {
  quota: number
  period: UsagePeriod
  action: OverageAction
  overageRate?: number
  gracePeriod?: number
}

export interface OverageResult {
  isOverage: boolean
  overageAmount: number
  percentUsed: number
  shouldBlock?: boolean
  inGracePeriod?: boolean
  overageCharge?: number
  warning?: string
}

export type AlertLevel = 'info' | 'warning' | 'critical' | 'exceeded'

export interface AlertThreshold {
  tenantId: string
  service: string
  metric: string
  limit: number
  warningPercent?: number
  criticalPercent?: number
  cooldownMinutes?: number
}

export interface UsageAlert {
  id: string
  tenantId: string
  service: string
  metric: string
  level: AlertLevel
  percentUsed: number
  currentValue: number
  limit: number
  timestamp: Date
  message?: string
}

export interface RolloverConfig {
  tenantId: string
  service: string
  metric: string
  enabled: boolean
  maxRolloverPercent: number
  maxRolloverPeriods: number
}

export interface RolloverInput {
  tenantId: string
  service: string
  metric: string
  quota: number
  used: number
  period: UsagePeriod
}

export interface RolloverResult {
  rolloverAmount: number
  expiresAt?: Date
}

export interface ApplyRolloverInput {
  tenantId: string
  service: string
  metric: string
  baseQuota: number
  period: UsagePeriod
}

export interface UsageSummary {
  tenantId: string
  period: { from: Date; to: Date }
  totalCost: number
  byService: Record<string, ServiceUsageSummary>
}

export interface ServiceUsageSummary {
  service: string
  metrics: Record<string, number>
  cost: number
  quota?: number
  used?: number
  overage?: number
  percentUsed?: number
}

export interface UsageReport {
  tenantId: string
  period: { from: Date; to: Date }
  granularity: UsagePeriod
  breakdown: AggregatedUsage[]
  trends?: Record<string, UsageTrend>
  costs?: { total: number; byService: Record<string, number> }
}

export interface UsageTrend {
  direction: 'increasing' | 'decreasing' | 'stable'
  changePercent: number
}

export interface ReportExportOptions {
  from: Date
  to: Date
  usage: AggregatedUsage[]
  format: 'csv' | 'json'
}

export interface ReportOptions {
  from: Date
  to: Date
  granularity: UsagePeriod
  usage: AggregatedUsage[]
  includeTrends?: boolean
  includeCosts?: boolean
  quotas?: Record<string, number>
}

export interface MeteringConfig {
  enabled: boolean
  batchSize: number
  flushIntervalMs: number
  storage?: { type: 'memory' | 'sqlite' | 'durable-object' }
}

export interface UsageLimit {
  service: string
  metric: string
  quota: number
  period: UsagePeriod
  action: OverageAction
}

export interface Invoice {
  tenantId: string
  period: { from: Date; to: Date }
  lineItems: InvoiceLineItem[]
  total: number
}

export interface InvoiceLineItem {
  service: string
  metric: string
  quantity: number
  unitPrice: number
  amount: number
}

// ============================================================================
// UsageEventRecorder - Stub Implementation
// ============================================================================

export class UsageEventRecorder {
  async record(_event: Omit<UsageEvent, 'id'>): Promise<UsageEvent> {
    throw new Error('Not implemented: UsageEventRecorder.record')
  }

  async recordBatch(_events: Omit<UsageEvent, 'id'>[]): Promise<UsageEvent[]> {
    throw new Error('Not implemented: UsageEventRecorder.recordBatch')
  }

  async query(_query: UsageEventQuery): Promise<UsageEvent[]> {
    throw new Error('Not implemented: UsageEventRecorder.query')
  }
}

// ============================================================================
// UsageAggregator - Stub Implementation
// ============================================================================

export class UsageAggregator {
  async aggregateByPeriod(
    _events: UsageEvent[],
    _period: UsagePeriod,
    _options?: AggregationOptions
  ): Promise<AggregatedUsage[]> {
    throw new Error('Not implemented: UsageAggregator.aggregateByPeriod')
  }

  async rollup(
    _aggregates: AggregatedUsage[],
    _targetPeriod: UsagePeriod
  ): Promise<AggregatedUsage[]> {
    throw new Error('Not implemented: UsageAggregator.rollup')
  }
}

// ============================================================================
// TieredPricingCalculator - Stub Implementation
// ============================================================================

export class TieredPricingCalculator {
  calculateCost(_usage: number, _pricing: TieredPricing): number {
    throw new Error('Not implemented: TieredPricingCalculator.calculateCost')
  }

  evaluateTier(_usage: number, _pricing: TieredPricing): PricingTier {
    throw new Error('Not implemented: TieredPricingCalculator.evaluateTier')
  }
}

// ============================================================================
// OverageTracker - Stub Implementation
// ============================================================================

export class OverageTracker {
  checkOverage(
    _tenantId: string,
    _currentUsage: number,
    _policy: OveragePolicy
  ): OverageResult {
    throw new Error('Not implemented: OverageTracker.checkOverage')
  }

  async getOverageHistory(_tenantId: string): Promise<OverageResult[]> {
    throw new Error('Not implemented: OverageTracker.getOverageHistory')
  }
}

// ============================================================================
// UsageAlertManager - Stub Implementation
// ============================================================================

export class UsageAlertManager {
  setThreshold(_threshold: AlertThreshold): void {
    throw new Error('Not implemented: UsageAlertManager.setThreshold')
  }

  getThresholds(_tenantId: string): AlertThreshold[] {
    throw new Error('Not implemented: UsageAlertManager.getThresholds')
  }

  async checkThresholds(
    _tenantId: string,
    _service: string,
    _metric: string,
    _currentValue: number
  ): Promise<UsageAlert[]> {
    throw new Error('Not implemented: UsageAlertManager.checkThresholds')
  }

  subscribe(_tenantId: string, _handler: (alert: UsageAlert) => void): void {
    throw new Error('Not implemented: UsageAlertManager.subscribe')
  }

  async getAlertHistory(_tenantId: string): Promise<UsageAlert[]> {
    throw new Error('Not implemented: UsageAlertManager.getAlertHistory')
  }
}

// ============================================================================
// UsageRollover - Stub Implementation
// ============================================================================

export class UsageRollover {
  configure(_config: RolloverConfig): void {
    throw new Error('Not implemented: UsageRollover.configure')
  }

  getConfig(
    _tenantId: string,
    _service: string,
    _metric: string
  ): RolloverConfig | undefined {
    throw new Error('Not implemented: UsageRollover.getConfig')
  }

  calculateRollover(_input: RolloverInput): RolloverResult {
    throw new Error('Not implemented: UsageRollover.calculateRollover')
  }

  applyRollover(_input: ApplyRolloverInput): number {
    throw new Error('Not implemented: UsageRollover.applyRollover')
  }

  getRolloverBalance(
    _tenantId: string,
    _service: string,
    _metric: string
  ): number {
    throw new Error('Not implemented: UsageRollover.getRolloverBalance')
  }
}

// ============================================================================
// UsageReportGenerator - Stub Implementation
// ============================================================================

export class UsageReportGenerator {
  async generateSummary(
    _tenantId: string,
    _usage: AggregatedUsage[],
    _options?: { quotas?: Record<string, number> }
  ): Promise<UsageSummary> {
    throw new Error('Not implemented: UsageReportGenerator.generateSummary')
  }

  async generateReport(
    _tenantId: string,
    _options: ReportOptions
  ): Promise<UsageReport> {
    throw new Error('Not implemented: UsageReportGenerator.generateReport')
  }

  async exportReport(
    _tenantId: string,
    _options: ReportExportOptions
  ): Promise<string> {
    throw new Error('Not implemented: UsageReportGenerator.exportReport')
  }
}

// ============================================================================
// UsageMeter - Main Integration Class - Stub Implementation
// ============================================================================

export class UsageMeter {
  async track(_event: Omit<UsageEvent, 'id'>): Promise<void> {
    throw new Error('Not implemented: UsageMeter.track')
  }

  async getUsage(
    _tenantId: string,
    _query: { service: string; metric: string; period: UsagePeriod }
  ): Promise<{ totalValue: number }> {
    throw new Error('Not implemented: UsageMeter.getUsage')
  }

  setLimit(_tenantId: string, _limit: UsageLimit): void {
    throw new Error('Not implemented: UsageMeter.setLimit')
  }

  setThreshold(_threshold: AlertThreshold): void {
    throw new Error('Not implemented: UsageMeter.setThreshold')
  }

  onAlert(_tenantId: string, _handler: (alert: UsageAlert) => void): void {
    throw new Error('Not implemented: UsageMeter.onAlert')
  }

  async getInvoice(
    _tenantId: string,
    _period: { from: Date; to: Date }
  ): Promise<Invoice> {
    throw new Error('Not implemented: UsageMeter.getInvoice')
  }

  async resetPeriod(_tenantId: string, _period: UsagePeriod): Promise<void> {
    throw new Error('Not implemented: UsageMeter.resetPeriod')
  }

  dispose(): void {
    // Cleanup stub - no-op
  }
}

// ============================================================================
// Factory Function - Stub Implementation
// ============================================================================

export function createUsageMeter(_config?: Partial<MeteringConfig>): UsageMeter {
  return new UsageMeter()
}

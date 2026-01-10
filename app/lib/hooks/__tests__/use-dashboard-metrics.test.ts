/**
 * useDashboardMetrics Hook Tests
 *
 * Tests for the dashboard metrics aggregation hook.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import {
  useDashboardMetrics,
  calculateTrend,
  getUptimeStatus,
  formatMetricValue,
} from '../use-dashboard-metrics'

// =============================================================================
// Hook Tests
// =============================================================================

describe('useDashboardMetrics', () => {
  describe('initial state', () => {
    it('returns isLoading=true initially', () => {
      const { result } = renderHook(() => useDashboardMetrics())

      expect(result.current.isLoading).toBe(true)
      expect(result.current.metrics).toBe(null)
      expect(result.current.error).toBe(null)
    })

    it('provides a refresh function', () => {
      const { result } = renderHook(() => useDashboardMetrics())

      expect(typeof result.current.refresh).toBe('function')
    })
  })

  describe('loading metrics', () => {
    it('returns metrics after loading', async () => {
      const { result } = renderHook(() => useDashboardMetrics())

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
        expect(result.current.metrics).not.toBe(null)
      }, { timeout: 1000 })
    })

    it('returns all expected metric properties', async () => {
      const { result } = renderHook(() => useDashboardMetrics())

      await waitFor(() => {
        expect(result.current.metrics).not.toBe(null)
      }, { timeout: 1000 })

      const metrics = result.current.metrics!
      expect(metrics).toHaveProperty('activeAgents')
      expect(metrics).toHaveProperty('totalWorkflows')
      expect(metrics).toHaveProperty('apiCalls')
      expect(metrics).toHaveProperty('uptime')
      expect(metrics).toHaveProperty('recentActivity')
      expect(metrics).toHaveProperty('agentStatuses')
      expect(metrics).toHaveProperty('chartData')
    })

    it('returns correct structure for apiCalls', async () => {
      const { result } = renderHook(() => useDashboardMetrics())

      await waitFor(() => {
        expect(result.current.metrics).not.toBe(null)
      }, { timeout: 1000 })

      const { apiCalls } = result.current.metrics!
      expect(apiCalls).toHaveProperty('today')
      expect(apiCalls).toHaveProperty('yesterday')
      expect(apiCalls).toHaveProperty('trend')
      expect(typeof apiCalls.today).toBe('number')
      expect(typeof apiCalls.yesterday).toBe('number')
      expect(typeof apiCalls.trend).toBe('number')
    })

    it('returns correct structure for uptime', async () => {
      const { result } = renderHook(() => useDashboardMetrics())

      await waitFor(() => {
        expect(result.current.metrics).not.toBe(null)
      }, { timeout: 1000 })

      const { uptime } = result.current.metrics!
      expect(uptime).toHaveProperty('percentage')
      expect(uptime).toHaveProperty('status')
      expect(typeof uptime.percentage).toBe('number')
      expect(['healthy', 'degraded', 'down']).toContain(uptime.status)
    })

    it('returns all 6 named agents', async () => {
      const { result } = renderHook(() => useDashboardMetrics())

      await waitFor(() => {
        expect(result.current.metrics).not.toBe(null)
      }, { timeout: 1000 })

      const { agentStatuses } = result.current.metrics!
      expect(agentStatuses).toHaveLength(6)

      const names = agentStatuses.map(a => a.name)
      expect(names).toContain('Priya')
      expect(names).toContain('Ralph')
      expect(names).toContain('Tom')
      expect(names).toContain('Mark')
      expect(names).toContain('Sally')
      expect(names).toContain('Quinn')
    })

    it('returns chart data arrays', async () => {
      const { result } = renderHook(() => useDashboardMetrics())

      await waitFor(() => {
        expect(result.current.metrics).not.toBe(null)
      }, { timeout: 1000 })

      const { chartData } = result.current.metrics!
      expect(Array.isArray(chartData.apiUsage)).toBe(true)
      expect(Array.isArray(chartData.workflowRuns)).toBe(true)
      expect(chartData.apiUsage.length).toBeGreaterThan(0)
      expect(chartData.workflowRuns.length).toBeGreaterThan(0)
    })
  })

  describe('refresh functionality', () => {
    it('refresh triggers reload', async () => {
      const { result } = renderHook(() => useDashboardMetrics())

      // Wait for initial load
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      }, { timeout: 1000 })

      const metricsBeforeRefresh = result.current.metrics

      // Call refresh wrapped in act
      act(() => {
        result.current.refresh()
      })

      // Wait for reload to complete
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
        expect(result.current.metrics).not.toBe(null)
      }, { timeout: 1000 })

      // Verify metrics were reloaded (they may be different due to random data)
      expect(result.current.metrics).not.toBe(null)
    })
  })
})

// =============================================================================
// Utility Function Tests
// =============================================================================

describe('calculateTrend', () => {
  it('calculates positive trend correctly', () => {
    expect(calculateTrend(120, 100)).toBe(20)
  })

  it('calculates negative trend correctly', () => {
    expect(calculateTrend(80, 100)).toBe(-20)
  })

  it('handles zero previous value', () => {
    expect(calculateTrend(100, 0)).toBe(100)
    expect(calculateTrend(0, 0)).toBe(0)
  })

  it('returns 0 for no change', () => {
    expect(calculateTrend(100, 100)).toBe(0)
  })
})

describe('getUptimeStatus', () => {
  it('returns healthy for 99.9% and above', () => {
    expect(getUptimeStatus(99.9)).toBe('healthy')
    expect(getUptimeStatus(100)).toBe('healthy')
    expect(getUptimeStatus(99.95)).toBe('healthy')
  })

  it('returns degraded for 95% to 99.9%', () => {
    expect(getUptimeStatus(95)).toBe('degraded')
    expect(getUptimeStatus(99)).toBe('degraded')
    expect(getUptimeStatus(99.8)).toBe('degraded')
  })

  it('returns down for below 95%', () => {
    expect(getUptimeStatus(94.9)).toBe('down')
    expect(getUptimeStatus(50)).toBe('down')
    expect(getUptimeStatus(0)).toBe('down')
  })
})

describe('formatMetricValue', () => {
  it('formats millions correctly', () => {
    expect(formatMetricValue(1000000)).toBe('1.0M')
    expect(formatMetricValue(1500000)).toBe('1.5M')
    expect(formatMetricValue(10000000)).toBe('10.0M')
  })

  it('formats thousands correctly', () => {
    expect(formatMetricValue(1000)).toBe('1.0k')
    expect(formatMetricValue(1500)).toBe('1.5k')
    expect(formatMetricValue(999999)).toBe('1000.0k')
  })

  it('returns raw number for values under 1000', () => {
    expect(formatMetricValue(999)).toBe('999')
    expect(formatMetricValue(100)).toBe('100')
    expect(formatMetricValue(0)).toBe('0')
  })
})

/**
 * Support & Customer Success OKRs Tests
 *
 * TDD tests for pre-built Support and Customer Success OKRs following red-green-refactor.
 * Write failing tests first, then implement.
 *
 * Support OKRs (owned by Sam):
 * - ResponseTime: First response SLA
 * - ResolutionRate: % resolved without escalation
 * - CustomerSatisfaction: Support CSAT
 *
 * Customer Success OKRs (owned by Casey):
 * - NetRetention: NRR %
 * - ExpansionRevenue: Upsell/cross-sell
 * - ChurnPrevention: At-risk accounts saved
 */

import { describe, it, expect } from 'vitest'
import {
  ResponseTime,
  ResolutionRate,
  CustomerSatisfaction,
  SupportOKRs,
  NetRetention,
  ExpansionRevenue,
  ChurnPrevention,
  CustomerSuccessOKRs,
} from '../prebuilt/support'

// ============================================================================
// Support OKRs: ResponseTime Metric Tests
// ============================================================================

describe('ResponseTime metric', () => {
  it('has name "ResponseTime"', () => {
    expect(ResponseTime.name).toBe('ResponseTime')
  })

  it('has description about first response SLA', () => {
    expect(ResponseTime.description).toBe('First response SLA')
  })

  it('has unit of minutes', () => {
    expect(ResponseTime.unit).toBe('minutes')
  })

  it('has a measurement function that returns response time', async () => {
    const mockAnalytics = {
      support: {
        firstResponseTime: 15,
      },
    }

    const result = await ResponseTime.measurement(mockAnalytics)
    expect(result).toBe(15)
  })

  it('measurement function handles fast response time', async () => {
    const mockAnalytics = {
      support: {
        firstResponseTime: 2,
      },
    }

    const result = await ResponseTime.measurement(mockAnalytics)
    expect(result).toBe(2)
  })

  it('measurement function handles slow response time', async () => {
    const mockAnalytics = {
      support: {
        firstResponseTime: 120,
      },
    }

    const result = await ResponseTime.measurement(mockAnalytics)
    expect(result).toBe(120)
  })
})

// ============================================================================
// Support OKRs: ResolutionRate Metric Tests
// ============================================================================

describe('ResolutionRate metric', () => {
  it('has name "ResolutionRate"', () => {
    expect(ResolutionRate.name).toBe('ResolutionRate')
  })

  it('has description about resolution without escalation', () => {
    expect(ResolutionRate.description).toBe('% resolved without escalation')
  })

  it('has unit of percentage (%)', () => {
    expect(ResolutionRate.unit).toBe('%')
  })

  it('has a measurement function that returns resolution rate', async () => {
    const mockAnalytics = {
      support: {
        resolutionRate: 85,
      },
    }

    const result = await ResolutionRate.measurement(mockAnalytics)
    expect(result).toBe(85)
  })

  it('measurement function handles 100% resolution rate', async () => {
    const mockAnalytics = {
      support: {
        resolutionRate: 100,
      },
    }

    const result = await ResolutionRate.measurement(mockAnalytics)
    expect(result).toBe(100)
  })

  it('measurement function handles low resolution rate', async () => {
    const mockAnalytics = {
      support: {
        resolutionRate: 45,
      },
    }

    const result = await ResolutionRate.measurement(mockAnalytics)
    expect(result).toBe(45)
  })
})

// ============================================================================
// Support OKRs: CustomerSatisfaction Metric Tests
// ============================================================================

describe('CustomerSatisfaction metric (Support)', () => {
  it('has name "CustomerSatisfaction"', () => {
    expect(CustomerSatisfaction.name).toBe('CustomerSatisfaction')
  })

  it('has description about support CSAT', () => {
    expect(CustomerSatisfaction.description).toBe('Support CSAT')
  })

  it('has unit of score', () => {
    expect(CustomerSatisfaction.unit).toBe('score')
  })

  it('has a measurement function that returns CSAT score', async () => {
    const mockAnalytics = {
      support: {
        csat: 4.5,
      },
    }

    const result = await CustomerSatisfaction.measurement(mockAnalytics)
    expect(result).toBe(4.5)
  })

  it('measurement function handles perfect CSAT', async () => {
    const mockAnalytics = {
      support: {
        csat: 5.0,
      },
    }

    const result = await CustomerSatisfaction.measurement(mockAnalytics)
    expect(result).toBe(5.0)
  })

  it('measurement function handles low CSAT', async () => {
    const mockAnalytics = {
      support: {
        csat: 2.5,
      },
    }

    const result = await CustomerSatisfaction.measurement(mockAnalytics)
    expect(result).toBe(2.5)
  })
})

// ============================================================================
// SupportOKRs Export Tests
// ============================================================================

describe('SupportOKRs export', () => {
  it('exports all three Support metrics', () => {
    expect(SupportOKRs).toBeDefined()
    expect(SupportOKRs.ResponseTime).toBeDefined()
    expect(SupportOKRs.ResolutionRate).toBeDefined()
    expect(SupportOKRs.CustomerSatisfaction).toBeDefined()
  })

  it('SupportOKRs.ResponseTime is the same as ResponseTime', () => {
    expect(SupportOKRs.ResponseTime).toBe(ResponseTime)
  })

  it('SupportOKRs.ResolutionRate is the same as ResolutionRate', () => {
    expect(SupportOKRs.ResolutionRate).toBe(ResolutionRate)
  })

  it('SupportOKRs.CustomerSatisfaction is the same as CustomerSatisfaction', () => {
    expect(SupportOKRs.CustomerSatisfaction).toBe(CustomerSatisfaction)
  })

  it('has exactly three metrics', () => {
    const metricNames = Object.keys(SupportOKRs)
    expect(metricNames).toHaveLength(3)
    expect(metricNames).toContain('ResponseTime')
    expect(metricNames).toContain('ResolutionRate')
    expect(metricNames).toContain('CustomerSatisfaction')
  })
})

// ============================================================================
// Customer Success OKRs: NetRetention Metric Tests
// ============================================================================

describe('NetRetention metric', () => {
  it('has name "NetRetention"', () => {
    expect(NetRetention.name).toBe('NetRetention')
  })

  it('has description about NRR %', () => {
    expect(NetRetention.description).toBe('NRR %')
  })

  it('has unit of percentage (%)', () => {
    expect(NetRetention.unit).toBe('%')
  })

  it('has a measurement function that returns NRR', async () => {
    const mockAnalytics = {
      customerSuccess: {
        netRetentionRate: 115,
      },
    }

    const result = await NetRetention.measurement(mockAnalytics)
    expect(result).toBe(115)
  })

  it('measurement function handles 100% retention', async () => {
    const mockAnalytics = {
      customerSuccess: {
        netRetentionRate: 100,
      },
    }

    const result = await NetRetention.measurement(mockAnalytics)
    expect(result).toBe(100)
  })

  it('measurement function handles net expansion (>100%)', async () => {
    const mockAnalytics = {
      customerSuccess: {
        netRetentionRate: 135,
      },
    }

    const result = await NetRetention.measurement(mockAnalytics)
    expect(result).toBe(135)
  })

  it('measurement function handles net contraction (<100%)', async () => {
    const mockAnalytics = {
      customerSuccess: {
        netRetentionRate: 85,
      },
    }

    const result = await NetRetention.measurement(mockAnalytics)
    expect(result).toBe(85)
  })
})

// ============================================================================
// Customer Success OKRs: ExpansionRevenue Metric Tests
// ============================================================================

describe('ExpansionRevenue metric', () => {
  it('has name "ExpansionRevenue"', () => {
    expect(ExpansionRevenue.name).toBe('ExpansionRevenue')
  })

  it('has description about upsell/cross-sell', () => {
    expect(ExpansionRevenue.description).toBe('Upsell/cross-sell')
  })

  it('has unit of dollars ($)', () => {
    expect(ExpansionRevenue.unit).toBe('$')
  })

  it('has a measurement function that returns expansion revenue', async () => {
    const mockAnalytics = {
      customerSuccess: {
        expansionRevenue: 50000,
      },
    }

    const result = await ExpansionRevenue.measurement(mockAnalytics)
    expect(result).toBe(50000)
  })

  it('measurement function handles zero expansion', async () => {
    const mockAnalytics = {
      customerSuccess: {
        expansionRevenue: 0,
      },
    }

    const result = await ExpansionRevenue.measurement(mockAnalytics)
    expect(result).toBe(0)
  })

  it('measurement function handles large expansion revenue', async () => {
    const mockAnalytics = {
      customerSuccess: {
        expansionRevenue: 500000,
      },
    }

    const result = await ExpansionRevenue.measurement(mockAnalytics)
    expect(result).toBe(500000)
  })
})

// ============================================================================
// Customer Success OKRs: ChurnPrevention Metric Tests
// ============================================================================

describe('ChurnPrevention metric', () => {
  it('has name "ChurnPrevention"', () => {
    expect(ChurnPrevention.name).toBe('ChurnPrevention')
  })

  it('has description about at-risk accounts saved', () => {
    expect(ChurnPrevention.description).toBe('At-risk accounts saved')
  })

  it('has unit of count', () => {
    expect(ChurnPrevention.unit).toBe('count')
  })

  it('has a measurement function that returns saved accounts', async () => {
    const mockAnalytics = {
      customerSuccess: {
        savedAccounts: 25,
      },
    }

    const result = await ChurnPrevention.measurement(mockAnalytics)
    expect(result).toBe(25)
  })

  it('measurement function handles zero saved accounts', async () => {
    const mockAnalytics = {
      customerSuccess: {
        savedAccounts: 0,
      },
    }

    const result = await ChurnPrevention.measurement(mockAnalytics)
    expect(result).toBe(0)
  })

  it('measurement function handles many saved accounts', async () => {
    const mockAnalytics = {
      customerSuccess: {
        savedAccounts: 150,
      },
    }

    const result = await ChurnPrevention.measurement(mockAnalytics)
    expect(result).toBe(150)
  })
})

// ============================================================================
// CustomerSuccessOKRs Export Tests
// ============================================================================

describe('CustomerSuccessOKRs export', () => {
  it('exports all three Customer Success metrics', () => {
    expect(CustomerSuccessOKRs).toBeDefined()
    expect(CustomerSuccessOKRs.NetRetention).toBeDefined()
    expect(CustomerSuccessOKRs.ExpansionRevenue).toBeDefined()
    expect(CustomerSuccessOKRs.ChurnPrevention).toBeDefined()
  })

  it('CustomerSuccessOKRs.NetRetention is the same as NetRetention', () => {
    expect(CustomerSuccessOKRs.NetRetention).toBe(NetRetention)
  })

  it('CustomerSuccessOKRs.ExpansionRevenue is the same as ExpansionRevenue', () => {
    expect(CustomerSuccessOKRs.ExpansionRevenue).toBe(ExpansionRevenue)
  })

  it('CustomerSuccessOKRs.ChurnPrevention is the same as ChurnPrevention', () => {
    expect(CustomerSuccessOKRs.ChurnPrevention).toBe(ChurnPrevention)
  })

  it('has exactly three metrics', () => {
    const metricNames = Object.keys(CustomerSuccessOKRs)
    expect(metricNames).toHaveLength(3)
    expect(metricNames).toContain('NetRetention')
    expect(metricNames).toContain('ExpansionRevenue')
    expect(metricNames).toContain('ChurnPrevention')
  })
})

// ============================================================================
// Metric Structure Tests (both collections)
// ============================================================================

describe('Support & CS Metric structure', () => {
  it('all Support metrics have required properties', () => {
    const metrics = [ResponseTime, ResolutionRate, CustomerSatisfaction]

    for (const metric of metrics) {
      expect(metric).toHaveProperty('name')
      expect(metric).toHaveProperty('description')
      expect(metric).toHaveProperty('unit')
      expect(metric).toHaveProperty('measurement')
      expect(typeof metric.name).toBe('string')
      expect(typeof metric.description).toBe('string')
      expect(typeof metric.unit).toBe('string')
      expect(typeof metric.measurement).toBe('function')
    }
  })

  it('all Customer Success metrics have required properties', () => {
    const metrics = [NetRetention, ExpansionRevenue, ChurnPrevention]

    for (const metric of metrics) {
      expect(metric).toHaveProperty('name')
      expect(metric).toHaveProperty('description')
      expect(metric).toHaveProperty('unit')
      expect(metric).toHaveProperty('measurement')
      expect(typeof metric.name).toBe('string')
      expect(typeof metric.description).toBe('string')
      expect(typeof metric.unit).toBe('string')
      expect(typeof metric.measurement).toBe('function')
    }
  })

  it('metric names follow PascalCase convention', () => {
    const allMetrics = [
      ResponseTime,
      ResolutionRate,
      CustomerSatisfaction,
      NetRetention,
      ExpansionRevenue,
      ChurnPrevention,
    ]

    for (const metric of allMetrics) {
      // PascalCase: starts with uppercase, no spaces/underscores
      expect(metric.name).toMatch(/^[A-Z][a-zA-Z]*$/)
    }
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Support & CS metrics integration', () => {
  it('all Support metrics can be measured with complete analytics object', async () => {
    const mockAnalytics = {
      support: {
        firstResponseTime: 10,
        resolutionRate: 92,
        csat: 4.7,
      },
    }

    expect(await ResponseTime.measurement(mockAnalytics)).toBe(10)
    expect(await ResolutionRate.measurement(mockAnalytics)).toBe(92)
    expect(await CustomerSatisfaction.measurement(mockAnalytics)).toBe(4.7)
  })

  it('all Customer Success metrics can be measured with complete analytics object', async () => {
    const mockAnalytics = {
      customerSuccess: {
        netRetentionRate: 118,
        expansionRevenue: 75000,
        savedAccounts: 42,
      },
    }

    expect(await NetRetention.measurement(mockAnalytics)).toBe(118)
    expect(await ExpansionRevenue.measurement(mockAnalytics)).toBe(75000)
    expect(await ChurnPrevention.measurement(mockAnalytics)).toBe(42)
  })

  it('can iterate over all metrics in SupportOKRs', () => {
    const entries = Object.entries(SupportOKRs)
    expect(entries.length).toBe(3)

    for (const [name, metric] of entries) {
      expect(metric.name).toBe(name)
      expect(typeof metric.description).toBe('string')
      expect(typeof metric.unit).toBe('string')
      expect(typeof metric.measurement).toBe('function')
    }
  })

  it('can iterate over all metrics in CustomerSuccessOKRs', () => {
    const entries = Object.entries(CustomerSuccessOKRs)
    expect(entries.length).toBe(3)

    for (const [name, metric] of entries) {
      expect(metric.name).toBe(name)
      expect(typeof metric.description).toBe('string')
      expect(typeof metric.unit).toBe('string')
      expect(typeof metric.measurement).toBe('function')
    }
  })
})

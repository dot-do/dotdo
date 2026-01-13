/**
 * Revenue Recognition Tests - ASC 606 compliant revenue recognition helpers
 *
 * Tests comprehensive revenue recognition functionality:
 * - Deferred revenue tracking
 * - Recognition schedule generation
 * - ASC 606 five-step model compliance
 * - Period-based recognition (straight-line, usage-based, milestone)
 * - Contract lifecycle management
 * - Performance obligation tracking
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createRevenueRecognitionManager,
  allocateTransactionPrice,
  applyVariableConsiderationConstraint,
  determineRecognitionTiming,
  calculateStraightLineAmount,
  calculateUsageBasedAmount,
  calculatePercentageOfCompletionAmount,
  calculateMilestoneAmount,
  type RevenueRecognitionManager,
  type Contract,
  type PerformanceObligation,
} from '../revenue-recognition'

// =============================================================================
// ASC 606 Compliance Helper Tests
// =============================================================================

describe('ASC 606 Compliance Helpers', () => {
  describe('allocateTransactionPrice', () => {
    it('should allocate based on relative standalone selling prices', () => {
      const allocations = allocateTransactionPrice(10000, [
        { id: 'obl1', standaloneSellingPrice: 6000 },
        { id: 'obl2', standaloneSellingPrice: 4000 },
      ])

      expect(allocations).toHaveLength(2)
      expect(allocations[0].allocatedAmount).toBe(6000)
      expect(allocations[1].allocatedAmount).toBe(4000)
      expect(allocations[0].allocationPercentage).toBe(0.6)
      expect(allocations[1].allocationPercentage).toBe(0.4)
    })

    it('should handle unequal SSPs correctly', () => {
      const allocations = allocateTransactionPrice(15000, [
        { id: 'obl1', standaloneSellingPrice: 5000 },
        { id: 'obl2', standaloneSellingPrice: 10000 },
        { id: 'obl3', standaloneSellingPrice: 15000 },
      ])

      // Total SSP = 30000, so transaction price 15000 is 50% of total
      // obl1: 5000/30000 * 15000 = 2500
      // obl2: 10000/30000 * 15000 = 5000
      // obl3: 15000/30000 * 15000 = 7500
      expect(allocations[0].allocatedAmount).toBe(2500)
      expect(allocations[1].allocatedAmount).toBe(5000)
      expect(allocations[2].allocatedAmount).toBe(7500)
    })

    it('should throw when total SSP is zero', () => {
      expect(() =>
        allocateTransactionPrice(10000, [
          { id: 'obl1', standaloneSellingPrice: 0 },
          { id: 'obl2', standaloneSellingPrice: 0 },
        ])
      ).toThrow('Total standalone selling price cannot be zero')
    })

    it('should handle single obligation', () => {
      const allocations = allocateTransactionPrice(5000, [
        { id: 'obl1', standaloneSellingPrice: 7500 },
      ])

      expect(allocations).toHaveLength(1)
      expect(allocations[0].allocatedAmount).toBe(5000)
      expect(allocations[0].allocationPercentage).toBe(1)
    })
  })

  describe('applyVariableConsiderationConstraint', () => {
    it('should not constrain when reversal probability is low', () => {
      const result = applyVariableConsiderationConstraint(10000, 0.1)

      expect(result.constrainedAmount).toBe(10000)
      expect(result.constraintApplied).toBe(false)
    })

    it('should constrain when reversal probability is high', () => {
      const result = applyVariableConsiderationConstraint(10000, 0.5)

      expect(result.constrainedAmount).toBe(0)
      expect(result.constraintApplied).toBe(true)
    })

    it('should use custom threshold', () => {
      // With higher threshold, probability of 0.4 would not trigger constraint
      const result = applyVariableConsiderationConstraint(10000, 0.4, 0.5)

      expect(result.constrainedAmount).toBe(10000)
      expect(result.constraintApplied).toBe(false)
    })

    it('should constrain at exactly the threshold', () => {
      const result = applyVariableConsiderationConstraint(10000, 0.25)

      expect(result.constraintApplied).toBe(true)
      expect(result.constrainedAmount).toBe(0)
    })
  })

  describe('determineRecognitionTiming', () => {
    it('should recognize over time when customer consumes as performed', () => {
      const result = determineRecognitionTiming({
        customerConsumesAsPerformed: true,
        customerControlsAssetAsCreated: false,
        noAlternativeUse: false,
        hasEnforceableRight: false,
      })

      expect(result.overTime).toBe(true)
      expect(result.pointInTime).toBe(false)
      expect(result.reason).toContain('consumes')
    })

    it('should recognize over time when customer controls asset as created', () => {
      const result = determineRecognitionTiming({
        customerConsumesAsPerformed: false,
        customerControlsAssetAsCreated: true,
        noAlternativeUse: false,
        hasEnforceableRight: false,
      })

      expect(result.overTime).toBe(true)
      expect(result.pointInTime).toBe(false)
    })

    it('should recognize over time with no alternative use and enforceable right', () => {
      const result = determineRecognitionTiming({
        customerConsumesAsPerformed: false,
        customerControlsAssetAsCreated: false,
        noAlternativeUse: true,
        hasEnforceableRight: true,
      })

      expect(result.overTime).toBe(true)
      expect(result.pointInTime).toBe(false)
    })

    it('should recognize at point in time when no over-time criteria met', () => {
      const result = determineRecognitionTiming({
        customerConsumesAsPerformed: false,
        customerControlsAssetAsCreated: false,
        noAlternativeUse: true,
        hasEnforceableRight: false, // Missing enforceable right
      })

      expect(result.overTime).toBe(false)
      expect(result.pointInTime).toBe(true)
    })
  })

  describe('calculateStraightLineAmount', () => {
    it('should calculate correct amount for full period', () => {
      const start = new Date('2024-01-01')
      const end = new Date('2024-12-31')

      const amount = calculateStraightLineAmount(12000, start, end, start, end)

      // Should be approximately full amount (may have small rounding)
      expect(amount).toBeCloseTo(12000, 0)
    })

    it('should calculate correct amount for partial period', () => {
      const contractStart = new Date('2024-01-01')
      const contractEnd = new Date('2024-12-31')
      const periodStart = new Date('2024-01-01')
      const periodEnd = new Date('2024-06-30')

      const amount = calculateStraightLineAmount(
        12000,
        periodStart,
        periodEnd,
        contractStart,
        contractEnd
      )

      // About half the year (181 days out of 365)
      expect(amount).toBeGreaterThan(5800)
      expect(amount).toBeLessThan(6200)
    })

    it('should return full amount for zero duration contract', () => {
      const date = new Date('2024-01-01')

      const amount = calculateStraightLineAmount(12000, date, date, date, date)

      expect(amount).toBe(12000)
    })

    it('should handle single month period', () => {
      const contractStart = new Date('2024-01-01')
      const contractEnd = new Date('2024-12-31')
      const periodStart = new Date('2024-03-01')
      const periodEnd = new Date('2024-03-31')

      const amount = calculateStraightLineAmount(
        12000,
        periodStart,
        periodEnd,
        contractStart,
        contractEnd
      )

      // About 1 month out of 12
      expect(amount).toBeGreaterThan(900)
      expect(amount).toBeLessThan(1100)
    })
  })

  describe('calculateUsageBasedAmount', () => {
    it('should calculate correct amount based on delivered units', () => {
      const amount = calculateUsageBasedAmount(10000, 100, 50)

      expect(amount).toBe(5000)
    })

    it('should return full amount when all units delivered', () => {
      const amount = calculateUsageBasedAmount(10000, 100, 100)

      expect(amount).toBe(10000)
    })

    it('should return zero when no units delivered', () => {
      const amount = calculateUsageBasedAmount(10000, 100, 0)

      expect(amount).toBe(0)
    })

    it('should return zero when total units is zero', () => {
      const amount = calculateUsageBasedAmount(10000, 0, 50)

      expect(amount).toBe(0)
    })

    it('should handle fractional results', () => {
      const amount = calculateUsageBasedAmount(10000, 3, 1)

      expect(amount).toBeCloseTo(3333.33, 2)
    })
  })

  describe('calculatePercentageOfCompletionAmount', () => {
    it('should calculate incremental amount correctly', () => {
      const amount = calculatePercentageOfCompletionAmount(10000, 50, 3000)

      // 50% of 10000 = 5000, minus previously recognized 3000 = 2000
      expect(amount).toBe(2000)
    })

    it('should return full remaining when 100% complete', () => {
      const amount = calculatePercentageOfCompletionAmount(10000, 100, 7000)

      expect(amount).toBe(3000)
    })

    it('should return zero when already fully recognized', () => {
      const amount = calculatePercentageOfCompletionAmount(10000, 50, 5000)

      expect(amount).toBe(0)
    })

    it('should not return negative even if over-recognized', () => {
      const amount = calculatePercentageOfCompletionAmount(10000, 50, 6000)

      expect(amount).toBe(0)
    })
  })

  describe('calculateMilestoneAmount', () => {
    it('should calculate amount based on completed milestones', () => {
      const milestones = [
        { id: 'ms1', name: 'Design', revenuePercentage: 25, status: 'pending' as const },
        { id: 'ms2', name: 'Development', revenuePercentage: 50, status: 'pending' as const },
        { id: 'ms3', name: 'Testing', revenuePercentage: 25, status: 'pending' as const },
      ]

      const amount = calculateMilestoneAmount(10000, milestones, ['ms1', 'ms2'])

      expect(amount).toBe(7500)
    })

    it('should return zero when no milestones completed', () => {
      const milestones = [
        { id: 'ms1', name: 'Design', revenuePercentage: 50, status: 'pending' as const },
        { id: 'ms2', name: 'Testing', revenuePercentage: 50, status: 'pending' as const },
      ]

      const amount = calculateMilestoneAmount(10000, milestones, [])

      expect(amount).toBe(0)
    })

    it('should return full amount when all milestones completed', () => {
      const milestones = [
        { id: 'ms1', name: 'Design', revenuePercentage: 50, status: 'pending' as const },
        { id: 'ms2', name: 'Testing', revenuePercentage: 50, status: 'pending' as const },
      ]

      const amount = calculateMilestoneAmount(10000, milestones, ['ms1', 'ms2'])

      expect(amount).toBe(10000)
    })
  })
})

// =============================================================================
// Revenue Recognition Manager Tests
// =============================================================================

describe('RevenueRecognitionManager', () => {
  let manager: RevenueRecognitionManager

  beforeEach(() => {
    manager = createRevenueRecognitionManager()
  })

  describe('Contract Management', () => {
    it('should create a contract', async () => {
      const contract = await manager.createContract({
        customerId: 'cust_123',
        transactionPrice: 12000,
        effectiveDate: new Date('2024-01-01'),
        terminationDate: new Date('2024-12-31'),
      })

      expect(contract.id).toBeTruthy()
      expect(contract.contractNumber).toMatch(/^CTR-/)
      expect(contract.customerId).toBe('cust_123')
      expect(contract.transactionPrice).toBe(12000)
      expect(contract.status).toBe('draft')
      expect(contract.recognizedRevenue).toBe(0)
      expect(contract.deferredRevenue).toBe(12000)
    })

    it('should create contract with custom contract number', async () => {
      const contract = await manager.createContract({
        customerId: 'cust_123',
        contractNumber: 'CUSTOM-001',
        transactionPrice: 12000,
        effectiveDate: new Date('2024-01-01'),
      })

      expect(contract.contractNumber).toBe('CUSTOM-001')
    })

    it('should get contract by ID', async () => {
      const created = await manager.createContract({
        customerId: 'cust_123',
        transactionPrice: 12000,
        effectiveDate: new Date('2024-01-01'),
      })

      const retrieved = await manager.getContract(created.id)

      expect(retrieved).toBeDefined()
      expect(retrieved!.id).toBe(created.id)
    })

    it('should get contract by contract number', async () => {
      const created = await manager.createContract({
        customerId: 'cust_123',
        contractNumber: 'CTR-TEST-001',
        transactionPrice: 12000,
        effectiveDate: new Date('2024-01-01'),
      })

      const retrieved = await manager.getContractByNumber('CTR-TEST-001')

      expect(retrieved).toBeDefined()
      expect(retrieved!.id).toBe(created.id)
    })

    it('should return null for non-existent contract', async () => {
      const contract = await manager.getContract('non-existent')

      expect(contract).toBeNull()
    })

    it('should update draft contract', async () => {
      const contract = await manager.createContract({
        customerId: 'cust_123',
        transactionPrice: 12000,
        effectiveDate: new Date('2024-01-01'),
      })

      const updated = await manager.updateContract(contract.id, {
        transactionPrice: 15000,
      })

      expect(updated.transactionPrice).toBe(15000)
      expect(updated.deferredRevenue).toBe(15000)
    })

    it('should not allow updating non-draft contracts', async () => {
      const contract = await manager.createContract({
        customerId: 'cust_123',
        transactionPrice: 12000,
        effectiveDate: new Date('2024-01-01'),
      })

      await manager.addObligation({
        contractId: contract.id,
        name: 'Service',
        recognitionMethod: 'straight_line',
        standaloneSellingPrice: 12000,
      })

      await manager.activateContract(contract.id)

      await expect(
        manager.updateContract(contract.id, { transactionPrice: 15000 })
      ).rejects.toThrow('Can only update draft contracts')
    })

    it('should activate contract with obligations', async () => {
      const contract = await manager.createContract({
        customerId: 'cust_123',
        transactionPrice: 12000,
        effectiveDate: new Date('2024-01-01'),
      })

      await manager.addObligation({
        contractId: contract.id,
        name: 'Annual Support',
        recognitionMethod: 'straight_line',
        standaloneSellingPrice: 12000,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
      })

      const activated = await manager.activateContract(contract.id)

      expect(activated.status).toBe('active')
      expect(activated.obligations[0].status).toBe('in_progress')
    })

    it('should not activate contract without obligations', async () => {
      const contract = await manager.createContract({
        customerId: 'cust_123',
        transactionPrice: 12000,
        effectiveDate: new Date('2024-01-01'),
      })

      await expect(manager.activateContract(contract.id)).rejects.toThrow(
        'Contract must have at least one performance obligation'
      )
    })

    it('should terminate contract', async () => {
      const contract = await manager.createContract({
        customerId: 'cust_123',
        transactionPrice: 12000,
        effectiveDate: new Date('2024-01-01'),
      })

      await manager.addObligation({
        contractId: contract.id,
        name: 'Service',
        recognitionMethod: 'straight_line',
        standaloneSellingPrice: 12000,
      })

      await manager.activateContract(contract.id)

      const terminated = await manager.terminateContract(contract.id, 'Customer request')

      expect(terminated.status).toBe('terminated')
      expect(terminated.metadata?.terminationReason).toBe('Customer request')
      expect(terminated.obligations[0].status).toBe('cancelled')
    })

    it('should modify contract', async () => {
      const contract = await manager.createContract({
        customerId: 'cust_123',
        transactionPrice: 12000,
        effectiveDate: new Date('2024-01-01'),
      })

      await manager.addObligation({
        contractId: contract.id,
        name: 'Service',
        recognitionMethod: 'straight_line',
        standaloneSellingPrice: 12000,
      })

      await manager.activateContract(contract.id)

      const modified = await manager.modifyContract(contract.id, {
        modificationDate: new Date(),
        description: 'Added premium support',
        priceChange: 3000,
        treatmentType: 'prospective',
        newTransactionPrice: 15000,
      })

      expect(modified.status).toBe('modified')
      expect(modified.transactionPrice).toBe(15000)
      expect(modified.modifications).toHaveLength(1)
      expect(modified.modifications![0].previousTransactionPrice).toBe(12000)
    })
  })

  describe('Performance Obligations', () => {
    let contract: Contract

    beforeEach(async () => {
      contract = await manager.createContract({
        customerId: 'cust_123',
        transactionPrice: 12000,
        effectiveDate: new Date('2024-01-01'),
        terminationDate: new Date('2024-12-31'),
      })
    })

    it('should add obligation to contract', async () => {
      const obligation = await manager.addObligation({
        contractId: contract.id,
        name: 'Annual Support',
        recognitionMethod: 'straight_line',
        standaloneSellingPrice: 12000,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
      })

      expect(obligation.id).toBeTruthy()
      expect(obligation.contractId).toBe(contract.id)
      expect(obligation.name).toBe('Annual Support')
      expect(obligation.recognitionMethod).toBe('straight_line')
      expect(obligation.status).toBe('pending')
    })

    it('should add obligation with milestones', async () => {
      const obligation = await manager.addObligation({
        contractId: contract.id,
        name: 'Implementation Project',
        recognitionMethod: 'milestone',
        standaloneSellingPrice: 12000,
        milestones: [
          { name: 'Design', revenuePercentage: 25 },
          { name: 'Development', revenuePercentage: 50 },
          { name: 'Testing', revenuePercentage: 25 },
        ],
      })

      expect(obligation.milestones).toHaveLength(3)
      expect(obligation.milestones![0].name).toBe('Design')
      expect(obligation.milestones![0].status).toBe('pending')
    })

    it('should allocate transaction price to obligations', async () => {
      await manager.addObligation({
        contractId: contract.id,
        name: 'Software License',
        recognitionMethod: 'point_in_time',
        standaloneSellingPrice: 8000,
      })

      await manager.addObligation({
        contractId: contract.id,
        name: 'Support Services',
        recognitionMethod: 'straight_line',
        standaloneSellingPrice: 4000,
      })

      const allocations = await manager.allocateTransactionPrice(contract.id)

      expect(allocations).toHaveLength(2)
      expect(allocations[0].allocatedAmount).toBe(8000)
      expect(allocations[1].allocatedAmount).toBe(4000)
    })

    it('should update obligation progress for usage-based', async () => {
      const obligation = await manager.addObligation({
        contractId: contract.id,
        name: 'API Calls',
        recognitionMethod: 'usage_based',
        standaloneSellingPrice: 10000,
        totalUnits: 1000000,
      })

      const updated = await manager.updateObligationProgress(obligation.id, {
        deliveredUnits: 500000,
      })

      expect(updated.deliveredUnits).toBe(500000)
    })

    it('should update obligation progress for percentage of completion', async () => {
      const obligation = await manager.addObligation({
        contractId: contract.id,
        name: 'Construction Project',
        recognitionMethod: 'percentage_of_completion',
        standaloneSellingPrice: 100000,
      })

      const updated = await manager.updateObligationProgress(obligation.id, {
        completionPercentage: 75,
      })

      expect(updated.completionPercentage).toBe(75)
    })

    it('should complete milestone and update obligation', async () => {
      const obligation = await manager.addObligation({
        contractId: contract.id,
        name: 'Implementation',
        recognitionMethod: 'milestone',
        standaloneSellingPrice: 12000,
        milestones: [
          { name: 'Phase 1', revenuePercentage: 50 },
          { name: 'Phase 2', revenuePercentage: 50 },
        ],
      })

      const milestoneId = obligation.milestones![0].id

      const updated = await manager.updateObligationProgress(obligation.id, {
        completedMilestoneId: milestoneId,
      })

      expect(updated.milestones![0].status).toBe('completed')
      expect(updated.milestones![0].completedAt).toBeDefined()
    })

    it('should satisfy obligation when all units delivered', async () => {
      const obligation = await manager.addObligation({
        contractId: contract.id,
        name: 'API Calls',
        recognitionMethod: 'usage_based',
        standaloneSellingPrice: 10000,
        totalUnits: 1000,
      })

      const updated = await manager.updateObligationProgress(obligation.id, {
        deliveredUnits: 1000,
      })

      expect(updated.status).toBe('satisfied')
      expect(updated.satisfiedAt).toBeDefined()
    })

    it('should manually satisfy obligation', async () => {
      const obligation = await manager.addObligation({
        contractId: contract.id,
        name: 'Consulting',
        recognitionMethod: 'point_in_time',
        standaloneSellingPrice: 12000, // Match contract transactionPrice since single obligation
      })

      await manager.allocateTransactionPrice(contract.id)
      await manager.activateContract(contract.id)

      const satisfied = await manager.satisfyObligation(obligation.id)

      expect(satisfied.status).toBe('satisfied')
      expect(satisfied.recognizedAmount).toBe(12000) // Gets 100% of transaction price
      expect(satisfied.deferredAmount).toBe(0)
    })
  })

  describe('Recognition Schedules', () => {
    it('should generate straight-line recognition schedule', async () => {
      const contract = await manager.createContract({
        customerId: 'cust_123',
        transactionPrice: 12000,
        effectiveDate: new Date('2024-01-01'),
        terminationDate: new Date('2024-12-31'),
      })

      await manager.addObligation({
        contractId: contract.id,
        name: 'Annual Support',
        recognitionMethod: 'straight_line',
        standaloneSellingPrice: 12000,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
      })

      await manager.allocateTransactionPrice(contract.id)

      const schedule = await manager.generateRecognitionSchedule(contract.id, {
        periodicity: 'monthly',
      })

      expect(schedule.entries.length).toBeGreaterThan(0)
      expect(schedule.totalAmount).toBe(12000)

      // Each monthly entry should be approximately 1000
      for (const entry of schedule.entries) {
        expect(entry.amount).toBeGreaterThan(0)
      }
    })

    it('should generate milestone-based recognition schedule', async () => {
      const contract = await manager.createContract({
        customerId: 'cust_123',
        transactionPrice: 10000,
        effectiveDate: new Date('2024-01-01'),
      })

      await manager.addObligation({
        contractId: contract.id,
        name: 'Project',
        recognitionMethod: 'milestone',
        standaloneSellingPrice: 10000,
        milestones: [
          { name: 'Design', revenuePercentage: 30, targetDate: new Date('2024-03-01') },
          { name: 'Build', revenuePercentage: 50, targetDate: new Date('2024-06-01') },
          { name: 'Launch', revenuePercentage: 20, targetDate: new Date('2024-09-01') },
        ],
      })

      await manager.allocateTransactionPrice(contract.id)

      const schedule = await manager.generateRecognitionSchedule(contract.id)

      expect(schedule.entries).toHaveLength(3)
      expect(schedule.entries[0].amount).toBe(3000)
      expect(schedule.entries[1].amount).toBe(5000)
      expect(schedule.entries[2].amount).toBe(2000)
    })

    it('should generate point-in-time recognition schedule', async () => {
      const contract = await manager.createContract({
        customerId: 'cust_123',
        transactionPrice: 5000,
        effectiveDate: new Date('2024-01-01'),
      })

      await manager.addObligation({
        contractId: contract.id,
        name: 'License Delivery',
        recognitionMethod: 'point_in_time',
        standaloneSellingPrice: 5000,
        startDate: new Date('2024-01-15'),
      })

      await manager.allocateTransactionPrice(contract.id)

      const schedule = await manager.generateRecognitionSchedule(contract.id)

      expect(schedule.entries).toHaveLength(1)
      expect(schedule.entries[0].amount).toBe(5000)
    })
  })

  describe('Revenue Recognition', () => {
    it('should recognize revenue for straight-line obligation', async () => {
      const contract = await manager.createContract({
        customerId: 'cust_123',
        transactionPrice: 12000,
        effectiveDate: new Date('2024-01-01'),
        terminationDate: new Date('2024-12-31'),
      })

      await manager.addObligation({
        contractId: contract.id,
        name: 'Annual Support',
        recognitionMethod: 'straight_line',
        standaloneSellingPrice: 12000,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
      })

      await manager.allocateTransactionPrice(contract.id)
      await manager.activateContract(contract.id)

      // Recognize as of end of June (half year)
      const result = await manager.recognizeRevenue(contract.id, {
        asOfDate: new Date('2024-06-30'),
      })

      expect(result.recognized).toBeGreaterThan(0)
      expect(result.remaining).toBeLessThan(12000)
      expect(result.entries).toHaveLength(1)
    })

    it('should recognize revenue for usage-based obligation', async () => {
      const contract = await manager.createContract({
        customerId: 'cust_123',
        transactionPrice: 10000,
        effectiveDate: new Date('2024-01-01'),
      })

      const obligation = await manager.addObligation({
        contractId: contract.id,
        name: 'API Credits',
        recognitionMethod: 'usage_based',
        standaloneSellingPrice: 10000,
        totalUnits: 100,
      })

      await manager.allocateTransactionPrice(contract.id)
      await manager.activateContract(contract.id)

      // Update usage
      await manager.updateObligationProgress(obligation.id, {
        deliveredUnits: 50,
      })

      const result = await manager.recognizeRevenue(contract.id)

      expect(result.recognized).toBe(5000)
      expect(result.remaining).toBe(5000)
    })

    it('should recognize revenue for milestone-based obligation', async () => {
      const contract = await manager.createContract({
        customerId: 'cust_123',
        transactionPrice: 10000,
        effectiveDate: new Date('2024-01-01'),
      })

      const obligation = await manager.addObligation({
        contractId: contract.id,
        name: 'Project',
        recognitionMethod: 'milestone',
        standaloneSellingPrice: 10000,
        milestones: [
          { name: 'Design', revenuePercentage: 30 },
          { name: 'Build', revenuePercentage: 50 },
          { name: 'Launch', revenuePercentage: 20 },
        ],
      })

      await manager.allocateTransactionPrice(contract.id)
      await manager.activateContract(contract.id)

      // Complete first milestone
      const milestoneId = obligation.milestones![0].id
      await manager.updateObligationProgress(obligation.id, {
        completedMilestoneId: milestoneId,
      })

      const result = await manager.recognizeRevenue(contract.id)

      expect(result.recognized).toBe(3000)
      expect(result.remaining).toBe(7000)
    })

    it('should not double-recognize revenue', async () => {
      const contract = await manager.createContract({
        customerId: 'cust_123',
        transactionPrice: 10000,
        effectiveDate: new Date('2024-01-01'),
      })

      const obligation = await manager.addObligation({
        contractId: contract.id,
        name: 'API Credits',
        recognitionMethod: 'usage_based',
        standaloneSellingPrice: 10000,
        totalUnits: 100,
      })

      await manager.allocateTransactionPrice(contract.id)
      await manager.activateContract(contract.id)

      await manager.updateObligationProgress(obligation.id, {
        deliveredUnits: 50,
      })

      // First recognition
      const result1 = await manager.recognizeRevenue(contract.id)
      expect(result1.recognized).toBe(5000)

      // Second recognition without additional usage should recognize nothing
      const result2 = await manager.recognizeRevenue(contract.id)
      expect(result2.recognized).toBe(0)
    })
  })

  describe('Period Summaries', () => {
    it('should get period summary', async () => {
      const contract = await manager.createContract({
        customerId: 'cust_123',
        transactionPrice: 12000,
        effectiveDate: new Date('2024-01-01'),
        terminationDate: new Date('2024-12-31'),
      })

      await manager.addObligation({
        contractId: contract.id,
        name: 'Annual Support',
        recognitionMethod: 'straight_line',
        standaloneSellingPrice: 12000,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
      })

      await manager.allocateTransactionPrice(contract.id)
      await manager.activateContract(contract.id)

      await manager.recognizeRevenue(contract.id, {
        asOfDate: new Date('2024-01-31'),
      })

      const summary = await manager.getPeriodSummary({ year: 2024, month: 1 })

      expect(summary.period.year).toBe(2024)
      expect(summary.period.month).toBe(1)
      expect(summary.recognizedRevenue).toBeGreaterThan(0)
    })

    it('should get deferred revenue balance', async () => {
      const contract = await manager.createContract({
        customerId: 'cust_123',
        transactionPrice: 12000,
        effectiveDate: new Date('2024-01-01'),
        terminationDate: new Date('2024-12-31'),
      })

      await manager.addObligation({
        contractId: contract.id,
        name: 'Annual Support',
        recognitionMethod: 'straight_line',
        standaloneSellingPrice: 12000,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
      })

      await manager.allocateTransactionPrice(contract.id)

      const balance = await manager.getDeferredRevenueBalance()

      expect(balance.total).toBe(12000)
      expect(balance.byContract).toHaveLength(1)
      expect(balance.byContract[0].amount).toBe(12000)
    })
  })

  describe('Query and Reporting', () => {
    it('should query contracts by customer', async () => {
      await manager.createContract({
        customerId: 'cust_123',
        transactionPrice: 10000,
        effectiveDate: new Date('2024-01-01'),
      })

      await manager.createContract({
        customerId: 'cust_456',
        transactionPrice: 20000,
        effectiveDate: new Date('2024-01-01'),
      })

      const contracts = await manager.getContractsByCustomer('cust_123')

      expect(contracts).toHaveLength(1)
      expect(contracts[0].customerId).toBe('cust_123')
    })

    it('should query contracts by status', async () => {
      const contract1 = await manager.createContract({
        customerId: 'cust_123',
        transactionPrice: 10000,
        effectiveDate: new Date('2024-01-01'),
      })

      await manager.addObligation({
        contractId: contract1.id,
        name: 'Service',
        recognitionMethod: 'straight_line',
        standaloneSellingPrice: 10000,
      })

      await manager.activateContract(contract1.id)

      await manager.createContract({
        customerId: 'cust_456',
        transactionPrice: 20000,
        effectiveDate: new Date('2024-01-01'),
      })

      const activeContracts = await manager.queryContracts({ status: 'active' })
      const draftContracts = await manager.queryContracts({ status: 'draft' })

      expect(activeContracts).toHaveLength(1)
      expect(draftContracts).toHaveLength(1)
    })

    it('should export ASC 606 report', async () => {
      const contract = await manager.createContract({
        customerId: 'cust_123',
        transactionPrice: 12000,
        effectiveDate: new Date('2024-01-01'),
        terminationDate: new Date('2024-12-31'),
      })

      await manager.addObligation({
        contractId: contract.id,
        name: 'Annual Support',
        recognitionMethod: 'straight_line',
        standaloneSellingPrice: 12000,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
      })

      await manager.allocateTransactionPrice(contract.id)
      await manager.activateContract(contract.id)

      await manager.recognizeRevenue(contract.id, {
        asOfDate: new Date('2024-03-31'),
      })

      const report = await manager.exportASC606Report({
        periodStart: new Date('2024-01-01'),
        periodEnd: new Date('2024-12-31'),
      })

      expect(report.contracts).toHaveLength(1)
      expect(report.totalRecognized).toBeGreaterThan(0)
      expect(report.totalDeferred).toBeGreaterThan(0)
      expect(report.movements.openingBalance).toBeDefined()
      expect(report.movements.closingBalance).toBeDefined()
    })
  })

  describe('Multi-Element Arrangements', () => {
    it('should handle contract with multiple obligations', async () => {
      const contract = await manager.createContract({
        customerId: 'cust_123',
        transactionPrice: 15000,
        effectiveDate: new Date('2024-01-01'),
        terminationDate: new Date('2024-12-31'),
      })

      // Software license (point-in-time)
      await manager.addObligation({
        contractId: contract.id,
        name: 'Software License',
        recognitionMethod: 'point_in_time',
        standaloneSellingPrice: 10000,
      })

      // Implementation services (milestone)
      await manager.addObligation({
        contractId: contract.id,
        name: 'Implementation',
        recognitionMethod: 'milestone',
        standaloneSellingPrice: 3000,
        milestones: [
          { name: 'Setup', revenuePercentage: 50 },
          { name: 'Go-live', revenuePercentage: 50 },
        ],
      })

      // Support (straight-line)
      await manager.addObligation({
        contractId: contract.id,
        name: 'Support',
        recognitionMethod: 'straight_line',
        standaloneSellingPrice: 2000,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
      })

      const allocations = await manager.allocateTransactionPrice(contract.id)

      // Total SSP = 15000, Transaction Price = 15000
      // Allocations should equal SSP in this case
      expect(allocations).toHaveLength(3)
      expect(allocations[0].allocatedAmount).toBe(10000)
      expect(allocations[1].allocatedAmount).toBe(3000)
      expect(allocations[2].allocatedAmount).toBe(2000)

      // Verify contract totals
      const updated = await manager.getContract(contract.id)
      expect(updated!.obligations).toHaveLength(3)
    })

    it('should handle bundled discount allocation', async () => {
      // Contract with discount: selling for 12000 when SSP total is 15000
      const contract = await manager.createContract({
        customerId: 'cust_123',
        transactionPrice: 12000, // 20% bundled discount
        effectiveDate: new Date('2024-01-01'),
      })

      await manager.addObligation({
        contractId: contract.id,
        name: 'Product A',
        recognitionMethod: 'point_in_time',
        standaloneSellingPrice: 10000,
      })

      await manager.addObligation({
        contractId: contract.id,
        name: 'Product B',
        recognitionMethod: 'point_in_time',
        standaloneSellingPrice: 5000,
      })

      const allocations = await manager.allocateTransactionPrice(contract.id)

      // SSP ratio: A = 10000/15000 = 2/3, B = 5000/15000 = 1/3
      // A allocation: 12000 * 2/3 = 8000
      // B allocation: 12000 * 1/3 = 4000
      expect(allocations[0].allocatedAmount).toBe(8000)
      expect(allocations[1].allocatedAmount).toBe(4000)
    })
  })

  describe('Contract Lifecycle', () => {
    it('should complete contract when all obligations satisfied', async () => {
      const contract = await manager.createContract({
        customerId: 'cust_123',
        transactionPrice: 5000,
        effectiveDate: new Date('2024-01-01'),
      })

      const obligation = await manager.addObligation({
        contractId: contract.id,
        name: 'Delivery',
        recognitionMethod: 'point_in_time',
        standaloneSellingPrice: 5000,
      })

      await manager.allocateTransactionPrice(contract.id)
      await manager.activateContract(contract.id)

      await manager.satisfyObligation(obligation.id)

      const updated = await manager.getContract(contract.id)

      expect(updated!.status).toBe('completed')
      expect(updated!.recognizedRevenue).toBe(5000)
      expect(updated!.deferredRevenue).toBe(0)
    })

    it('should not complete contract until all obligations satisfied', async () => {
      const contract = await manager.createContract({
        customerId: 'cust_123',
        transactionPrice: 10000,
        effectiveDate: new Date('2024-01-01'),
      })

      const obl1 = await manager.addObligation({
        contractId: contract.id,
        name: 'Product',
        recognitionMethod: 'point_in_time',
        standaloneSellingPrice: 7000,
      })

      await manager.addObligation({
        contractId: contract.id,
        name: 'Support',
        recognitionMethod: 'straight_line',
        standaloneSellingPrice: 3000,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
      })

      await manager.allocateTransactionPrice(contract.id)
      await manager.activateContract(contract.id)

      // Satisfy only first obligation
      await manager.satisfyObligation(obl1.id)

      const updated = await manager.getContract(contract.id)

      // Should still be active since support is not satisfied
      expect(updated!.status).toBe('active')
    })
  })
})

// =============================================================================
// Accounting Export Helper Tests
// =============================================================================

import {
  createDeferredRevenueEntry,
  createRevenueRecognitionEntry,
  createUnbilledRevenueEntry,
  createBatchRecognitionEntries,
  createAccountingExportSummary,
  validateJournalEntries,
  formatJournalEntriesAsCSV,
  DEFAULT_REVENUE_ACCOUNT_CODES,
  type DeferredRevenueEntry as DRE,
} from '../revenue-recognition'

describe('Accounting Export Helpers', () => {
  describe('createDeferredRevenueEntry', () => {
    it('should create a deferred revenue journal entry', () => {
      const entry = createDeferredRevenueEntry(10000, 'ctr_123')

      expect(entry.type).toBe('deferred_revenue')
      expect(entry.contractId).toBe('ctr_123')
      expect(entry.totalCredit).toBe(10000)
      expect(entry.totalDebit).toBe(0)
      expect(entry.lines).toHaveLength(1)
      expect(entry.lines[0].credit).toBe(10000)
      expect(entry.lines[0].debit).toBe(0)
    })

    it('should use custom account codes', () => {
      const entry = createDeferredRevenueEntry(5000, 'ctr_456', {
        accountCodes: {
          contractLiabilities: '2500',
        },
      })

      expect(entry.lines[0].accountCode).toBe('2500')
    })

    it('should include obligation ID when provided', () => {
      const entry = createDeferredRevenueEntry(5000, 'ctr_123', {
        obligationId: 'obl_789',
      })

      expect(entry.obligationId).toBe('obl_789')
      expect(entry.lines[0].memo).toContain('obl_789')
    })

    it('should include metadata when requested', () => {
      const entry = createDeferredRevenueEntry(5000, 'ctr_123', {
        includeMetadata: true,
        currency: 'EUR',
      })

      expect(entry.metadata).toBeDefined()
      expect(entry.metadata?.currency).toBe('EUR')
    })
  })

  describe('createRevenueRecognitionEntry', () => {
    it('should create a balanced revenue recognition entry', () => {
      const deferredEntry: DRE = {
        id: 'dre_123',
        contractId: 'ctr_456',
        obligationId: 'obl_789',
        amount: 1000,
        periodStart: new Date('2024-01-01'),
        periodEnd: new Date('2024-01-31'),
        recognizedAt: new Date('2024-01-31'),
        status: 'recognized',
        createdAt: new Date(),
      }

      const entry = createRevenueRecognitionEntry(deferredEntry)

      expect(entry.type).toBe('recognition')
      expect(entry.contractId).toBe('ctr_456')
      expect(entry.obligationId).toBe('obl_789')
      expect(entry.deferredEntryId).toBe('dre_123')
      expect(entry.totalDebit).toBe(1000)
      expect(entry.totalCredit).toBe(1000)
      expect(entry.lines).toHaveLength(2)

      // Debit to deferred revenue
      expect(entry.lines[0].debit).toBe(1000)
      expect(entry.lines[0].credit).toBe(0)
      expect(entry.lines[0].accountCode).toBe(DEFAULT_REVENUE_ACCOUNT_CODES.deferredRevenue)

      // Credit to recognized revenue
      expect(entry.lines[1].debit).toBe(0)
      expect(entry.lines[1].credit).toBe(1000)
      expect(entry.lines[1].accountCode).toBe(DEFAULT_REVENUE_ACCOUNT_CODES.recognizedRevenue)
    })

    it('should use periodEnd as date when recognizedAt is not set', () => {
      const deferredEntry: DRE = {
        id: 'dre_123',
        contractId: 'ctr_456',
        obligationId: 'obl_789',
        amount: 1000,
        periodStart: new Date('2024-01-01'),
        periodEnd: new Date('2024-01-31'),
        status: 'recognized',
        createdAt: new Date(),
      }

      const entry = createRevenueRecognitionEntry(deferredEntry)

      expect(entry.date).toEqual(deferredEntry.periodEnd)
    })
  })

  describe('createUnbilledRevenueEntry', () => {
    it('should create an unbilled revenue entry', () => {
      const entry = createUnbilledRevenueEntry(2500, 'ctr_123')

      expect(entry.type).toBe('unbilled_revenue')
      expect(entry.totalDebit).toBe(2500)
      expect(entry.totalCredit).toBe(2500)
      expect(entry.lines).toHaveLength(2)

      // Debit to unbilled receivables
      expect(entry.lines[0].debit).toBe(2500)
      expect(entry.lines[0].accountCode).toBe(DEFAULT_REVENUE_ACCOUNT_CODES.unbilledReceivables)

      // Credit to revenue
      expect(entry.lines[1].credit).toBe(2500)
      expect(entry.lines[1].accountCode).toBe(DEFAULT_REVENUE_ACCOUNT_CODES.recognizedRevenue)
    })
  })

  describe('createBatchRecognitionEntries', () => {
    it('should create entries for recognized items only', () => {
      const entries: DRE[] = [
        {
          id: 'dre_1',
          contractId: 'ctr_1',
          obligationId: 'obl_1',
          amount: 1000,
          periodStart: new Date('2024-01-01'),
          periodEnd: new Date('2024-01-31'),
          recognizedAt: new Date('2024-01-31'),
          status: 'recognized',
          createdAt: new Date(),
        },
        {
          id: 'dre_2',
          contractId: 'ctr_1',
          obligationId: 'obl_1',
          amount: 1000,
          periodStart: new Date('2024-02-01'),
          periodEnd: new Date('2024-02-29'),
          status: 'scheduled', // Not recognized yet
          createdAt: new Date(),
        },
        {
          id: 'dre_3',
          contractId: 'ctr_2',
          obligationId: 'obl_2',
          amount: 500,
          periodStart: new Date('2024-01-01'),
          periodEnd: new Date('2024-01-31'),
          recognizedAt: new Date('2024-01-31'),
          status: 'recognized',
          createdAt: new Date(),
        },
      ]

      const journalEntries = createBatchRecognitionEntries(entries)

      expect(journalEntries).toHaveLength(2)
      expect(journalEntries[0].deferredEntryId).toBe('dre_1')
      expect(journalEntries[1].deferredEntryId).toBe('dre_3')
    })
  })

  describe('createAccountingExportSummary', () => {
    it('should create summary with correct totals', () => {
      const entries: DRE[] = [
        {
          id: 'dre_1',
          contractId: 'ctr_1',
          obligationId: 'obl_1',
          amount: 1000,
          periodStart: new Date('2024-01-01'),
          periodEnd: new Date('2024-01-31'),
          recognizedAt: new Date('2024-01-15'),
          status: 'recognized',
          createdAt: new Date(),
        },
        {
          id: 'dre_2',
          contractId: 'ctr_1',
          obligationId: 'obl_1',
          amount: 1000,
          periodStart: new Date('2024-02-01'),
          periodEnd: new Date('2024-02-29'),
          status: 'scheduled',
          createdAt: new Date(),
        },
      ]

      const result = createAccountingExportSummary(
        entries,
        new Date('2024-01-01'),
        new Date('2024-01-31')
      )

      expect(result.summary.totalRecognizedRevenue).toBe(1000)
      expect(result.summary.totalDeferredRevenue).toBe(1000)
      expect(result.summary.entryCount).toBe(1)
      expect(result.journalEntries).toHaveLength(1)
    })
  })

  describe('validateJournalEntries', () => {
    it('should validate balanced entries', () => {
      const entries = [
        createRevenueRecognitionEntry({
          id: 'dre_1',
          contractId: 'ctr_1',
          obligationId: 'obl_1',
          amount: 1000,
          periodStart: new Date('2024-01-01'),
          periodEnd: new Date('2024-01-31'),
          status: 'recognized',
          createdAt: new Date(),
        }),
      ]

      const result = validateJournalEntries(entries)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should detect unbalanced entries', () => {
      const entry = createRevenueRecognitionEntry({
        id: 'dre_1',
        contractId: 'ctr_1',
        obligationId: 'obl_1',
        amount: 1000,
        periodStart: new Date('2024-01-01'),
        periodEnd: new Date('2024-01-31'),
        status: 'recognized',
        createdAt: new Date(),
      })

      // Manually break the balance
      entry.lines[0].debit = 1500

      const result = validateJournalEntries([entry])

      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors[0]).toContain('unbalanced')
    })

    it('should detect incorrect totals', () => {
      const entry = createRevenueRecognitionEntry({
        id: 'dre_1',
        contractId: 'ctr_1',
        obligationId: 'obl_1',
        amount: 1000,
        periodStart: new Date('2024-01-01'),
        periodEnd: new Date('2024-01-31'),
        status: 'recognized',
        createdAt: new Date(),
      })

      // Manually break the total
      entry.totalDebit = 2000

      const result = validateJournalEntries([entry])

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('totalDebit'))).toBe(true)
    })
  })

  describe('formatJournalEntriesAsCSV', () => {
    it('should format entries as CSV', () => {
      const entries = [
        createRevenueRecognitionEntry({
          id: 'dre_1',
          contractId: 'ctr_1',
          obligationId: 'obl_1',
          amount: 1000,
          periodStart: new Date('2024-01-01'),
          periodEnd: new Date('2024-01-31'),
          recognizedAt: new Date('2024-01-31'),
          status: 'recognized',
          createdAt: new Date(),
        }),
      ]

      const csv = formatJournalEntriesAsCSV(entries)

      expect(csv).toContain('Date')
      expect(csv).toContain('Reference')
      expect(csv).toContain('Account Code')
      expect(csv).toContain('Debit')
      expect(csv).toContain('Credit')
      expect(csv).toContain('2024-01-31')
      expect(csv).toContain('recognition')
      expect(csv).toContain('1000.00')
      expect(csv).toContain('ctr_1')
    })

    it('should handle multiple entries', () => {
      const entries = [
        createRevenueRecognitionEntry({
          id: 'dre_1',
          contractId: 'ctr_1',
          obligationId: 'obl_1',
          amount: 1000,
          periodStart: new Date('2024-01-01'),
          periodEnd: new Date('2024-01-31'),
          status: 'recognized',
          createdAt: new Date(),
        }),
        createRevenueRecognitionEntry({
          id: 'dre_2',
          contractId: 'ctr_2',
          obligationId: 'obl_2',
          amount: 2000,
          periodStart: new Date('2024-01-01'),
          periodEnd: new Date('2024-01-31'),
          status: 'recognized',
          createdAt: new Date(),
        }),
      ]

      const csv = formatJournalEntriesAsCSV(entries)
      const lines = csv.split('\n')

      // Header + 2 lines per entry (debit and credit) = 1 + 4 = 5 lines
      expect(lines.length).toBe(5)
    })
  })

  describe('DEFAULT_REVENUE_ACCOUNT_CODES', () => {
    it('should have standard account codes', () => {
      expect(DEFAULT_REVENUE_ACCOUNT_CODES.deferredRevenue).toBe('2400')
      expect(DEFAULT_REVENUE_ACCOUNT_CODES.recognizedRevenue).toBe('4000')
      expect(DEFAULT_REVENUE_ACCOUNT_CODES.unbilledReceivables).toBe('1150')
      expect(DEFAULT_REVENUE_ACCOUNT_CODES.contractAssets).toBe('1160')
      expect(DEFAULT_REVENUE_ACCOUNT_CODES.contractLiabilities).toBe('2410')
    })
  })
})

/**
 * Revenue Recognition - ASC 606 compliant revenue recognition helpers
 *
 * Provides comprehensive revenue recognition functionality:
 * - Deferred revenue tracking
 * - Recognition schedule generation
 * - ASC 606 five-step model compliance
 * - Period-based recognition (straight-line, usage-based, milestone)
 * - Contract liability management
 * - Multi-element arrangements
 * - Performance obligation tracking
 * - Revenue allocation by standalone selling price
 *
 * ASC 606 Five-Step Model:
 * 1. Identify the contract(s) with a customer
 * 2. Identify the performance obligations in the contract
 * 3. Determine the transaction price
 * 4. Allocate the transaction price to performance obligations
 * 5. Recognize revenue when (or as) the entity satisfies a performance obligation
 *
 * @module db/primitives/commerce/revenue-recognition
 */

// =============================================================================
// Types
// =============================================================================

export type RecognitionMethod =
  | 'straight_line' // Equal recognition over time
  | 'usage_based' // Based on usage/consumption
  | 'milestone' // At specific milestones
  | 'point_in_time' // All at once when delivered
  | 'percentage_of_completion' // Based on completion %
  | 'output_method' // Based on outputs delivered
  | 'input_method' // Based on inputs consumed

export type ObligationStatus =
  | 'pending' // Not yet started
  | 'in_progress' // Partially satisfied
  | 'satisfied' // Fully delivered
  | 'cancelled' // Cancelled before completion

export type ContractStatus =
  | 'draft' // Contract being prepared
  | 'active' // Contract in force
  | 'completed' // All obligations satisfied
  | 'terminated' // Contract ended early
  | 'modified' // Contract has been modified

export interface PerformanceObligation {
  id: string
  contractId: string
  name: string
  description?: string
  recognitionMethod: RecognitionMethod
  status: ObligationStatus

  // Pricing
  standaloneSellingPrice: number // SSP for allocation
  allocatedPrice: number // Price allocated from transaction price
  recognizedAmount: number // Amount recognized to date
  deferredAmount: number // Remaining to recognize

  // Timing
  startDate?: Date
  endDate?: Date
  estimatedDuration?: number // Days
  satisfiedAt?: Date

  // For milestone-based recognition
  milestones?: Milestone[]

  // For usage-based recognition
  totalUnits?: number
  deliveredUnits?: number

  // For percentage of completion
  completionPercentage?: number

  // Metadata
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export interface Milestone {
  id: string
  name: string
  description?: string
  targetDate?: Date
  completedAt?: Date
  revenuePercentage: number // % of obligation revenue
  status: 'pending' | 'completed'
}

export interface Contract {
  id: string
  contractNumber: string
  customerId: string
  status: ContractStatus

  // Pricing
  transactionPrice: number // Total contract value
  variableConsideration?: number // Estimated variable amounts
  adjustedTransactionPrice?: number // After constraint adjustments
  recognizedRevenue: number // Total recognized to date
  deferredRevenue: number // Total remaining

  // Contract dates
  effectiveDate: Date
  terminationDate?: Date
  renewalDate?: Date

  // Related entities
  orderId?: string
  invoiceIds?: string[]

  // Performance obligations
  obligations: PerformanceObligation[]

  // Variable consideration constraint
  variableConsiderationConstraint?: {
    estimatedAmount: number
    constrainedAmount: number
    constraintReason?: string
  }

  // Modification history
  modifications?: ContractModification[]

  // Metadata
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export interface ContractModification {
  id: string
  modificationDate: Date
  description: string
  priceChange: number
  treatmentType: 'separate_contract' | 'prospective' | 'cumulative_catchup'
  previousTransactionPrice: number
  newTransactionPrice: number
}

export interface DeferredRevenueEntry {
  id: string
  contractId: string
  obligationId: string
  amount: number
  periodStart: Date
  periodEnd: Date
  recognizedAt?: Date
  status: 'scheduled' | 'recognized' | 'reversed'
  journalEntryId?: string
  metadata?: Record<string, unknown>
  createdAt: Date
}

export interface RecognitionSchedule {
  contractId: string
  obligationId?: string
  entries: RecognitionScheduleEntry[]
  totalAmount: number
  recognizedToDate: number
  remainingAmount: number
  startDate: Date
  endDate: Date
}

export interface RecognitionScheduleEntry {
  periodStart: Date
  periodEnd: Date
  amount: number
  cumulativeAmount: number
  recognitionPercentage: number
  status: 'future' | 'current' | 'recognized'
  deferredEntryId?: string
}

export interface RecognitionPeriod {
  year: number
  month?: number // 1-12
  quarter?: number // 1-4
}

export interface PeriodRecognitionSummary {
  period: RecognitionPeriod
  recognizedRevenue: number
  deferredRevenueStart: number
  deferredRevenueEnd: number
  newContracts: number
  completedObligations: number
  contracts: {
    contractId: string
    recognizedAmount: number
    deferredAmount: number
  }[]
}

export interface CreateContractInput {
  customerId: string
  contractNumber?: string
  transactionPrice: number
  effectiveDate: Date
  terminationDate?: Date
  orderId?: string
  variableConsideration?: number
  metadata?: Record<string, unknown>
}

export interface CreateObligationInput {
  contractId: string
  name: string
  description?: string
  recognitionMethod: RecognitionMethod
  standaloneSellingPrice: number
  startDate?: Date
  endDate?: Date
  estimatedDuration?: number
  milestones?: Omit<Milestone, 'id' | 'status' | 'completedAt'>[]
  totalUnits?: number
  metadata?: Record<string, unknown>
}

export interface UpdateObligationProgressInput {
  deliveredUnits?: number
  completionPercentage?: number
  completedMilestoneId?: string
}

export interface RecognitionQuery {
  contractId?: string
  customerId?: string
  periodStart?: Date
  periodEnd?: Date
  status?: ContractStatus
  includeCompleted?: boolean
}

export interface AllocationResult {
  obligationId: string
  standaloneSellingPrice: number
  allocationPercentage: number
  allocatedAmount: number
}

// =============================================================================
// Accounting Export Types
// =============================================================================

/**
 * Standard chart of accounts codes for revenue recognition
 */
export interface RevenueAccountCodes {
  deferredRevenue: string // Liability account (2400)
  recognizedRevenue: string // Revenue account (4000)
  unbilledReceivables?: string // Asset account (1150)
  contractAssets?: string // Asset account (1160)
  contractLiabilities?: string // Liability account (2410)
}

/**
 * Default account codes following standard chart of accounts
 */
export const DEFAULT_REVENUE_ACCOUNT_CODES: RevenueAccountCodes = {
  deferredRevenue: '2400', // Deferred Revenue (Unearned Revenue)
  recognizedRevenue: '4000', // Service Revenue / Sales Revenue
  unbilledReceivables: '1150', // Unbilled Receivables
  contractAssets: '1160', // Contract Assets
  contractLiabilities: '2410', // Contract Liabilities
}

/**
 * Journal entry line for double-entry accounting
 */
export interface JournalEntryLine {
  accountId: string
  accountCode: string
  description: string
  debit: number
  credit: number
  reference?: string
  memo?: string
}

/**
 * Journal entry structure for accounting export
 */
export interface AccountingJournalEntry {
  id?: string
  date: Date
  description: string
  reference: string
  type: 'deferred_revenue' | 'recognition' | 'unbilled_revenue' | 'contract_asset' | 'contract_liability'
  lines: JournalEntryLine[]
  totalDebit: number
  totalCredit: number
  contractId: string
  obligationId?: string
  deferredEntryId?: string
  metadata?: Record<string, unknown>
}

/**
 * Accounting export options
 */
export interface AccountingExportOptions {
  accountCodes?: Partial<RevenueAccountCodes>
  currency?: string
  includeMetadata?: boolean
}

/**
 * Batch journal entries result
 */
export interface AccountingExportResult {
  journalEntries: AccountingJournalEntry[]
  summary: {
    totalDeferredRevenue: number
    totalRecognizedRevenue: number
    entryCount: number
    periodStart: Date
    periodEnd: Date
  }
}

// =============================================================================
// Accounting Export Helpers
// =============================================================================

/**
 * Generate a journal entry for deferring revenue when payment is received
 *
 * Debit: Cash/Receivables (received)
 * Credit: Deferred Revenue (liability for future service)
 *
 * Note: This helper assumes cash has already been recorded elsewhere.
 * It creates the deferred revenue entry portion.
 */
export function createDeferredRevenueEntry(
  amount: number,
  contractId: string,
  options?: AccountingExportOptions & {
    date?: Date
    description?: string
    obligationId?: string
    reference?: string
  }
): AccountingJournalEntry {
  const codes = { ...DEFAULT_REVENUE_ACCOUNT_CODES, ...options?.accountCodes }
  const date = options?.date ?? new Date()

  return {
    date,
    description: options?.description ?? `Deferred revenue recorded for contract ${contractId}`,
    reference: options?.reference ?? `DR-${contractId}-${Date.now().toString(36)}`,
    type: 'deferred_revenue',
    lines: [
      {
        accountId: codes.contractLiabilities ?? codes.deferredRevenue,
        accountCode: codes.contractLiabilities ?? codes.deferredRevenue,
        description: 'Deferred revenue - unearned service obligation',
        debit: 0,
        credit: amount,
        reference: contractId,
        memo: options?.obligationId ? `Obligation: ${options.obligationId}` : undefined,
      },
    ],
    totalDebit: 0,
    totalCredit: amount,
    contractId,
    obligationId: options?.obligationId,
    metadata: options?.includeMetadata ? { currency: options.currency ?? 'USD' } : undefined,
  }
}

/**
 * Generate a journal entry for recognizing revenue
 *
 * Debit: Deferred Revenue (reduce liability)
 * Credit: Revenue (recognize income)
 */
export function createRevenueRecognitionEntry(
  deferredEntry: DeferredRevenueEntry,
  options?: AccountingExportOptions & {
    description?: string
    reference?: string
  }
): AccountingJournalEntry {
  const codes = { ...DEFAULT_REVENUE_ACCOUNT_CODES, ...options?.accountCodes }

  return {
    date: deferredEntry.recognizedAt ?? deferredEntry.periodEnd,
    description:
      options?.description ??
      `Revenue recognition for period ${deferredEntry.periodStart.toISOString().split('T')[0]} to ${deferredEntry.periodEnd.toISOString().split('T')[0]}`,
    reference: options?.reference ?? `RR-${deferredEntry.id}`,
    type: 'recognition',
    lines: [
      {
        accountId: codes.deferredRevenue,
        accountCode: codes.deferredRevenue,
        description: 'Reduce deferred revenue liability',
        debit: deferredEntry.amount,
        credit: 0,
        reference: deferredEntry.contractId,
        memo: `Recognition entry: ${deferredEntry.id}`,
      },
      {
        accountId: codes.recognizedRevenue,
        accountCode: codes.recognizedRevenue,
        description: 'Recognize service revenue',
        debit: 0,
        credit: deferredEntry.amount,
        reference: deferredEntry.contractId,
        memo: `Obligation: ${deferredEntry.obligationId}`,
      },
    ],
    totalDebit: deferredEntry.amount,
    totalCredit: deferredEntry.amount,
    contractId: deferredEntry.contractId,
    obligationId: deferredEntry.obligationId,
    deferredEntryId: deferredEntry.id,
    metadata: options?.includeMetadata
      ? {
          periodStart: deferredEntry.periodStart,
          periodEnd: deferredEntry.periodEnd,
          currency: options.currency ?? 'USD',
        }
      : undefined,
  }
}

/**
 * Generate a journal entry for unbilled revenue (revenue recognized before billing)
 *
 * Debit: Unbilled Receivables / Contract Asset
 * Credit: Revenue
 */
export function createUnbilledRevenueEntry(
  amount: number,
  contractId: string,
  options?: AccountingExportOptions & {
    date?: Date
    description?: string
    obligationId?: string
    reference?: string
  }
): AccountingJournalEntry {
  const codes = { ...DEFAULT_REVENUE_ACCOUNT_CODES, ...options?.accountCodes }
  const date = options?.date ?? new Date()

  return {
    date,
    description: options?.description ?? `Unbilled revenue for contract ${contractId}`,
    reference: options?.reference ?? `UR-${contractId}-${Date.now().toString(36)}`,
    type: 'unbilled_revenue',
    lines: [
      {
        accountId: codes.unbilledReceivables ?? codes.contractAssets ?? '1150',
        accountCode: codes.unbilledReceivables ?? codes.contractAssets ?? '1150',
        description: 'Unbilled receivables - revenue recognized before invoicing',
        debit: amount,
        credit: 0,
        reference: contractId,
      },
      {
        accountId: codes.recognizedRevenue,
        accountCode: codes.recognizedRevenue,
        description: 'Recognize revenue',
        debit: 0,
        credit: amount,
        reference: contractId,
      },
    ],
    totalDebit: amount,
    totalCredit: amount,
    contractId,
    obligationId: options?.obligationId,
    metadata: options?.includeMetadata ? { currency: options.currency ?? 'USD' } : undefined,
  }
}

/**
 * Generate journal entries for a batch of deferred revenue entries
 */
export function createBatchRecognitionEntries(
  entries: DeferredRevenueEntry[],
  options?: AccountingExportOptions
): AccountingJournalEntry[] {
  return entries
    .filter((entry) => entry.status === 'recognized')
    .map((entry) => createRevenueRecognitionEntry(entry, options))
}

/**
 * Generate accounting export summary for a period
 */
export function createAccountingExportSummary(
  entries: DeferredRevenueEntry[],
  periodStart: Date,
  periodEnd: Date,
  options?: AccountingExportOptions
): AccountingExportResult {
  const recognizedEntries = entries.filter(
    (e) =>
      e.status === 'recognized' &&
      e.recognizedAt &&
      e.recognizedAt >= periodStart &&
      e.recognizedAt <= periodEnd
  )

  const journalEntries = createBatchRecognitionEntries(recognizedEntries, options)

  const totalRecognizedRevenue = recognizedEntries.reduce((sum, e) => sum + e.amount, 0)
  const totalDeferredRevenue = entries
    .filter((e) => e.status === 'scheduled')
    .reduce((sum, e) => sum + e.amount, 0)

  return {
    journalEntries,
    summary: {
      totalDeferredRevenue,
      totalRecognizedRevenue,
      entryCount: journalEntries.length,
      periodStart,
      periodEnd,
    },
  }
}

/**
 * Validate that journal entries balance (debits = credits)
 */
export function validateJournalEntries(entries: AccountingJournalEntry[]): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  for (const entry of entries) {
    const totalDebit = entry.lines.reduce((sum, line) => sum + line.debit, 0)
    const totalCredit = entry.lines.reduce((sum, line) => sum + line.credit, 0)

    // Allow for floating point precision issues
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      errors.push(
        `Entry ${entry.reference} is unbalanced: debits=${totalDebit.toFixed(2)}, credits=${totalCredit.toFixed(2)}`
      )
    }

    if (Math.abs(entry.totalDebit - totalDebit) > 0.01) {
      errors.push(`Entry ${entry.reference} has incorrect totalDebit`)
    }

    if (Math.abs(entry.totalCredit - totalCredit) > 0.01) {
      errors.push(`Entry ${entry.reference} has incorrect totalCredit`)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Format journal entries for CSV export
 */
export function formatJournalEntriesAsCSV(entries: AccountingJournalEntry[]): string {
  const headers = [
    'Date',
    'Reference',
    'Type',
    'Account Code',
    'Description',
    'Debit',
    'Credit',
    'Contract ID',
    'Obligation ID',
  ]

  const rows: string[][] = [headers]

  for (const entry of entries) {
    for (const line of entry.lines) {
      rows.push([
        entry.date.toISOString().split('T')[0],
        entry.reference,
        entry.type,
        line.accountCode,
        line.description,
        line.debit > 0 ? line.debit.toFixed(2) : '',
        line.credit > 0 ? line.credit.toFixed(2) : '',
        entry.contractId,
        entry.obligationId ?? '',
      ])
    }
  }

  return rows.map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\n')
}

// =============================================================================
// ASC 606 Compliance Helpers
// =============================================================================

/**
 * Calculate allocation of transaction price based on relative SSP
 * ASC 606 Step 4: Allocate transaction price to performance obligations
 */
export function allocateTransactionPrice(
  transactionPrice: number,
  obligations: Array<{ id: string; standaloneSellingPrice: number }>
): AllocationResult[] {
  const totalSSP = obligations.reduce((sum, o) => sum + o.standaloneSellingPrice, 0)

  if (totalSSP === 0) {
    throw new Error('Total standalone selling price cannot be zero')
  }

  return obligations.map((obligation) => {
    const allocationPercentage = obligation.standaloneSellingPrice / totalSSP
    return {
      obligationId: obligation.id,
      standaloneSellingPrice: obligation.standaloneSellingPrice,
      allocationPercentage,
      allocatedAmount: Math.round(transactionPrice * allocationPercentage * 100) / 100,
    }
  })
}

/**
 * Apply variable consideration constraint
 * Revenue from variable consideration is only recognized to the extent
 * that it is highly probable a significant reversal won't occur
 */
export function applyVariableConsiderationConstraint(
  estimatedAmount: number,
  reversalProbability: number, // 0-1, where < 0.25 is "highly probable no reversal"
  constraintThreshold: number = 0.25
): { constrainedAmount: number; constraintApplied: boolean } {
  const constraintApplied = reversalProbability >= constraintThreshold

  return {
    constrainedAmount: constraintApplied ? 0 : estimatedAmount,
    constraintApplied,
  }
}

/**
 * Determine if revenue should be recognized over time or at a point in time
 * ASC 606 criteria for over-time recognition
 */
export function determineRecognitionTiming(criteria: {
  customerConsumesAsPerformed: boolean // Customer receives benefit as work performed
  customerControlsAssetAsCreated: boolean // Customer controls asset as created
  noAlternativeUse: boolean // Asset has no alternative use to seller
  hasEnforceableRight: boolean // Seller has right to payment for performance to date
}): { overTime: boolean; pointInTime: boolean; reason: string } {
  // Any of these criteria being true means over-time recognition
  if (criteria.customerConsumesAsPerformed) {
    return {
      overTime: true,
      pointInTime: false,
      reason: 'Customer simultaneously receives and consumes benefits',
    }
  }

  if (criteria.customerControlsAssetAsCreated) {
    return {
      overTime: true,
      pointInTime: false,
      reason: 'Customer controls asset as it is created or enhanced',
    }
  }

  if (criteria.noAlternativeUse && criteria.hasEnforceableRight) {
    return {
      overTime: true,
      pointInTime: false,
      reason: 'Asset has no alternative use and seller has right to payment for performance to date',
    }
  }

  return {
    overTime: false,
    pointInTime: true,
    reason: 'Does not meet criteria for over-time recognition',
  }
}

/**
 * Calculate straight-line recognition amount for a period
 */
export function calculateStraightLineAmount(
  totalAmount: number,
  periodStart: Date,
  periodEnd: Date,
  contractStart: Date,
  contractEnd: Date
): number {
  const contractDuration = contractEnd.getTime() - contractStart.getTime()
  const periodDuration = periodEnd.getTime() - periodStart.getTime()

  if (contractDuration <= 0) {
    return totalAmount // Recognize all at once if no duration
  }

  const dailyRate = totalAmount / (contractDuration / (1000 * 60 * 60 * 24))
  const periodDays = periodDuration / (1000 * 60 * 60 * 24)

  return Math.round(dailyRate * periodDays * 100) / 100
}

/**
 * Calculate usage-based recognition amount
 */
export function calculateUsageBasedAmount(
  totalAmount: number,
  totalUnits: number,
  deliveredUnits: number
): number {
  if (totalUnits <= 0) {
    return 0
  }

  const unitRate = totalAmount / totalUnits
  return Math.round(unitRate * deliveredUnits * 100) / 100
}

/**
 * Calculate percentage of completion recognition
 */
export function calculatePercentageOfCompletionAmount(
  totalAmount: number,
  completionPercentage: number,
  previouslyRecognized: number
): number {
  const targetRecognized = Math.round(totalAmount * (completionPercentage / 100) * 100) / 100
  return Math.max(0, targetRecognized - previouslyRecognized)
}

/**
 * Calculate milestone-based recognition amount
 */
export function calculateMilestoneAmount(
  totalAmount: number,
  milestones: Milestone[],
  completedMilestoneIds: string[]
): number {
  const completedPercentage = milestones
    .filter((m) => completedMilestoneIds.includes(m.id))
    .reduce((sum, m) => sum + m.revenuePercentage, 0)

  return Math.round(totalAmount * (completedPercentage / 100) * 100) / 100
}

// =============================================================================
// RevenueRecognitionManager Interface
// =============================================================================

export interface RevenueRecognitionManager {
  // Contract management
  createContract(input: CreateContractInput): Promise<Contract>
  getContract(id: string): Promise<Contract | null>
  getContractByNumber(contractNumber: string): Promise<Contract | null>
  updateContract(id: string, updates: Partial<CreateContractInput>): Promise<Contract>
  activateContract(id: string): Promise<Contract>
  terminateContract(id: string, reason?: string): Promise<Contract>
  modifyContract(
    id: string,
    modification: Omit<ContractModification, 'id' | 'previousTransactionPrice'>
  ): Promise<Contract>

  // Performance obligations
  addObligation(input: CreateObligationInput): Promise<PerformanceObligation>
  getObligation(id: string): Promise<PerformanceObligation | null>
  updateObligationProgress(id: string, input: UpdateObligationProgressInput): Promise<PerformanceObligation>
  satisfyObligation(id: string): Promise<PerformanceObligation>
  allocateTransactionPrice(contractId: string): Promise<AllocationResult[]>

  // Recognition schedules
  generateRecognitionSchedule(
    contractId: string,
    options?: { obligationId?: string; periodicity?: 'daily' | 'monthly' | 'quarterly' }
  ): Promise<RecognitionSchedule>
  getDeferredRevenueEntries(query: {
    contractId?: string
    periodStart?: Date
    periodEnd?: Date
    status?: 'scheduled' | 'recognized'
  }): Promise<DeferredRevenueEntry[]>

  // Revenue recognition
  recognizeRevenue(
    contractId: string,
    options?: {
      obligationId?: string
      asOfDate?: Date
      amount?: number // For manual recognition
    }
  ): Promise<{ recognized: number; remaining: number; entries: DeferredRevenueEntry[] }>

  // Period summaries
  getPeriodSummary(period: RecognitionPeriod): Promise<PeriodRecognitionSummary>
  getDeferredRevenueBalance(asOfDate?: Date): Promise<{
    total: number
    byContract: { contractId: string; amount: number }[]
    byPeriod: { periodEnd: Date; amount: number }[]
  }>

  // Query and reporting
  queryContracts(query: RecognitionQuery): Promise<Contract[]>
  getContractsByCustomer(customerId: string): Promise<Contract[]>

  // ASC 606 compliance exports
  exportASC606Report(options: {
    periodStart: Date
    periodEnd: Date
    format?: 'json' | 'csv'
  }): Promise<{
    contracts: Contract[]
    totalRecognized: number
    totalDeferred: number
    movements: {
      openingBalance: number
      additions: number
      recognitions: number
      closingBalance: number
    }
  }>
}

// =============================================================================
// Helper Functions
// =============================================================================

function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `${prefix}_${timestamp}${random}`
}

function generateContractNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase()
  const random = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `CTR-${timestamp}${random}`
}

function getMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function getMonthEnd(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999)
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date)
  result.setMonth(result.getMonth() + months)
  return result
}

// =============================================================================
// Implementation
// =============================================================================

class InMemoryRevenueRecognitionManager implements RevenueRecognitionManager {
  private contracts: Map<string, Contract> = new Map()
  private contractNumberIndex: Map<string, string> = new Map()
  private obligations: Map<string, PerformanceObligation> = new Map()
  private deferredEntries: Map<string, DeferredRevenueEntry> = new Map()

  // Contract management

  async createContract(input: CreateContractInput): Promise<Contract> {
    const now = new Date()
    const contractNumber = input.contractNumber ?? generateContractNumber()

    const contract: Contract = {
      id: generateId('ctr'),
      contractNumber,
      customerId: input.customerId,
      status: 'draft',
      transactionPrice: input.transactionPrice,
      variableConsideration: input.variableConsideration,
      recognizedRevenue: 0,
      deferredRevenue: input.transactionPrice,
      effectiveDate: input.effectiveDate,
      terminationDate: input.terminationDate,
      orderId: input.orderId,
      obligations: [],
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    }

    this.contracts.set(contract.id, contract)
    this.contractNumberIndex.set(contractNumber, contract.id)

    return contract
  }

  async getContract(id: string): Promise<Contract | null> {
    return this.contracts.get(id) ?? null
  }

  async getContractByNumber(contractNumber: string): Promise<Contract | null> {
    const id = this.contractNumberIndex.get(contractNumber)
    if (!id) return null
    return this.contracts.get(id) ?? null
  }

  async updateContract(id: string, updates: Partial<CreateContractInput>): Promise<Contract> {
    const contract = this.contracts.get(id)
    if (!contract) {
      throw new Error('Contract not found')
    }

    if (contract.status !== 'draft') {
      throw new Error('Can only update draft contracts')
    }

    const updated: Contract = {
      ...contract,
      ...updates,
      deferredRevenue: updates.transactionPrice ?? contract.deferredRevenue,
      updatedAt: new Date(),
    }

    this.contracts.set(id, updated)
    return updated
  }

  async activateContract(id: string): Promise<Contract> {
    const contract = this.contracts.get(id)
    if (!contract) {
      throw new Error('Contract not found')
    }

    if (contract.status !== 'draft') {
      throw new Error('Can only activate draft contracts')
    }

    if (contract.obligations.length === 0) {
      throw new Error('Contract must have at least one performance obligation')
    }

    // Allocate transaction price if not already done
    await this.allocateTransactionPrice(id)

    const updated: Contract = {
      ...contract,
      status: 'active',
      updatedAt: new Date(),
    }

    // Update obligation status
    for (const obligation of updated.obligations) {
      obligation.status = 'in_progress'
      this.obligations.set(obligation.id, obligation)
    }

    this.contracts.set(id, updated)
    return updated
  }

  async terminateContract(id: string, reason?: string): Promise<Contract> {
    const contract = this.contracts.get(id)
    if (!contract) {
      throw new Error('Contract not found')
    }

    const updated: Contract = {
      ...contract,
      status: 'terminated',
      metadata: {
        ...contract.metadata,
        terminationReason: reason,
        terminatedAt: new Date(),
      },
      updatedAt: new Date(),
    }

    // Mark all pending obligations as cancelled
    for (const obligation of updated.obligations) {
      if (obligation.status === 'pending' || obligation.status === 'in_progress') {
        obligation.status = 'cancelled'
        this.obligations.set(obligation.id, obligation)
      }
    }

    this.contracts.set(id, updated)
    return updated
  }

  async modifyContract(
    id: string,
    modification: Omit<ContractModification, 'id' | 'previousTransactionPrice'>
  ): Promise<Contract> {
    const contract = this.contracts.get(id)
    if (!contract) {
      throw new Error('Contract not found')
    }

    const mod: ContractModification = {
      id: generateId('mod'),
      previousTransactionPrice: contract.transactionPrice,
      ...modification,
    }

    const updated: Contract = {
      ...contract,
      status: 'modified',
      transactionPrice: modification.newTransactionPrice,
      deferredRevenue: modification.newTransactionPrice - contract.recognizedRevenue,
      modifications: [...(contract.modifications ?? []), mod],
      updatedAt: new Date(),
    }

    // Re-allocate transaction price if prospective or cumulative catchup
    if (modification.treatmentType !== 'separate_contract') {
      const allocations = allocateTransactionPrice(
        updated.transactionPrice,
        updated.obligations.map((o) => ({
          id: o.id,
          standaloneSellingPrice: o.standaloneSellingPrice,
        }))
      )

      for (const allocation of allocations) {
        const obligation = updated.obligations.find((o) => o.id === allocation.obligationId)
        if (obligation) {
          obligation.allocatedPrice = allocation.allocatedAmount
          obligation.deferredAmount = allocation.allocatedAmount - obligation.recognizedAmount
          this.obligations.set(obligation.id, obligation)
        }
      }
    }

    this.contracts.set(id, updated)
    return updated
  }

  // Performance obligations

  async addObligation(input: CreateObligationInput): Promise<PerformanceObligation> {
    const contract = this.contracts.get(input.contractId)
    if (!contract) {
      throw new Error('Contract not found')
    }

    if (contract.status !== 'draft') {
      throw new Error('Can only add obligations to draft contracts')
    }

    const now = new Date()
    const milestones: Milestone[] = input.milestones?.map((m, index) => ({
      id: generateId('ms'),
      name: m.name,
      description: m.description,
      targetDate: m.targetDate,
      revenuePercentage: m.revenuePercentage,
      status: 'pending' as const,
    })) ?? []

    const obligation: PerformanceObligation = {
      id: generateId('obl'),
      contractId: input.contractId,
      name: input.name,
      description: input.description,
      recognitionMethod: input.recognitionMethod,
      status: 'pending',
      standaloneSellingPrice: input.standaloneSellingPrice,
      allocatedPrice: 0, // Will be set during allocation
      recognizedAmount: 0,
      deferredAmount: 0,
      startDate: input.startDate,
      endDate: input.endDate,
      estimatedDuration: input.estimatedDuration,
      milestones: milestones.length > 0 ? milestones : undefined,
      totalUnits: input.totalUnits,
      deliveredUnits: 0,
      completionPercentage: 0,
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    }

    this.obligations.set(obligation.id, obligation)
    contract.obligations.push(obligation)
    contract.updatedAt = now
    this.contracts.set(contract.id, contract)

    return obligation
  }

  async getObligation(id: string): Promise<PerformanceObligation | null> {
    return this.obligations.get(id) ?? null
  }

  async updateObligationProgress(
    id: string,
    input: UpdateObligationProgressInput
  ): Promise<PerformanceObligation> {
    const obligation = this.obligations.get(id)
    if (!obligation) {
      throw new Error('Obligation not found')
    }

    const now = new Date()
    const updated: PerformanceObligation = { ...obligation, updatedAt: now }

    if (input.deliveredUnits !== undefined) {
      updated.deliveredUnits = input.deliveredUnits
      if (updated.totalUnits && updated.deliveredUnits >= updated.totalUnits) {
        updated.status = 'satisfied'
        updated.satisfiedAt = now
      }
    }

    if (input.completionPercentage !== undefined) {
      updated.completionPercentage = input.completionPercentage
      if (updated.completionPercentage >= 100) {
        updated.status = 'satisfied'
        updated.satisfiedAt = now
      }
    }

    if (input.completedMilestoneId && updated.milestones) {
      const milestone = updated.milestones.find((m) => m.id === input.completedMilestoneId)
      if (milestone) {
        milestone.status = 'completed'
        milestone.completedAt = now
      }

      // Check if all milestones are completed
      const allCompleted = updated.milestones.every((m) => m.status === 'completed')
      if (allCompleted) {
        updated.status = 'satisfied'
        updated.satisfiedAt = now
      }
    }

    this.obligations.set(id, updated)

    // Update contract
    const contract = this.contracts.get(obligation.contractId)
    if (contract) {
      const index = contract.obligations.findIndex((o) => o.id === id)
      if (index >= 0) {
        contract.obligations[index] = updated
        contract.updatedAt = now
        this.contracts.set(contract.id, contract)
      }
    }

    return updated
  }

  async satisfyObligation(id: string): Promise<PerformanceObligation> {
    const obligation = this.obligations.get(id)
    if (!obligation) {
      throw new Error('Obligation not found')
    }

    const now = new Date()
    const updated: PerformanceObligation = {
      ...obligation,
      status: 'satisfied',
      satisfiedAt: now,
      completionPercentage: 100,
      recognizedAmount: obligation.allocatedPrice,
      deferredAmount: 0,
      updatedAt: now,
    }

    if (updated.totalUnits) {
      updated.deliveredUnits = updated.totalUnits
    }

    if (updated.milestones) {
      for (const milestone of updated.milestones) {
        milestone.status = 'completed'
        milestone.completedAt = milestone.completedAt ?? now
      }
    }

    this.obligations.set(id, updated)

    // Update contract
    const contract = this.contracts.get(obligation.contractId)
    if (contract) {
      const index = contract.obligations.findIndex((o) => o.id === id)
      if (index >= 0) {
        contract.obligations[index] = updated
      }

      // Recalculate contract totals
      let totalRecognized = 0
      let totalDeferred = 0
      let allSatisfied = true

      for (const obl of contract.obligations) {
        totalRecognized += obl.recognizedAmount
        totalDeferred += obl.deferredAmount
        if (obl.status !== 'satisfied' && obl.status !== 'cancelled') {
          allSatisfied = false
        }
      }

      contract.recognizedRevenue = totalRecognized
      contract.deferredRevenue = totalDeferred
      if (allSatisfied) {
        contract.status = 'completed'
      }
      contract.updatedAt = now
      this.contracts.set(contract.id, contract)
    }

    return updated
  }

  async allocateTransactionPrice(contractId: string): Promise<AllocationResult[]> {
    const contract = this.contracts.get(contractId)
    if (!contract) {
      throw new Error('Contract not found')
    }

    const allocations = allocateTransactionPrice(
      contract.transactionPrice,
      contract.obligations.map((o) => ({
        id: o.id,
        standaloneSellingPrice: o.standaloneSellingPrice,
      }))
    )

    for (const allocation of allocations) {
      const obligation = contract.obligations.find((o) => o.id === allocation.obligationId)
      if (obligation) {
        obligation.allocatedPrice = allocation.allocatedAmount
        obligation.deferredAmount = allocation.allocatedAmount - obligation.recognizedAmount
        this.obligations.set(obligation.id, obligation)
      }
    }

    contract.updatedAt = new Date()
    this.contracts.set(contractId, contract)

    return allocations
  }

  // Recognition schedules

  async generateRecognitionSchedule(
    contractId: string,
    options?: { obligationId?: string; periodicity?: 'daily' | 'monthly' | 'quarterly' }
  ): Promise<RecognitionSchedule> {
    const contract = this.contracts.get(contractId)
    if (!contract) {
      throw new Error('Contract not found')
    }

    const periodicity = options?.periodicity ?? 'monthly'
    const obligations = options?.obligationId
      ? contract.obligations.filter((o) => o.id === options.obligationId)
      : contract.obligations

    const entries: RecognitionScheduleEntry[] = []
    let totalAmount = 0
    let recognizedToDate = 0

    for (const obligation of obligations) {
      totalAmount += obligation.allocatedPrice
      recognizedToDate += obligation.recognizedAmount

      const startDate = obligation.startDate ?? contract.effectiveDate
      const endDate = obligation.endDate ?? contract.terminationDate ?? addMonths(startDate, 12)

      if (obligation.recognitionMethod === 'point_in_time') {
        // Single entry at satisfaction
        entries.push({
          periodStart: startDate,
          periodEnd: startDate,
          amount: obligation.allocatedPrice,
          cumulativeAmount: obligation.allocatedPrice,
          recognitionPercentage: 100,
          status: obligation.status === 'satisfied' ? 'recognized' : 'future',
        })
      } else if (obligation.recognitionMethod === 'straight_line') {
        // Generate periodic entries
        let currentDate = getMonthStart(startDate)
        let cumulative = 0

        while (currentDate < endDate) {
          const periodStart = currentDate
          let periodEnd: Date

          switch (periodicity) {
            case 'daily':
              periodEnd = new Date(currentDate.getTime() + 24 * 60 * 60 * 1000 - 1)
              break
            case 'quarterly':
              periodEnd = getMonthEnd(addMonths(currentDate, 2))
              break
            case 'monthly':
            default:
              periodEnd = getMonthEnd(currentDate)
          }

          // Clamp to contract period
          const effectiveStart = periodStart < startDate ? startDate : periodStart
          const effectiveEnd = periodEnd > endDate ? endDate : periodEnd

          const amount = calculateStraightLineAmount(
            obligation.allocatedPrice,
            effectiveStart,
            effectiveEnd,
            startDate,
            endDate
          )

          cumulative += amount
          const now = new Date()

          entries.push({
            periodStart: effectiveStart,
            periodEnd: effectiveEnd,
            amount,
            cumulativeAmount: cumulative,
            recognitionPercentage: (cumulative / obligation.allocatedPrice) * 100,
            status: effectiveEnd < now ? 'recognized' : effectiveEnd <= getMonthEnd(now) ? 'current' : 'future',
          })

          // Move to next period
          switch (periodicity) {
            case 'daily':
              currentDate = new Date(currentDate.getTime() + 24 * 60 * 60 * 1000)
              break
            case 'quarterly':
              currentDate = addMonths(currentDate, 3)
              break
            case 'monthly':
            default:
              currentDate = addMonths(currentDate, 1)
          }
        }
      } else if (obligation.recognitionMethod === 'milestone' && obligation.milestones) {
        // Generate entries for each milestone
        let cumulative = 0
        for (const milestone of obligation.milestones) {
          const amount = (obligation.allocatedPrice * milestone.revenuePercentage) / 100
          cumulative += amount

          entries.push({
            periodStart: milestone.targetDate ?? contract.effectiveDate,
            periodEnd: milestone.targetDate ?? contract.effectiveDate,
            amount,
            cumulativeAmount: cumulative,
            recognitionPercentage: (cumulative / obligation.allocatedPrice) * 100,
            status: milestone.status === 'completed' ? 'recognized' : 'future',
          })
        }
      }
    }

    // Sort entries by date
    entries.sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime())

    return {
      contractId,
      obligationId: options?.obligationId,
      entries,
      totalAmount,
      recognizedToDate,
      remainingAmount: totalAmount - recognizedToDate,
      startDate: entries[0]?.periodStart ?? contract.effectiveDate,
      endDate: entries[entries.length - 1]?.periodEnd ?? contract.terminationDate ?? contract.effectiveDate,
    }
  }

  async getDeferredRevenueEntries(query: {
    contractId?: string
    periodStart?: Date
    periodEnd?: Date
    status?: 'scheduled' | 'recognized'
  }): Promise<DeferredRevenueEntry[]> {
    let entries = Array.from(this.deferredEntries.values())

    if (query.contractId) {
      entries = entries.filter((e) => e.contractId === query.contractId)
    }

    if (query.periodStart) {
      entries = entries.filter((e) => e.periodEnd >= query.periodStart!)
    }

    if (query.periodEnd) {
      entries = entries.filter((e) => e.periodStart <= query.periodEnd!)
    }

    if (query.status) {
      entries = entries.filter((e) => e.status === query.status)
    }

    return entries.sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime())
  }

  // Revenue recognition

  async recognizeRevenue(
    contractId: string,
    options?: {
      obligationId?: string
      asOfDate?: Date
      amount?: number
    }
  ): Promise<{ recognized: number; remaining: number; entries: DeferredRevenueEntry[] }> {
    const contract = this.contracts.get(contractId)
    if (!contract) {
      throw new Error('Contract not found')
    }

    const asOfDate = options?.asOfDate ?? new Date()
    const newEntries: DeferredRevenueEntry[] = []
    let totalRecognized = 0

    const obligations = options?.obligationId
      ? contract.obligations.filter((o) => o.id === options.obligationId)
      : contract.obligations

    for (const obligation of obligations) {
      if (obligation.status === 'cancelled' || obligation.status === 'satisfied') {
        continue
      }

      let amountToRecognize = 0

      switch (obligation.recognitionMethod) {
        case 'straight_line': {
          const startDate = obligation.startDate ?? contract.effectiveDate
          const endDate = obligation.endDate ?? contract.terminationDate ?? addMonths(startDate, 12)
          const totalDue = calculateStraightLineAmount(
            obligation.allocatedPrice,
            startDate,
            asOfDate < endDate ? asOfDate : endDate,
            startDate,
            endDate
          )
          amountToRecognize = Math.max(0, totalDue - obligation.recognizedAmount)
          break
        }

        case 'usage_based': {
          const totalDue = calculateUsageBasedAmount(
            obligation.allocatedPrice,
            obligation.totalUnits ?? 0,
            obligation.deliveredUnits ?? 0
          )
          amountToRecognize = Math.max(0, totalDue - obligation.recognizedAmount)
          break
        }

        case 'percentage_of_completion': {
          amountToRecognize = calculatePercentageOfCompletionAmount(
            obligation.allocatedPrice,
            obligation.completionPercentage ?? 0,
            obligation.recognizedAmount
          )
          break
        }

        case 'milestone': {
          const completedIds = obligation.milestones
            ?.filter((m) => m.status === 'completed')
            .map((m) => m.id) ?? []
          const totalDue = calculateMilestoneAmount(
            obligation.allocatedPrice,
            obligation.milestones ?? [],
            completedIds
          )
          amountToRecognize = Math.max(0, totalDue - obligation.recognizedAmount)
          break
        }

        case 'point_in_time': {
          if (obligation.status === 'satisfied') {
            amountToRecognize = obligation.allocatedPrice - obligation.recognizedAmount
          }
          break
        }
      }

      // Override with manual amount if provided
      if (options?.amount !== undefined && options.obligationId === obligation.id) {
        amountToRecognize = Math.min(options.amount, obligation.deferredAmount)
      }

      if (amountToRecognize > 0) {
        const entry: DeferredRevenueEntry = {
          id: generateId('dre'),
          contractId,
          obligationId: obligation.id,
          amount: amountToRecognize,
          periodStart: getMonthStart(asOfDate),
          periodEnd: getMonthEnd(asOfDate),
          recognizedAt: asOfDate,
          status: 'recognized',
          createdAt: new Date(),
        }

        this.deferredEntries.set(entry.id, entry)
        newEntries.push(entry)

        // Update obligation
        obligation.recognizedAmount += amountToRecognize
        obligation.deferredAmount -= amountToRecognize
        obligation.updatedAt = new Date()
        this.obligations.set(obligation.id, obligation)

        totalRecognized += amountToRecognize
      }
    }

    // Update contract totals
    contract.recognizedRevenue += totalRecognized
    contract.deferredRevenue -= totalRecognized
    contract.updatedAt = new Date()

    // Check if contract is completed
    const allSatisfied = contract.obligations.every(
      (o) => o.status === 'satisfied' || o.status === 'cancelled'
    )
    if (allSatisfied) {
      contract.status = 'completed'
    }

    this.contracts.set(contractId, contract)

    return {
      recognized: totalRecognized,
      remaining: contract.deferredRevenue,
      entries: newEntries,
    }
  }

  // Period summaries

  async getPeriodSummary(period: RecognitionPeriod): Promise<PeriodRecognitionSummary> {
    let periodStart: Date
    let periodEnd: Date

    if (period.month) {
      periodStart = new Date(period.year, period.month - 1, 1)
      periodEnd = getMonthEnd(periodStart)
    } else if (period.quarter) {
      const startMonth = (period.quarter - 1) * 3
      periodStart = new Date(period.year, startMonth, 1)
      periodEnd = getMonthEnd(new Date(period.year, startMonth + 2, 1))
    } else {
      periodStart = new Date(period.year, 0, 1)
      periodEnd = new Date(period.year, 11, 31, 23, 59, 59, 999)
    }

    let recognizedRevenue = 0
    let newContracts = 0
    let completedObligations = 0
    const contractSummaries: { contractId: string; recognizedAmount: number; deferredAmount: number }[] = []

    // Get all deferred entries in period
    const entries = await this.getDeferredRevenueEntries({
      periodStart,
      periodEnd,
      status: 'recognized',
    })

    for (const entry of entries) {
      recognizedRevenue += entry.amount
    }

    // Calculate contract-level summaries
    for (const contract of this.contracts.values()) {
      let contractRecognized = 0
      for (const entry of entries) {
        if (entry.contractId === contract.id) {
          contractRecognized += entry.amount
        }
      }

      if (contractRecognized > 0 || contract.deferredRevenue > 0) {
        contractSummaries.push({
          contractId: contract.id,
          recognizedAmount: contractRecognized,
          deferredAmount: contract.deferredRevenue,
        })
      }

      if (contract.createdAt >= periodStart && contract.createdAt <= periodEnd) {
        newContracts++
      }

      for (const obligation of contract.obligations) {
        if (
          obligation.satisfiedAt &&
          obligation.satisfiedAt >= periodStart &&
          obligation.satisfiedAt <= periodEnd
        ) {
          completedObligations++
        }
      }
    }

    // Calculate deferred revenue balances
    let deferredRevenueStart = 0
    let deferredRevenueEnd = 0

    for (const contract of this.contracts.values()) {
      // This is simplified - in a real implementation, we'd track historical balances
      deferredRevenueEnd += contract.deferredRevenue
    }

    deferredRevenueStart = deferredRevenueEnd + recognizedRevenue

    return {
      period,
      recognizedRevenue,
      deferredRevenueStart,
      deferredRevenueEnd,
      newContracts,
      completedObligations,
      contracts: contractSummaries,
    }
  }

  async getDeferredRevenueBalance(asOfDate?: Date): Promise<{
    total: number
    byContract: { contractId: string; amount: number }[]
    byPeriod: { periodEnd: Date; amount: number }[]
  }> {
    const date = asOfDate ?? new Date()
    let total = 0
    const byContract: { contractId: string; amount: number }[] = []
    const periodMap = new Map<string, number>()

    for (const contract of this.contracts.values()) {
      if (contract.deferredRevenue > 0) {
        total += contract.deferredRevenue
        byContract.push({
          contractId: contract.id,
          amount: contract.deferredRevenue,
        })

        // Generate schedule to get period breakdown
        const schedule = await this.generateRecognitionSchedule(contract.id)
        for (const entry of schedule.entries) {
          if (entry.status === 'future' || entry.status === 'current') {
            const key = entry.periodEnd.toISOString().split('T')[0]
            const existing = periodMap.get(key) ?? 0
            periodMap.set(key, existing + entry.amount)
          }
        }
      }
    }

    const byPeriod = Array.from(periodMap.entries())
      .map(([dateStr, amount]) => ({
        periodEnd: new Date(dateStr),
        amount,
      }))
      .sort((a, b) => a.periodEnd.getTime() - b.periodEnd.getTime())

    return { total, byContract, byPeriod }
  }

  // Query and reporting

  async queryContracts(query: RecognitionQuery): Promise<Contract[]> {
    let results = Array.from(this.contracts.values())

    if (query.contractId) {
      results = results.filter((c) => c.id === query.contractId)
    }

    if (query.customerId) {
      results = results.filter((c) => c.customerId === query.customerId)
    }

    if (query.status) {
      results = results.filter((c) => c.status === query.status)
    }

    if (query.periodStart) {
      results = results.filter((c) => c.effectiveDate >= query.periodStart!)
    }

    if (query.periodEnd) {
      results = results.filter((c) => c.effectiveDate <= query.periodEnd!)
    }

    if (!query.includeCompleted) {
      results = results.filter((c) => c.status !== 'completed')
    }

    return results.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  }

  async getContractsByCustomer(customerId: string): Promise<Contract[]> {
    return this.queryContracts({ customerId, includeCompleted: true })
  }

  // ASC 606 compliance exports

  async exportASC606Report(options: {
    periodStart: Date
    periodEnd: Date
    format?: 'json' | 'csv'
  }): Promise<{
    contracts: Contract[]
    totalRecognized: number
    totalDeferred: number
    movements: {
      openingBalance: number
      additions: number
      recognitions: number
      closingBalance: number
    }
  }> {
    const contracts = await this.queryContracts({
      periodStart: options.periodStart,
      periodEnd: options.periodEnd,
      includeCompleted: true,
    })

    let totalRecognized = 0
    let totalDeferred = 0
    let additions = 0
    let recognitions = 0

    for (const contract of contracts) {
      totalDeferred += contract.deferredRevenue
      totalRecognized += contract.recognizedRevenue

      // New contracts in period
      if (
        contract.createdAt >= options.periodStart &&
        contract.createdAt <= options.periodEnd
      ) {
        additions += contract.transactionPrice
      }
    }

    // Get recognition entries in period
    const entries = await this.getDeferredRevenueEntries({
      periodStart: options.periodStart,
      periodEnd: options.periodEnd,
      status: 'recognized',
    })

    for (const entry of entries) {
      recognitions += entry.amount
    }

    // Calculate opening balance (simplified)
    const openingBalance = totalDeferred + recognitions - additions

    return {
      contracts,
      totalRecognized,
      totalDeferred,
      movements: {
        openingBalance,
        additions,
        recognitions,
        closingBalance: totalDeferred,
      },
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createRevenueRecognitionManager(): RevenueRecognitionManager {
  return new InMemoryRevenueRecognitionManager()
}

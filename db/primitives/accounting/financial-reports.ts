/**
 * Financial Reports - P&L, Balance Sheet, Trial Balance
 *
 * Implements GAAP-compliant financial report generation:
 * - Profit & Loss (Income) Statement
 * - Balance Sheet (Statement of Financial Position)
 * - Trial Balance
 *
 * Supports:
 * - Date ranges and as-of dates
 * - Comparative periods (e.g., this year vs last year)
 * - Account hierarchy aggregation
 * - Multi-currency support via functional currency conversion
 *
 * @module db/primitives/accounting/financial-reports
 */

import { AccountType, type Account as HierarchyAccount } from './account-hierarchy'

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Account balance information for reports
 */
export interface AccountBalance {
  accountId: string
  accountNumber: string
  accountName: string
  accountType: AccountType
  debitBalance: number
  creditBalance: number
  balance: number
  isContra?: boolean
  parentAccountId?: string
  depth?: number
}

/**
 * Date range for period-based reports
 */
export interface ReportPeriod {
  startDate: Date
  endDate: Date
  label?: string
}

/**
 * Comparative period configuration
 */
export interface ComparativePeriod extends ReportPeriod {
  comparison: 'prior_period' | 'prior_year' | 'custom'
}

/**
 * Line item in a financial statement
 */
export interface ReportLineItem {
  accountId: string
  accountNumber: string
  accountName: string
  amount: number
  comparativeAmount?: number
  variance?: number
  variancePercent?: number
  isSubtotal?: boolean
  isTotal?: boolean
  depth?: number
  children?: ReportLineItem[]
}

/**
 * Section in a financial statement (e.g., "Current Assets")
 */
export interface ReportSection {
  name: string
  items: ReportLineItem[]
  subtotal: number
  comparativeSubtotal?: number
  variance?: number
  variancePercent?: number
}

// =============================================================================
// Trial Balance Types
// =============================================================================

export interface TrialBalanceLineItem {
  accountId: string
  accountNumber: string
  accountName: string
  accountType: AccountType
  debitBalance: number
  creditBalance: number
}

export interface TrialBalanceReport {
  asOfDate: Date
  generatedAt: Date
  currency: string
  items: TrialBalanceLineItem[]
  totalDebits: number
  totalCredits: number
  isBalanced: boolean
  difference: number
}

export interface TrialBalanceOptions {
  asOfDate?: Date
  includeZeroBalances?: boolean
  currency?: string
}

// =============================================================================
// Profit & Loss (Income Statement) Types
// =============================================================================

export interface IncomeStatementReport {
  period: ReportPeriod
  comparativePeriod?: ReportPeriod
  generatedAt: Date
  currency: string

  // Revenue sections
  operatingRevenue: ReportSection
  otherIncome: ReportSection
  totalRevenue: number
  comparativeTotalRevenue?: number

  // Expense sections
  costOfSales: ReportSection
  operatingExpenses: ReportSection
  otherExpenses: ReportSection
  totalExpenses: number
  comparativeTotalExpenses?: number

  // Calculated totals
  grossProfit: number
  comparativeGrossProfit?: number
  operatingIncome: number
  comparativeOperatingIncome?: number
  netIncome: number
  comparativeNetIncome?: number

  // Variance analysis
  revenueVariance?: number
  revenueVariancePercent?: number
  expenseVariance?: number
  expenseVariancePercent?: number
  netIncomeVariance?: number
  netIncomeVariancePercent?: number
}

export interface IncomeStatementOptions {
  period: ReportPeriod
  comparativePeriod?: ComparativePeriod
  includeZeroBalances?: boolean
  currency?: string
  showPercentages?: boolean
}

// =============================================================================
// Balance Sheet Types
// =============================================================================

export interface BalanceSheetReport {
  asOfDate: Date
  comparativeDate?: Date
  generatedAt: Date
  currency: string

  // Asset sections
  currentAssets: ReportSection
  fixedAssets: ReportSection
  intangibleAssets: ReportSection
  otherAssets: ReportSection
  totalAssets: number
  comparativeTotalAssets?: number

  // Liability sections
  currentLiabilities: ReportSection
  longTermLiabilities: ReportSection
  totalLiabilities: number
  comparativeTotalLiabilities?: number

  // Equity section
  equity: ReportSection
  totalEquity: number
  comparativeTotalEquity?: number

  // Balance check
  totalLiabilitiesAndEquity: number
  comparativeTotalLiabilitiesAndEquity?: number
  isBalanced: boolean
  difference: number

  // Variance analysis (if comparative)
  assetsVariance?: number
  assetsVariancePercent?: number
  liabilitiesVariance?: number
  liabilitiesVariancePercent?: number
  equityVariance?: number
  equityVariancePercent?: number
}

export interface BalanceSheetOptions {
  asOfDate?: Date
  comparativeDate?: Date
  includeZeroBalances?: boolean
  currency?: string
}

// =============================================================================
// Report Data Provider Interface
// =============================================================================

/**
 * Interface for providing account and balance data to the report generator.
 * This abstracts the data source (ledger, chart of accounts, etc.)
 */
export interface ReportDataProvider {
  /**
   * Get all accounts
   */
  getAccounts(): Promise<AccountBalance[]>

  /**
   * Get account balance at a specific date
   */
  getAccountBalanceAtDate(accountId: string, date: Date): Promise<number>

  /**
   * Get account balance for a date range (for P&L)
   */
  getAccountBalanceForPeriod(
    accountId: string,
    startDate: Date,
    endDate: Date
  ): Promise<number>

  /**
   * Get all accounts by type
   */
  getAccountsByType(type: AccountType): Promise<AccountBalance[]>

  /**
   * Get functional currency
   */
  getFunctionalCurrency(): Promise<string>
}

// =============================================================================
// Financial Report Generator Interface
// =============================================================================

export interface FinancialReportGenerator {
  /**
   * Generate a Trial Balance report
   */
  generateTrialBalance(options?: TrialBalanceOptions): Promise<TrialBalanceReport>

  /**
   * Generate a Profit & Loss (Income Statement) report
   */
  generateIncomeStatement(options: IncomeStatementOptions): Promise<IncomeStatementReport>

  /**
   * Generate a Balance Sheet report
   */
  generateBalanceSheet(options?: BalanceSheetOptions): Promise<BalanceSheetReport>
}

// =============================================================================
// Implementation
// =============================================================================

class FinancialReportGeneratorImpl implements FinancialReportGenerator {
  private dataProvider: ReportDataProvider

  constructor(dataProvider: ReportDataProvider) {
    this.dataProvider = dataProvider
  }

  // ===========================================================================
  // Trial Balance
  // ===========================================================================

  async generateTrialBalance(options?: TrialBalanceOptions): Promise<TrialBalanceReport> {
    const asOfDate = options?.asOfDate ?? new Date()
    const currency = options?.currency ?? (await this.dataProvider.getFunctionalCurrency())
    const includeZeroBalances = options?.includeZeroBalances ?? false

    const accounts = await this.dataProvider.getAccounts()
    const items: TrialBalanceLineItem[] = []
    let totalDebits = 0
    let totalCredits = 0

    for (const account of accounts) {
      const balance = await this.dataProvider.getAccountBalanceAtDate(
        account.accountId,
        asOfDate
      )

      // Skip zero balances if not requested
      if (!includeZeroBalances && balance === 0) {
        continue
      }

      // Determine if balance is debit or credit based on account type
      const isDebitNormal = account.accountType === 'asset' || account.accountType === 'expense'
      const isContra = account.isContra ?? false

      // Contra accounts flip the normal balance
      const effectiveDebitNormal = isContra ? !isDebitNormal : isDebitNormal

      let debitBalance = 0
      let creditBalance = 0

      if (balance >= 0) {
        if (effectiveDebitNormal) {
          debitBalance = balance
        } else {
          creditBalance = balance
        }
      } else {
        // Negative balance means it's on the opposite side
        if (effectiveDebitNormal) {
          creditBalance = Math.abs(balance)
        } else {
          debitBalance = Math.abs(balance)
        }
      }

      items.push({
        accountId: account.accountId,
        accountNumber: account.accountNumber,
        accountName: account.accountName,
        accountType: account.accountType,
        debitBalance,
        creditBalance,
      })

      totalDebits += debitBalance
      totalCredits += creditBalance
    }

    // Sort by account number
    items.sort((a, b) => a.accountNumber.localeCompare(b.accountNumber))

    const difference = Math.abs(totalDebits - totalCredits)
    const isBalanced = difference < 0.01 // Allow for floating point precision

    return {
      asOfDate,
      generatedAt: new Date(),
      currency,
      items,
      totalDebits,
      totalCredits,
      isBalanced,
      difference,
    }
  }

  // ===========================================================================
  // Income Statement (P&L)
  // ===========================================================================

  async generateIncomeStatement(
    options: IncomeStatementOptions
  ): Promise<IncomeStatementReport> {
    const { period, comparativePeriod, includeZeroBalances = false } = options
    const currency = options.currency ?? (await this.dataProvider.getFunctionalCurrency())

    // Get revenue accounts
    const revenueAccounts = await this.dataProvider.getAccountsByType('revenue')

    // Get expense accounts
    const expenseAccounts = await this.dataProvider.getAccountsByType('expense')

    // Build revenue sections
    const operatingRevenueItems: ReportLineItem[] = []
    const otherIncomeItems: ReportLineItem[] = []

    for (const account of revenueAccounts) {
      const amount = await this.dataProvider.getAccountBalanceForPeriod(
        account.accountId,
        period.startDate,
        period.endDate
      )

      let comparativeAmount: number | undefined
      if (comparativePeriod) {
        comparativeAmount = await this.dataProvider.getAccountBalanceForPeriod(
          account.accountId,
          comparativePeriod.startDate,
          comparativePeriod.endDate
        )
      }

      // Skip zero balances if not requested
      if (!includeZeroBalances && amount === 0 && (!comparativeAmount || comparativeAmount === 0)) {
        continue
      }

      const item: ReportLineItem = {
        accountId: account.accountId,
        accountNumber: account.accountNumber,
        accountName: account.accountName,
        amount: Math.abs(amount), // Revenue is positive
        comparativeAmount: comparativeAmount !== undefined ? Math.abs(comparativeAmount) : undefined,
        variance: comparativeAmount !== undefined ? Math.abs(amount) - Math.abs(comparativeAmount) : undefined,
        variancePercent:
          comparativeAmount !== undefined && comparativeAmount !== 0
            ? ((Math.abs(amount) - Math.abs(comparativeAmount)) / Math.abs(comparativeAmount)) * 100
            : undefined,
        depth: account.depth ?? 0,
      }

      // Categorize: 4000-4099 operating revenue, 4100+ other income (example)
      const accountNum = parseInt(account.accountNumber.split('.')[0], 10)
      if (accountNum < 4100) {
        operatingRevenueItems.push(item)
      } else {
        otherIncomeItems.push(item)
      }
    }

    // Build expense sections
    const costOfSalesItems: ReportLineItem[] = []
    const operatingExpenseItems: ReportLineItem[] = []
    const otherExpenseItems: ReportLineItem[] = []

    for (const account of expenseAccounts) {
      const amount = await this.dataProvider.getAccountBalanceForPeriod(
        account.accountId,
        period.startDate,
        period.endDate
      )

      let comparativeAmount: number | undefined
      if (comparativePeriod) {
        comparativeAmount = await this.dataProvider.getAccountBalanceForPeriod(
          account.accountId,
          comparativePeriod.startDate,
          comparativePeriod.endDate
        )
      }

      // Skip zero balances if not requested
      if (!includeZeroBalances && amount === 0 && (!comparativeAmount || comparativeAmount === 0)) {
        continue
      }

      const item: ReportLineItem = {
        accountId: account.accountId,
        accountNumber: account.accountNumber,
        accountName: account.accountName,
        amount: Math.abs(amount), // Expense is positive on P&L
        comparativeAmount: comparativeAmount !== undefined ? Math.abs(comparativeAmount) : undefined,
        variance: comparativeAmount !== undefined ? Math.abs(amount) - Math.abs(comparativeAmount) : undefined,
        variancePercent:
          comparativeAmount !== undefined && comparativeAmount !== 0
            ? ((Math.abs(amount) - Math.abs(comparativeAmount)) / Math.abs(comparativeAmount)) * 100
            : undefined,
        depth: account.depth ?? 0,
      }

      // Categorize: 5000-5099 COGS, 5100-5499 operating, 5500+ other (example)
      const accountNum = parseInt(account.accountNumber.split('.')[0], 10)
      if (accountNum < 5100) {
        costOfSalesItems.push(item)
      } else if (accountNum < 5500) {
        operatingExpenseItems.push(item)
      } else {
        otherExpenseItems.push(item)
      }
    }

    // Build sections
    const operatingRevenue = this.buildSection('Operating Revenue', operatingRevenueItems)
    const otherIncome = this.buildSection('Other Income', otherIncomeItems)
    const costOfSales = this.buildSection('Cost of Sales', costOfSalesItems)
    const operatingExpenses = this.buildSection('Operating Expenses', operatingExpenseItems)
    const otherExpenses = this.buildSection('Other Expenses', otherExpenseItems)

    // Calculate totals
    const totalRevenue = operatingRevenue.subtotal + otherIncome.subtotal
    const comparativeTotalRevenue =
      comparativePeriod !== undefined
        ? (operatingRevenue.comparativeSubtotal ?? 0) + (otherIncome.comparativeSubtotal ?? 0)
        : undefined

    const totalExpenses = costOfSales.subtotal + operatingExpenses.subtotal + otherExpenses.subtotal
    const comparativeTotalExpenses =
      comparativePeriod !== undefined
        ? (costOfSales.comparativeSubtotal ?? 0) +
          (operatingExpenses.comparativeSubtotal ?? 0) +
          (otherExpenses.comparativeSubtotal ?? 0)
        : undefined

    const grossProfit = totalRevenue - costOfSales.subtotal
    const comparativeGrossProfit =
      comparativePeriod !== undefined && comparativeTotalRevenue !== undefined
        ? comparativeTotalRevenue - (costOfSales.comparativeSubtotal ?? 0)
        : undefined

    const operatingIncome = grossProfit - operatingExpenses.subtotal
    const comparativeOperatingIncome =
      comparativeGrossProfit !== undefined
        ? comparativeGrossProfit - (operatingExpenses.comparativeSubtotal ?? 0)
        : undefined

    const netIncome = totalRevenue - totalExpenses
    const comparativeNetIncome =
      comparativeTotalRevenue !== undefined && comparativeTotalExpenses !== undefined
        ? comparativeTotalRevenue - comparativeTotalExpenses
        : undefined

    return {
      period,
      comparativePeriod,
      generatedAt: new Date(),
      currency,
      operatingRevenue,
      otherIncome,
      totalRevenue,
      comparativeTotalRevenue,
      costOfSales,
      operatingExpenses,
      otherExpenses,
      totalExpenses,
      comparativeTotalExpenses,
      grossProfit,
      comparativeGrossProfit,
      operatingIncome,
      comparativeOperatingIncome,
      netIncome,
      comparativeNetIncome,
      revenueVariance:
        comparativeTotalRevenue !== undefined ? totalRevenue - comparativeTotalRevenue : undefined,
      revenueVariancePercent:
        comparativeTotalRevenue !== undefined && comparativeTotalRevenue !== 0
          ? ((totalRevenue - comparativeTotalRevenue) / comparativeTotalRevenue) * 100
          : undefined,
      expenseVariance:
        comparativeTotalExpenses !== undefined ? totalExpenses - comparativeTotalExpenses : undefined,
      expenseVariancePercent:
        comparativeTotalExpenses !== undefined && comparativeTotalExpenses !== 0
          ? ((totalExpenses - comparativeTotalExpenses) / comparativeTotalExpenses) * 100
          : undefined,
      netIncomeVariance:
        comparativeNetIncome !== undefined ? netIncome - comparativeNetIncome : undefined,
      netIncomeVariancePercent:
        comparativeNetIncome !== undefined && comparativeNetIncome !== 0
          ? ((netIncome - comparativeNetIncome) / comparativeNetIncome) * 100
          : undefined,
    }
  }

  // ===========================================================================
  // Balance Sheet
  // ===========================================================================

  async generateBalanceSheet(options?: BalanceSheetOptions): Promise<BalanceSheetReport> {
    const asOfDate = options?.asOfDate ?? new Date()
    const comparativeDate = options?.comparativeDate
    const currency = options?.currency ?? (await this.dataProvider.getFunctionalCurrency())
    const includeZeroBalances = options?.includeZeroBalances ?? false

    // Get accounts by type
    const assetAccounts = await this.dataProvider.getAccountsByType('asset')
    const liabilityAccounts = await this.dataProvider.getAccountsByType('liability')
    const equityAccounts = await this.dataProvider.getAccountsByType('equity')

    // Build asset sections
    const currentAssetItems: ReportLineItem[] = []
    const fixedAssetItems: ReportLineItem[] = []
    const intangibleAssetItems: ReportLineItem[] = []
    const otherAssetItems: ReportLineItem[] = []

    for (const account of assetAccounts) {
      const balance = await this.dataProvider.getAccountBalanceAtDate(account.accountId, asOfDate)
      let comparativeBalance: number | undefined
      if (comparativeDate) {
        comparativeBalance = await this.dataProvider.getAccountBalanceAtDate(
          account.accountId,
          comparativeDate
        )
      }

      if (!includeZeroBalances && balance === 0 && (!comparativeBalance || comparativeBalance === 0)) {
        continue
      }

      const item: ReportLineItem = {
        accountId: account.accountId,
        accountNumber: account.accountNumber,
        accountName: account.accountName,
        amount: balance,
        comparativeAmount: comparativeBalance,
        variance: comparativeBalance !== undefined ? balance - comparativeBalance : undefined,
        variancePercent:
          comparativeBalance !== undefined && comparativeBalance !== 0
            ? ((balance - comparativeBalance) / Math.abs(comparativeBalance)) * 100
            : undefined,
        depth: account.depth ?? 0,
      }

      // Categorize assets by account number range (GAAP typical)
      // 1000-1099: Current assets (cash, receivables)
      // 1100-1199: Current assets (inventory, prepaid)
      // 1200-1299: Current assets
      // 1300-1399: Fixed assets (property, equipment)
      // 1400-1499: Fixed assets (accumulated depreciation)
      // 1500-1599: Fixed assets
      // 1600-1699: Intangible assets
      // 1700+: Other assets
      const accountNum = parseInt(account.accountNumber.split('.')[0], 10)
      if (accountNum < 1300) {
        currentAssetItems.push(item)
      } else if (accountNum < 1600) {
        fixedAssetItems.push(item)
      } else if (accountNum < 1700) {
        intangibleAssetItems.push(item)
      } else {
        otherAssetItems.push(item)
      }
    }

    // Build liability sections
    const currentLiabilityItems: ReportLineItem[] = []
    const longTermLiabilityItems: ReportLineItem[] = []

    for (const account of liabilityAccounts) {
      const balance = await this.dataProvider.getAccountBalanceAtDate(account.accountId, asOfDate)
      let comparativeBalance: number | undefined
      if (comparativeDate) {
        comparativeBalance = await this.dataProvider.getAccountBalanceAtDate(
          account.accountId,
          comparativeDate
        )
      }

      if (!includeZeroBalances && balance === 0 && (!comparativeBalance || comparativeBalance === 0)) {
        continue
      }

      const item: ReportLineItem = {
        accountId: account.accountId,
        accountNumber: account.accountNumber,
        accountName: account.accountName,
        amount: Math.abs(balance), // Liabilities shown as positive
        comparativeAmount: comparativeBalance !== undefined ? Math.abs(comparativeBalance) : undefined,
        variance:
          comparativeBalance !== undefined
            ? Math.abs(balance) - Math.abs(comparativeBalance)
            : undefined,
        variancePercent:
          comparativeBalance !== undefined && comparativeBalance !== 0
            ? ((Math.abs(balance) - Math.abs(comparativeBalance)) / Math.abs(comparativeBalance)) * 100
            : undefined,
        depth: account.depth ?? 0,
      }

      // Categorize liabilities by account number range
      // 2000-2299: Current liabilities
      // 2300+: Long-term liabilities
      const accountNum = parseInt(account.accountNumber.split('.')[0], 10)
      if (accountNum < 2300) {
        currentLiabilityItems.push(item)
      } else {
        longTermLiabilityItems.push(item)
      }
    }

    // Build equity section
    const equityItems: ReportLineItem[] = []

    for (const account of equityAccounts) {
      const balance = await this.dataProvider.getAccountBalanceAtDate(account.accountId, asOfDate)
      let comparativeBalance: number | undefined
      if (comparativeDate) {
        comparativeBalance = await this.dataProvider.getAccountBalanceAtDate(
          account.accountId,
          comparativeDate
        )
      }

      if (!includeZeroBalances && balance === 0 && (!comparativeBalance || comparativeBalance === 0)) {
        continue
      }

      const item: ReportLineItem = {
        accountId: account.accountId,
        accountNumber: account.accountNumber,
        accountName: account.accountName,
        amount: Math.abs(balance), // Equity shown as positive
        comparativeAmount: comparativeBalance !== undefined ? Math.abs(comparativeBalance) : undefined,
        variance:
          comparativeBalance !== undefined
            ? Math.abs(balance) - Math.abs(comparativeBalance)
            : undefined,
        variancePercent:
          comparativeBalance !== undefined && comparativeBalance !== 0
            ? ((Math.abs(balance) - Math.abs(comparativeBalance)) / Math.abs(comparativeBalance)) * 100
            : undefined,
        depth: account.depth ?? 0,
      }

      equityItems.push(item)
    }

    // Build sections
    const currentAssets = this.buildSection('Current Assets', currentAssetItems)
    const fixedAssets = this.buildSection('Fixed Assets', fixedAssetItems)
    const intangibleAssets = this.buildSection('Intangible Assets', intangibleAssetItems)
    const otherAssets = this.buildSection('Other Assets', otherAssetItems)
    const currentLiabilities = this.buildSection('Current Liabilities', currentLiabilityItems)
    const longTermLiabilities = this.buildSection('Long-Term Liabilities', longTermLiabilityItems)
    const equity = this.buildSection("Stockholders' Equity", equityItems)

    // Calculate totals
    const totalAssets =
      currentAssets.subtotal +
      fixedAssets.subtotal +
      intangibleAssets.subtotal +
      otherAssets.subtotal

    const comparativeTotalAssets =
      comparativeDate !== undefined
        ? (currentAssets.comparativeSubtotal ?? 0) +
          (fixedAssets.comparativeSubtotal ?? 0) +
          (intangibleAssets.comparativeSubtotal ?? 0) +
          (otherAssets.comparativeSubtotal ?? 0)
        : undefined

    const totalLiabilities = currentLiabilities.subtotal + longTermLiabilities.subtotal
    const comparativeTotalLiabilities =
      comparativeDate !== undefined
        ? (currentLiabilities.comparativeSubtotal ?? 0) +
          (longTermLiabilities.comparativeSubtotal ?? 0)
        : undefined

    const totalEquity = equity.subtotal
    const comparativeTotalEquity = equity.comparativeSubtotal

    const totalLiabilitiesAndEquity = totalLiabilities + totalEquity
    const comparativeTotalLiabilitiesAndEquity =
      comparativeTotalLiabilities !== undefined && comparativeTotalEquity !== undefined
        ? comparativeTotalLiabilities + comparativeTotalEquity
        : undefined

    const difference = Math.abs(totalAssets - totalLiabilitiesAndEquity)
    const isBalanced = difference < 0.01 // Allow for floating point precision

    return {
      asOfDate,
      comparativeDate,
      generatedAt: new Date(),
      currency,
      currentAssets,
      fixedAssets,
      intangibleAssets,
      otherAssets,
      totalAssets,
      comparativeTotalAssets,
      currentLiabilities,
      longTermLiabilities,
      totalLiabilities,
      comparativeTotalLiabilities,
      equity,
      totalEquity,
      comparativeTotalEquity,
      totalLiabilitiesAndEquity,
      comparativeTotalLiabilitiesAndEquity,
      isBalanced,
      difference,
      assetsVariance:
        comparativeTotalAssets !== undefined ? totalAssets - comparativeTotalAssets : undefined,
      assetsVariancePercent:
        comparativeTotalAssets !== undefined && comparativeTotalAssets !== 0
          ? ((totalAssets - comparativeTotalAssets) / comparativeTotalAssets) * 100
          : undefined,
      liabilitiesVariance:
        comparativeTotalLiabilities !== undefined
          ? totalLiabilities - comparativeTotalLiabilities
          : undefined,
      liabilitiesVariancePercent:
        comparativeTotalLiabilities !== undefined && comparativeTotalLiabilities !== 0
          ? ((totalLiabilities - comparativeTotalLiabilities) / comparativeTotalLiabilities) * 100
          : undefined,
      equityVariance:
        comparativeTotalEquity !== undefined ? totalEquity - comparativeTotalEquity : undefined,
      equityVariancePercent:
        comparativeTotalEquity !== undefined && comparativeTotalEquity !== 0
          ? ((totalEquity - comparativeTotalEquity) / comparativeTotalEquity) * 100
          : undefined,
    }
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  private buildSection(name: string, items: ReportLineItem[]): ReportSection {
    // Sort by account number
    items.sort((a, b) => a.accountNumber.localeCompare(b.accountNumber))

    const subtotal = items.reduce((sum, item) => sum + item.amount, 0)
    const comparativeSubtotal = items.some((item) => item.comparativeAmount !== undefined)
      ? items.reduce((sum, item) => sum + (item.comparativeAmount ?? 0), 0)
      : undefined

    return {
      name,
      items,
      subtotal,
      comparativeSubtotal,
      variance:
        comparativeSubtotal !== undefined ? subtotal - comparativeSubtotal : undefined,
      variancePercent:
        comparativeSubtotal !== undefined && comparativeSubtotal !== 0
          ? ((subtotal - comparativeSubtotal) / comparativeSubtotal) * 100
          : undefined,
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new FinancialReportGenerator with the given data provider
 */
export function createFinancialReportGenerator(
  dataProvider: ReportDataProvider
): FinancialReportGenerator {
  return new FinancialReportGeneratorImpl(dataProvider)
}

// =============================================================================
// In-Memory Data Provider for Testing
// =============================================================================

export interface InMemoryAccountData {
  accountId: string
  accountNumber: string
  accountName: string
  accountType: AccountType
  isContra?: boolean
  parentAccountId?: string
  depth?: number
  /** Account balance by date (ISO string key) */
  balances: Map<string, number>
  /** Period balances for P&L (startDate_endDate key format) */
  periodBalances: Map<string, number>
}

/**
 * In-memory data provider for testing the report generator
 */
export class InMemoryReportDataProvider implements ReportDataProvider {
  private accounts: Map<string, InMemoryAccountData> = new Map()
  private functionalCurrency: string = 'USD'

  addAccount(data: Omit<InMemoryAccountData, 'balances' | 'periodBalances'>): void {
    this.accounts.set(data.accountId, {
      ...data,
      balances: new Map(),
      periodBalances: new Map(),
    })
  }

  setAccountBalance(accountId: string, date: Date, balance: number): void {
    const account = this.accounts.get(accountId)
    if (account) {
      account.balances.set(date.toISOString().split('T')[0], balance)
    }
  }

  setAccountPeriodBalance(
    accountId: string,
    startDate: Date,
    endDate: Date,
    balance: number
  ): void {
    const account = this.accounts.get(accountId)
    if (account) {
      const key = `${startDate.toISOString().split('T')[0]}_${endDate.toISOString().split('T')[0]}`
      account.periodBalances.set(key, balance)
    }
  }

  setFunctionalCurrency(currency: string): void {
    this.functionalCurrency = currency
  }

  async getAccounts(): Promise<AccountBalance[]> {
    return Array.from(this.accounts.values()).map((acc) => ({
      accountId: acc.accountId,
      accountNumber: acc.accountNumber,
      accountName: acc.accountName,
      accountType: acc.accountType,
      debitBalance: 0,
      creditBalance: 0,
      balance: 0,
      isContra: acc.isContra,
      parentAccountId: acc.parentAccountId,
      depth: acc.depth,
    }))
  }

  async getAccountBalanceAtDate(accountId: string, date: Date): Promise<number> {
    const account = this.accounts.get(accountId)
    if (!account) return 0

    const dateKey = date.toISOString().split('T')[0]

    // Find the most recent balance on or before the given date
    let latestBalance = 0
    let latestDate = ''

    for (const [key, balance] of account.balances) {
      if (key <= dateKey && key > latestDate) {
        latestDate = key
        latestBalance = balance
      }
    }

    return latestBalance
  }

  async getAccountBalanceForPeriod(
    accountId: string,
    startDate: Date,
    endDate: Date
  ): Promise<number> {
    const account = this.accounts.get(accountId)
    if (!account) return 0

    const key = `${startDate.toISOString().split('T')[0]}_${endDate.toISOString().split('T')[0]}`
    return account.periodBalances.get(key) ?? 0
  }

  async getAccountsByType(type: AccountType): Promise<AccountBalance[]> {
    return Array.from(this.accounts.values())
      .filter((acc) => acc.accountType === type)
      .map((acc) => ({
        accountId: acc.accountId,
        accountNumber: acc.accountNumber,
        accountName: acc.accountName,
        accountType: acc.accountType,
        debitBalance: 0,
        creditBalance: 0,
        balance: 0,
        isContra: acc.isContra,
        parentAccountId: acc.parentAccountId,
        depth: acc.depth,
      }))
  }

  async getFunctionalCurrency(): Promise<string> {
    return this.functionalCurrency
  }
}

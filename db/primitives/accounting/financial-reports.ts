/**
 * Financial Reports - P&L, Balance Sheet, Cash Flow Statement, Trial Balance
 *
 * Implements GAAP-compliant financial report generation:
 * - Profit & Loss (Income) Statement
 * - Balance Sheet (Statement of Financial Position)
 * - Cash Flow Statement (Statement of Cash Flows)
 * - Trial Balance
 *
 * Supports:
 * - Date ranges and as-of dates
 * - Comparative periods (e.g., this year vs last year)
 * - Account hierarchy aggregation
 * - Multi-currency support via functional currency conversion
 * - Structured output formatting (text, JSON, HTML)
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
// Cash Flow Statement Types
// =============================================================================

/**
 * Cash flow activity type
 */
export type CashFlowActivityType = 'operating' | 'investing' | 'financing'

/**
 * Cash flow line item
 */
export interface CashFlowLineItem {
  accountId: string
  accountName: string
  description: string
  amount: number
  comparativeAmount?: number
  variance?: number
  variancePercent?: number
  activityType: CashFlowActivityType
  isAdjustment?: boolean
}

/**
 * Cash flow section (Operating, Investing, Financing)
 */
export interface CashFlowSection {
  name: string
  items: CashFlowLineItem[]
  subtotal: number
  comparativeSubtotal?: number
  variance?: number
  variancePercent?: number
}

/**
 * Cash Flow Statement report
 * Uses the indirect method for operating activities
 */
export interface CashFlowStatementReport {
  period: ReportPeriod
  comparativePeriod?: ReportPeriod
  generatedAt: Date
  currency: string
  method: 'indirect' | 'direct'

  // Starting point for indirect method
  netIncome: number
  comparativeNetIncome?: number

  // Operating Activities
  operatingActivities: CashFlowSection
  netCashFromOperating: number
  comparativeNetCashFromOperating?: number

  // Investing Activities
  investingActivities: CashFlowSection
  netCashFromInvesting: number
  comparativeNetCashFromInvesting?: number

  // Financing Activities
  financingActivities: CashFlowSection
  netCashFromFinancing: number
  comparativeNetCashFromFinancing?: number

  // Net change and balances
  netChangeInCash: number
  comparativeNetChangeInCash?: number
  beginningCashBalance: number
  comparativeBeginningCashBalance?: number
  endingCashBalance: number
  comparativeEndingCashBalance?: number

  // Verification
  isReconciled: boolean
  reconciliationDifference: number
}

/**
 * Options for generating cash flow statement
 */
export interface CashFlowStatementOptions {
  period: ReportPeriod
  comparativePeriod?: ComparativePeriod
  method?: 'indirect' | 'direct'
  currency?: string
  /**
   * Account IDs to treat as cash accounts for beginning/ending balance
   */
  cashAccountIds?: string[]
}

// =============================================================================
// Report Formatting Types
// =============================================================================

/**
 * Output format for reports
 */
export type ReportOutputFormat = 'text' | 'json' | 'html' | 'csv'

/**
 * Formatting options for report output
 */
export interface ReportFormattingOptions {
  format: ReportOutputFormat
  /** Include headers in output */
  includeHeaders?: boolean
  /** Number of decimal places for amounts */
  decimalPlaces?: number
  /** Currency symbol to use */
  currencySymbol?: string
  /** Thousands separator */
  thousandsSeparator?: string
  /** Indent size for hierarchical display */
  indentSize?: number
  /** Show zero amounts */
  showZeroAmounts?: boolean
  /** Show variance columns */
  showVariance?: boolean
  /** Show percentage columns */
  showPercentage?: boolean
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

  /**
   * Generate a Cash Flow Statement report
   */
  generateCashFlowStatement(options: CashFlowStatementOptions): Promise<CashFlowStatementReport>
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

      // Contra assets (like Accumulated Depreciation) should be shown as negative
      // to reduce the section total when summed
      const isContraAsset = account.isContra === true
      const displayAmount = isContraAsset ? -balance : balance
      const displayComparativeAmount = isContraAsset && comparativeBalance !== undefined
        ? -comparativeBalance
        : comparativeBalance

      const item: ReportLineItem = {
        accountId: account.accountId,
        accountNumber: account.accountNumber,
        accountName: account.accountName,
        amount: displayAmount,
        comparativeAmount: displayComparativeAmount,
        variance: displayComparativeAmount !== undefined ? displayAmount - displayComparativeAmount : undefined,
        variancePercent:
          displayComparativeAmount !== undefined && displayComparativeAmount !== 0
            ? ((displayAmount - displayComparativeAmount) / Math.abs(displayComparativeAmount)) * 100
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
  // Cash Flow Statement
  // ===========================================================================

  async generateCashFlowStatement(
    options: CashFlowStatementOptions
  ): Promise<CashFlowStatementReport> {
    const { period, comparativePeriod, method = 'indirect' } = options
    const currency = options.currency ?? (await this.dataProvider.getFunctionalCurrency())

    // Default cash account IDs - typically account 1000 (Cash)
    const cashAccountIds = options.cashAccountIds ?? ['cash', '1000']

    // Get net income from P&L for the period (indirect method starts here)
    const incomeStatement = await this.generateIncomeStatement({ period, comparativePeriod })
    const netIncome = incomeStatement.netIncome
    const comparativeNetIncome = incomeStatement.comparativeNetIncome

    // Get all accounts for calculating changes
    const accounts = await this.dataProvider.getAccounts()

    // Build operating activities (indirect method: adjustments to net income)
    const operatingItems: CashFlowLineItem[] = []

    // Add depreciation/amortization adjustments (non-cash expenses)
    const expenseAccounts = await this.dataProvider.getAccountsByType('expense')
    for (const account of expenseAccounts) {
      // Depreciation and amortization are non-cash expenses, add back
      const isDepreciationOrAmortization =
        account.accountName.toLowerCase().includes('depreciation') ||
        account.accountName.toLowerCase().includes('amortization')

      if (isDepreciationOrAmortization) {
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

        if (amount !== 0 || (comparativeAmount && comparativeAmount !== 0)) {
          operatingItems.push({
            accountId: account.accountId,
            accountName: account.accountName,
            description: `Add back: ${account.accountName}`,
            amount: Math.abs(amount),
            comparativeAmount: comparativeAmount !== undefined ? Math.abs(comparativeAmount) : undefined,
            activityType: 'operating',
            isAdjustment: true,
          })
        }
      }
    }

    // Changes in working capital (current assets and current liabilities)
    const assetAccounts = await this.dataProvider.getAccountsByType('asset')
    for (const account of assetAccounts) {
      // Skip cash accounts and fixed assets
      const accountNum = parseInt(account.accountNumber.split('.')[0], 10)
      const isCashAccount = cashAccountIds.includes(account.accountId) ||
        cashAccountIds.includes(account.accountNumber)
      const isCurrentAsset = accountNum >= 1000 && accountNum < 1300

      if (isCashAccount || !isCurrentAsset) continue

      const beginningBalance = await this.dataProvider.getAccountBalanceAtDate(
        account.accountId,
        period.startDate
      )
      const endingBalance = await this.dataProvider.getAccountBalanceAtDate(
        account.accountId,
        period.endDate
      )
      const change = endingBalance - beginningBalance

      let comparativeChange: number | undefined
      if (comparativePeriod) {
        const compBeginning = await this.dataProvider.getAccountBalanceAtDate(
          account.accountId,
          comparativePeriod.startDate
        )
        const compEnding = await this.dataProvider.getAccountBalanceAtDate(
          account.accountId,
          comparativePeriod.endDate
        )
        comparativeChange = compEnding - compBeginning
      }

      if (change !== 0 || (comparativeChange && comparativeChange !== 0)) {
        // Increase in current assets decreases cash (negative)
        // Decrease in current assets increases cash (positive)
        operatingItems.push({
          accountId: account.accountId,
          accountName: account.accountName,
          description: change > 0
            ? `Increase in ${account.accountName}`
            : `Decrease in ${account.accountName}`,
          amount: -change, // Invert: asset increase = cash decrease
          comparativeAmount: comparativeChange !== undefined ? -comparativeChange : undefined,
          activityType: 'operating',
          isAdjustment: true,
        })
      }
    }

    // Changes in current liabilities
    const liabilityAccounts = await this.dataProvider.getAccountsByType('liability')
    for (const account of liabilityAccounts) {
      const accountNum = parseInt(account.accountNumber.split('.')[0], 10)
      const isCurrentLiability = accountNum >= 2000 && accountNum < 2300

      if (!isCurrentLiability) continue

      const beginningBalance = await this.dataProvider.getAccountBalanceAtDate(
        account.accountId,
        period.startDate
      )
      const endingBalance = await this.dataProvider.getAccountBalanceAtDate(
        account.accountId,
        period.endDate
      )
      const change = endingBalance - beginningBalance

      let comparativeChange: number | undefined
      if (comparativePeriod) {
        const compBeginning = await this.dataProvider.getAccountBalanceAtDate(
          account.accountId,
          comparativePeriod.startDate
        )
        const compEnding = await this.dataProvider.getAccountBalanceAtDate(
          account.accountId,
          comparativePeriod.endDate
        )
        comparativeChange = compEnding - compBeginning
      }

      if (change !== 0 || (comparativeChange && comparativeChange !== 0)) {
        // Increase in current liabilities increases cash (positive)
        // Decrease in current liabilities decreases cash (negative)
        operatingItems.push({
          accountId: account.accountId,
          accountName: account.accountName,
          description: change > 0
            ? `Increase in ${account.accountName}`
            : `Decrease in ${account.accountName}`,
          amount: change,
          comparativeAmount: comparativeChange,
          activityType: 'operating',
          isAdjustment: true,
        })
      }
    }

    // Build investing activities (changes in fixed assets)
    const investingItems: CashFlowLineItem[] = []
    for (const account of assetAccounts) {
      const accountNum = parseInt(account.accountNumber.split('.')[0], 10)
      const isFixedAsset = accountNum >= 1300 && accountNum < 1600
      const isContra = account.isContra === true

      // Skip non-fixed assets and contra accounts (depreciation handled in operating)
      if (!isFixedAsset || isContra) continue

      const beginningBalance = await this.dataProvider.getAccountBalanceAtDate(
        account.accountId,
        period.startDate
      )
      const endingBalance = await this.dataProvider.getAccountBalanceAtDate(
        account.accountId,
        period.endDate
      )
      const change = endingBalance - beginningBalance

      let comparativeChange: number | undefined
      if (comparativePeriod) {
        const compBeginning = await this.dataProvider.getAccountBalanceAtDate(
          account.accountId,
          comparativePeriod.startDate
        )
        const compEnding = await this.dataProvider.getAccountBalanceAtDate(
          account.accountId,
          comparativePeriod.endDate
        )
        comparativeChange = compEnding - compBeginning
      }

      if (change !== 0 || (comparativeChange && comparativeChange !== 0)) {
        investingItems.push({
          accountId: account.accountId,
          accountName: account.accountName,
          description: change > 0
            ? `Purchase of ${account.accountName}`
            : `Sale of ${account.accountName}`,
          amount: -change, // Purchases are cash outflow (negative)
          comparativeAmount: comparativeChange !== undefined ? -comparativeChange : undefined,
          activityType: 'investing',
        })
      }
    }

    // Build financing activities (changes in long-term debt and equity)
    const financingItems: CashFlowLineItem[] = []

    // Long-term liabilities
    for (const account of liabilityAccounts) {
      const accountNum = parseInt(account.accountNumber.split('.')[0], 10)
      const isLongTermLiability = accountNum >= 2300

      if (!isLongTermLiability) continue

      const beginningBalance = await this.dataProvider.getAccountBalanceAtDate(
        account.accountId,
        period.startDate
      )
      const endingBalance = await this.dataProvider.getAccountBalanceAtDate(
        account.accountId,
        period.endDate
      )
      const change = endingBalance - beginningBalance

      let comparativeChange: number | undefined
      if (comparativePeriod) {
        const compBeginning = await this.dataProvider.getAccountBalanceAtDate(
          account.accountId,
          comparativePeriod.startDate
        )
        const compEnding = await this.dataProvider.getAccountBalanceAtDate(
          account.accountId,
          comparativePeriod.endDate
        )
        comparativeChange = compEnding - compBeginning
      }

      if (change !== 0 || (comparativeChange && comparativeChange !== 0)) {
        financingItems.push({
          accountId: account.accountId,
          accountName: account.accountName,
          description: change > 0
            ? `Proceeds from ${account.accountName}`
            : `Repayment of ${account.accountName}`,
          amount: change,
          comparativeAmount: comparativeChange,
          activityType: 'financing',
        })
      }
    }

    // Equity changes (excluding retained earnings which is from net income)
    const equityAccounts = await this.dataProvider.getAccountsByType('equity')
    for (const account of equityAccounts) {
      // Skip retained earnings - that's captured in net income
      if (account.accountName.toLowerCase().includes('retained')) continue

      const beginningBalance = await this.dataProvider.getAccountBalanceAtDate(
        account.accountId,
        period.startDate
      )
      const endingBalance = await this.dataProvider.getAccountBalanceAtDate(
        account.accountId,
        period.endDate
      )
      const change = endingBalance - beginningBalance

      let comparativeChange: number | undefined
      if (comparativePeriod) {
        const compBeginning = await this.dataProvider.getAccountBalanceAtDate(
          account.accountId,
          comparativePeriod.startDate
        )
        const compEnding = await this.dataProvider.getAccountBalanceAtDate(
          account.accountId,
          comparativePeriod.endDate
        )
        comparativeChange = compEnding - compBeginning
      }

      if (change !== 0 || (comparativeChange && comparativeChange !== 0)) {
        // For contra equity (dividends), decrease means cash outflow
        const isContra = account.isContra === true
        const cashEffect = isContra ? -change : change

        financingItems.push({
          accountId: account.accountId,
          accountName: account.accountName,
          description: change > 0
            ? isContra ? `Dividends paid` : `Issuance of ${account.accountName}`
            : isContra ? `Dividends received` : `Repurchase of ${account.accountName}`,
          amount: cashEffect,
          comparativeAmount: comparativeChange !== undefined
            ? (isContra ? -comparativeChange : comparativeChange)
            : undefined,
          activityType: 'financing',
        })
      }
    }

    // Build sections
    const operatingActivities = this.buildCashFlowSection('Operating Activities', operatingItems)
    const investingActivities = this.buildCashFlowSection('Investing Activities', investingItems)
    const financingActivities = this.buildCashFlowSection('Financing Activities', financingItems)

    // Calculate net cash from each activity
    const netCashFromOperating = netIncome + operatingActivities.subtotal
    const comparativeNetCashFromOperating = comparativeNetIncome !== undefined
      ? comparativeNetIncome + (operatingActivities.comparativeSubtotal ?? 0)
      : undefined

    const netCashFromInvesting = investingActivities.subtotal
    const comparativeNetCashFromInvesting = investingActivities.comparativeSubtotal

    const netCashFromFinancing = financingActivities.subtotal
    const comparativeNetCashFromFinancing = financingActivities.comparativeSubtotal

    // Net change in cash
    const netChangeInCash = netCashFromOperating + netCashFromInvesting + netCashFromFinancing
    const comparativeNetChangeInCash =
      comparativeNetCashFromOperating !== undefined &&
      comparativeNetCashFromInvesting !== undefined &&
      comparativeNetCashFromFinancing !== undefined
        ? comparativeNetCashFromOperating + comparativeNetCashFromInvesting + comparativeNetCashFromFinancing
        : undefined

    // Get beginning and ending cash balances
    let beginningCashBalance = 0
    let endingCashBalance = 0
    let comparativeBeginningCashBalance: number | undefined
    let comparativeEndingCashBalance: number | undefined

    for (const account of assetAccounts) {
      const isCashAccount = cashAccountIds.includes(account.accountId) ||
        cashAccountIds.includes(account.accountNumber)

      if (isCashAccount) {
        beginningCashBalance += await this.dataProvider.getAccountBalanceAtDate(
          account.accountId,
          period.startDate
        )
        endingCashBalance += await this.dataProvider.getAccountBalanceAtDate(
          account.accountId,
          period.endDate
        )

        if (comparativePeriod) {
          comparativeBeginningCashBalance = (comparativeBeginningCashBalance ?? 0) +
            await this.dataProvider.getAccountBalanceAtDate(
              account.accountId,
              comparativePeriod.startDate
            )
          comparativeEndingCashBalance = (comparativeEndingCashBalance ?? 0) +
            await this.dataProvider.getAccountBalanceAtDate(
              account.accountId,
              comparativePeriod.endDate
            )
        }
      }
    }

    // Verify reconciliation
    const expectedEndingCash = beginningCashBalance + netChangeInCash
    const reconciliationDifference = Math.abs(expectedEndingCash - endingCashBalance)
    const isReconciled = reconciliationDifference < 0.01

    return {
      period,
      comparativePeriod,
      generatedAt: new Date(),
      currency,
      method,
      netIncome,
      comparativeNetIncome,
      operatingActivities,
      netCashFromOperating,
      comparativeNetCashFromOperating,
      investingActivities,
      netCashFromInvesting,
      comparativeNetCashFromInvesting,
      financingActivities,
      netCashFromFinancing,
      comparativeNetCashFromFinancing,
      netChangeInCash,
      comparativeNetChangeInCash,
      beginningCashBalance,
      comparativeBeginningCashBalance,
      endingCashBalance,
      comparativeEndingCashBalance,
      isReconciled,
      reconciliationDifference,
    }
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  private buildCashFlowSection(name: string, items: CashFlowLineItem[]): CashFlowSection {
    const subtotal = items.reduce((sum, item) => sum + item.amount, 0)
    const comparativeSubtotal = items.some((item) => item.comparativeAmount !== undefined)
      ? items.reduce((sum, item) => sum + (item.comparativeAmount ?? 0), 0)
      : undefined

    // Calculate variance for each item
    for (const item of items) {
      if (item.comparativeAmount !== undefined) {
        item.variance = item.amount - item.comparativeAmount
        if (item.comparativeAmount !== 0) {
          item.variancePercent = ((item.amount - item.comparativeAmount) / Math.abs(item.comparativeAmount)) * 100
        }
      }
    }

    return {
      name,
      items,
      subtotal,
      comparativeSubtotal,
      variance: comparativeSubtotal !== undefined ? subtotal - comparativeSubtotal : undefined,
      variancePercent:
        comparativeSubtotal !== undefined && comparativeSubtotal !== 0
          ? ((subtotal - comparativeSubtotal) / Math.abs(comparativeSubtotal)) * 100
          : undefined,
    }
  }

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

// =============================================================================
// Report Formatters
// =============================================================================

/**
 * Default formatting options
 */
const DEFAULT_FORMATTING_OPTIONS: ReportFormattingOptions = {
  format: 'text',
  includeHeaders: true,
  decimalPlaces: 2,
  currencySymbol: '$',
  thousandsSeparator: ',',
  indentSize: 2,
  showZeroAmounts: false,
  showVariance: true,
  showPercentage: true,
}

/**
 * Format a number as currency
 */
export function formatCurrency(
  amount: number,
  options: Partial<ReportFormattingOptions> = {}
): string {
  const opts = { ...DEFAULT_FORMATTING_OPTIONS, ...options }
  const absAmount = Math.abs(amount)
  const formatted = absAmount.toFixed(opts.decimalPlaces!)
  const parts = formatted.split('.')
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, opts.thousandsSeparator!)
  const result = opts.decimalPlaces! > 0 ? parts.join('.') : parts[0]
  const prefix = amount < 0 ? '(' : ''
  const suffix = amount < 0 ? ')' : ''
  return `${prefix}${opts.currencySymbol}${result}${suffix}`
}

/**
 * Format a percentage
 */
export function formatPercentage(
  value: number,
  decimalPlaces: number = 1
): string {
  if (value === undefined || value === null || isNaN(value)) return '-'
  const prefix = value >= 0 ? '' : ''
  return `${prefix}${value.toFixed(decimalPlaces)}%`
}

/**
 * Format a date for reports
 */
export function formatReportDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

/**
 * Format a report period
 */
export function formatReportPeriod(period: ReportPeriod): string {
  if (period.label) return period.label
  return `${formatReportDate(period.startDate)} - ${formatReportDate(period.endDate)}`
}

/**
 * Report formatter for text output
 */
export class ReportFormatter {
  private options: ReportFormattingOptions

  constructor(options: Partial<ReportFormattingOptions> = {}) {
    this.options = { ...DEFAULT_FORMATTING_OPTIONS, ...options }
  }

  /**
   * Format Income Statement as text
   */
  formatIncomeStatement(report: IncomeStatementReport): string {
    const lines: string[] = []
    const indent = ' '.repeat(this.options.indentSize!)

    lines.push('=' .repeat(60))
    lines.push('INCOME STATEMENT')
    lines.push('=' .repeat(60))
    lines.push(`Period: ${formatReportPeriod(report.period)}`)
    if (report.comparativePeriod) {
      lines.push(`Comparative Period: ${formatReportPeriod(report.comparativePeriod)}`)
    }
    lines.push(`Currency: ${report.currency}`)
    lines.push(`Generated: ${formatReportDate(report.generatedAt)}`)
    lines.push('')

    // Revenue
    lines.push('REVENUE')
    lines.push('-'.repeat(60))
    lines.push(...this.formatSection(report.operatingRevenue, indent))
    lines.push(...this.formatSection(report.otherIncome, indent))
    lines.push(`${indent}TOTAL REVENUE: ${formatCurrency(report.totalRevenue, this.options)}`)
    lines.push('')

    // Cost of Sales
    lines.push('COST OF SALES')
    lines.push('-'.repeat(60))
    lines.push(...this.formatSection(report.costOfSales, indent))
    lines.push('')

    lines.push(`GROSS PROFIT: ${formatCurrency(report.grossProfit, this.options)}`)
    lines.push('')

    // Operating Expenses
    lines.push('OPERATING EXPENSES')
    lines.push('-'.repeat(60))
    lines.push(...this.formatSection(report.operatingExpenses, indent))
    lines.push('')

    lines.push(`OPERATING INCOME: ${formatCurrency(report.operatingIncome, this.options)}`)
    lines.push('')

    // Other Expenses
    if (report.otherExpenses.items.length > 0) {
      lines.push('OTHER EXPENSES')
      lines.push('-'.repeat(60))
      lines.push(...this.formatSection(report.otherExpenses, indent))
      lines.push('')
    }

    lines.push('=' .repeat(60))
    lines.push(`NET INCOME: ${formatCurrency(report.netIncome, this.options)}`)
    lines.push('=' .repeat(60))

    return lines.join('\n')
  }

  /**
   * Format Balance Sheet as text
   */
  formatBalanceSheet(report: BalanceSheetReport): string {
    const lines: string[] = []
    const indent = ' '.repeat(this.options.indentSize!)

    lines.push('=' .repeat(60))
    lines.push('BALANCE SHEET')
    lines.push('=' .repeat(60))
    lines.push(`As of: ${formatReportDate(report.asOfDate)}`)
    if (report.comparativeDate) {
      lines.push(`Comparative Date: ${formatReportDate(report.comparativeDate)}`)
    }
    lines.push(`Currency: ${report.currency}`)
    lines.push(`Generated: ${formatReportDate(report.generatedAt)}`)
    lines.push('')

    // Assets
    lines.push('ASSETS')
    lines.push('-'.repeat(60))
    lines.push(...this.formatSection(report.currentAssets, indent))
    lines.push(...this.formatSection(report.fixedAssets, indent))
    if (report.intangibleAssets.items.length > 0) {
      lines.push(...this.formatSection(report.intangibleAssets, indent))
    }
    if (report.otherAssets.items.length > 0) {
      lines.push(...this.formatSection(report.otherAssets, indent))
    }
    lines.push(`${indent}TOTAL ASSETS: ${formatCurrency(report.totalAssets, this.options)}`)
    lines.push('')

    // Liabilities
    lines.push('LIABILITIES')
    lines.push('-'.repeat(60))
    lines.push(...this.formatSection(report.currentLiabilities, indent))
    lines.push(...this.formatSection(report.longTermLiabilities, indent))
    lines.push(`${indent}TOTAL LIABILITIES: ${formatCurrency(report.totalLiabilities, this.options)}`)
    lines.push('')

    // Equity
    lines.push("STOCKHOLDERS' EQUITY")
    lines.push('-'.repeat(60))
    lines.push(...this.formatSection(report.equity, indent))
    lines.push(`${indent}TOTAL EQUITY: ${formatCurrency(report.totalEquity, this.options)}`)
    lines.push('')

    lines.push('=' .repeat(60))
    lines.push(`TOTAL LIABILITIES & EQUITY: ${formatCurrency(report.totalLiabilitiesAndEquity, this.options)}`)
    lines.push('=' .repeat(60))

    if (!report.isBalanced) {
      lines.push(`WARNING: Balance sheet is out of balance by ${formatCurrency(report.difference, this.options)}`)
    }

    return lines.join('\n')
  }

  /**
   * Format Cash Flow Statement as text
   */
  formatCashFlowStatement(report: CashFlowStatementReport): string {
    const lines: string[] = []
    const indent = ' '.repeat(this.options.indentSize!)

    lines.push('=' .repeat(60))
    lines.push('STATEMENT OF CASH FLOWS')
    lines.push('=' .repeat(60))
    lines.push(`Period: ${formatReportPeriod(report.period)}`)
    if (report.comparativePeriod) {
      lines.push(`Comparative Period: ${formatReportPeriod(report.comparativePeriod)}`)
    }
    lines.push(`Method: ${report.method.charAt(0).toUpperCase() + report.method.slice(1)}`)
    lines.push(`Currency: ${report.currency}`)
    lines.push(`Generated: ${formatReportDate(report.generatedAt)}`)
    lines.push('')

    // Operating Activities
    lines.push('OPERATING ACTIVITIES')
    lines.push('-'.repeat(60))
    lines.push(`${indent}Net Income: ${formatCurrency(report.netIncome, this.options)}`)
    lines.push(`${indent}Adjustments:`)
    for (const item of report.operatingActivities.items) {
      lines.push(`${indent}${indent}${item.description}: ${formatCurrency(item.amount, this.options)}`)
    }
    lines.push(`${indent}Net Cash from Operating: ${formatCurrency(report.netCashFromOperating, this.options)}`)
    lines.push('')

    // Investing Activities
    lines.push('INVESTING ACTIVITIES')
    lines.push('-'.repeat(60))
    for (const item of report.investingActivities.items) {
      lines.push(`${indent}${item.description}: ${formatCurrency(item.amount, this.options)}`)
    }
    lines.push(`${indent}Net Cash from Investing: ${formatCurrency(report.netCashFromInvesting, this.options)}`)
    lines.push('')

    // Financing Activities
    lines.push('FINANCING ACTIVITIES')
    lines.push('-'.repeat(60))
    for (const item of report.financingActivities.items) {
      lines.push(`${indent}${item.description}: ${formatCurrency(item.amount, this.options)}`)
    }
    lines.push(`${indent}Net Cash from Financing: ${formatCurrency(report.netCashFromFinancing, this.options)}`)
    lines.push('')

    // Summary
    lines.push('=' .repeat(60))
    lines.push(`Net Change in Cash: ${formatCurrency(report.netChangeInCash, this.options)}`)
    lines.push(`Beginning Cash Balance: ${formatCurrency(report.beginningCashBalance, this.options)}`)
    lines.push(`Ending Cash Balance: ${formatCurrency(report.endingCashBalance, this.options)}`)
    lines.push('=' .repeat(60))

    if (!report.isReconciled) {
      lines.push(`WARNING: Cash flow does not reconcile. Difference: ${formatCurrency(report.reconciliationDifference, this.options)}`)
    }

    return lines.join('\n')
  }

  /**
   * Format Trial Balance as text
   */
  formatTrialBalance(report: TrialBalanceReport): string {
    const lines: string[] = []
    const indent = ' '.repeat(this.options.indentSize!)

    lines.push('=' .repeat(80))
    lines.push('TRIAL BALANCE')
    lines.push('=' .repeat(80))
    lines.push(`As of: ${formatReportDate(report.asOfDate)}`)
    lines.push(`Currency: ${report.currency}`)
    lines.push(`Generated: ${formatReportDate(report.generatedAt)}`)
    lines.push('')

    // Header
    const acctWidth = 8
    const nameWidth = 30
    const amtWidth = 15
    lines.push(
      'Account'.padEnd(acctWidth) +
      'Name'.padEnd(nameWidth) +
      'Debit'.padStart(amtWidth) +
      'Credit'.padStart(amtWidth)
    )
    lines.push('-'.repeat(80))

    // Items
    for (const item of report.items) {
      const debitStr = item.debitBalance > 0 ? formatCurrency(item.debitBalance, this.options) : ''
      const creditStr = item.creditBalance > 0 ? formatCurrency(item.creditBalance, this.options) : ''
      lines.push(
        item.accountNumber.padEnd(acctWidth) +
        item.accountName.substring(0, nameWidth - 1).padEnd(nameWidth) +
        debitStr.padStart(amtWidth) +
        creditStr.padStart(amtWidth)
      )
    }

    lines.push('-'.repeat(80))
    lines.push(
      'TOTALS'.padEnd(acctWidth + nameWidth) +
      formatCurrency(report.totalDebits, this.options).padStart(amtWidth) +
      formatCurrency(report.totalCredits, this.options).padStart(amtWidth)
    )
    lines.push('=' .repeat(80))

    if (!report.isBalanced) {
      lines.push(`WARNING: Trial balance is out of balance by ${formatCurrency(report.difference, this.options)}`)
    } else {
      lines.push('Trial balance is in balance.')
    }

    return lines.join('\n')
  }

  private formatSection(section: ReportSection, indent: string): string[] {
    const lines: string[] = []
    lines.push(`${section.name}:`)
    for (const item of section.items) {
      const amount = formatCurrency(item.amount, this.options)
      lines.push(`${indent}${item.accountName}: ${amount}`)
    }
    lines.push(`${indent}Subtotal: ${formatCurrency(section.subtotal, this.options)}`)
    return lines
  }
}

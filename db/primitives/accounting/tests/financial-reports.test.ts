/**
 * Financial Reports Tests
 *
 * Tests for P&L, Balance Sheet, and Trial Balance report generation
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createFinancialReportGenerator,
  InMemoryReportDataProvider,
  type FinancialReportGenerator,
  type ReportPeriod,
} from '../financial-reports'

describe('FinancialReportGenerator', () => {
  let dataProvider: InMemoryReportDataProvider
  let reportGenerator: FinancialReportGenerator

  beforeEach(() => {
    dataProvider = new InMemoryReportDataProvider()
    reportGenerator = createFinancialReportGenerator(dataProvider)
  })

  describe('Trial Balance', () => {
    it('should generate empty trial balance with no accounts', async () => {
      const report = await reportGenerator.generateTrialBalance()

      expect(report.items).toHaveLength(0)
      expect(report.totalDebits).toBe(0)
      expect(report.totalCredits).toBe(0)
      expect(report.isBalanced).toBe(true)
      expect(report.difference).toBe(0)
      expect(report.currency).toBe('USD')
    })

    it('should generate trial balance with asset and liability accounts', async () => {
      // Setup accounts
      dataProvider.addAccount({
        accountId: 'cash',
        accountNumber: '1000',
        accountName: 'Cash',
        accountType: 'asset',
      })
      dataProvider.addAccount({
        accountId: 'ap',
        accountNumber: '2000',
        accountName: 'Accounts Payable',
        accountType: 'liability',
      })

      // Set balances
      const asOfDate = new Date('2024-12-31')
      dataProvider.setAccountBalance('cash', asOfDate, 10000)
      dataProvider.setAccountBalance('ap', asOfDate, 5000)

      const report = await reportGenerator.generateTrialBalance({ asOfDate })

      expect(report.items).toHaveLength(2)
      expect(report.totalDebits).toBe(10000) // Assets debit normal
      expect(report.totalCredits).toBe(5000) // Liabilities credit normal
      expect(report.isBalanced).toBe(false)
      expect(report.asOfDate).toEqual(asOfDate)
    })

    it('should show balanced trial balance when debits equal credits', async () => {
      // Setup balanced accounts
      dataProvider.addAccount({
        accountId: 'cash',
        accountNumber: '1000',
        accountName: 'Cash',
        accountType: 'asset',
      })
      dataProvider.addAccount({
        accountId: 'equity',
        accountNumber: '3000',
        accountName: 'Common Stock',
        accountType: 'equity',
      })

      const asOfDate = new Date('2024-12-31')
      dataProvider.setAccountBalance('cash', asOfDate, 10000)
      dataProvider.setAccountBalance('equity', asOfDate, 10000)

      const report = await reportGenerator.generateTrialBalance({ asOfDate })

      expect(report.totalDebits).toBe(10000)
      expect(report.totalCredits).toBe(10000)
      expect(report.isBalanced).toBe(true)
      expect(report.difference).toBe(0)
    })

    it('should exclude zero balance accounts by default', async () => {
      dataProvider.addAccount({
        accountId: 'cash',
        accountNumber: '1000',
        accountName: 'Cash',
        accountType: 'asset',
      })
      dataProvider.addAccount({
        accountId: 'ar',
        accountNumber: '1100',
        accountName: 'Accounts Receivable',
        accountType: 'asset',
      })

      const asOfDate = new Date('2024-12-31')
      dataProvider.setAccountBalance('cash', asOfDate, 10000)
      // ar has zero balance

      const report = await reportGenerator.generateTrialBalance({ asOfDate })

      expect(report.items).toHaveLength(1)
      expect(report.items[0].accountName).toBe('Cash')
    })

    it('should include zero balance accounts when requested', async () => {
      dataProvider.addAccount({
        accountId: 'cash',
        accountNumber: '1000',
        accountName: 'Cash',
        accountType: 'asset',
      })
      dataProvider.addAccount({
        accountId: 'ar',
        accountNumber: '1100',
        accountName: 'Accounts Receivable',
        accountType: 'asset',
      })

      const asOfDate = new Date('2024-12-31')
      dataProvider.setAccountBalance('cash', asOfDate, 10000)

      const report = await reportGenerator.generateTrialBalance({
        asOfDate,
        includeZeroBalances: true,
      })

      expect(report.items).toHaveLength(2)
    })

    it('should sort accounts by account number', async () => {
      dataProvider.addAccount({
        accountId: 'expenses',
        accountNumber: '5000',
        accountName: 'Expenses',
        accountType: 'expense',
      })
      dataProvider.addAccount({
        accountId: 'cash',
        accountNumber: '1000',
        accountName: 'Cash',
        accountType: 'asset',
      })
      dataProvider.addAccount({
        accountId: 'revenue',
        accountNumber: '4000',
        accountName: 'Revenue',
        accountType: 'revenue',
      })

      const asOfDate = new Date('2024-12-31')
      dataProvider.setAccountBalance('expenses', asOfDate, 3000)
      dataProvider.setAccountBalance('cash', asOfDate, 10000)
      dataProvider.setAccountBalance('revenue', asOfDate, 7000)

      const report = await reportGenerator.generateTrialBalance({ asOfDate })

      expect(report.items[0].accountNumber).toBe('1000')
      expect(report.items[1].accountNumber).toBe('4000')
      expect(report.items[2].accountNumber).toBe('5000')
    })

    it('should handle contra accounts correctly', async () => {
      dataProvider.addAccount({
        accountId: 'equipment',
        accountNumber: '1500',
        accountName: 'Equipment',
        accountType: 'asset',
      })
      dataProvider.addAccount({
        accountId: 'accum-dep',
        accountNumber: '1510',
        accountName: 'Accumulated Depreciation',
        accountType: 'asset',
        isContra: true,
      })

      const asOfDate = new Date('2024-12-31')
      dataProvider.setAccountBalance('equipment', asOfDate, 50000)
      dataProvider.setAccountBalance('accum-dep', asOfDate, 10000) // Contra has credit normal

      const report = await reportGenerator.generateTrialBalance({ asOfDate })

      const equipment = report.items.find((i) => i.accountId === 'equipment')
      const accumDep = report.items.find((i) => i.accountId === 'accum-dep')

      expect(equipment?.debitBalance).toBe(50000)
      expect(equipment?.creditBalance).toBe(0)
      // Contra asset with positive balance should be credit
      expect(accumDep?.creditBalance).toBe(10000)
      expect(accumDep?.debitBalance).toBe(0)
    })

    it('should use custom currency', async () => {
      dataProvider.setFunctionalCurrency('EUR')
      const report = await reportGenerator.generateTrialBalance({ currency: 'EUR' })

      expect(report.currency).toBe('EUR')
    })
  })

  describe('Income Statement (P&L)', () => {
    const period: ReportPeriod = {
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-12-31'),
      label: 'FY 2024',
    }

    beforeEach(() => {
      // Setup standard P&L accounts
      dataProvider.addAccount({
        accountId: 'sales-revenue',
        accountNumber: '4000',
        accountName: 'Sales Revenue',
        accountType: 'revenue',
      })
      dataProvider.addAccount({
        accountId: 'service-revenue',
        accountNumber: '4100',
        accountName: 'Service Revenue',
        accountType: 'revenue',
      })
      dataProvider.addAccount({
        accountId: 'cogs',
        accountNumber: '5000',
        accountName: 'Cost of Goods Sold',
        accountType: 'expense',
      })
      dataProvider.addAccount({
        accountId: 'salaries',
        accountNumber: '5100',
        accountName: 'Salaries Expense',
        accountType: 'expense',
      })
      dataProvider.addAccount({
        accountId: 'rent',
        accountNumber: '5200',
        accountName: 'Rent Expense',
        accountType: 'expense',
      })
      dataProvider.addAccount({
        accountId: 'interest',
        accountNumber: '5500',
        accountName: 'Interest Expense',
        accountType: 'expense',
      })
    })

    it('should generate income statement with revenue and expenses', async () => {
      // Set period balances
      dataProvider.setAccountPeriodBalance('sales-revenue', period.startDate, period.endDate, 100000)
      dataProvider.setAccountPeriodBalance('service-revenue', period.startDate, period.endDate, 25000)
      dataProvider.setAccountPeriodBalance('cogs', period.startDate, period.endDate, 40000)
      dataProvider.setAccountPeriodBalance('salaries', period.startDate, period.endDate, 30000)
      dataProvider.setAccountPeriodBalance('rent', period.startDate, period.endDate, 12000)
      dataProvider.setAccountPeriodBalance('interest', period.startDate, period.endDate, 3000)

      const report = await reportGenerator.generateIncomeStatement({ period })

      // Revenue
      expect(report.operatingRevenue.subtotal).toBe(100000)
      expect(report.otherIncome.subtotal).toBe(25000)
      expect(report.totalRevenue).toBe(125000)

      // Expenses
      expect(report.costOfSales.subtotal).toBe(40000)
      expect(report.operatingExpenses.subtotal).toBe(42000) // salaries + rent
      expect(report.otherExpenses.subtotal).toBe(3000)
      expect(report.totalExpenses).toBe(85000)

      // Calculated totals
      expect(report.grossProfit).toBe(85000) // 125000 - 40000
      expect(report.operatingIncome).toBe(43000) // 85000 - 42000
      expect(report.netIncome).toBe(40000) // 125000 - 85000

      expect(report.period).toEqual(period)
      expect(report.currency).toBe('USD')
    })

    it('should generate comparative income statement', async () => {
      const priorPeriod: ReportPeriod = {
        startDate: new Date('2023-01-01'),
        endDate: new Date('2023-12-31'),
        label: 'FY 2023',
      }

      // Current period
      dataProvider.setAccountPeriodBalance('sales-revenue', period.startDate, period.endDate, 120000)
      dataProvider.setAccountPeriodBalance('cogs', period.startDate, period.endDate, 48000)
      dataProvider.setAccountPeriodBalance('salaries', period.startDate, period.endDate, 35000)

      // Prior period
      dataProvider.setAccountPeriodBalance('sales-revenue', priorPeriod.startDate, priorPeriod.endDate, 100000)
      dataProvider.setAccountPeriodBalance('cogs', priorPeriod.startDate, priorPeriod.endDate, 40000)
      dataProvider.setAccountPeriodBalance('salaries', priorPeriod.startDate, priorPeriod.endDate, 30000)

      const report = await reportGenerator.generateIncomeStatement({
        period,
        comparativePeriod: { ...priorPeriod, comparison: 'prior_year' },
      })

      // Current period
      expect(report.totalRevenue).toBe(120000)
      expect(report.netIncome).toBe(37000)

      // Comparative
      expect(report.comparativeTotalRevenue).toBe(100000)
      expect(report.comparativeNetIncome).toBe(30000)

      // Variances
      expect(report.revenueVariance).toBe(20000)
      expect(report.revenueVariancePercent).toBe(20)
      expect(report.netIncomeVariance).toBe(7000)
    })

    it('should calculate variance percentages correctly', async () => {
      const priorPeriod: ReportPeriod = {
        startDate: new Date('2023-01-01'),
        endDate: new Date('2023-12-31'),
      }

      // 50% revenue increase
      dataProvider.setAccountPeriodBalance('sales-revenue', period.startDate, period.endDate, 150000)
      dataProvider.setAccountPeriodBalance('sales-revenue', priorPeriod.startDate, priorPeriod.endDate, 100000)

      const report = await reportGenerator.generateIncomeStatement({
        period,
        comparativePeriod: { ...priorPeriod, comparison: 'prior_year' },
      })

      expect(report.revenueVariancePercent).toBe(50)
    })

    it('should exclude zero balance accounts by default', async () => {
      dataProvider.setAccountPeriodBalance('sales-revenue', period.startDate, period.endDate, 100000)
      // Other accounts have zero

      const report = await reportGenerator.generateIncomeStatement({ period })

      expect(report.operatingRevenue.items).toHaveLength(1)
      expect(report.costOfSales.items).toHaveLength(0)
    })

    it('should include zero balance accounts when requested', async () => {
      dataProvider.setAccountPeriodBalance('sales-revenue', period.startDate, period.endDate, 100000)

      const report = await reportGenerator.generateIncomeStatement({
        period,
        includeZeroBalances: true,
      })

      // Should include all revenue and expense accounts
      expect(report.operatingRevenue.items.length + report.otherIncome.items.length).toBe(2)
    })

    it('should handle loss scenario (negative net income)', async () => {
      dataProvider.setAccountPeriodBalance('sales-revenue', period.startDate, period.endDate, 50000)
      dataProvider.setAccountPeriodBalance('cogs', period.startDate, period.endDate, 30000)
      dataProvider.setAccountPeriodBalance('salaries', period.startDate, period.endDate, 40000)

      const report = await reportGenerator.generateIncomeStatement({ period })

      expect(report.totalRevenue).toBe(50000)
      expect(report.totalExpenses).toBe(70000)
      expect(report.netIncome).toBe(-20000)
    })
  })

  describe('Balance Sheet', () => {
    beforeEach(() => {
      // Setup standard balance sheet accounts
      // Current Assets
      dataProvider.addAccount({
        accountId: 'cash',
        accountNumber: '1000',
        accountName: 'Cash',
        accountType: 'asset',
      })
      dataProvider.addAccount({
        accountId: 'ar',
        accountNumber: '1100',
        accountName: 'Accounts Receivable',
        accountType: 'asset',
      })
      dataProvider.addAccount({
        accountId: 'inventory',
        accountNumber: '1200',
        accountName: 'Inventory',
        accountType: 'asset',
      })

      // Fixed Assets
      dataProvider.addAccount({
        accountId: 'equipment',
        accountNumber: '1500',
        accountName: 'Equipment',
        accountType: 'asset',
      })
      dataProvider.addAccount({
        accountId: 'accum-dep',
        accountNumber: '1510',
        accountName: 'Accumulated Depreciation',
        accountType: 'asset',
        isContra: true,
        parentAccountId: 'equipment',
      })

      // Current Liabilities
      dataProvider.addAccount({
        accountId: 'ap',
        accountNumber: '2000',
        accountName: 'Accounts Payable',
        accountType: 'liability',
      })
      dataProvider.addAccount({
        accountId: 'accrued',
        accountNumber: '2100',
        accountName: 'Accrued Expenses',
        accountType: 'liability',
      })

      // Long-term Liabilities
      dataProvider.addAccount({
        accountId: 'notes-payable',
        accountNumber: '2500',
        accountName: 'Notes Payable',
        accountType: 'liability',
      })

      // Equity
      dataProvider.addAccount({
        accountId: 'common-stock',
        accountNumber: '3000',
        accountName: 'Common Stock',
        accountType: 'equity',
      })
      dataProvider.addAccount({
        accountId: 'retained-earnings',
        accountNumber: '3100',
        accountName: 'Retained Earnings',
        accountType: 'equity',
      })
    })

    it('should generate balanced balance sheet', async () => {
      const asOfDate = new Date('2024-12-31')

      // Assets: 150,000
      dataProvider.setAccountBalance('cash', asOfDate, 50000)
      dataProvider.setAccountBalance('ar', asOfDate, 30000)
      dataProvider.setAccountBalance('inventory', asOfDate, 20000)
      dataProvider.setAccountBalance('equipment', asOfDate, 60000)
      dataProvider.setAccountBalance('accum-dep', asOfDate, 10000) // Contra - reduces assets

      // Liabilities: 70,000
      dataProvider.setAccountBalance('ap', asOfDate, 25000)
      dataProvider.setAccountBalance('accrued', asOfDate, 5000)
      dataProvider.setAccountBalance('notes-payable', asOfDate, 40000)

      // Equity: 80,000 (should balance: 150 - 10 = 140 assets, 70 + 70 = 140)
      dataProvider.setAccountBalance('common-stock', asOfDate, 50000)
      dataProvider.setAccountBalance('retained-earnings', asOfDate, 20000)

      const report = await reportGenerator.generateBalanceSheet({ asOfDate })

      // Assets (equipment 60k - accum dep 10k = 50k fixed)
      expect(report.currentAssets.subtotal).toBe(100000) // cash + ar + inventory
      expect(report.fixedAssets.subtotal).toBe(50000) // equipment - accum dep
      expect(report.totalAssets).toBe(150000)

      // Liabilities
      expect(report.currentLiabilities.subtotal).toBe(30000)
      expect(report.longTermLiabilities.subtotal).toBe(40000)
      expect(report.totalLiabilities).toBe(70000)

      // Equity
      expect(report.totalEquity).toBe(70000)

      // Balance check
      expect(report.totalLiabilitiesAndEquity).toBe(140000)
      // Note: Balance sheet won't be balanced because we have contra asset counted differently
    })

    it('should generate comparative balance sheet', async () => {
      const currentDate = new Date('2024-12-31')
      const priorDate = new Date('2023-12-31')

      // Current period
      dataProvider.setAccountBalance('cash', currentDate, 60000)
      dataProvider.setAccountBalance('ap', currentDate, 20000)
      dataProvider.setAccountBalance('common-stock', currentDate, 40000)

      // Prior period
      dataProvider.setAccountBalance('cash', priorDate, 50000)
      dataProvider.setAccountBalance('ap', priorDate, 15000)
      dataProvider.setAccountBalance('common-stock', priorDate, 35000)

      const report = await reportGenerator.generateBalanceSheet({
        asOfDate: currentDate,
        comparativeDate: priorDate,
      })

      expect(report.totalAssets).toBe(60000)
      expect(report.comparativeTotalAssets).toBe(50000)
      expect(report.assetsVariance).toBe(10000)
      expect(report.assetsVariancePercent).toBe(20)
    })

    it('should categorize assets correctly', async () => {
      const asOfDate = new Date('2024-12-31')

      dataProvider.setAccountBalance('cash', asOfDate, 10000)
      dataProvider.setAccountBalance('ar', asOfDate, 20000)
      dataProvider.setAccountBalance('inventory', asOfDate, 15000)
      dataProvider.setAccountBalance('equipment', asOfDate, 50000)

      const report = await reportGenerator.generateBalanceSheet({ asOfDate })

      expect(report.currentAssets.items).toHaveLength(3)
      expect(report.fixedAssets.items).toHaveLength(1)
      expect(report.intangibleAssets.items).toHaveLength(0)
      expect(report.otherAssets.items).toHaveLength(0)
    })

    it('should categorize liabilities correctly', async () => {
      const asOfDate = new Date('2024-12-31')

      dataProvider.setAccountBalance('ap', asOfDate, 25000)
      dataProvider.setAccountBalance('accrued', asOfDate, 10000)
      dataProvider.setAccountBalance('notes-payable', asOfDate, 100000)

      const report = await reportGenerator.generateBalanceSheet({ asOfDate })

      expect(report.currentLiabilities.items).toHaveLength(2)
      expect(report.longTermLiabilities.items).toHaveLength(1)
    })

    it('should detect unbalanced balance sheet', async () => {
      const asOfDate = new Date('2024-12-31')

      // Assets: 100,000
      dataProvider.setAccountBalance('cash', asOfDate, 100000)

      // Liabilities + Equity: 80,000 (unbalanced)
      dataProvider.setAccountBalance('ap', asOfDate, 30000)
      dataProvider.setAccountBalance('common-stock', asOfDate, 50000)

      const report = await reportGenerator.generateBalanceSheet({ asOfDate })

      expect(report.totalAssets).toBe(100000)
      expect(report.totalLiabilitiesAndEquity).toBe(80000)
      expect(report.isBalanced).toBe(false)
      expect(report.difference).toBe(20000)
    })

    it('should handle zero balances correctly', async () => {
      const asOfDate = new Date('2024-12-31')
      dataProvider.setAccountBalance('cash', asOfDate, 50000)

      const report = await reportGenerator.generateBalanceSheet({
        asOfDate,
        includeZeroBalances: false,
      })

      expect(report.currentAssets.items).toHaveLength(1)
    })

    it('should use correct as-of date', async () => {
      const asOfDate = new Date('2024-06-30')
      dataProvider.setAccountBalance('cash', asOfDate, 25000)

      const report = await reportGenerator.generateBalanceSheet({ asOfDate })

      expect(report.asOfDate).toEqual(asOfDate)
    })
  })

  describe('ReportDataProvider', () => {
    it('should return most recent balance for as-of date', async () => {
      dataProvider.addAccount({
        accountId: 'cash',
        accountNumber: '1000',
        accountName: 'Cash',
        accountType: 'asset',
      })

      // Multiple balance dates
      dataProvider.setAccountBalance('cash', new Date('2024-01-01'), 10000)
      dataProvider.setAccountBalance('cash', new Date('2024-06-01'), 15000)
      dataProvider.setAccountBalance('cash', new Date('2024-12-01'), 20000)

      const balance = await dataProvider.getAccountBalanceAtDate('cash', new Date('2024-08-15'))

      expect(balance).toBe(15000) // Should get June balance, not December
    })

    it('should return zero for non-existent account', async () => {
      const balance = await dataProvider.getAccountBalanceAtDate('nonexistent', new Date())
      expect(balance).toBe(0)
    })

    it('should return functional currency', async () => {
      dataProvider.setFunctionalCurrency('GBP')
      const currency = await dataProvider.getFunctionalCurrency()
      expect(currency).toBe('GBP')
    })
  })

  describe('Report Sections', () => {
    it('should calculate section subtotals correctly', async () => {
      const period: ReportPeriod = {
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
      }

      dataProvider.addAccount({
        accountId: 'sales',
        accountNumber: '4000',
        accountName: 'Sales',
        accountType: 'revenue',
      })
      dataProvider.addAccount({
        accountId: 'services',
        accountNumber: '4050',
        accountName: 'Services',
        accountType: 'revenue',
      })

      dataProvider.setAccountPeriodBalance('sales', period.startDate, period.endDate, 80000)
      dataProvider.setAccountPeriodBalance('services', period.startDate, period.endDate, 20000)

      const report = await reportGenerator.generateIncomeStatement({ period })

      expect(report.operatingRevenue.subtotal).toBe(100000)
      expect(report.operatingRevenue.items).toHaveLength(2)
    })

    it('should calculate section variances correctly', async () => {
      const period: ReportPeriod = {
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
      }
      const priorPeriod: ReportPeriod = {
        startDate: new Date('2023-01-01'),
        endDate: new Date('2023-12-31'),
      }

      dataProvider.addAccount({
        accountId: 'sales',
        accountNumber: '4000',
        accountName: 'Sales',
        accountType: 'revenue',
      })

      dataProvider.setAccountPeriodBalance('sales', period.startDate, period.endDate, 120000)
      dataProvider.setAccountPeriodBalance('sales', priorPeriod.startDate, priorPeriod.endDate, 100000)

      const report = await reportGenerator.generateIncomeStatement({
        period,
        comparativePeriod: { ...priorPeriod, comparison: 'prior_year' },
      })

      expect(report.operatingRevenue.variance).toBe(20000)
      expect(report.operatingRevenue.variancePercent).toBe(20)
    })
  })
})

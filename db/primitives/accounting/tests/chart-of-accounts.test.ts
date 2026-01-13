/**
 * Chart of Accounts Tests - TDD RED Phase
 *
 * Tests for the chart of accounts primitive providing:
 * - Account types (Asset, Liability, Equity, Revenue, Expense)
 * - Account hierarchy (parent/child relationships)
 * - Account numbering system
 * - Account status (active/inactive)
 * - Account creation and validation
 * - Standard chart templates (US GAAP, IFRS)
 *
 * All tests should FAIL because implementation doesn't exist yet.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createChartOfAccounts,
  type ChartOfAccounts,
  type Account,
  type AccountType,
  type AccountStatus,
  type AccountTemplate,
  AccountTypes,
} from '../chart-of-accounts'

// =============================================================================
// Test Helpers
// =============================================================================

function createTestChart(): ChartOfAccounts {
  return createChartOfAccounts()
}

// =============================================================================
// Account Types Tests
// =============================================================================

describe('ChartOfAccounts', () => {
  describe('account types', () => {
    let chart: ChartOfAccounts

    beforeEach(() => {
      chart = createTestChart()
    })

    it('should support Asset account type', async () => {
      const account = await chart.createAccount({
        name: 'Cash',
        type: AccountTypes.ASSET,
        number: '1000',
      })

      expect(account.type).toBe(AccountTypes.ASSET)
      expect(account.normalBalance).toBe('debit')
    })

    it('should support Liability account type', async () => {
      const account = await chart.createAccount({
        name: 'Accounts Payable',
        type: AccountTypes.LIABILITY,
        number: '2000',
      })

      expect(account.type).toBe(AccountTypes.LIABILITY)
      expect(account.normalBalance).toBe('credit')
    })

    it('should support Equity account type', async () => {
      const account = await chart.createAccount({
        name: 'Retained Earnings',
        type: AccountTypes.EQUITY,
        number: '3000',
      })

      expect(account.type).toBe(AccountTypes.EQUITY)
      expect(account.normalBalance).toBe('credit')
    })

    it('should support Revenue account type', async () => {
      const account = await chart.createAccount({
        name: 'Sales Revenue',
        type: AccountTypes.REVENUE,
        number: '4000',
      })

      expect(account.type).toBe(AccountTypes.REVENUE)
      expect(account.normalBalance).toBe('credit')
    })

    it('should support Expense account type', async () => {
      const account = await chart.createAccount({
        name: 'Rent Expense',
        type: AccountTypes.EXPENSE,
        number: '5000',
      })

      expect(account.type).toBe(AccountTypes.EXPENSE)
      expect(account.normalBalance).toBe('debit')
    })

    it('should list all account types', () => {
      expect(AccountTypes.ASSET).toBe('asset')
      expect(AccountTypes.LIABILITY).toBe('liability')
      expect(AccountTypes.EQUITY).toBe('equity')
      expect(AccountTypes.REVENUE).toBe('revenue')
      expect(AccountTypes.EXPENSE).toBe('expense')
    })

    it('should filter accounts by type', async () => {
      await chart.createAccount({
        name: 'Cash',
        type: AccountTypes.ASSET,
        number: '1000',
      })
      await chart.createAccount({
        name: 'Inventory',
        type: AccountTypes.ASSET,
        number: '1200',
      })
      await chart.createAccount({
        name: 'Accounts Payable',
        type: AccountTypes.LIABILITY,
        number: '2000',
      })

      const assets = await chart.getAccountsByType(AccountTypes.ASSET)

      expect(assets).toHaveLength(2)
      expect(assets.every((a) => a.type === AccountTypes.ASSET)).toBe(true)
    })

    it('should support contra accounts', async () => {
      const account = await chart.createAccount({
        name: 'Accumulated Depreciation',
        type: AccountTypes.ASSET,
        number: '1500',
        isContra: true,
      })

      expect(account.type).toBe(AccountTypes.ASSET)
      expect(account.isContra).toBe(true)
      // Contra asset has credit normal balance (opposite of regular asset)
      expect(account.normalBalance).toBe('credit')
    })
  })

  // =============================================================================
  // Account Hierarchy Tests
  // =============================================================================

  describe('account hierarchy', () => {
    let chart: ChartOfAccounts

    beforeEach(() => {
      chart = createTestChart()
    })

    it('should create a root account', async () => {
      const account = await chart.createAccount({
        name: 'Current Assets',
        type: AccountTypes.ASSET,
        number: '1000',
      })

      expect(account.id).toBeDefined()
      expect(account.parentId).toBeUndefined()
    })

    it('should create a child account', async () => {
      const parent = await chart.createAccount({
        name: 'Current Assets',
        type: AccountTypes.ASSET,
        number: '1000',
      })

      const child = await chart.createAccount({
        name: 'Cash',
        type: AccountTypes.ASSET,
        number: '1010',
        parentId: parent.id,
      })

      expect(child.parentId).toBe(parent.id)
    })

    it('should enforce parent-child type consistency', async () => {
      const parent = await chart.createAccount({
        name: 'Current Assets',
        type: AccountTypes.ASSET,
        number: '1000',
      })

      // Should fail: trying to add liability under asset
      await expect(
        chart.createAccount({
          name: 'Accounts Payable',
          type: AccountTypes.LIABILITY,
          number: '1010',
          parentId: parent.id,
        })
      ).rejects.toThrow('Child account type must match parent type')
    })

    it('should get child accounts', async () => {
      const parent = await chart.createAccount({
        name: 'Current Assets',
        type: AccountTypes.ASSET,
        number: '1000',
      })

      await chart.createAccount({
        name: 'Cash',
        type: AccountTypes.ASSET,
        number: '1010',
        parentId: parent.id,
      })
      await chart.createAccount({
        name: 'Inventory',
        type: AccountTypes.ASSET,
        number: '1020',
        parentId: parent.id,
      })

      const children = await chart.getChildAccounts(parent.id)

      expect(children).toHaveLength(2)
    })

    it('should get account hierarchy tree', async () => {
      const assets = await chart.createAccount({
        name: 'Assets',
        type: AccountTypes.ASSET,
        number: '1000',
      })
      const currentAssets = await chart.createAccount({
        name: 'Current Assets',
        type: AccountTypes.ASSET,
        number: '1100',
        parentId: assets.id,
      })
      await chart.createAccount({
        name: 'Cash',
        type: AccountTypes.ASSET,
        number: '1110',
        parentId: currentAssets.id,
      })
      await chart.createAccount({
        name: 'Fixed Assets',
        type: AccountTypes.ASSET,
        number: '1200',
        parentId: assets.id,
      })

      const tree = await chart.getAccountTree()

      expect(tree).toHaveLength(1) // 1 root (Assets)
      expect(tree[0].children).toHaveLength(2) // Current Assets, Fixed Assets
      expect(tree[0].children?.[0].children).toHaveLength(1) // Cash under Current Assets
    })

    it('should get account ancestors (breadcrumb)', async () => {
      const root = await chart.createAccount({
        name: 'Assets',
        type: AccountTypes.ASSET,
        number: '1000',
      })
      const mid = await chart.createAccount({
        name: 'Current Assets',
        type: AccountTypes.ASSET,
        number: '1100',
        parentId: root.id,
      })
      const leaf = await chart.createAccount({
        name: 'Cash',
        type: AccountTypes.ASSET,
        number: '1110',
        parentId: mid.id,
      })

      const ancestors = await chart.getAccountAncestors(leaf.id)

      expect(ancestors).toHaveLength(2)
      expect(ancestors[0].name).toBe('Assets')
      expect(ancestors[1].name).toBe('Current Assets')
    })

    it('should calculate depth level', async () => {
      const root = await chart.createAccount({
        name: 'Assets',
        type: AccountTypes.ASSET,
        number: '1000',
      })
      const child = await chart.createAccount({
        name: 'Current Assets',
        type: AccountTypes.ASSET,
        number: '1100',
        parentId: root.id,
      })
      const grandchild = await chart.createAccount({
        name: 'Cash',
        type: AccountTypes.ASSET,
        number: '1110',
        parentId: child.id,
      })

      expect(root.depth).toBe(0)
      expect(child.depth).toBe(1)
      expect(grandchild.depth).toBe(2)
    })

    it('should prevent circular references', async () => {
      const account1 = await chart.createAccount({
        name: 'Account 1',
        type: AccountTypes.ASSET,
        number: '1000',
      })
      const account2 = await chart.createAccount({
        name: 'Account 2',
        type: AccountTypes.ASSET,
        number: '1100',
        parentId: account1.id,
      })

      // Try to make account1 a child of account2 (would create circular reference)
      await expect(
        chart.updateAccount(account1.id, { parentId: account2.id })
      ).rejects.toThrow('Circular reference detected')
    })

    it('should move account to different parent', async () => {
      const parent1 = await chart.createAccount({
        name: 'Parent 1',
        type: AccountTypes.ASSET,
        number: '1000',
      })
      const parent2 = await chart.createAccount({
        name: 'Parent 2',
        type: AccountTypes.ASSET,
        number: '1100',
      })
      const child = await chart.createAccount({
        name: 'Child',
        type: AccountTypes.ASSET,
        number: '1010',
        parentId: parent1.id,
      })

      const moved = await chart.updateAccount(child.id, { parentId: parent2.id })

      expect(moved.parentId).toBe(parent2.id)
    })
  })

  // =============================================================================
  // Account Numbering System Tests
  // =============================================================================

  describe('account numbering', () => {
    let chart: ChartOfAccounts

    beforeEach(() => {
      chart = createTestChart()
    })

    it('should enforce unique account numbers', async () => {
      await chart.createAccount({
        name: 'Cash',
        type: AccountTypes.ASSET,
        number: '1000',
      })

      await expect(
        chart.createAccount({
          name: 'Other Cash',
          type: AccountTypes.ASSET,
          number: '1000',
        })
      ).rejects.toThrow('Account number already exists')
    })

    it('should find account by number', async () => {
      await chart.createAccount({
        name: 'Accounts Receivable',
        type: AccountTypes.ASSET,
        number: '1200',
      })

      const account = await chart.getAccountByNumber('1200')

      expect(account).not.toBeNull()
      expect(account?.name).toBe('Accounts Receivable')
    })

    it('should validate account number format', async () => {
      await expect(
        chart.createAccount({
          name: 'Invalid',
          type: AccountTypes.ASSET,
          number: 'ABC', // Should be numeric
        })
      ).rejects.toThrow('Invalid account number format')
    })

    it('should support custom numbering schemes', async () => {
      const chartWithScheme = createChartOfAccounts({
        numberingScheme: {
          assets: { start: '100', end: '199' },
          liabilities: { start: '200', end: '299' },
          equity: { start: '300', end: '399' },
          revenue: { start: '400', end: '499' },
          expenses: { start: '500', end: '999' },
        },
      })

      const account = await chartWithScheme.createAccount({
        name: 'Cash',
        type: AccountTypes.ASSET,
        number: '100',
      })

      expect(account.number).toBe('100')
    })

    it('should auto-generate account numbers', async () => {
      const chartWithAutoNumber = createChartOfAccounts({
        autoNumber: true,
      })

      const account1 = await chartWithAutoNumber.createAccount({
        name: 'Cash',
        type: AccountTypes.ASSET,
      })
      const account2 = await chartWithAutoNumber.createAccount({
        name: 'Inventory',
        type: AccountTypes.ASSET,
      })

      expect(account1.number).toBeDefined()
      expect(account2.number).toBeDefined()
      expect(account1.number).not.toBe(account2.number)
    })

    it('should support sub-account numbering', async () => {
      const parent = await chart.createAccount({
        name: 'Current Assets',
        type: AccountTypes.ASSET,
        number: '1000',
      })

      const child = await chart.createAccount({
        name: 'Cash',
        type: AccountTypes.ASSET,
        number: '1000.10', // Sub-account notation
        parentId: parent.id,
      })

      expect(child.number).toBe('1000.10')
    })

    it('should get next available number in range', async () => {
      await chart.createAccount({
        name: 'Account 1',
        type: AccountTypes.ASSET,
        number: '1000',
      })
      await chart.createAccount({
        name: 'Account 2',
        type: AccountTypes.ASSET,
        number: '1001',
      })

      const nextNumber = await chart.getNextAvailableNumber(AccountTypes.ASSET)

      expect(nextNumber).toBe('1002')
    })

    it('should suggest account number based on parent', async () => {
      const parent = await chart.createAccount({
        name: 'Current Assets',
        type: AccountTypes.ASSET,
        number: '1000',
      })
      await chart.createAccount({
        name: 'Cash',
        type: AccountTypes.ASSET,
        number: '1001',
        parentId: parent.id,
      })

      const suggested = await chart.suggestChildNumber(parent.id)

      expect(suggested).toBe('1002')
    })
  })

  // =============================================================================
  // Account Status Tests
  // =============================================================================

  describe('account status', () => {
    let chart: ChartOfAccounts

    beforeEach(() => {
      chart = createTestChart()
    })

    it('should create account with active status by default', async () => {
      const account = await chart.createAccount({
        name: 'Cash',
        type: AccountTypes.ASSET,
        number: '1000',
      })

      expect(account.status).toBe('active')
    })

    it('should deactivate an account', async () => {
      const account = await chart.createAccount({
        name: 'Old Account',
        type: AccountTypes.ASSET,
        number: '1000',
      })

      const deactivated = await chart.deactivateAccount(account.id)

      expect(deactivated.status).toBe('inactive')
      expect(deactivated.deactivatedAt).toBeInstanceOf(Date)
    })

    it('should reactivate an inactive account', async () => {
      const account = await chart.createAccount({
        name: 'Old Account',
        type: AccountTypes.ASSET,
        number: '1000',
      })
      await chart.deactivateAccount(account.id)

      const reactivated = await chart.reactivateAccount(account.id)

      expect(reactivated.status).toBe('active')
      expect(reactivated.deactivatedAt).toBeUndefined()
    })

    it('should list only active accounts by default', async () => {
      await chart.createAccount({
        name: 'Active Account',
        type: AccountTypes.ASSET,
        number: '1000',
      })
      const inactive = await chart.createAccount({
        name: 'Inactive Account',
        type: AccountTypes.ASSET,
        number: '1001',
      })
      await chart.deactivateAccount(inactive.id)

      const accounts = await chart.listAccounts()

      expect(accounts).toHaveLength(1)
      expect(accounts[0].name).toBe('Active Account')
    })

    it('should list all accounts including inactive', async () => {
      await chart.createAccount({
        name: 'Active Account',
        type: AccountTypes.ASSET,
        number: '1000',
      })
      const inactive = await chart.createAccount({
        name: 'Inactive Account',
        type: AccountTypes.ASSET,
        number: '1001',
      })
      await chart.deactivateAccount(inactive.id)

      const accounts = await chart.listAccounts({ includeInactive: true })

      expect(accounts).toHaveLength(2)
    })

    it('should prevent deactivating account with balance', async () => {
      const account = await chart.createAccount({
        name: 'Cash',
        type: AccountTypes.ASSET,
        number: '1000',
      })

      // Simulate account having a balance
      await chart.setAccountBalance(account.id, 1000)

      await expect(chart.deactivateAccount(account.id)).rejects.toThrow(
        'Cannot deactivate account with non-zero balance'
      )
    })

    it('should prevent deactivating account with active children', async () => {
      const parent = await chart.createAccount({
        name: 'Current Assets',
        type: AccountTypes.ASSET,
        number: '1000',
      })
      await chart.createAccount({
        name: 'Cash',
        type: AccountTypes.ASSET,
        number: '1010',
        parentId: parent.id,
      })

      await expect(chart.deactivateAccount(parent.id)).rejects.toThrow(
        'Cannot deactivate account with active child accounts'
      )
    })

    it('should track status history', async () => {
      const account = await chart.createAccount({
        name: 'Test Account',
        type: AccountTypes.ASSET,
        number: '1000',
      })

      await chart.deactivateAccount(account.id, { reason: 'No longer needed' })
      await chart.reactivateAccount(account.id, { reason: 'Needed again' })

      const history = await chart.getAccountStatusHistory(account.id)

      expect(history).toHaveLength(2)
      expect(history[0].status).toBe('inactive')
      expect(history[0].reason).toBe('No longer needed')
      expect(history[1].status).toBe('active')
    })
  })

  // =============================================================================
  // Account Creation and Validation Tests
  // =============================================================================

  describe('account creation and validation', () => {
    let chart: ChartOfAccounts

    beforeEach(() => {
      chart = createTestChart()
    })

    it('should create a basic account', async () => {
      const account = await chart.createAccount({
        name: 'Cash',
        type: AccountTypes.ASSET,
        number: '1000',
      })

      expect(account.id).toBeDefined()
      expect(account.name).toBe('Cash')
      expect(account.type).toBe(AccountTypes.ASSET)
      expect(account.number).toBe('1000')
      expect(account.createdAt).toBeInstanceOf(Date)
    })

    it('should create account with description', async () => {
      const account = await chart.createAccount({
        name: 'Cash',
        type: AccountTypes.ASSET,
        number: '1000',
        description: 'Cash on hand and in bank accounts',
      })

      expect(account.description).toBe('Cash on hand and in bank accounts')
    })

    it('should require name', async () => {
      await expect(
        chart.createAccount({
          name: '',
          type: AccountTypes.ASSET,
          number: '1000',
        })
      ).rejects.toThrow('Account name is required')
    })

    it('should require type', async () => {
      await expect(
        chart.createAccount({
          name: 'Cash',
          type: '' as AccountType,
          number: '1000',
        })
      ).rejects.toThrow('Account type is required')
    })

    it('should validate type is valid', async () => {
      await expect(
        chart.createAccount({
          name: 'Cash',
          type: 'invalid' as AccountType,
          number: '1000',
        })
      ).rejects.toThrow('Invalid account type')
    })

    it('should get account by id', async () => {
      const created = await chart.createAccount({
        name: 'Cash',
        type: AccountTypes.ASSET,
        number: '1000',
      })

      const retrieved = await chart.getAccount(created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.id).toBe(created.id)
    })

    it('should return null for non-existent account', async () => {
      const result = await chart.getAccount('nonexistent-id')
      expect(result).toBeNull()
    })

    it('should update account', async () => {
      const account = await chart.createAccount({
        name: 'Original Name',
        type: AccountTypes.ASSET,
        number: '1000',
      })

      const updated = await chart.updateAccount(account.id, {
        name: 'Updated Name',
        description: 'New description',
      })

      expect(updated.name).toBe('Updated Name')
      expect(updated.description).toBe('New description')
      expect(updated.updatedAt).toBeInstanceOf(Date)
    })

    it('should not allow changing account type', async () => {
      const account = await chart.createAccount({
        name: 'Cash',
        type: AccountTypes.ASSET,
        number: '1000',
      })

      await expect(
        chart.updateAccount(account.id, { type: AccountTypes.LIABILITY })
      ).rejects.toThrow('Cannot change account type')
    })

    it('should delete account', async () => {
      const account = await chart.createAccount({
        name: 'To Delete',
        type: AccountTypes.ASSET,
        number: '1000',
      })

      await chart.deleteAccount(account.id)

      const result = await chart.getAccount(account.id)
      expect(result).toBeNull()
    })

    it('should prevent deleting account with transactions', async () => {
      const account = await chart.createAccount({
        name: 'Has Transactions',
        type: AccountTypes.ASSET,
        number: '1000',
      })

      // Simulate account having transactions
      await chart.recordTransaction(account.id, { amount: 100, type: 'debit' })

      await expect(chart.deleteAccount(account.id)).rejects.toThrow(
        'Cannot delete account with transaction history'
      )
    })

    it('should support account code/short code', async () => {
      const account = await chart.createAccount({
        name: 'Cash',
        type: AccountTypes.ASSET,
        number: '1000',
        code: 'CASH',
      })

      expect(account.code).toBe('CASH')

      const found = await chart.getAccountByCode('CASH')
      expect(found?.name).toBe('Cash')
    })

    it('should support currency assignment', async () => {
      const account = await chart.createAccount({
        name: 'Cash USD',
        type: AccountTypes.ASSET,
        number: '1000',
        currency: 'USD',
      })

      expect(account.currency).toBe('USD')
    })

    it('should support tax code assignment', async () => {
      const account = await chart.createAccount({
        name: 'Sales Revenue',
        type: AccountTypes.REVENUE,
        number: '4000',
        taxCode: 'TAXABLE',
      })

      expect(account.taxCode).toBe('TAXABLE')
    })

    it('should support account tags/labels', async () => {
      const account = await chart.createAccount({
        name: 'Cash',
        type: AccountTypes.ASSET,
        number: '1000',
        tags: ['bank', 'operating', 'primary'],
      })

      expect(account.tags).toContain('bank')
      expect(account.tags).toContain('operating')
    })
  })

  // =============================================================================
  // Standard Chart Templates Tests
  // =============================================================================

  describe('standard chart templates', () => {
    it('should create US GAAP standard chart', async () => {
      const chart = createChartOfAccounts()
      await chart.loadTemplate('US_GAAP')

      const accounts = await chart.listAccounts({ includeInactive: true })

      // Should have standard accounts
      expect(accounts.length).toBeGreaterThan(0)

      // Check for standard GAAP accounts
      const cash = await chart.getAccountByNumber('1000')
      expect(cash).not.toBeNull()
      expect(cash?.name).toBe('Cash')

      const accountsReceivable = await chart.getAccountByNumber('1100')
      expect(accountsReceivable).not.toBeNull()

      const accountsPayable = await chart.getAccountByNumber('2000')
      expect(accountsPayable).not.toBeNull()

      const commonStock = await chart.getAccountByNumber('3000')
      expect(commonStock).not.toBeNull()

      const salesRevenue = await chart.getAccountByNumber('4000')
      expect(salesRevenue).not.toBeNull()

      const rentExpense = await chart.getAccountByNumber('5100')
      expect(rentExpense).not.toBeNull()
    })

    it('should create IFRS standard chart', async () => {
      const chart = createChartOfAccounts()
      await chart.loadTemplate('IFRS')

      const accounts = await chart.listAccounts({ includeInactive: true })

      expect(accounts.length).toBeGreaterThan(0)

      // IFRS uses different structure/naming
      const nonCurrentAssets = await chart.getAccountByNumber('100')
      expect(nonCurrentAssets).not.toBeNull()

      const currentAssets = await chart.getAccountByNumber('200')
      expect(currentAssets).not.toBeNull()
    })

    it('should list available templates', async () => {
      const chart = createChartOfAccounts()
      const templates = await chart.getAvailableTemplates()

      expect(templates).toContain('US_GAAP')
      expect(templates).toContain('IFRS')
    })

    it('should get template details', async () => {
      const chart = createChartOfAccounts()
      const template = await chart.getTemplateDetails('US_GAAP')

      expect(template.name).toBe('US GAAP')
      expect(template.description).toBeDefined()
      expect(template.accountCount).toBeGreaterThan(0)
    })

    it('should load template into existing chart', async () => {
      const chart = createChartOfAccounts()

      // Create a custom account first
      await chart.createAccount({
        name: 'Custom Account',
        type: AccountTypes.ASSET,
        number: '9999',
      })

      await chart.loadTemplate('US_GAAP', { merge: true })

      // Both custom and template accounts should exist
      const custom = await chart.getAccountByNumber('9999')
      const standard = await chart.getAccountByNumber('1000')

      expect(custom).not.toBeNull()
      expect(standard).not.toBeNull()
    })

    it('should handle template number conflicts', async () => {
      const chart = createChartOfAccounts()

      // Create account with number that conflicts with template
      await chart.createAccount({
        name: 'My Cash',
        type: AccountTypes.ASSET,
        number: '1000',
      })

      // Loading template should either skip or rename conflicting accounts
      await chart.loadTemplate('US_GAAP', { merge: true, skipConflicts: true })

      const account = await chart.getAccountByNumber('1000')
      expect(account?.name).toBe('My Cash') // Original preserved
    })

    it('should support small business template', async () => {
      const chart = createChartOfAccounts()
      await chart.loadTemplate('SMALL_BUSINESS')

      const accounts = await chart.listAccounts()

      // Should have simplified account structure
      expect(accounts.length).toBeGreaterThan(0)
      expect(accounts.length).toBeLessThan(50) // Simplified
    })

    it('should support nonprofit template', async () => {
      const chart = createChartOfAccounts()
      await chart.loadTemplate('NONPROFIT')

      const accounts = await chart.listAccounts()

      // Should have nonprofit-specific accounts
      const contributions = accounts.find((a) => a.name.includes('Contributions'))
      expect(contributions).toBeDefined()

      const grants = accounts.find((a) => a.name.includes('Grant'))
      expect(grants).toBeDefined()
    })

    it('should export chart to template format', async () => {
      const chart = createChartOfAccounts()
      await chart.createAccount({
        name: 'Cash',
        type: AccountTypes.ASSET,
        number: '1000',
      })
      await chart.createAccount({
        name: 'Accounts Payable',
        type: AccountTypes.LIABILITY,
        number: '2000',
      })

      const exported = await chart.exportAsTemplate('MY_TEMPLATE')

      expect(exported.name).toBe('MY_TEMPLATE')
      expect(exported.accounts).toHaveLength(2)
      expect(exported.accounts[0].number).toBe('1000')
    })

    it('should import custom template', async () => {
      const customTemplate: AccountTemplate = {
        name: 'CUSTOM',
        description: 'Custom template',
        accounts: [
          { name: 'Cash', type: AccountTypes.ASSET, number: '100' },
          { name: 'Equity', type: AccountTypes.EQUITY, number: '300' },
        ],
      }

      const chart = createChartOfAccounts()
      await chart.importTemplate(customTemplate)

      const accounts = await chart.listAccounts()
      expect(accounts).toHaveLength(2)
    })
  })

  // =============================================================================
  // Query and Search Tests
  // =============================================================================

  describe('query and search', () => {
    let chart: ChartOfAccounts

    beforeEach(async () => {
      chart = createTestChart()

      // Create test accounts
      await chart.createAccount({
        name: 'Cash',
        type: AccountTypes.ASSET,
        number: '1000',
        tags: ['bank', 'operating'],
      })
      await chart.createAccount({
        name: 'Accounts Receivable',
        type: AccountTypes.ASSET,
        number: '1100',
        tags: ['operating'],
      })
      await chart.createAccount({
        name: 'Accounts Payable',
        type: AccountTypes.LIABILITY,
        number: '2000',
        tags: ['operating'],
      })
      await chart.createAccount({
        name: 'Sales Revenue',
        type: AccountTypes.REVENUE,
        number: '4000',
      })
    })

    it('should search accounts by name', async () => {
      const results = await chart.searchAccounts({ name: 'Accounts' })

      expect(results).toHaveLength(2)
    })

    it('should search accounts by number prefix', async () => {
      const results = await chart.searchAccounts({ numberPrefix: '1' })

      expect(results).toHaveLength(2)
    })

    it('should search accounts by tags', async () => {
      const results = await chart.searchAccounts({ tags: ['operating'] })

      expect(results).toHaveLength(3)
    })

    it('should combine search criteria', async () => {
      const results = await chart.searchAccounts({
        type: AccountTypes.ASSET,
        tags: ['bank'],
      })

      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('Cash')
    })

    it('should sort search results', async () => {
      const byNumber = await chart.searchAccounts(
        {},
        { sortBy: 'number', sortOrder: 'asc' }
      )
      const byName = await chart.searchAccounts({}, { sortBy: 'name', sortOrder: 'asc' })

      expect(byNumber[0].number).toBe('1000')
      expect(byName[0].name).toBe('Accounts Payable')
    })

    it('should paginate search results', async () => {
      const page1 = await chart.searchAccounts({}, { limit: 2, offset: 0 })
      const page2 = await chart.searchAccounts({}, { limit: 2, offset: 2 })

      expect(page1).toHaveLength(2)
      expect(page2).toHaveLength(2)
    })
  })

  // =============================================================================
  // Financial Statement Classification Tests
  // =============================================================================

  describe('financial statement classification', () => {
    let chart: ChartOfAccounts

    beforeEach(() => {
      chart = createTestChart()
    })

    it('should classify accounts for balance sheet', async () => {
      await chart.createAccount({
        name: 'Cash',
        type: AccountTypes.ASSET,
        number: '1000',
        classification: 'current_asset',
      })
      await chart.createAccount({
        name: 'Equipment',
        type: AccountTypes.ASSET,
        number: '1500',
        classification: 'fixed_asset',
      })
      await chart.createAccount({
        name: 'Accounts Payable',
        type: AccountTypes.LIABILITY,
        number: '2000',
        classification: 'current_liability',
      })
      await chart.createAccount({
        name: 'Long-term Debt',
        type: AccountTypes.LIABILITY,
        number: '2500',
        classification: 'long_term_liability',
      })

      const balanceSheet = await chart.getBalanceSheetAccounts()

      expect(balanceSheet.currentAssets).toHaveLength(1)
      expect(balanceSheet.fixedAssets).toHaveLength(1)
      expect(balanceSheet.currentLiabilities).toHaveLength(1)
      expect(balanceSheet.longTermLiabilities).toHaveLength(1)
    })

    it('should classify accounts for income statement', async () => {
      await chart.createAccount({
        name: 'Sales Revenue',
        type: AccountTypes.REVENUE,
        number: '4000',
        classification: 'operating_revenue',
      })
      await chart.createAccount({
        name: 'Interest Income',
        type: AccountTypes.REVENUE,
        number: '4500',
        classification: 'other_income',
      })
      await chart.createAccount({
        name: 'Cost of Goods Sold',
        type: AccountTypes.EXPENSE,
        number: '5000',
        classification: 'cost_of_sales',
      })
      await chart.createAccount({
        name: 'Rent Expense',
        type: AccountTypes.EXPENSE,
        number: '5100',
        classification: 'operating_expense',
      })

      const incomeStatement = await chart.getIncomeStatementAccounts()

      expect(incomeStatement.operatingRevenue).toHaveLength(1)
      expect(incomeStatement.otherIncome).toHaveLength(1)
      expect(incomeStatement.costOfSales).toHaveLength(1)
      expect(incomeStatement.operatingExpenses).toHaveLength(1)
    })

    it('should classify cash flow accounts', async () => {
      await chart.createAccount({
        name: 'Cash',
        type: AccountTypes.ASSET,
        number: '1000',
        cashFlowCategory: 'operating',
      })
      await chart.createAccount({
        name: 'Equipment',
        type: AccountTypes.ASSET,
        number: '1500',
        cashFlowCategory: 'investing',
      })
      await chart.createAccount({
        name: 'Long-term Debt',
        type: AccountTypes.LIABILITY,
        number: '2500',
        cashFlowCategory: 'financing',
      })

      const cashFlowAccounts = await chart.getCashFlowAccounts()

      expect(cashFlowAccounts.operating).toHaveLength(1)
      expect(cashFlowAccounts.investing).toHaveLength(1)
      expect(cashFlowAccounts.financing).toHaveLength(1)
    })
  })
})

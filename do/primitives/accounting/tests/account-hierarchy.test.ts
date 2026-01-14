/**
 * Account Hierarchy Tests
 *
 * Tests for the GAAP-compliant account hierarchy implementation:
 * - Standard account types with correct normal balances
 * - Account numbering scheme validation (1xxx-5xxx)
 * - Sub-account support with parent-child relationships
 * - Account lookup by number, name, or type
 * - Contra account handling
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  Account,
  AccountHierarchy,
  createAccountHierarchy,
  createStandardGAAPHierarchy,
  isDebitNormalType,
  isCreditNormalType,
  getNormalBalance,
  isValidGAAPNumber,
  getTypeFromNumber,
  GAAP_NUMBER_RANGES,
  type AccountType,
  type NormalBalance,
} from '../account-hierarchy'

// =============================================================================
// Account Class Tests
// =============================================================================

describe('Account', () => {
  describe('account types and normal balances', () => {
    it('should create an asset account with debit normal balance', () => {
      const account = new Account({
        number: '1000',
        name: 'Cash',
        type: 'asset',
      })

      expect(account.type).toBe('asset')
      expect(account.normalBalance).toBe('debit')
      expect(account.isDebitNormal()).toBe(true)
      expect(account.isCreditNormal()).toBe(false)
    })

    it('should create a liability account with credit normal balance', () => {
      const account = new Account({
        number: '2000',
        name: 'Accounts Payable',
        type: 'liability',
      })

      expect(account.type).toBe('liability')
      expect(account.normalBalance).toBe('credit')
      expect(account.isDebitNormal()).toBe(false)
      expect(account.isCreditNormal()).toBe(true)
    })

    it('should create an equity account with credit normal balance', () => {
      const account = new Account({
        number: '3000',
        name: 'Common Stock',
        type: 'equity',
      })

      expect(account.type).toBe('equity')
      expect(account.normalBalance).toBe('credit')
      expect(account.isDebitNormal()).toBe(false)
      expect(account.isCreditNormal()).toBe(true)
    })

    it('should create a revenue account with credit normal balance', () => {
      const account = new Account({
        number: '4000',
        name: 'Sales Revenue',
        type: 'revenue',
      })

      expect(account.type).toBe('revenue')
      expect(account.normalBalance).toBe('credit')
      expect(account.isDebitNormal()).toBe(false)
      expect(account.isCreditNormal()).toBe(true)
    })

    it('should create an expense account with debit normal balance', () => {
      const account = new Account({
        number: '5000',
        name: 'Rent Expense',
        type: 'expense',
      })

      expect(account.type).toBe('expense')
      expect(account.normalBalance).toBe('debit')
      expect(account.isDebitNormal()).toBe(true)
      expect(account.isCreditNormal()).toBe(false)
    })
  })

  describe('contra accounts', () => {
    it('should create a contra asset account with credit normal balance', () => {
      const account = new Account({
        number: '1500',
        name: 'Accumulated Depreciation',
        type: 'asset',
        isContra: true,
      })

      expect(account.type).toBe('asset')
      expect(account.isContra).toBe(true)
      expect(account.normalBalance).toBe('credit') // Opposite of regular asset
      expect(account.isDebitNormal()).toBe(false)
      expect(account.isCreditNormal()).toBe(true)
    })

    it('should create a contra liability account with debit normal balance', () => {
      const account = new Account({
        number: '2500',
        name: 'Discount on Bonds Payable',
        type: 'liability',
        isContra: true,
      })

      expect(account.type).toBe('liability')
      expect(account.isContra).toBe(true)
      expect(account.normalBalance).toBe('debit') // Opposite of regular liability
    })

    it('should create a contra equity account with debit normal balance', () => {
      const account = new Account({
        number: '3200',
        name: 'Treasury Stock',
        type: 'equity',
        isContra: true,
      })

      expect(account.type).toBe('equity')
      expect(account.isContra).toBe(true)
      expect(account.normalBalance).toBe('debit') // Opposite of regular equity
    })

    it('should create a contra revenue account with debit normal balance', () => {
      const account = new Account({
        number: '4900',
        name: 'Sales Returns and Allowances',
        type: 'revenue',
        isContra: true,
      })

      expect(account.type).toBe('revenue')
      expect(account.isContra).toBe(true)
      expect(account.normalBalance).toBe('debit') // Opposite of regular revenue
    })

    it('should create a contra expense account with credit normal balance', () => {
      const account = new Account({
        number: '5900',
        name: 'Purchase Discounts',
        type: 'expense',
        isContra: true,
      })

      expect(account.type).toBe('expense')
      expect(account.isContra).toBe(true)
      expect(account.normalBalance).toBe('credit') // Opposite of regular expense
    })
  })

  describe('account properties', () => {
    it('should store account description', () => {
      const account = new Account({
        number: '1000',
        name: 'Cash',
        type: 'asset',
        description: 'Cash on hand and in bank accounts',
      })

      expect(account.description).toBe('Cash on hand and in bank accounts')
    })

    it('should store account tags', () => {
      const account = new Account({
        number: '1000',
        name: 'Cash',
        type: 'asset',
        tags: ['current', 'liquid'],
      })

      expect(account.tags).toContain('current')
      expect(account.tags).toContain('liquid')
    })

    it('should default to empty tags array', () => {
      const account = new Account({
        number: '1000',
        name: 'Cash',
        type: 'asset',
      })

      expect(account.tags).toEqual([])
    })

    it('should default isContra to false', () => {
      const account = new Account({
        number: '1000',
        name: 'Cash',
        type: 'asset',
      })

      expect(account.isContra).toBe(false)
    })

    it('should have active status by default', () => {
      const account = new Account({
        number: '1000',
        name: 'Cash',
        type: 'asset',
      })

      expect(account.status).toBe('active')
    })

    it('should have createdAt timestamp', () => {
      const before = new Date()
      const account = new Account({
        number: '1000',
        name: 'Cash',
        type: 'asset',
      })
      const after = new Date()

      expect(account.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(account.createdAt.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it('should return full path', () => {
      const account = new Account({
        number: '1000.10',
        name: 'Checking',
        type: 'asset',
        parentNumber: '1000',
      })

      expect(account.getFullPath()).toBe('1000.10')
    })
  })
})

// =============================================================================
// Account Hierarchy Tests
// =============================================================================

describe('AccountHierarchy', () => {
  let hierarchy: AccountHierarchy

  beforeEach(() => {
    hierarchy = createAccountHierarchy()
  })

  describe('account creation', () => {
    it('should create a root account', () => {
      const account = hierarchy.createAccount({
        number: '1000',
        name: 'Cash',
        type: 'asset',
      })

      expect(account.number).toBe('1000')
      expect(account.name).toBe('Cash')
      expect(account.depth).toBe(0)
    })

    it('should reject duplicate account numbers', () => {
      hierarchy.createAccount({
        number: '1000',
        name: 'Cash',
        type: 'asset',
      })

      expect(() =>
        hierarchy.createAccount({
          number: '1000',
          name: 'Another Cash',
          type: 'asset',
        })
      ).toThrow('Account number 1000 already exists')
    })

    it('should reject duplicate account names', () => {
      hierarchy.createAccount({
        number: '1000',
        name: 'Cash',
        type: 'asset',
      })

      expect(() =>
        hierarchy.createAccount({
          number: '1001',
          name: 'Cash',
          type: 'asset',
        })
      ).toThrow('Account name "Cash" already exists')
    })

    it('should reject duplicate names case-insensitively', () => {
      hierarchy.createAccount({
        number: '1000',
        name: 'Cash',
        type: 'asset',
      })

      expect(() =>
        hierarchy.createAccount({
          number: '1001',
          name: 'CASH',
          type: 'asset',
        })
      ).toThrow('Account name "CASH" already exists')
    })
  })

  describe('account numbering validation', () => {
    it('should accept valid asset account numbers (1xxx)', () => {
      const account = hierarchy.createAccount({
        number: '1000',
        name: 'Cash',
        type: 'asset',
      })
      expect(account.number).toBe('1000')

      const account2 = hierarchy.createAccount({
        number: '1999',
        name: 'Other Assets',
        type: 'asset',
      })
      expect(account2.number).toBe('1999')
    })

    it('should accept valid liability account numbers (2xxx)', () => {
      const account = hierarchy.createAccount({
        number: '2000',
        name: 'Accounts Payable',
        type: 'liability',
      })
      expect(account.number).toBe('2000')
    })

    it('should accept valid equity account numbers (3xxx)', () => {
      const account = hierarchy.createAccount({
        number: '3000',
        name: 'Common Stock',
        type: 'equity',
      })
      expect(account.number).toBe('3000')
    })

    it('should accept valid revenue account numbers (4xxx)', () => {
      const account = hierarchy.createAccount({
        number: '4000',
        name: 'Sales Revenue',
        type: 'revenue',
      })
      expect(account.number).toBe('4000')
    })

    it('should accept valid expense account numbers (5xxx)', () => {
      const account = hierarchy.createAccount({
        number: '5000',
        name: 'Rent Expense',
        type: 'expense',
      })
      expect(account.number).toBe('5000')
    })

    it('should reject asset account with wrong number range', () => {
      expect(() =>
        hierarchy.createAccount({
          number: '2000',
          name: 'Cash',
          type: 'asset',
        })
      ).toThrow('outside valid range for asset accounts (1000-1999)')
    })

    it('should reject liability account with wrong number range', () => {
      expect(() =>
        hierarchy.createAccount({
          number: '1000',
          name: 'Payable',
          type: 'liability',
        })
      ).toThrow('outside valid range for liability accounts (2000-2999)')
    })

    it('should reject non-numeric account numbers', () => {
      expect(() =>
        hierarchy.createAccount({
          number: 'ABC',
          name: 'Invalid',
          type: 'asset',
        })
      ).toThrow('Invalid account number format')
    })

    it('should accept sub-account numbers with decimal notation', () => {
      hierarchy.createAccount({
        number: '1100',
        name: 'Cash',
        type: 'asset',
      })

      const subAccount = hierarchy.createAccount({
        number: '1100.10',
        name: 'Checking',
        type: 'asset',
        parentNumber: '1100',
      })

      expect(subAccount.number).toBe('1100.10')
    })
  })

  describe('sub-account support', () => {
    it('should create sub-account with parent reference', () => {
      hierarchy.createAccount({
        number: '1100',
        name: 'Cash',
        type: 'asset',
      })

      const checking = hierarchy.createAccount({
        number: '1110',
        name: 'Checking',
        type: 'asset',
        parentNumber: '1100',
      })

      expect(checking.parentNumber).toBe('1100')
      expect(checking.depth).toBe(1)
    })

    it('should create multi-level hierarchy', () => {
      hierarchy.createAccount({
        number: '1100',
        name: 'Cash',
        type: 'asset',
      })

      hierarchy.createAccount({
        number: '1110',
        name: 'Checking',
        type: 'asset',
        parentNumber: '1100',
      })

      const operating = hierarchy.createAccount({
        number: '1111',
        name: 'Operating Account',
        type: 'asset',
        parentNumber: '1110',
      })

      expect(operating.depth).toBe(2)
    })

    it('should reject sub-account with non-existent parent', () => {
      expect(() =>
        hierarchy.createAccount({
          number: '1110',
          name: 'Checking',
          type: 'asset',
          parentNumber: '9999',
        })
      ).toThrow('Parent account 9999 not found')
    })

    it('should reject sub-account with mismatched type', () => {
      hierarchy.createAccount({
        number: '1100',
        name: 'Cash',
        type: 'asset',
      })

      expect(() =>
        hierarchy.createAccount({
          number: '1110',
          name: 'Payable Under Cash',
          type: 'liability',
          parentNumber: '1100',
        })
      ).toThrow('Child account type (liability) must match parent type (asset)')
    })

    it('should get children of a parent account', () => {
      hierarchy.createAccount({
        number: '1100',
        name: 'Cash',
        type: 'asset',
      })

      hierarchy.createAccount({
        number: '1110',
        name: 'Checking',
        type: 'asset',
        parentNumber: '1100',
      })

      hierarchy.createAccount({
        number: '1120',
        name: 'Savings',
        type: 'asset',
        parentNumber: '1100',
      })

      const children = hierarchy.getChildren('1100')

      expect(children).toHaveLength(2)
      expect(children.map((c) => c.name)).toContain('Checking')
      expect(children.map((c) => c.name)).toContain('Savings')
    })

    it('should get parent of an account', () => {
      hierarchy.createAccount({
        number: '1100',
        name: 'Cash',
        type: 'asset',
      })

      hierarchy.createAccount({
        number: '1110',
        name: 'Checking',
        type: 'asset',
        parentNumber: '1100',
      })

      const parent = hierarchy.getParent('1110')

      expect(parent).toBeDefined()
      expect(parent?.name).toBe('Cash')
    })

    it('should return undefined for root account parent', () => {
      hierarchy.createAccount({
        number: '1100',
        name: 'Cash',
        type: 'asset',
      })

      const parent = hierarchy.getParent('1100')

      expect(parent).toBeUndefined()
    })

    it('should get ancestors of an account', () => {
      hierarchy.createAccount({
        number: '1100',
        name: 'Cash',
        type: 'asset',
      })

      hierarchy.createAccount({
        number: '1110',
        name: 'Checking',
        type: 'asset',
        parentNumber: '1100',
      })

      hierarchy.createAccount({
        number: '1111',
        name: 'Operating',
        type: 'asset',
        parentNumber: '1110',
      })

      const ancestors = hierarchy.getAncestors('1111')

      expect(ancestors).toHaveLength(2)
      expect(ancestors[0].name).toBe('Cash')
      expect(ancestors[1].name).toBe('Checking')
    })

    it('should get descendants of an account', () => {
      hierarchy.createAccount({
        number: '1100',
        name: 'Cash',
        type: 'asset',
      })

      hierarchy.createAccount({
        number: '1110',
        name: 'Checking',
        type: 'asset',
        parentNumber: '1100',
      })

      hierarchy.createAccount({
        number: '1120',
        name: 'Savings',
        type: 'asset',
        parentNumber: '1100',
      })

      hierarchy.createAccount({
        number: '1111',
        name: 'Operating',
        type: 'asset',
        parentNumber: '1110',
      })

      const descendants = hierarchy.getDescendants('1100')

      expect(descendants).toHaveLength(3)
      expect(descendants.map((d) => d.name)).toContain('Checking')
      expect(descendants.map((d) => d.name)).toContain('Savings')
      expect(descendants.map((d) => d.name)).toContain('Operating')
    })
  })

  describe('account lookup', () => {
    beforeEach(() => {
      hierarchy.createAccount({ number: '1000', name: 'Cash', type: 'asset' })
      hierarchy.createAccount({ number: '1100', name: 'Accounts Receivable', type: 'asset' })
      hierarchy.createAccount({ number: '2000', name: 'Accounts Payable', type: 'liability' })
      hierarchy.createAccount({ number: '3000', name: 'Common Stock', type: 'equity' })
      hierarchy.createAccount({ number: '4000', name: 'Sales Revenue', type: 'revenue' })
      hierarchy.createAccount({ number: '5000', name: 'Rent Expense', type: 'expense' })
    })

    it('should get account by number', () => {
      const account = hierarchy.getByNumber('1000')

      expect(account).toBeDefined()
      expect(account?.name).toBe('Cash')
    })

    it('should return undefined for non-existent number', () => {
      const account = hierarchy.getByNumber('9999')

      expect(account).toBeUndefined()
    })

    it('should get account by name', () => {
      const account = hierarchy.getByName('Cash')

      expect(account).toBeDefined()
      expect(account?.number).toBe('1000')
    })

    it('should get account by name case-insensitively', () => {
      const account = hierarchy.getByName('CASH')

      expect(account).toBeDefined()
      expect(account?.number).toBe('1000')
    })

    it('should return undefined for non-existent name', () => {
      const account = hierarchy.getByName('Non-existent')

      expect(account).toBeUndefined()
    })

    it('should get accounts by type - assets', () => {
      const assets = hierarchy.getByType('asset')

      expect(assets).toHaveLength(2)
      expect(assets.every((a) => a.type === 'asset')).toBe(true)
    })

    it('should get accounts by type - liabilities', () => {
      const liabilities = hierarchy.getByType('liability')

      expect(liabilities).toHaveLength(1)
      expect(liabilities[0].name).toBe('Accounts Payable')
    })

    it('should get all accounts', () => {
      const allAccounts = hierarchy.getAllAccounts()

      expect(allAccounts).toHaveLength(6)
    })

    it('should get root accounts only', () => {
      hierarchy.createAccount({
        number: '1010',
        name: 'Petty Cash',
        type: 'asset',
        parentNumber: '1000',
      })

      const rootAccounts = hierarchy.getRootAccounts()

      expect(rootAccounts).toHaveLength(6) // Original 6, not including sub-account
      expect(rootAccounts.every((a) => !a.parentNumber)).toBe(true)
    })

    it('should report correct size', () => {
      expect(hierarchy.size).toBe(6)
    })
  })

  describe('account search', () => {
    beforeEach(() => {
      hierarchy.createAccount({
        number: '1000',
        name: 'Cash',
        type: 'asset',
        tags: ['current', 'liquid'],
      })
      hierarchy.createAccount({
        number: '1100',
        name: 'Cash in Bank',
        type: 'asset',
        tags: ['current'],
      })
      hierarchy.createAccount({
        number: '1200',
        name: 'Accounts Receivable',
        type: 'asset',
        tags: ['current'],
      })
      hierarchy.createAccount({
        number: '2000',
        name: 'Accounts Payable',
        type: 'liability',
      })
    })

    it('should search by partial name', () => {
      const results = hierarchy.searchByName('Cash')

      expect(results).toHaveLength(2)
      expect(results.map((r) => r.name)).toContain('Cash')
      expect(results.map((r) => r.name)).toContain('Cash in Bank')
    })

    it('should search by partial name case-insensitively', () => {
      const results = hierarchy.searchByName('ACCOUNTS')

      expect(results).toHaveLength(2)
    })

    it('should search by number prefix', () => {
      const results = hierarchy.searchByNumberPrefix('1')

      expect(results).toHaveLength(3) // All 1xxx accounts
    })

    it('should search by tags', () => {
      const results = hierarchy.searchByTags(['current'])

      expect(results).toHaveLength(3)
    })

    it('should search by multiple tags', () => {
      const results = hierarchy.searchByTags(['liquid'])

      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('Cash')
    })
  })

  describe('account numbering helpers', () => {
    it('should get next available number for type', () => {
      hierarchy.createAccount({ number: '1000', name: 'Cash', type: 'asset' })
      hierarchy.createAccount({ number: '1001', name: 'AR', type: 'asset' })

      const next = hierarchy.getNextAvailableNumber('asset')

      expect(next).toBe('1002')
    })

    it('should return start of range for empty type', () => {
      const next = hierarchy.getNextAvailableNumber('liability')

      expect(next).toBe('2000')
    })

    it('should suggest child number', () => {
      hierarchy.createAccount({ number: '1100', name: 'Cash', type: 'asset' })

      const suggested = hierarchy.suggestChildNumber('1100')

      expect(suggested).toBe('1100.10')
    })

    it('should suggest next child number', () => {
      hierarchy.createAccount({ number: '1100', name: 'Cash', type: 'asset' })
      hierarchy.createAccount({
        number: '1100.10',
        name: 'Checking',
        type: 'asset',
        parentNumber: '1100',
      })

      const suggested = hierarchy.suggestChildNumber('1100')

      expect(suggested).toBe('1100.20')
    })

    it('should throw for non-existent parent when suggesting child', () => {
      expect(() => hierarchy.suggestChildNumber('9999')).toThrow(
        'Parent account 9999 not found'
      )
    })

    it('should validate number for type', () => {
      expect(hierarchy.isValidNumberForType('1000', 'asset')).toBe(true)
      expect(hierarchy.isValidNumberForType('2000', 'asset')).toBe(false)
      expect(hierarchy.isValidNumberForType('2000', 'liability')).toBe(true)
    })
  })

  describe('tree building', () => {
    it('should build account tree', () => {
      hierarchy.createAccount({ number: '1000', name: 'Assets', type: 'asset' })
      hierarchy.createAccount({
        number: '1100',
        name: 'Current Assets',
        type: 'asset',
        parentNumber: '1000',
      })
      hierarchy.createAccount({
        number: '1110',
        name: 'Cash',
        type: 'asset',
        parentNumber: '1100',
      })
      hierarchy.createAccount({
        number: '1120',
        name: 'AR',
        type: 'asset',
        parentNumber: '1100',
      })

      const tree = hierarchy.buildTree()

      expect(tree).toHaveLength(1)
      expect(tree[0].account.name).toBe('Assets')
      expect(tree[0].children).toHaveLength(1)
      expect(tree[0].children[0].account.name).toBe('Current Assets')
      expect(tree[0].children[0].children).toHaveLength(2)
    })

    it('should handle multiple root accounts', () => {
      hierarchy.createAccount({ number: '1000', name: 'Cash', type: 'asset' })
      hierarchy.createAccount({ number: '2000', name: 'Payable', type: 'liability' })

      const tree = hierarchy.buildTree()

      expect(tree).toHaveLength(2)
    })
  })

  describe('account counts', () => {
    it('should get count by type', () => {
      hierarchy.createAccount({ number: '1000', name: 'Cash', type: 'asset' })
      hierarchy.createAccount({ number: '1100', name: 'AR', type: 'asset' })
      hierarchy.createAccount({ number: '2000', name: 'AP', type: 'liability' })
      hierarchy.createAccount({ number: '4000', name: 'Revenue', type: 'revenue' })

      const counts = hierarchy.getCountByType()

      expect(counts.asset).toBe(2)
      expect(counts.liability).toBe(1)
      expect(counts.equity).toBe(0)
      expect(counts.revenue).toBe(1)
      expect(counts.expense).toBe(0)
    })
  })
})

// =============================================================================
// Helper Function Tests
// =============================================================================

describe('Helper Functions', () => {
  describe('isDebitNormalType', () => {
    it('should return true for asset', () => {
      expect(isDebitNormalType('asset')).toBe(true)
    })

    it('should return true for expense', () => {
      expect(isDebitNormalType('expense')).toBe(true)
    })

    it('should return false for liability', () => {
      expect(isDebitNormalType('liability')).toBe(false)
    })

    it('should return false for equity', () => {
      expect(isDebitNormalType('equity')).toBe(false)
    })

    it('should return false for revenue', () => {
      expect(isDebitNormalType('revenue')).toBe(false)
    })
  })

  describe('isCreditNormalType', () => {
    it('should return true for liability', () => {
      expect(isCreditNormalType('liability')).toBe(true)
    })

    it('should return true for equity', () => {
      expect(isCreditNormalType('equity')).toBe(true)
    })

    it('should return true for revenue', () => {
      expect(isCreditNormalType('revenue')).toBe(true)
    })

    it('should return false for asset', () => {
      expect(isCreditNormalType('asset')).toBe(false)
    })

    it('should return false for expense', () => {
      expect(isCreditNormalType('expense')).toBe(false)
    })
  })

  describe('getNormalBalance', () => {
    it('should return debit for asset', () => {
      expect(getNormalBalance('asset')).toBe('debit')
    })

    it('should return credit for liability', () => {
      expect(getNormalBalance('liability')).toBe('credit')
    })

    it('should return credit for contra asset', () => {
      expect(getNormalBalance('asset', true)).toBe('credit')
    })

    it('should return debit for contra liability', () => {
      expect(getNormalBalance('liability', true)).toBe('debit')
    })
  })

  describe('isValidGAAPNumber', () => {
    it('should accept 4-digit numbers', () => {
      expect(isValidGAAPNumber('1000')).toBe(true)
      expect(isValidGAAPNumber('5999')).toBe(true)
    })

    it('should accept numbers with decimal sub-accounts', () => {
      expect(isValidGAAPNumber('1000.10')).toBe(true)
      expect(isValidGAAPNumber('1234.567')).toBe(true)
    })

    it('should reject non-4-digit base numbers', () => {
      expect(isValidGAAPNumber('100')).toBe(false)
      expect(isValidGAAPNumber('10000')).toBe(false)
    })

    it('should reject non-numeric', () => {
      expect(isValidGAAPNumber('ABC')).toBe(false)
      expect(isValidGAAPNumber('12AB')).toBe(false)
    })
  })

  describe('getTypeFromNumber', () => {
    it('should return asset for 1xxx', () => {
      expect(getTypeFromNumber('1000')).toBe('asset')
      expect(getTypeFromNumber('1999')).toBe('asset')
    })

    it('should return liability for 2xxx', () => {
      expect(getTypeFromNumber('2000')).toBe('liability')
      expect(getTypeFromNumber('2500')).toBe('liability')
    })

    it('should return equity for 3xxx', () => {
      expect(getTypeFromNumber('3000')).toBe('equity')
    })

    it('should return revenue for 4xxx', () => {
      expect(getTypeFromNumber('4000')).toBe('revenue')
    })

    it('should return expense for 5xxx', () => {
      expect(getTypeFromNumber('5000')).toBe('expense')
    })

    it('should return undefined for out-of-range', () => {
      expect(getTypeFromNumber('6000')).toBeUndefined()
      expect(getTypeFromNumber('0500')).toBeUndefined()
    })

    it('should handle sub-account numbers', () => {
      expect(getTypeFromNumber('1000.10')).toBe('asset')
    })
  })
})

// =============================================================================
// GAAP Number Ranges Tests
// =============================================================================

describe('GAAP_NUMBER_RANGES', () => {
  it('should define correct asset range', () => {
    expect(GAAP_NUMBER_RANGES.asset.start).toBe(1000)
    expect(GAAP_NUMBER_RANGES.asset.end).toBe(1999)
  })

  it('should define correct liability range', () => {
    expect(GAAP_NUMBER_RANGES.liability.start).toBe(2000)
    expect(GAAP_NUMBER_RANGES.liability.end).toBe(2999)
  })

  it('should define correct equity range', () => {
    expect(GAAP_NUMBER_RANGES.equity.start).toBe(3000)
    expect(GAAP_NUMBER_RANGES.equity.end).toBe(3999)
  })

  it('should define correct revenue range', () => {
    expect(GAAP_NUMBER_RANGES.revenue.start).toBe(4000)
    expect(GAAP_NUMBER_RANGES.revenue.end).toBe(4999)
  })

  it('should define correct expense range', () => {
    expect(GAAP_NUMBER_RANGES.expense.start).toBe(5000)
    expect(GAAP_NUMBER_RANGES.expense.end).toBe(5999)
  })
})

// =============================================================================
// Factory Function Tests
// =============================================================================

describe('Factory Functions', () => {
  describe('createAccountHierarchy', () => {
    it('should create empty hierarchy', () => {
      const hierarchy = createAccountHierarchy()

      expect(hierarchy.size).toBe(0)
      expect(hierarchy.getAllAccounts()).toEqual([])
    })
  })

  describe('createStandardGAAPHierarchy', () => {
    it('should create hierarchy with standard accounts', () => {
      const hierarchy = createStandardGAAPHierarchy()

      expect(hierarchy.size).toBeGreaterThan(0)
    })

    it('should include Cash account', () => {
      const hierarchy = createStandardGAAPHierarchy()
      const cash = hierarchy.getByNumber('1000')

      expect(cash).toBeDefined()
      expect(cash?.name).toBe('Cash')
      expect(cash?.type).toBe('asset')
    })

    it('should include Accounts Payable', () => {
      const hierarchy = createStandardGAAPHierarchy()
      const ap = hierarchy.getByNumber('2000')

      expect(ap).toBeDefined()
      expect(ap?.name).toBe('Accounts Payable')
      expect(ap?.type).toBe('liability')
    })

    it('should include Common Stock', () => {
      const hierarchy = createStandardGAAPHierarchy()
      const stock = hierarchy.getByNumber('3000')

      expect(stock).toBeDefined()
      expect(stock?.name).toBe('Common Stock')
      expect(stock?.type).toBe('equity')
    })

    it('should include Sales Revenue', () => {
      const hierarchy = createStandardGAAPHierarchy()
      const revenue = hierarchy.getByNumber('4000')

      expect(revenue).toBeDefined()
      expect(revenue?.name).toBe('Sales Revenue')
      expect(revenue?.type).toBe('revenue')
    })

    it('should include Rent Expense', () => {
      const hierarchy = createStandardGAAPHierarchy()
      const rent = hierarchy.getByNumber('5200')

      expect(rent).toBeDefined()
      expect(rent?.name).toBe('Rent Expense')
      expect(rent?.type).toBe('expense')
    })

    it('should include contra accounts with correct normal balance', () => {
      const hierarchy = createStandardGAAPHierarchy()
      const accumDepr = hierarchy.getByNumber('1510')

      expect(accumDepr).toBeDefined()
      expect(accumDepr?.name).toBe('Accumulated Depreciation - Equipment')
      expect(accumDepr?.isContra).toBe(true)
      expect(accumDepr?.normalBalance).toBe('credit') // Opposite of asset
    })

    it('should have proper parent-child relationships', () => {
      const hierarchy = createStandardGAAPHierarchy()
      const accumDepr = hierarchy.getByNumber('1510')

      expect(accumDepr?.parentNumber).toBe('1500')

      const parent = hierarchy.getParent('1510')
      expect(parent?.name).toBe('Equipment')
    })

    it('should have all five account types', () => {
      const hierarchy = createStandardGAAPHierarchy()
      const counts = hierarchy.getCountByType()

      expect(counts.asset).toBeGreaterThan(0)
      expect(counts.liability).toBeGreaterThan(0)
      expect(counts.equity).toBeGreaterThan(0)
      expect(counts.revenue).toBeGreaterThan(0)
      expect(counts.expense).toBeGreaterThan(0)
    })
  })
})

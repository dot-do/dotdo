/**
 * Account Hierarchy - Double-Entry Accounting Foundation
 *
 * Implements GAAP-compliant account hierarchy with:
 * - Standard account types (Assets, Liabilities, Equity, Revenue, Expenses)
 * - GAAP numbering scheme (1xxx-5xxx)
 * - Sub-account support with parent-child relationships
 * - Normal balance direction tracking
 * - Account lookup by number, name, or type
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Standard GAAP account types
 */
export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'

/**
 * Normal balance direction - determines how debits/credits affect the account
 */
export type NormalBalance = 'debit' | 'credit'

/**
 * Account status
 */
export type AccountStatus = 'active' | 'inactive'

/**
 * GAAP account numbering ranges
 */
export const GAAP_NUMBER_RANGES: Record<AccountType, { start: number; end: number }> = {
  asset: { start: 1000, end: 1999 },
  liability: { start: 2000, end: 2999 },
  equity: { start: 3000, end: 3999 },
  revenue: { start: 4000, end: 4999 },
  expense: { start: 5000, end: 5999 },
}

/**
 * Account configuration for creation
 */
export interface AccountConfig {
  number: string
  name: string
  type: AccountType
  description?: string
  parentNumber?: string
  isContra?: boolean
  tags?: string[]
}

/**
 * Account interface representing a ledger account
 */
export interface IAccount {
  readonly number: string
  readonly name: string
  readonly type: AccountType
  readonly normalBalance: NormalBalance
  readonly description?: string
  readonly parentNumber?: string
  readonly isContra: boolean
  readonly depth: number
  readonly tags: string[]
  readonly status: AccountStatus
  readonly createdAt: Date

  isDebitNormal(): boolean
  isCreditNormal(): boolean
  getFullPath(): string
}

// =============================================================================
// Account Class
// =============================================================================

/**
 * Account represents a single account in the chart of accounts.
 * Implements GAAP accounting principles with proper normal balance tracking.
 */
export class Account implements IAccount {
  readonly number: string
  readonly name: string
  readonly type: AccountType
  readonly normalBalance: NormalBalance
  readonly description?: string
  readonly parentNumber?: string
  readonly isContra: boolean
  readonly depth: number
  readonly tags: string[]
  readonly status: AccountStatus
  readonly createdAt: Date

  constructor(config: AccountConfig, depth: number = 0) {
    this.number = config.number
    this.name = config.name
    this.type = config.type
    this.description = config.description
    this.parentNumber = config.parentNumber
    this.isContra = config.isContra ?? false
    this.depth = depth
    this.tags = config.tags ?? []
    this.status = 'active'
    this.createdAt = new Date()

    // Determine normal balance based on account type and contra status
    this.normalBalance = this.determineNormalBalance()
  }

  /**
   * Determines the normal balance direction based on GAAP rules:
   * - Assets: Debit increases (debit normal)
   * - Liabilities: Credit increases (credit normal)
   * - Equity: Credit increases (credit normal)
   * - Revenue: Credit increases (credit normal)
   * - Expenses: Debit increases (debit normal)
   *
   * Contra accounts have the opposite normal balance.
   */
  private determineNormalBalance(): NormalBalance {
    const typeToNormal: Record<AccountType, NormalBalance> = {
      asset: 'debit',
      liability: 'credit',
      equity: 'credit',
      revenue: 'credit',
      expense: 'debit',
    }

    const baseNormal = typeToNormal[this.type]

    // Contra accounts have opposite normal balance
    if (this.isContra) {
      return baseNormal === 'debit' ? 'credit' : 'debit'
    }

    return baseNormal
  }

  /**
   * Returns true if the account has a debit normal balance
   */
  isDebitNormal(): boolean {
    return this.normalBalance === 'debit'
  }

  /**
   * Returns true if the account has a credit normal balance
   */
  isCreditNormal(): boolean {
    return this.normalBalance === 'credit'
  }

  /**
   * Returns the full hierarchical path of the account (e.g., "1000.1100.1110")
   */
  getFullPath(): string {
    return this.number
  }
}

// =============================================================================
// Account Hierarchy
// =============================================================================

/**
 * AccountHierarchy manages a collection of accounts with parent-child relationships.
 * Provides validation, lookup, and hierarchy operations.
 */
export class AccountHierarchy {
  private accounts: Map<string, Account> = new Map()
  private accountsByName: Map<string, Account> = new Map()
  private childrenMap: Map<string, Set<string>> = new Map()

  /**
   * Creates a new account and adds it to the hierarchy
   */
  createAccount(config: AccountConfig): Account {
    // Validate parent first if specified (before number validation)
    // This allows the type mismatch error to surface before number range errors
    let depth = 0
    if (config.parentNumber) {
      const parent = this.accounts.get(config.parentNumber)
      if (!parent) {
        throw new Error(`Parent account ${config.parentNumber} not found`)
      }
      if (parent.type !== config.type) {
        throw new Error(
          `Child account type (${config.type}) must match parent type (${parent.type})`
        )
      }
      depth = parent.depth + 1
    }

    // Validate account number format and range
    this.validateAccountNumber(config.number, config.type)

    // Check for duplicate number
    if (this.accounts.has(config.number)) {
      throw new Error(`Account number ${config.number} already exists`)
    }

    // Check for duplicate name (case-insensitive)
    const normalizedName = config.name.toLowerCase()
    if (this.accountsByName.has(normalizedName)) {
      throw new Error(`Account name "${config.name}" already exists`)
    }

    // Add to children map if has parent
    if (config.parentNumber) {
      if (!this.childrenMap.has(config.parentNumber)) {
        this.childrenMap.set(config.parentNumber, new Set())
      }
      this.childrenMap.get(config.parentNumber)!.add(config.number)
    }

    const account = new Account(config, depth)
    this.accounts.set(config.number, account)
    this.accountsByName.set(normalizedName, account)

    return account
  }

  /**
   * Validates that an account number follows GAAP numbering conventions
   */
  validateAccountNumber(number: string, type: AccountType): void {
    // Must be numeric (allowing decimal for sub-accounts)
    if (!/^\d+(\.\d+)?$/.test(number)) {
      throw new Error(`Invalid account number format: ${number}. Must be numeric.`)
    }

    const baseNumber = parseInt(number.split('.')[0], 10)
    const range = GAAP_NUMBER_RANGES[type]

    if (baseNumber < range.start || baseNumber > range.end) {
      throw new Error(
        `Account number ${number} is outside valid range for ${type} accounts (${range.start}-${range.end})`
      )
    }
  }

  /**
   * Gets an account by its number
   */
  getByNumber(number: string): Account | undefined {
    return this.accounts.get(number)
  }

  /**
   * Gets an account by its name (case-insensitive)
   */
  getByName(name: string): Account | undefined {
    return this.accountsByName.get(name.toLowerCase())
  }

  /**
   * Gets all accounts of a specific type
   */
  getByType(type: AccountType): Account[] {
    return Array.from(this.accounts.values()).filter((account) => account.type === type)
  }

  /**
   * Gets all child accounts of a parent
   */
  getChildren(parentNumber: string): Account[] {
    const childNumbers = this.childrenMap.get(parentNumber)
    if (!childNumbers) {
      return []
    }
    return Array.from(childNumbers)
      .map((num) => this.accounts.get(num)!)
      .filter(Boolean)
  }

  /**
   * Gets the parent account of a given account
   */
  getParent(accountNumber: string): Account | undefined {
    const account = this.accounts.get(accountNumber)
    if (!account || !account.parentNumber) {
      return undefined
    }
    return this.accounts.get(account.parentNumber)
  }

  /**
   * Gets all ancestors of an account (from root to immediate parent)
   */
  getAncestors(accountNumber: string): Account[] {
    const ancestors: Account[] = []
    let current = this.accounts.get(accountNumber)

    while (current && current.parentNumber) {
      const parent = this.accounts.get(current.parentNumber)
      if (parent) {
        ancestors.unshift(parent)
        current = parent
      } else {
        break
      }
    }

    return ancestors
  }

  /**
   * Gets all descendants of an account (recursive)
   */
  getDescendants(accountNumber: string): Account[] {
    const descendants: Account[] = []
    const children = this.getChildren(accountNumber)

    for (const child of children) {
      descendants.push(child)
      descendants.push(...this.getDescendants(child.number))
    }

    return descendants
  }

  /**
   * Gets all accounts in the hierarchy
   */
  getAllAccounts(): Account[] {
    return Array.from(this.accounts.values())
  }

  /**
   * Gets all root accounts (accounts without parents)
   */
  getRootAccounts(): Account[] {
    return Array.from(this.accounts.values()).filter((account) => !account.parentNumber)
  }

  /**
   * Checks if an account number is valid for a given type
   */
  isValidNumberForType(number: string, type: AccountType): boolean {
    try {
      this.validateAccountNumber(number, type)
      return true
    } catch {
      return false
    }
  }

  /**
   * Gets the next available account number for a type
   */
  getNextAvailableNumber(type: AccountType): string {
    const typeAccounts = this.getByType(type)
    const range = GAAP_NUMBER_RANGES[type]

    if (typeAccounts.length === 0) {
      return range.start.toString()
    }

    const usedNumbers = new Set(
      typeAccounts.map((a) => parseInt(a.number.split('.')[0], 10))
    )

    for (let num = range.start; num <= range.end; num++) {
      if (!usedNumbers.has(num)) {
        return num.toString()
      }
    }

    throw new Error(`No available account numbers for ${type} accounts`)
  }

  /**
   * Suggests the next child account number for a parent
   */
  suggestChildNumber(parentNumber: string): string {
    const parent = this.accounts.get(parentNumber)
    if (!parent) {
      throw new Error(`Parent account ${parentNumber} not found`)
    }

    const children = this.getChildren(parentNumber)
    const baseNum = parseInt(parentNumber.split('.')[0], 10)

    if (children.length === 0) {
      // First child: append .10
      return `${baseNum}.10`
    }

    // Find highest child sub-number and increment by 10
    let maxSubNum = 0
    for (const child of children) {
      const parts = child.number.split('.')
      if (parts.length > 1) {
        const subNum = parseInt(parts[1], 10)
        if (subNum > maxSubNum) {
          maxSubNum = subNum
        }
      }
    }

    return `${baseNum}.${maxSubNum + 10}`
  }

  /**
   * Builds a tree structure of all accounts
   */
  buildTree(): AccountTreeNode[] {
    const rootAccounts = this.getRootAccounts()
    return rootAccounts.map((account) => this.buildTreeNode(account))
  }

  private buildTreeNode(account: Account): AccountTreeNode {
    const children = this.getChildren(account.number)
    return {
      account,
      children: children.map((child) => this.buildTreeNode(child)),
    }
  }

  /**
   * Searches accounts by partial name match
   */
  searchByName(query: string): Account[] {
    const lowerQuery = query.toLowerCase()
    return Array.from(this.accounts.values()).filter((account) =>
      account.name.toLowerCase().includes(lowerQuery)
    )
  }

  /**
   * Searches accounts by number prefix
   */
  searchByNumberPrefix(prefix: string): Account[] {
    return Array.from(this.accounts.values()).filter((account) =>
      account.number.startsWith(prefix)
    )
  }

  /**
   * Searches accounts by tags
   */
  searchByTags(tags: string[]): Account[] {
    const tagSet = new Set(tags.map((t) => t.toLowerCase()))
    return Array.from(this.accounts.values()).filter((account) =>
      account.tags.some((tag) => tagSet.has(tag.toLowerCase()))
    )
  }

  /**
   * Gets account count by type
   */
  getCountByType(): Record<AccountType, number> {
    const counts: Record<AccountType, number> = {
      asset: 0,
      liability: 0,
      equity: 0,
      revenue: 0,
      expense: 0,
    }

    for (const account of this.accounts.values()) {
      counts[account.type]++
    }

    return counts
  }

  /**
   * Returns total number of accounts
   */
  get size(): number {
    return this.accounts.size
  }
}

// =============================================================================
// Tree Node Interface
// =============================================================================

export interface AccountTreeNode {
  account: Account
  children: AccountTreeNode[]
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Returns true if the account type has a debit normal balance
 */
export function isDebitNormalType(type: AccountType): boolean {
  return type === 'asset' || type === 'expense'
}

/**
 * Returns true if the account type has a credit normal balance
 */
export function isCreditNormalType(type: AccountType): boolean {
  return type === 'liability' || type === 'equity' || type === 'revenue'
}

/**
 * Gets the normal balance for an account type
 */
export function getNormalBalance(type: AccountType, isContra: boolean = false): NormalBalance {
  const baseNormal = isDebitNormalType(type) ? 'debit' : 'credit'
  return isContra ? (baseNormal === 'debit' ? 'credit' : 'debit') : baseNormal
}

/**
 * Validates that an account number follows GAAP format
 */
export function isValidGAAPNumber(number: string): boolean {
  return /^\d{4}(\.\d+)?$/.test(number)
}

/**
 * Gets the account type from a GAAP account number
 */
export function getTypeFromNumber(number: string): AccountType | undefined {
  const baseNumber = parseInt(number.split('.')[0], 10)

  for (const [type, range] of Object.entries(GAAP_NUMBER_RANGES)) {
    if (baseNumber >= range.start && baseNumber <= range.end) {
      return type as AccountType
    }
  }

  return undefined
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates a new AccountHierarchy instance
 */
export function createAccountHierarchy(): AccountHierarchy {
  return new AccountHierarchy()
}

/**
 * Creates a standard GAAP chart of accounts with common accounts
 */
export function createStandardGAAPHierarchy(): AccountHierarchy {
  const hierarchy = new AccountHierarchy()

  // Assets (1xxx)
  hierarchy.createAccount({ number: '1000', name: 'Cash', type: 'asset', description: 'Cash on hand and in bank' })
  hierarchy.createAccount({ number: '1100', name: 'Accounts Receivable', type: 'asset', description: 'Amounts owed by customers' })
  hierarchy.createAccount({ number: '1200', name: 'Inventory', type: 'asset', description: 'Goods available for sale' })
  hierarchy.createAccount({ number: '1300', name: 'Prepaid Expenses', type: 'asset', description: 'Expenses paid in advance' })
  hierarchy.createAccount({ number: '1500', name: 'Equipment', type: 'asset', description: 'Equipment and machinery' })
  hierarchy.createAccount({ number: '1510', name: 'Accumulated Depreciation - Equipment', type: 'asset', isContra: true, parentNumber: '1500', description: 'Accumulated depreciation on equipment' })

  // Liabilities (2xxx)
  hierarchy.createAccount({ number: '2000', name: 'Accounts Payable', type: 'liability', description: 'Amounts owed to suppliers' })
  hierarchy.createAccount({ number: '2100', name: 'Accrued Expenses', type: 'liability', description: 'Expenses incurred but not yet paid' })
  hierarchy.createAccount({ number: '2200', name: 'Notes Payable', type: 'liability', description: 'Loans and notes payable' })
  hierarchy.createAccount({ number: '2300', name: 'Unearned Revenue', type: 'liability', description: 'Revenue received but not yet earned' })

  // Equity (3xxx)
  hierarchy.createAccount({ number: '3000', name: 'Common Stock', type: 'equity', description: 'Owner investment' })
  hierarchy.createAccount({ number: '3100', name: 'Retained Earnings', type: 'equity', description: 'Accumulated profits' })
  hierarchy.createAccount({ number: '3200', name: 'Dividends', type: 'equity', isContra: true, description: 'Distributions to owners' })

  // Revenue (4xxx)
  hierarchy.createAccount({ number: '4000', name: 'Sales Revenue', type: 'revenue', description: 'Revenue from sales' })
  hierarchy.createAccount({ number: '4100', name: 'Service Revenue', type: 'revenue', description: 'Revenue from services' })
  hierarchy.createAccount({ number: '4200', name: 'Interest Income', type: 'revenue', description: 'Interest earned' })
  hierarchy.createAccount({ number: '4900', name: 'Sales Returns and Allowances', type: 'revenue', isContra: true, description: 'Returns and allowances on sales' })

  // Expenses (5xxx)
  hierarchy.createAccount({ number: '5000', name: 'Cost of Goods Sold', type: 'expense', description: 'Cost of products sold' })
  hierarchy.createAccount({ number: '5100', name: 'Salaries Expense', type: 'expense', description: 'Employee wages and salaries' })
  hierarchy.createAccount({ number: '5200', name: 'Rent Expense', type: 'expense', description: 'Rent for facilities' })
  hierarchy.createAccount({ number: '5300', name: 'Utilities Expense', type: 'expense', description: 'Electricity, water, gas' })
  hierarchy.createAccount({ number: '5400', name: 'Depreciation Expense', type: 'expense', description: 'Depreciation of assets' })
  hierarchy.createAccount({ number: '5500', name: 'Interest Expense', type: 'expense', description: 'Interest on loans' })

  return hierarchy
}

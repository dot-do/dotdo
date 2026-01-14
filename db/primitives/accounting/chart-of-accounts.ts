/**
 * Chart of Accounts - Stub Implementation
 *
 * This file contains only type definitions and stub exports.
 * The actual implementation does not exist yet - this is the RED phase of TDD.
 *
 * All functions will throw "Not implemented" errors.
 */

// =============================================================================
// Types
// =============================================================================

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'

export type AccountStatus = 'active' | 'inactive'

export type NormalBalance = 'debit' | 'credit'

export type FinancialStatementClassification =
  | 'current_asset'
  | 'fixed_asset'
  | 'intangible_asset'
  | 'other_asset'
  | 'current_liability'
  | 'long_term_liability'
  | 'operating_revenue'
  | 'other_income'
  | 'cost_of_sales'
  | 'operating_expense'
  | 'other_expense'
  | 'equity'

export type CashFlowCategory = 'operating' | 'investing' | 'financing'

export interface Account {
  id: string
  name: string
  type: AccountType
  number: string
  description?: string
  parentId?: string
  status: AccountStatus
  normalBalance: NormalBalance
  isContra?: boolean
  depth?: number
  code?: string
  currency?: string
  taxCode?: string
  tags?: string[]
  classification?: FinancialStatementClassification
  cashFlowCategory?: CashFlowCategory
  createdAt: Date
  updatedAt?: Date
  deactivatedAt?: Date
}

export interface AccountWithChildren extends Account {
  children?: AccountWithChildren[]
}

export interface CreateAccountInput {
  name: string
  type: AccountType
  number?: string
  description?: string
  parentId?: string
  isContra?: boolean
  code?: string
  currency?: string
  taxCode?: string
  tags?: string[]
  classification?: FinancialStatementClassification
  cashFlowCategory?: CashFlowCategory
}

export interface UpdateAccountInput {
  name?: string
  description?: string
  parentId?: string
  code?: string
  currency?: string
  taxCode?: string
  tags?: string[]
  type?: AccountType
  classification?: FinancialStatementClassification
  cashFlowCategory?: CashFlowCategory
}

export interface AccountQuery {
  type?: AccountType
  name?: string
  numberPrefix?: string
  tags?: string[]
  status?: AccountStatus
}

export interface QueryOptions {
  limit?: number
  offset?: number
  sortBy?: 'number' | 'name' | 'createdAt'
  sortOrder?: 'asc' | 'desc'
}

export interface ListAccountsOptions {
  includeInactive?: boolean
}

export interface AccountStatusHistoryEntry {
  status: AccountStatus
  reason?: string
  changedAt: Date
}

export interface NumberingScheme {
  assets: { start: string; end: string }
  liabilities: { start: string; end: string }
  equity: { start: string; end: string }
  revenue: { start: string; end: string }
  expenses: { start: string; end: string }
}

export interface ChartOfAccountsOptions {
  numberingScheme?: NumberingScheme
  autoNumber?: boolean
}

export interface AccountTemplateAccount {
  name: string
  type: AccountType
  number: string
  description?: string
  parentNumber?: string
  isContra?: boolean
  classification?: FinancialStatementClassification
  cashFlowCategory?: CashFlowCategory
}

export interface AccountTemplate {
  name: string
  description?: string
  accounts: AccountTemplateAccount[]
}

export interface TemplateDetails {
  name: string
  description: string
  accountCount: number
}

export interface LoadTemplateOptions {
  merge?: boolean
  skipConflicts?: boolean
}

export interface BalanceSheetAccounts {
  currentAssets: Account[]
  fixedAssets: Account[]
  intangibleAssets: Account[]
  otherAssets: Account[]
  currentLiabilities: Account[]
  longTermLiabilities: Account[]
  equity: Account[]
}

export interface IncomeStatementAccounts {
  operatingRevenue: Account[]
  otherIncome: Account[]
  costOfSales: Account[]
  operatingExpenses: Account[]
  otherExpenses: Account[]
}

export interface CashFlowAccounts {
  operating: Account[]
  investing: Account[]
  financing: Account[]
}

export interface TransactionInput {
  amount: number
  type: 'debit' | 'credit'
}

export interface StatusChangeOptions {
  reason?: string
}

export interface ChartOfAccounts {
  // Account CRUD
  createAccount(input: CreateAccountInput): Promise<Account>
  getAccount(id: string): Promise<Account | null>
  getAccountByNumber(number: string): Promise<Account | null>
  getAccountByCode(code: string): Promise<Account | null>
  updateAccount(id: string, input: UpdateAccountInput): Promise<Account>
  deleteAccount(id: string): Promise<void>
  listAccounts(options?: ListAccountsOptions): Promise<Account[]>

  // Account types
  getAccountsByType(type: AccountType): Promise<Account[]>

  // Hierarchy
  getChildAccounts(parentId: string): Promise<Account[]>
  getAccountTree(): Promise<AccountWithChildren[]>
  getAccountAncestors(id: string): Promise<Account[]>

  // Numbering
  getNextAvailableNumber(type: AccountType): Promise<string>
  suggestChildNumber(parentId: string): Promise<string>

  // Status
  deactivateAccount(id: string, options?: StatusChangeOptions): Promise<Account>
  reactivateAccount(id: string, options?: StatusChangeOptions): Promise<Account>
  getAccountStatusHistory(id: string): Promise<AccountStatusHistoryEntry[]>
  setAccountBalance(id: string, balance: number): Promise<void>

  // Transactions (stub for validation)
  recordTransaction(accountId: string, input: TransactionInput): Promise<void>

  // Search
  searchAccounts(query: AccountQuery, options?: QueryOptions): Promise<Account[]>

  // Templates
  loadTemplate(name: string, options?: LoadTemplateOptions): Promise<void>
  getAvailableTemplates(): Promise<string[]>
  getTemplateDetails(name: string): Promise<TemplateDetails>
  exportAsTemplate(name: string): Promise<AccountTemplate>
  importTemplate(template: AccountTemplate): Promise<void>

  // Financial statement classification
  getBalanceSheetAccounts(): Promise<BalanceSheetAccounts>
  getIncomeStatementAccounts(): Promise<IncomeStatementAccounts>
  getCashFlowAccounts(): Promise<CashFlowAccounts>
}

// =============================================================================
// Constants
// =============================================================================

export const AccountTypes = {
  ASSET: 'asset' as const,
  LIABILITY: 'liability' as const,
  EQUITY: 'equity' as const,
  REVENUE: 'revenue' as const,
  EXPENSE: 'expense' as const,
}

// =============================================================================
// Factory Function (Stub)
// =============================================================================

export function createChartOfAccounts(_options?: ChartOfAccountsOptions): ChartOfAccounts {
  throw new Error('Not implemented: createChartOfAccounts')
}

/**
 * @dotdo/quickbooks - QuickBooks Online API Compatibility Layer for Cloudflare Workers
 *
 * Drop-in replacement for QuickBooks Online SDK with edge compatibility.
 *
 * @example
 * ```typescript
 * import { QuickBooks } from '@dotdo/quickbooks'
 *
 * const qb = new QuickBooks({
 *   clientId: env.QB_CLIENT_ID,
 *   clientSecret: env.QB_CLIENT_SECRET,
 *   realmId: env.QB_REALM_ID,
 *   accessToken: env.QB_ACCESS_TOKEN,
 * })
 *
 * // Create an account
 * const account = await qb.accounts.create({
 *   Name: 'Utilities',
 *   AccountType: 'Expense',
 * })
 *
 * // Get account by ID
 * const retrieved = await qb.accounts.get(account.Id)
 *
 * // Query accounts
 * const accounts = await qb.accounts.query("SELECT * FROM Account WHERE AccountType = 'Expense'")
 * ```
 *
 * @module @dotdo/quickbooks
 */

// Placeholder exports - to be implemented
export class QuickBooks {
  constructor(_config: QuickBooksConfig) {
    throw new Error('QuickBooks not yet implemented')
  }
}

export interface QuickBooksConfig {
  clientId: string
  clientSecret: string
  realmId: string
  accessToken: string
  refreshToken?: string
  sandbox?: boolean
}

// Account types
export type AccountType =
  | 'Bank'
  | 'Other Current Asset'
  | 'Fixed Asset'
  | 'Other Asset'
  | 'Accounts Receivable'
  | 'Equity'
  | 'Expense'
  | 'Other Expense'
  | 'Cost of Goods Sold'
  | 'Accounts Payable'
  | 'Credit Card'
  | 'Long Term Liability'
  | 'Other Current Liability'
  | 'Income'
  | 'Other Income'

export type AccountClassification = 'Asset' | 'Equity' | 'Expense' | 'Liability' | 'Revenue'

export interface Account {
  Id: string
  Name: string
  SyncToken: string
  AccountType: AccountType
  AccountSubType?: string
  Classification?: AccountClassification
  CurrentBalance?: number
  CurrentBalanceWithSubAccounts?: number
  Active?: boolean
  SubAccount?: boolean
  ParentRef?: { value: string; name?: string }
  FullyQualifiedName?: string
  AcctNum?: string
  Description?: string
  TaxCodeRef?: { value: string }
  CurrencyRef?: { value: string; name?: string }
  MetaData?: {
    CreateTime: string
    LastUpdatedTime: string
  }
}

export interface AccountCreateParams {
  Name: string
  AccountType: AccountType
  AccountSubType?: string
  AcctNum?: string
  Description?: string
  SubAccount?: boolean
  ParentRef?: { value: string }
  Active?: boolean
  TaxCodeRef?: { value: string }
  CurrencyRef?: { value: string }
}

export interface AccountUpdateParams extends Partial<AccountCreateParams> {
  Id: string
  SyncToken: string
}

export interface QueryResponse<T> {
  QueryResponse: {
    Account?: T[]
    startPosition?: number
    maxResults?: number
    totalCount?: number
  }
  time: string
}

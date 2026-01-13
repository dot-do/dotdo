/**
 * QuickBooksLocal - Local QuickBooks Implementation
 *
 * In-memory implementation for testing and local development.
 * Provides QuickBooks Online API compatibility without requiring
 * actual QuickBooks credentials.
 *
 * This is a stub - implementation pending.
 */

import type {
  Account,
  AccountCreateParams,
  AccountUpdateParams,
  QueryResponse,
} from './index'

export interface QuickBooksLocalConfig {
  realmId: string
}

export class QuickBooksLocal {
  public readonly accounts: AccountsResource

  constructor(_config: QuickBooksLocalConfig) {
    this.accounts = new AccountsResource()
  }
}

class AccountsResource {
  async create(_params: AccountCreateParams): Promise<Account> {
    throw new Error('AccountsResource.create not yet implemented')
  }

  async get(_id: string): Promise<Account> {
    throw new Error('AccountsResource.get not yet implemented')
  }

  async update(_params: AccountUpdateParams): Promise<Account> {
    throw new Error('AccountsResource.update not yet implemented')
  }

  async delete(_id: string, _syncToken: string): Promise<Account> {
    throw new Error('AccountsResource.delete not yet implemented')
  }

  async query(_query: string): Promise<QueryResponse<Account>> {
    throw new Error('AccountsResource.query not yet implemented')
  }

  async setBalance(_id: string, _balance: number): Promise<void> {
    throw new Error('AccountsResource.setBalance not yet implemented')
  }
}

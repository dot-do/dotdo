/**
 * QuickBooks Account Tests - RED Phase
 *
 * Tests for QuickBooks Online Account API compatibility:
 * - Account CRUD operations (create, read, update, delete)
 * - Account types (16 account types)
 * - Parent/child account relationships (SubAccount, ParentRef)
 *
 * These tests should FAIL until the implementation is complete.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { QuickBooksLocal } from '../local'
import type { Account, AccountType, AccountClassification } from '../index'

describe('QuickBooks Account API', () => {
  let qb: QuickBooksLocal

  beforeEach(() => {
    qb = new QuickBooksLocal({
      realmId: 'test-realm-123',
    })
  })

  // ===========================================================================
  // Account CRUD Operations
  // ===========================================================================

  describe('Account CRUD', () => {
    describe('create', () => {
      it('should create an expense account', async () => {
        const account = await qb.accounts.create({
          Name: 'Office Supplies',
          AccountType: 'Expense',
        })

        expect(account.Id).toBeDefined()
        expect(account.Name).toBe('Office Supplies')
        expect(account.AccountType).toBe('Expense')
        expect(account.SyncToken).toBe('0')
        expect(account.Active).toBe(true)
      })

      it('should create an account with account number', async () => {
        const account = await qb.accounts.create({
          Name: 'Checking Account',
          AccountType: 'Bank',
          AcctNum: '1000',
        })

        expect(account.AcctNum).toBe('1000')
        expect(account.AccountType).toBe('Bank')
      })

      it('should create an account with description', async () => {
        const account = await qb.accounts.create({
          Name: 'Marketing Expenses',
          AccountType: 'Expense',
          Description: 'All marketing and advertising expenses',
        })

        expect(account.Description).toBe('All marketing and advertising expenses')
      })

      it('should auto-assign classification based on account type', async () => {
        const expenseAccount = await qb.accounts.create({
          Name: 'Test Expense',
          AccountType: 'Expense',
        })

        expect(expenseAccount.Classification).toBe('Expense')

        const assetAccount = await qb.accounts.create({
          Name: 'Test Asset',
          AccountType: 'Bank',
        })

        expect(assetAccount.Classification).toBe('Asset')

        const incomeAccount = await qb.accounts.create({
          Name: 'Test Income',
          AccountType: 'Income',
        })

        expect(incomeAccount.Classification).toBe('Revenue')
      })

      it('should set initial balance to zero', async () => {
        const account = await qb.accounts.create({
          Name: 'New Account',
          AccountType: 'Bank',
        })

        expect(account.CurrentBalance).toBe(0)
        expect(account.CurrentBalanceWithSubAccounts).toBe(0)
      })

      it('should generate metadata with timestamps', async () => {
        const account = await qb.accounts.create({
          Name: 'Timestamped Account',
          AccountType: 'Expense',
        })

        expect(account.MetaData).toBeDefined()
        expect(account.MetaData?.CreateTime).toBeDefined()
        expect(account.MetaData?.LastUpdatedTime).toBeDefined()
      })

      it('should reject duplicate account names', async () => {
        await qb.accounts.create({
          Name: 'Duplicate Name',
          AccountType: 'Expense',
        })

        await expect(
          qb.accounts.create({
            Name: 'Duplicate Name',
            AccountType: 'Expense',
          })
        ).rejects.toThrow(/duplicate|already exists/i)
      })

      it('should require Name field', async () => {
        await expect(
          qb.accounts.create({
            Name: '',
            AccountType: 'Expense',
          })
        ).rejects.toThrow(/name.*required/i)
      })

      it('should require AccountType field', async () => {
        await expect(
          qb.accounts.create({
            Name: 'Missing Type',
            AccountType: '' as AccountType,
          })
        ).rejects.toThrow(/account.*type.*required/i)
      })
    })

    describe('get', () => {
      it('should retrieve an account by ID', async () => {
        const created = await qb.accounts.create({
          Name: 'Retrievable Account',
          AccountType: 'Bank',
        })

        const retrieved = await qb.accounts.get(created.Id)

        expect(retrieved.Id).toBe(created.Id)
        expect(retrieved.Name).toBe('Retrievable Account')
        expect(retrieved.AccountType).toBe('Bank')
      })

      it('should throw for non-existent account', async () => {
        await expect(qb.accounts.get('non-existent-id')).rejects.toThrow(/not found/i)
      })
    })

    describe('update', () => {
      it('should update account name', async () => {
        const account = await qb.accounts.create({
          Name: 'Original Name',
          AccountType: 'Expense',
        })

        const updated = await qb.accounts.update({
          Id: account.Id,
          SyncToken: account.SyncToken,
          Name: 'Updated Name',
        })

        expect(updated.Name).toBe('Updated Name')
        expect(updated.SyncToken).toBe('1')
      })

      it('should update account description', async () => {
        const account = await qb.accounts.create({
          Name: 'Describable',
          AccountType: 'Expense',
        })

        const updated = await qb.accounts.update({
          Id: account.Id,
          SyncToken: account.SyncToken,
          Description: 'New description',
        })

        expect(updated.Description).toBe('New description')
      })

      it('should update account number', async () => {
        const account = await qb.accounts.create({
          Name: 'Numbered',
          AccountType: 'Bank',
          AcctNum: '1000',
        })

        const updated = await qb.accounts.update({
          Id: account.Id,
          SyncToken: account.SyncToken,
          AcctNum: '1001',
        })

        expect(updated.AcctNum).toBe('1001')
      })

      it('should reject stale SyncToken', async () => {
        const account = await qb.accounts.create({
          Name: 'Sync Test',
          AccountType: 'Expense',
        })

        // First update succeeds
        await qb.accounts.update({
          Id: account.Id,
          SyncToken: '0',
          Name: 'First Update',
        })

        // Second update with stale token should fail
        await expect(
          qb.accounts.update({
            Id: account.Id,
            SyncToken: '0', // Stale token
            Name: 'Second Update',
          })
        ).rejects.toThrow(/stale|sync.*token|conflict/i)
      })

      it('should update LastUpdatedTime', async () => {
        const account = await qb.accounts.create({
          Name: 'Time Test',
          AccountType: 'Expense',
        })

        const originalTime = account.MetaData?.LastUpdatedTime

        // Small delay to ensure time difference
        await new Promise((r) => setTimeout(r, 10))

        const updated = await qb.accounts.update({
          Id: account.Id,
          SyncToken: account.SyncToken,
          Name: 'Time Test Updated',
        })

        expect(updated.MetaData?.LastUpdatedTime).not.toBe(originalTime)
      })

      it('should not allow changing AccountType', async () => {
        const account = await qb.accounts.create({
          Name: 'Type Lock',
          AccountType: 'Expense',
        })

        // QuickBooks does not allow changing account type after creation
        await expect(
          qb.accounts.update({
            Id: account.Id,
            SyncToken: account.SyncToken,
            AccountType: 'Income',
          })
        ).rejects.toThrow(/cannot change.*account.*type|immutable/i)
      })
    })

    describe('delete (deactivate)', () => {
      it('should deactivate an account', async () => {
        const account = await qb.accounts.create({
          Name: 'To Deactivate',
          AccountType: 'Expense',
        })

        const deactivated = await qb.accounts.update({
          Id: account.Id,
          SyncToken: account.SyncToken,
          Active: false,
        })

        expect(deactivated.Active).toBe(false)
      })

      it('should not delete accounts with transactions', async () => {
        const account = await qb.accounts.create({
          Name: 'Has Transactions',
          AccountType: 'Bank',
        })

        // Simulate account having transactions by setting balance
        await qb.accounts.setBalance(account.Id, 100)

        await expect(
          qb.accounts.delete(account.Id, account.SyncToken)
        ).rejects.toThrow(/transactions/)
      })

      it('should allow reactivating deactivated accounts', async () => {
        const account = await qb.accounts.create({
          Name: 'Reactivatable',
          AccountType: 'Expense',
        })

        const deactivated = await qb.accounts.update({
          Id: account.Id,
          SyncToken: account.SyncToken,
          Active: false,
        })

        const reactivated = await qb.accounts.update({
          Id: account.Id,
          SyncToken: deactivated.SyncToken,
          Active: true,
        })

        expect(reactivated.Active).toBe(true)
      })
    })

    describe('query', () => {
      it('should query all accounts', async () => {
        await qb.accounts.create({ Name: 'Query Test 1', AccountType: 'Expense' })
        await qb.accounts.create({ Name: 'Query Test 2', AccountType: 'Income' })
        await qb.accounts.create({ Name: 'Query Test 3', AccountType: 'Bank' })

        const result = await qb.accounts.query('SELECT * FROM Account')

        expect(result.QueryResponse.Account).toBeDefined()
        expect(result.QueryResponse.Account!.length).toBeGreaterThanOrEqual(3)
      })

      it('should query accounts by type', async () => {
        await qb.accounts.create({ Name: 'Expense 1', AccountType: 'Expense' })
        await qb.accounts.create({ Name: 'Expense 2', AccountType: 'Expense' })
        await qb.accounts.create({ Name: 'Income 1', AccountType: 'Income' })

        const result = await qb.accounts.query(
          "SELECT * FROM Account WHERE AccountType = 'Expense'"
        )

        expect(result.QueryResponse.Account!.every((a) => a.AccountType === 'Expense')).toBe(true)
      })

      it('should query accounts by name', async () => {
        await qb.accounts.create({ Name: 'Specific Name', AccountType: 'Expense' })

        const result = await qb.accounts.query(
          "SELECT * FROM Account WHERE Name = 'Specific Name'"
        )

        expect(result.QueryResponse.Account).toHaveLength(1)
        expect(result.QueryResponse.Account![0].Name).toBe('Specific Name')
      })

      it('should support LIKE queries', async () => {
        await qb.accounts.create({ Name: 'Office Supplies', AccountType: 'Expense' })
        await qb.accounts.create({ Name: 'Office Equipment', AccountType: 'Fixed Asset' })
        await qb.accounts.create({ Name: 'Travel Expenses', AccountType: 'Expense' })

        const result = await qb.accounts.query(
          "SELECT * FROM Account WHERE Name LIKE 'Office%'"
        )

        expect(result.QueryResponse.Account!.length).toBe(2)
        expect(result.QueryResponse.Account!.every((a) => a.Name.startsWith('Office'))).toBe(true)
      })

      it('should support pagination with STARTPOSITION and MAXRESULTS', async () => {
        // Create multiple accounts
        for (let i = 1; i <= 10; i++) {
          await qb.accounts.create({ Name: `Paginated Account ${i}`, AccountType: 'Expense' })
        }

        const page1 = await qb.accounts.query(
          'SELECT * FROM Account STARTPOSITION 1 MAXRESULTS 5'
        )

        expect(page1.QueryResponse.Account!.length).toBe(5)
        expect(page1.QueryResponse.startPosition).toBe(1)
        expect(page1.QueryResponse.maxResults).toBe(5)

        const page2 = await qb.accounts.query(
          'SELECT * FROM Account STARTPOSITION 6 MAXRESULTS 5'
        )

        expect(page2.QueryResponse.startPosition).toBe(6)
      })

      it('should query only active accounts by default', async () => {
        const active = await qb.accounts.create({ Name: 'Active Account', AccountType: 'Expense' })
        const inactive = await qb.accounts.create({ Name: 'Inactive Account', AccountType: 'Expense' })

        await qb.accounts.update({
          Id: inactive.Id,
          SyncToken: inactive.SyncToken,
          Active: false,
        })

        const result = await qb.accounts.query(
          "SELECT * FROM Account WHERE Active = true"
        )

        expect(result.QueryResponse.Account!.some((a) => a.Id === active.Id)).toBe(true)
        expect(result.QueryResponse.Account!.some((a) => a.Id === inactive.Id)).toBe(false)
      })

      it('should return totalCount', async () => {
        await qb.accounts.create({ Name: 'Count Test 1', AccountType: 'Expense' })
        await qb.accounts.create({ Name: 'Count Test 2', AccountType: 'Expense' })

        const result = await qb.accounts.query(
          'SELECT COUNT(*) FROM Account'
        )

        expect(result.QueryResponse.totalCount).toBeGreaterThanOrEqual(2)
      })
    })
  })

  // ===========================================================================
  // Account Types
  // ===========================================================================

  describe('Account Types', () => {
    const accountTypeClassifications: Array<{ type: AccountType; classification: AccountClassification }> = [
      { type: 'Bank', classification: 'Asset' },
      { type: 'Other Current Asset', classification: 'Asset' },
      { type: 'Fixed Asset', classification: 'Asset' },
      { type: 'Other Asset', classification: 'Asset' },
      { type: 'Accounts Receivable', classification: 'Asset' },
      { type: 'Equity', classification: 'Equity' },
      { type: 'Expense', classification: 'Expense' },
      { type: 'Other Expense', classification: 'Expense' },
      { type: 'Cost of Goods Sold', classification: 'Expense' },
      { type: 'Accounts Payable', classification: 'Liability' },
      { type: 'Credit Card', classification: 'Liability' },
      { type: 'Long Term Liability', classification: 'Liability' },
      { type: 'Other Current Liability', classification: 'Liability' },
      { type: 'Income', classification: 'Revenue' },
      { type: 'Other Income', classification: 'Revenue' },
    ]

    it.each(accountTypeClassifications)(
      'should create $type account with $classification classification',
      async ({ type, classification }) => {
        const account = await qb.accounts.create({
          Name: `Test ${type} Account`,
          AccountType: type,
        })

        expect(account.AccountType).toBe(type)
        expect(account.Classification).toBe(classification)
      }
    )

    it('should reject invalid account type', async () => {
      await expect(
        qb.accounts.create({
          Name: 'Invalid Type',
          AccountType: 'InvalidType' as AccountType,
        })
      ).rejects.toThrow(/invalid.*account.*type/i)
    })

    describe('Account SubTypes', () => {
      it('should create account with subtype', async () => {
        const account = await qb.accounts.create({
          Name: 'Checking',
          AccountType: 'Bank',
          AccountSubType: 'Checking',
        })

        expect(account.AccountSubType).toBe('Checking')
      })

      it('should create expense account with subtype', async () => {
        const account = await qb.accounts.create({
          Name: 'Office Supplies',
          AccountType: 'Expense',
          AccountSubType: 'OfficeGeneralAdministrativeExpenses',
        })

        expect(account.AccountSubType).toBe('OfficeGeneralAdministrativeExpenses')
      })

      it('should validate subtype matches account type', async () => {
        // Checking is a Bank subtype, not Expense
        await expect(
          qb.accounts.create({
            Name: 'Invalid Subtype',
            AccountType: 'Expense',
            AccountSubType: 'Checking',
          })
        ).rejects.toThrow(/invalid.*subtype|subtype.*not valid/i)
      })

      it('should default subtype when not provided', async () => {
        const account = await qb.accounts.create({
          Name: 'Default Subtype',
          AccountType: 'Bank',
        })

        // QuickBooks assigns a default subtype based on account type
        expect(account.AccountSubType).toBeDefined()
      })
    })
  })

  // ===========================================================================
  // Parent/Child Account Relationships
  // ===========================================================================

  describe('Parent/Child Accounts', () => {
    describe('creating sub-accounts', () => {
      it('should create a sub-account with ParentRef', async () => {
        const parent = await qb.accounts.create({
          Name: 'Utilities',
          AccountType: 'Expense',
        })

        const child = await qb.accounts.create({
          Name: 'Electric',
          AccountType: 'Expense',
          SubAccount: true,
          ParentRef: { value: parent.Id },
        })

        expect(child.SubAccount).toBe(true)
        expect(child.ParentRef?.value).toBe(parent.Id)
      })

      it('should set FullyQualifiedName for sub-accounts', async () => {
        const parent = await qb.accounts.create({
          Name: 'Utilities',
          AccountType: 'Expense',
        })

        const child = await qb.accounts.create({
          Name: 'Electric',
          AccountType: 'Expense',
          SubAccount: true,
          ParentRef: { value: parent.Id },
        })

        expect(child.FullyQualifiedName).toBe('Utilities:Electric')
      })

      it('should support multi-level hierarchy', async () => {
        const grandparent = await qb.accounts.create({
          Name: 'Expenses',
          AccountType: 'Expense',
        })

        const parent = await qb.accounts.create({
          Name: 'Operating',
          AccountType: 'Expense',
          SubAccount: true,
          ParentRef: { value: grandparent.Id },
        })

        const child = await qb.accounts.create({
          Name: 'Office',
          AccountType: 'Expense',
          SubAccount: true,
          ParentRef: { value: parent.Id },
        })

        expect(child.FullyQualifiedName).toBe('Expenses:Operating:Office')
      })

      it('should require same AccountType as parent', async () => {
        const parent = await qb.accounts.create({
          Name: 'Parent Expense',
          AccountType: 'Expense',
        })

        // Child must have same account type as parent
        await expect(
          qb.accounts.create({
            Name: 'Income Child',
            AccountType: 'Income',
            SubAccount: true,
            ParentRef: { value: parent.Id },
          })
        ).rejects.toThrow(/account.*type.*must match|same.*type.*as parent/i)
      })

      it('should require SubAccount flag with ParentRef', async () => {
        const parent = await qb.accounts.create({
          Name: 'Parent',
          AccountType: 'Expense',
        })

        // ParentRef without SubAccount=true should fail
        await expect(
          qb.accounts.create({
            Name: 'Child',
            AccountType: 'Expense',
            ParentRef: { value: parent.Id },
            // SubAccount not set to true
          })
        ).rejects.toThrow(/subaccount.*must be true|parentref.*requires.*subaccount/i)
      })

      it('should validate parent exists', async () => {
        await expect(
          qb.accounts.create({
            Name: 'Orphan',
            AccountType: 'Expense',
            SubAccount: true,
            ParentRef: { value: 'non-existent-id' },
          })
        ).rejects.toThrow(/parent.*not found|invalid.*parent/i)
      })

      it('should not allow account to be its own parent', async () => {
        const account = await qb.accounts.create({
          Name: 'Self Reference',
          AccountType: 'Expense',
        })

        await expect(
          qb.accounts.update({
            Id: account.Id,
            SyncToken: account.SyncToken,
            SubAccount: true,
            ParentRef: { value: account.Id },
          })
        ).rejects.toThrow(/cannot be.*own parent|self.*reference/i)
      })

      it('should not allow circular parent references', async () => {
        const parent = await qb.accounts.create({
          Name: 'Parent',
          AccountType: 'Expense',
        })

        const child = await qb.accounts.create({
          Name: 'Child',
          AccountType: 'Expense',
          SubAccount: true,
          ParentRef: { value: parent.Id },
        })

        // Try to make parent a child of its own child
        await expect(
          qb.accounts.update({
            Id: parent.Id,
            SyncToken: parent.SyncToken,
            SubAccount: true,
            ParentRef: { value: child.Id },
          })
        ).rejects.toThrow(/circular.*reference|cycle.*detected/i)
      })
    })

    describe('balance aggregation', () => {
      it('should aggregate child balances in CurrentBalanceWithSubAccounts', async () => {
        const parent = await qb.accounts.create({
          Name: 'Utilities',
          AccountType: 'Expense',
        })

        const electric = await qb.accounts.create({
          Name: 'Electric',
          AccountType: 'Expense',
          SubAccount: true,
          ParentRef: { value: parent.Id },
        })

        const gas = await qb.accounts.create({
          Name: 'Gas',
          AccountType: 'Expense',
          SubAccount: true,
          ParentRef: { value: parent.Id },
        })

        // Set balances on child accounts
        await qb.accounts.setBalance(electric.Id, 100)
        await qb.accounts.setBalance(gas.Id, 50)

        const updatedParent = await qb.accounts.get(parent.Id)

        expect(updatedParent.CurrentBalance).toBe(0) // Parent has no direct balance
        expect(updatedParent.CurrentBalanceWithSubAccounts).toBe(150)
      })

      it('should cascade balance updates through hierarchy', async () => {
        const grandparent = await qb.accounts.create({
          Name: 'All Expenses',
          AccountType: 'Expense',
        })

        const parent = await qb.accounts.create({
          Name: 'Utilities',
          AccountType: 'Expense',
          SubAccount: true,
          ParentRef: { value: grandparent.Id },
        })

        const child = await qb.accounts.create({
          Name: 'Electric',
          AccountType: 'Expense',
          SubAccount: true,
          ParentRef: { value: parent.Id },
        })

        await qb.accounts.setBalance(child.Id, 200)

        const updatedGrandparent = await qb.accounts.get(grandparent.Id)
        const updatedParent = await qb.accounts.get(parent.Id)

        expect(updatedParent.CurrentBalanceWithSubAccounts).toBe(200)
        expect(updatedGrandparent.CurrentBalanceWithSubAccounts).toBe(200)
      })
    })

    describe('querying hierarchies', () => {
      it('should query sub-accounts', async () => {
        const parent = await qb.accounts.create({
          Name: 'Parent Account',
          AccountType: 'Expense',
        })

        await qb.accounts.create({
          Name: 'Child 1',
          AccountType: 'Expense',
          SubAccount: true,
          ParentRef: { value: parent.Id },
        })

        await qb.accounts.create({
          Name: 'Child 2',
          AccountType: 'Expense',
          SubAccount: true,
          ParentRef: { value: parent.Id },
        })

        const result = await qb.accounts.query(
          `SELECT * FROM Account WHERE ParentRef = '${parent.Id}'`
        )

        expect(result.QueryResponse.Account).toHaveLength(2)
      })

      it('should query top-level accounts only', async () => {
        await qb.accounts.create({ Name: 'Top Level 1', AccountType: 'Expense' })
        await qb.accounts.create({ Name: 'Top Level 2', AccountType: 'Income' })

        const parent = await qb.accounts.create({ Name: 'Has Children', AccountType: 'Expense' })
        await qb.accounts.create({
          Name: 'Child',
          AccountType: 'Expense',
          SubAccount: true,
          ParentRef: { value: parent.Id },
        })

        const result = await qb.accounts.query(
          'SELECT * FROM Account WHERE SubAccount = false'
        )

        expect(result.QueryResponse.Account!.every((a) => !a.SubAccount)).toBe(true)
      })

      it('should find accounts by FullyQualifiedName', async () => {
        const parent = await qb.accounts.create({ Name: 'Utilities', AccountType: 'Expense' })
        await qb.accounts.create({
          Name: 'Electric',
          AccountType: 'Expense',
          SubAccount: true,
          ParentRef: { value: parent.Id },
        })

        const result = await qb.accounts.query(
          "SELECT * FROM Account WHERE FullyQualifiedName = 'Utilities:Electric'"
        )

        expect(result.QueryResponse.Account).toHaveLength(1)
        expect(result.QueryResponse.Account![0].Name).toBe('Electric')
      })
    })

    describe('moving accounts in hierarchy', () => {
      it('should move sub-account to different parent', async () => {
        const oldParent = await qb.accounts.create({ Name: 'Old Parent', AccountType: 'Expense' })
        const newParent = await qb.accounts.create({ Name: 'New Parent', AccountType: 'Expense' })

        const child = await qb.accounts.create({
          Name: 'Movable Child',
          AccountType: 'Expense',
          SubAccount: true,
          ParentRef: { value: oldParent.Id },
        })

        const moved = await qb.accounts.update({
          Id: child.Id,
          SyncToken: child.SyncToken,
          ParentRef: { value: newParent.Id },
        })

        expect(moved.ParentRef?.value).toBe(newParent.Id)
        expect(moved.FullyQualifiedName).toBe('New Parent:Movable Child')
      })

      it('should convert sub-account to top-level account', async () => {
        const parent = await qb.accounts.create({ Name: 'Parent', AccountType: 'Expense' })

        const child = await qb.accounts.create({
          Name: 'Former Child',
          AccountType: 'Expense',
          SubAccount: true,
          ParentRef: { value: parent.Id },
        })

        const topLevel = await qb.accounts.update({
          Id: child.Id,
          SyncToken: child.SyncToken,
          SubAccount: false,
          // Clear ParentRef
        })

        expect(topLevel.SubAccount).toBe(false)
        expect(topLevel.ParentRef).toBeUndefined()
        expect(topLevel.FullyQualifiedName).toBe('Former Child')
      })

      it('should update FullyQualifiedName of descendants when parent name changes', async () => {
        const parent = await qb.accounts.create({ Name: 'Old Name', AccountType: 'Expense' })

        const child = await qb.accounts.create({
          Name: 'Child',
          AccountType: 'Expense',
          SubAccount: true,
          ParentRef: { value: parent.Id },
        })

        await qb.accounts.update({
          Id: parent.Id,
          SyncToken: parent.SyncToken,
          Name: 'New Name',
        })

        const updatedChild = await qb.accounts.get(child.Id)

        expect(updatedChild.FullyQualifiedName).toBe('New Name:Child')
      })

      it('should not allow moving account to different type hierarchy', async () => {
        const expenseParent = await qb.accounts.create({ Name: 'Expense Parent', AccountType: 'Expense' })
        const incomeParent = await qb.accounts.create({ Name: 'Income Parent', AccountType: 'Income' })

        const child = await qb.accounts.create({
          Name: 'Child',
          AccountType: 'Expense',
          SubAccount: true,
          ParentRef: { value: expenseParent.Id },
        })

        await expect(
          qb.accounts.update({
            Id: child.Id,
            SyncToken: child.SyncToken,
            ParentRef: { value: incomeParent.Id },
          })
        ).rejects.toThrow(/account.*type.*must match|different.*type/i)
      })
    })

    describe('deleting accounts with children', () => {
      it('should not allow deleting parent with active children', async () => {
        const parent = await qb.accounts.create({ Name: 'Parent With Children', AccountType: 'Expense' })

        await qb.accounts.create({
          Name: 'Active Child',
          AccountType: 'Expense',
          SubAccount: true,
          ParentRef: { value: parent.Id },
        })

        await expect(
          qb.accounts.delete(parent.Id, parent.SyncToken)
        ).rejects.toThrow(/children/)
      })

      it('should allow deleting parent after deactivating all children', async () => {
        const parent = await qb.accounts.create({ Name: 'Parent', AccountType: 'Expense' })

        const child = await qb.accounts.create({
          Name: 'Child',
          AccountType: 'Expense',
          SubAccount: true,
          ParentRef: { value: parent.Id },
        })

        // Deactivate child first
        await qb.accounts.update({
          Id: child.Id,
          SyncToken: child.SyncToken,
          Active: false,
        })

        // Now parent can be deleted
        const deletedParent = await qb.accounts.delete(parent.Id, parent.SyncToken)

        expect(deletedParent.Active).toBe(false)
      })
    })
  })
})

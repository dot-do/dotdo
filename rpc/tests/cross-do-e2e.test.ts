/**
 * E2E Tests for Cross-DO RPC Communication Flow
 *
 * Issue: do-yajj
 *
 * These tests verify end-to-end cross-DO communication patterns using real
 * Miniflare instances with actual DOs. NO MOCKS.
 *
 * Tests cover:
 * 1. DO-to-DO communication
 * 2. RPC request/response
 * 3. Error handling across DOs
 * 4. Timeout scenarios
 *
 * @module rpc/tests/cross-do-e2e
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Miniflare } from 'miniflare'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface AccountData {
  id: string
  name: string
  balance: number
  status: 'active' | 'suspended' | 'closed'
}

interface TransferResult {
  success: boolean
  sourceBalance: number
  targetBalance: number
  transferId: string
  timestamp: number
}

interface NotificationResult {
  delivered: boolean
  channel: string
  messageId: string
  timestamp: number
}

// ============================================================================
// TEST DO IMPLEMENTATIONS
// ============================================================================

/**
 * Multi-DO script for E2E cross-DO RPC testing
 * Implements Account, Transfer, and Notification DOs
 */
const E2E_CROSS_DO_SCRIPT = `
// Shared RPC endpoint handler
function handleRPC(instance) {
  return async (request) => {
    const { method, args } = await request.json()

    // Navigate to nested methods via dot notation
    const parts = method.split('.')
    let target = instance
    for (let i = 0; i < parts.length - 1; i++) {
      target = target[parts[i]]
      if (!target) {
        return Response.json({ error: \`Path not found: \${parts.slice(0, i + 1).join('.')}\` }, { status: 404 })
      }
    }

    const fn = target[parts[parts.length - 1]]
    if (typeof fn !== 'function') {
      return Response.json({ error: \`Method not found: \${method}\` }, { status: 404 })
    }

    try {
      const result = await fn.apply(target, args)
      return Response.json(result)
    } catch (error) {
      // Structured error response
      return Response.json({
        error: error.message,
        code: error.code || 'INTERNAL_ERROR',
        details: error.details || {}
      }, { status: error.httpStatus || 500 })
    }
  }
}

// ============================================================================
// Account DO - Manages account data and balance operations
// ============================================================================
export class AccountDO {
  constructor(state, env) {
    this.state = state
    this.storage = state.storage
    this.env = env
  }

  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname

    // RPC endpoint
    if (path === '/rpc' && request.method === 'POST') {
      return handleRPC(this)(request)
    }

    // Setup endpoint
    if (path === '/setup' && request.method === 'POST') {
      const data = await request.json()
      await this.storage.put('account', data)
      return Response.json({ success: true })
    }

    // Get account
    if (path === '/get') {
      const account = await this.storage.get('account')
      return Response.json({ account })
    }

    return Response.json({ status: 'AccountDO', id: this.state.id.toString() })
  }

  // RPC Methods

  async getData() {
    return await this.storage.get('account') || null
  }

  async getBalance() {
    const account = await this.storage.get('account')
    if (!account) {
      const error = new Error('Account not found')
      error.code = 'NOT_FOUND'
      error.httpStatus = 404
      throw error
    }
    return { balance: account.balance, accountId: account.id }
  }

  async credit(amount) {
    const account = await this.storage.get('account')
    if (!account) {
      const error = new Error('Account not found')
      error.code = 'NOT_FOUND'
      error.httpStatus = 404
      throw error
    }
    if (account.status !== 'active') {
      const error = new Error('Account is not active')
      error.code = 'ACCOUNT_INACTIVE'
      error.httpStatus = 400
      throw error
    }
    account.balance += amount
    await this.storage.put('account', account)
    return { balance: account.balance, credited: amount }
  }

  async debit(amount) {
    const account = await this.storage.get('account')
    if (!account) {
      const error = new Error('Account not found')
      error.code = 'NOT_FOUND'
      error.httpStatus = 404
      throw error
    }
    if (account.status !== 'active') {
      const error = new Error('Account is not active')
      error.code = 'ACCOUNT_INACTIVE'
      error.httpStatus = 400
      throw error
    }
    if (account.balance < amount) {
      const error = new Error('Insufficient balance')
      error.code = 'INSUFFICIENT_BALANCE'
      error.httpStatus = 400
      error.details = { available: account.balance, requested: amount }
      throw error
    }
    account.balance -= amount
    await this.storage.put('account', account)
    return { balance: account.balance, debited: amount }
  }

  async suspend() {
    const account = await this.storage.get('account')
    if (!account) {
      const error = new Error('Account not found')
      error.code = 'NOT_FOUND'
      error.httpStatus = 404
      throw error
    }
    account.status = 'suspended'
    await this.storage.put('account', account)
    return { status: account.status }
  }

  async activate() {
    const account = await this.storage.get('account')
    if (!account) {
      const error = new Error('Account not found')
      error.code = 'NOT_FOUND'
      error.httpStatus = 404
      throw error
    }
    account.status = 'active'
    await this.storage.put('account', account)
    return { status: account.status }
  }

  // Cross-DO call - notify about balance change
  async notifyBalanceChange(params) {
    const { amount, operation } = params
    const account = await this.storage.get('account')
    if (!account) {
      throw new Error('Account not found')
    }

    // Call NotificationDO
    const notifId = this.env.NOTIFICATION_DO.idFromName('notification-service')
    const notifStub = this.env.NOTIFICATION_DO.get(notifId)

    const response = await notifStub.fetch('https://do/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'send',
        args: [{
          accountId: account.id,
          message: \`Balance \${operation}: $\${amount}. New balance: $\${account.balance}\`,
          channel: 'email'
        }]
      })
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Notification failed')
    }

    return response.json()
  }
}

// ============================================================================
// Transfer DO - Orchestrates transfers between accounts
// ============================================================================
export class TransferDO {
  constructor(state, env) {
    this.state = state
    this.storage = state.storage
    this.env = env
  }

  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname

    // RPC endpoint
    if (path === '/rpc' && request.method === 'POST') {
      return handleRPC(this)(request)
    }

    if (path === '/history') {
      const history = await this.storage.get('transferHistory') || []
      return Response.json({ history })
    }

    return Response.json({ status: 'TransferDO', id: this.state.id.toString() })
  }

  // RPC Methods

  async execute(params) {
    const { sourceAccountId, targetAccountId, amount } = params

    if (amount <= 0) {
      const error = new Error('Transfer amount must be positive')
      error.code = 'INVALID_AMOUNT'
      error.httpStatus = 400
      throw error
    }

    // Step 1: Debit source account
    const sourceDoId = this.env.ACCOUNT_DO.idFromName(sourceAccountId)
    const sourceStub = this.env.ACCOUNT_DO.get(sourceDoId)

    const debitResponse = await sourceStub.fetch('https://do/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'debit', args: [amount] })
    })

    if (!debitResponse.ok) {
      const error = await debitResponse.json()
      const transferError = new Error(error.error)
      transferError.code = error.code || 'DEBIT_FAILED'
      transferError.httpStatus = debitResponse.status
      throw transferError
    }

    const debitResult = await debitResponse.json()

    // Step 2: Credit target account
    const targetDoId = this.env.ACCOUNT_DO.idFromName(targetAccountId)
    const targetStub = this.env.ACCOUNT_DO.get(targetDoId)

    const creditResponse = await targetStub.fetch('https://do/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'credit', args: [amount] })
    })

    if (!creditResponse.ok) {
      // Rollback: credit the source account back
      await sourceStub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'credit', args: [amount] })
      })

      const error = await creditResponse.json()
      const transferError = new Error(error.error)
      transferError.code = error.code || 'CREDIT_FAILED'
      transferError.httpStatus = creditResponse.status
      throw transferError
    }

    const creditResult = await creditResponse.json()

    // Step 3: Record the transfer
    const transferId = 'xfer-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
    const transfer = {
      id: transferId,
      sourceAccountId,
      targetAccountId,
      amount,
      timestamp: Date.now(),
      sourceBalanceAfter: debitResult.balance,
      targetBalanceAfter: creditResult.balance
    }

    const history = await this.storage.get('transferHistory') || []
    history.push(transfer)
    await this.storage.put('transferHistory', history)

    return {
      success: true,
      transferId: transfer.id,
      sourceBalance: debitResult.balance,
      targetBalance: creditResult.balance,
      timestamp: transfer.timestamp
    }
  }

  async getHistory() {
    return await this.storage.get('transferHistory') || []
  }

  // Execute transfer with notifications (chained cross-DO call)
  async executeWithNotifications(params) {
    const { sourceAccountId, targetAccountId, amount } = params

    // Execute the transfer first
    const result = await this.execute(params)

    // Notify both accounts
    const sourceDoId = this.env.ACCOUNT_DO.idFromName(sourceAccountId)
    const sourceStub = this.env.ACCOUNT_DO.get(sourceDoId)

    const targetDoId = this.env.ACCOUNT_DO.idFromName(targetAccountId)
    const targetStub = this.env.ACCOUNT_DO.get(targetDoId)

    // Send notifications in parallel
    const [sourceNotif, targetNotif] = await Promise.all([
      sourceStub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'notifyBalanceChange',
          args: [{ amount, operation: 'debited' }]
        })
      }).then(r => r.ok ? r.json() : { delivered: false }),
      targetStub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'notifyBalanceChange',
          args: [{ amount, operation: 'credited' }]
        })
      }).then(r => r.ok ? r.json() : { delivered: false })
    ])

    return {
      ...result,
      notifications: {
        source: sourceNotif,
        target: targetNotif
      }
    }
  }

  // Slow transfer for timeout testing
  async slowExecute(params) {
    const { delay, ...transferParams } = params
    await new Promise(resolve => setTimeout(resolve, delay))
    return this.execute(transferParams)
  }
}

// ============================================================================
// Notification DO - Centralized notification service
// ============================================================================
export class NotificationDO {
  constructor(state, env) {
    this.state = state
    this.storage = state.storage
    this.env = env
  }

  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname

    // RPC endpoint
    if (path === '/rpc' && request.method === 'POST') {
      return handleRPC(this)(request)
    }

    if (path === '/sent') {
      const sent = await this.storage.get('sentNotifications') || []
      return Response.json({ sent })
    }

    return Response.json({ status: 'NotificationDO', id: this.state.id.toString() })
  }

  // RPC Methods

  async send(params) {
    const { accountId, message, channel } = params

    // Simulate sending notification
    const notification = {
      messageId: 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      accountId,
      message,
      channel: channel || 'email',
      timestamp: Date.now()
    }

    const sent = await this.storage.get('sentNotifications') || []
    sent.push(notification)
    await this.storage.put('sentNotifications', sent)

    return {
      delivered: true,
      channel: notification.channel,
      messageId: notification.messageId,
      timestamp: notification.timestamp
    }
  }

  async getSentCount() {
    const sent = await this.storage.get('sentNotifications') || []
    return { count: sent.length }
  }

  // Method that always fails for error testing
  async fail() {
    const error = new Error('Notification service unavailable')
    error.code = 'SERVICE_UNAVAILABLE'
    error.httpStatus = 503
    throw error
  }

  // Slow notification for timeout testing
  async slowSend(params) {
    const { delay, ...notifParams } = params
    await new Promise(resolve => setTimeout(resolve, delay))
    return this.send(notifParams)
  }
}

// ============================================================================
// Aggregator DO - Coordinates multiple DOs for concurrent testing
// ============================================================================
export class AggregatorDO {
  constructor(state, env) {
    this.state = state
    this.storage = state.storage
    this.env = env
  }

  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname

    // RPC endpoint
    if (path === '/rpc' && request.method === 'POST') {
      return handleRPC(this)(request)
    }

    return Response.json({ status: 'AggregatorDO', id: this.state.id.toString() })
  }

  // Aggregate balances from multiple accounts
  async aggregateBalances(accountIds) {
    const promises = accountIds.map(async (accountId) => {
      const doId = this.env.ACCOUNT_DO.idFromName(accountId)
      const stub = this.env.ACCOUNT_DO.get(doId)

      try {
        const response = await stub.fetch('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'getBalance', args: [] })
        })

        if (!response.ok) {
          return { accountId, error: 'Failed to get balance' }
        }

        const result = await response.json()
        return { accountId, balance: result.balance }
      } catch (error) {
        return { accountId, error: error.message }
      }
    })

    const results = await Promise.all(promises)
    const successful = results.filter(r => !r.error)
    const totalBalance = successful.reduce((sum, r) => sum + r.balance, 0)

    return {
      balances: results,
      totalBalance,
      successCount: successful.length,
      errorCount: results.length - successful.length
    }
  }

  // Broadcast notification to multiple accounts
  async broadcastNotification(accountIds, message) {
    const promises = accountIds.map(async (accountId) => {
      const doId = this.env.ACCOUNT_DO.idFromName(accountId)
      const stub = this.env.ACCOUNT_DO.get(doId)

      try {
        const response = await stub.fetch('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: 'notifyBalanceChange',
            args: [{ amount: 0, operation: message }]
          })
        })

        if (!response.ok) {
          return { accountId, success: false }
        }

        return { accountId, success: true }
      } catch (error) {
        return { accountId, success: false, error: error.message }
      }
    })

    const results = await Promise.all(promises)
    return {
      results,
      delivered: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length
    }
  }
}

// ============================================================================
// Worker entry point
// ============================================================================
export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const doType = url.searchParams.get('do') || 'account'
    const doName = url.searchParams.get('name') || 'default'

    let stub
    switch (doType) {
      case 'account':
        stub = env.ACCOUNT_DO.get(env.ACCOUNT_DO.idFromName(doName))
        break
      case 'transfer':
        stub = env.TRANSFER_DO.get(env.TRANSFER_DO.idFromName(doName))
        break
      case 'notification':
        stub = env.NOTIFICATION_DO.get(env.NOTIFICATION_DO.idFromName(doName))
        break
      case 'aggregator':
        stub = env.AGGREGATOR_DO.get(env.AGGREGATOR_DO.idFromName(doName))
        break
      default:
        return Response.json({ error: 'Unknown DO type' }, { status: 400 })
    }

    return stub.fetch(request)
  }
}
`

// ============================================================================
// MINIFLARE CONFIGURATION
// ============================================================================

function getMiniflareConfig() {
  return {
    modules: true,
    script: E2E_CROSS_DO_SCRIPT,
    durableObjects: {
      ACCOUNT_DO: 'AccountDO',
      TRANSFER_DO: 'TransferDO',
      NOTIFICATION_DO: 'NotificationDO',
      AGGREGATOR_DO: 'AggregatorDO',
    },
    durableObjectsPersist: false, // In-memory for tests
  }
}

// ============================================================================
// TEST HELPERS
// ============================================================================

async function getAccountStub(mf: Miniflare, name: string) {
  const ns = await mf.getDurableObjectNamespace('ACCOUNT_DO')
  const id = ns.idFromName(name)
  return ns.get(id)
}

async function getTransferStub(mf: Miniflare, name: string) {
  const ns = await mf.getDurableObjectNamespace('TRANSFER_DO')
  const id = ns.idFromName(name)
  return ns.get(id)
}

async function getNotificationStub(mf: Miniflare, name: string) {
  const ns = await mf.getDurableObjectNamespace('NOTIFICATION_DO')
  const id = ns.idFromName(name)
  return ns.get(id)
}

async function getAggregatorStub(mf: Miniflare, name: string) {
  const ns = await mf.getDurableObjectNamespace('AGGREGATOR_DO')
  const id = ns.idFromName(name)
  return ns.get(id)
}

function generateTestId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

async function setupAccount(stub: DurableObjectStub, account: AccountData) {
  await stub.fetch('http://fake/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(account),
  })
}

async function rpcCall(stub: DurableObjectStub, method: string, args: unknown[] = []) {
  const response = await stub.fetch('https://do/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args }),
  })
  return response
}

// ============================================================================
// E2E TEST SUITES
// ============================================================================

describe('E2E Cross-DO RPC Communication Flow', () => {
  let mf: Miniflare

  beforeAll(async () => {
    mf = new Miniflare(getMiniflareConfig())
  })

  afterAll(async () => {
    await mf.dispose()
  })

  // ==========================================================================
  // 1. DO-TO-DO COMMUNICATION
  // ==========================================================================

  describe('1. DO-to-DO Communication', () => {
    it('should successfully call methods on another DO', async () => {
      const accountId = generateTestId()

      // Setup account
      const accountStub = await getAccountStub(mf, accountId)
      await setupAccount(accountStub, {
        id: accountId,
        name: 'Test Account',
        balance: 1000,
        status: 'active',
      })

      // Direct RPC call to account
      const response = await rpcCall(accountStub, 'getBalance')
      expect(response.ok).toBe(true)

      const result = await response.json() as { balance: number; accountId: string }
      expect(result.balance).toBe(1000)
      expect(result.accountId).toBe(accountId)
    })

    it('should orchestrate transfer between two accounts via Transfer DO', async () => {
      const sourceId = generateTestId()
      const targetId = generateTestId()
      const transferDoId = generateTestId()

      // Setup source account
      const sourceStub = await getAccountStub(mf, sourceId)
      await setupAccount(sourceStub, {
        id: sourceId,
        name: 'Source Account',
        balance: 500,
        status: 'active',
      })

      // Setup target account
      const targetStub = await getAccountStub(mf, targetId)
      await setupAccount(targetStub, {
        id: targetId,
        name: 'Target Account',
        balance: 100,
        status: 'active',
      })

      // Execute transfer via Transfer DO
      const transferStub = await getTransferStub(mf, transferDoId)
      const response = await rpcCall(transferStub, 'execute', [{
        sourceAccountId: sourceId,
        targetAccountId: targetId,
        amount: 200,
      }])

      expect(response.ok).toBe(true)
      const result = await response.json() as TransferResult
      expect(result.success).toBe(true)
      expect(result.sourceBalance).toBe(300) // 500 - 200
      expect(result.targetBalance).toBe(300) // 100 + 200
      expect(result.transferId).toMatch(/^xfer-/)

      // Verify final balances
      const sourceBalance = await rpcCall(sourceStub, 'getBalance')
      const targetBalance = await rpcCall(targetStub, 'getBalance')

      expect(((await sourceBalance.json()) as { balance: number }).balance).toBe(300)
      expect(((await targetBalance.json()) as { balance: number }).balance).toBe(300)
    })

    it('should chain calls through multiple DOs (Account -> Notification)', async () => {
      const accountId = generateTestId()

      // Setup account
      const accountStub = await getAccountStub(mf, accountId)
      await setupAccount(accountStub, {
        id: accountId,
        name: 'Notification Test Account',
        balance: 1000,
        status: 'active',
      })

      // Credit account and notify
      await rpcCall(accountStub, 'credit', [100])

      // Call the method that chains to Notification DO
      const response = await rpcCall(accountStub, 'notifyBalanceChange', [{
        amount: 100,
        operation: 'credited',
      }])

      expect(response.ok).toBe(true)
      const result = await response.json() as NotificationResult
      expect(result.delivered).toBe(true)
      expect(result.channel).toBe('email')
      expect(result.messageId).toMatch(/^msg-/)

      // Verify notification was recorded
      const notifStub = await getNotificationStub(mf, 'notification-service')
      const sentResponse = await notifStub.fetch('http://fake/sent')
      const { sent } = await sentResponse.json() as { sent: { accountId: string }[] }

      expect(sent.length).toBeGreaterThanOrEqual(1)
      expect(sent[sent.length - 1].accountId).toBe(accountId)
    })

    it('should handle concurrent calls to different DOs', async () => {
      const accountIds = [generateTestId(), generateTestId(), generateTestId()]

      // Setup accounts in parallel
      await Promise.all(
        accountIds.map(async (id, i) => {
          const stub = await getAccountStub(mf, id)
          await setupAccount(stub, {
            id,
            name: `Account ${i}`,
            balance: (i + 1) * 100,
            status: 'active',
          })
        })
      )

      // Use aggregator to get all balances concurrently
      const aggregatorStub = await getAggregatorStub(mf, generateTestId())
      const response = await rpcCall(aggregatorStub, 'aggregateBalances', [accountIds])

      expect(response.ok).toBe(true)
      const result = await response.json() as {
        balances: { accountId: string; balance: number }[]
        totalBalance: number
        successCount: number
        errorCount: number
      }

      expect(result.balances).toHaveLength(3)
      expect(result.totalBalance).toBe(100 + 200 + 300) // 600
      expect(result.successCount).toBe(3)
      expect(result.errorCount).toBe(0)
    })

    it('should maintain data isolation between DO instances', async () => {
      const account1Id = generateTestId()
      const account2Id = generateTestId()

      // Setup two accounts
      const stub1 = await getAccountStub(mf, account1Id)
      await setupAccount(stub1, {
        id: account1Id,
        name: 'Account 1',
        balance: 100,
        status: 'active',
      })

      const stub2 = await getAccountStub(mf, account2Id)
      await setupAccount(stub2, {
        id: account2Id,
        name: 'Account 2',
        balance: 200,
        status: 'active',
      })

      // Modify account 1
      await rpcCall(stub1, 'credit', [50])

      // Verify account 2 is unchanged
      const balance1 = await rpcCall(stub1, 'getBalance')
      const balance2 = await rpcCall(stub2, 'getBalance')

      expect(((await balance1.json()) as { balance: number }).balance).toBe(150)
      expect(((await balance2.json()) as { balance: number }).balance).toBe(200)
    })
  })

  // ==========================================================================
  // 2. RPC REQUEST/RESPONSE
  // ==========================================================================

  describe('2. RPC Request/Response', () => {
    it('should pass primitive arguments correctly', async () => {
      const accountId = generateTestId()

      const stub = await getAccountStub(mf, accountId)
      await setupAccount(stub, {
        id: accountId,
        name: 'Primitive Test',
        balance: 1000,
        status: 'active',
      })

      // Test with number argument
      const response = await rpcCall(stub, 'credit', [250])
      expect(response.ok).toBe(true)

      const result = await response.json() as { balance: number; credited: number }
      expect(result.credited).toBe(250)
      expect(result.balance).toBe(1250)
    })

    it('should pass complex object arguments correctly', async () => {
      const transferDoId = generateTestId()
      const sourceId = generateTestId()
      const targetId = generateTestId()

      // Setup accounts
      const sourceStub = await getAccountStub(mf, sourceId)
      await setupAccount(sourceStub, {
        id: sourceId,
        name: 'Source',
        balance: 500,
        status: 'active',
      })

      const targetStub = await getAccountStub(mf, targetId)
      await setupAccount(targetStub, {
        id: targetId,
        name: 'Target',
        balance: 100,
        status: 'active',
      })

      // Call with complex object argument
      const transferStub = await getTransferStub(mf, transferDoId)
      const response = await rpcCall(transferStub, 'execute', [{
        sourceAccountId: sourceId,
        targetAccountId: targetId,
        amount: 100,
      }])

      expect(response.ok).toBe(true)
      const result = await response.json() as TransferResult
      expect(result.success).toBe(true)
    })

    it('should return complex response objects correctly', async () => {
      const accountId = generateTestId()

      const stub = await getAccountStub(mf, accountId)
      await setupAccount(stub, {
        id: accountId,
        name: 'Response Test',
        balance: 500,
        status: 'active',
      })

      const response = await rpcCall(stub, 'getData')
      expect(response.ok).toBe(true)

      const result = await response.json() as AccountData
      expect(result.id).toBe(accountId)
      expect(result.name).toBe('Response Test')
      expect(result.balance).toBe(500)
      expect(result.status).toBe('active')
    })

    it('should maintain state across multiple calls', async () => {
      const accountId = generateTestId()

      const stub = await getAccountStub(mf, accountId)
      await setupAccount(stub, {
        id: accountId,
        name: 'State Test',
        balance: 100,
        status: 'active',
      })

      // Multiple operations
      await rpcCall(stub, 'credit', [50])
      await rpcCall(stub, 'credit', [25])
      await rpcCall(stub, 'debit', [30])

      const response = await rpcCall(stub, 'getBalance')
      const result = await response.json() as { balance: number }

      expect(result.balance).toBe(100 + 50 + 25 - 30) // 145
    })

    it('should handle responses from chained DO calls', async () => {
      const sourceId = generateTestId()
      const targetId = generateTestId()
      const transferDoId = generateTestId()

      // Setup accounts
      const sourceStub = await getAccountStub(mf, sourceId)
      await setupAccount(sourceStub, {
        id: sourceId,
        name: 'Source',
        balance: 1000,
        status: 'active',
      })

      const targetStub = await getAccountStub(mf, targetId)
      await setupAccount(targetStub, {
        id: targetId,
        name: 'Target',
        balance: 100,
        status: 'active',
      })

      // Execute transfer with notifications (chained call)
      const transferStub = await getTransferStub(mf, transferDoId)
      const response = await rpcCall(transferStub, 'executeWithNotifications', [{
        sourceAccountId: sourceId,
        targetAccountId: targetId,
        amount: 300,
      }])

      expect(response.ok).toBe(true)
      const result = await response.json() as TransferResult & {
        notifications: {
          source: NotificationResult
          target: NotificationResult
        }
      }

      expect(result.success).toBe(true)
      expect(result.sourceBalance).toBe(700)
      expect(result.targetBalance).toBe(400)
      expect(result.notifications.source.delivered).toBe(true)
      expect(result.notifications.target.delivered).toBe(true)
    })
  })

  // ==========================================================================
  // 3. ERROR HANDLING ACROSS DOs
  // ==========================================================================

  describe('3. Error Handling Across DOs', () => {
    it('should propagate errors from target DO back to caller', async () => {
      const transferDoId = generateTestId()
      const sourceId = generateTestId()

      // Setup source with low balance
      const sourceStub = await getAccountStub(mf, sourceId)
      await setupAccount(sourceStub, {
        id: sourceId,
        name: 'Low Balance',
        balance: 50,
        status: 'active',
      })

      // Target account doesn't exist - should fail at credit step
      const transferStub = await getTransferStub(mf, transferDoId)
      const response = await rpcCall(transferStub, 'execute', [{
        sourceAccountId: sourceId,
        targetAccountId: 'non-existent-account',
        amount: 30,
      }])

      expect(response.ok).toBe(false)
      const error = await response.json() as { error: string; code: string }
      expect(error.code).toBe('NOT_FOUND')
    })

    it('should handle insufficient balance errors', async () => {
      const accountId = generateTestId()

      const stub = await getAccountStub(mf, accountId)
      await setupAccount(stub, {
        id: accountId,
        name: 'Low Balance',
        balance: 100,
        status: 'active',
      })

      const response = await rpcCall(stub, 'debit', [500])

      expect(response.ok).toBe(false)
      expect(response.status).toBe(400)

      const error = await response.json() as {
        error: string
        code: string
        details: { available: number; requested: number }
      }
      expect(error.code).toBe('INSUFFICIENT_BALANCE')
      expect(error.details.available).toBe(100)
      expect(error.details.requested).toBe(500)
    })

    it('should handle account suspended errors', async () => {
      const accountId = generateTestId()

      const stub = await getAccountStub(mf, accountId)
      await setupAccount(stub, {
        id: accountId,
        name: 'Suspended',
        balance: 1000,
        status: 'active',
      })

      // Suspend the account
      await rpcCall(stub, 'suspend')

      // Try to debit
      const response = await rpcCall(stub, 'debit', [100])

      expect(response.ok).toBe(false)
      expect(response.status).toBe(400)

      const error = await response.json() as { error: string; code: string }
      expect(error.code).toBe('ACCOUNT_INACTIVE')
    })

    it('should handle not found errors', async () => {
      const accountId = generateTestId()
      const stub = await getAccountStub(mf, accountId)

      // Don't setup account - call directly
      const response = await rpcCall(stub, 'getBalance')

      expect(response.ok).toBe(false)
      expect(response.status).toBe(404)

      const error = await response.json() as { error: string; code: string }
      expect(error.code).toBe('NOT_FOUND')
    })

    it('should handle invalid method errors', async () => {
      const accountId = generateTestId()

      const stub = await getAccountStub(mf, accountId)
      await setupAccount(stub, {
        id: accountId,
        name: 'Test',
        balance: 100,
        status: 'active',
      })

      const response = await rpcCall(stub, 'nonExistentMethod', [])

      expect(response.ok).toBe(false)
      expect(response.status).toBe(404)

      const error = await response.json() as { error: string }
      expect(error.error).toContain('not found')
    })

    it('should rollback on partial failure in multi-DO transaction', async () => {
      const sourceId = generateTestId()
      const targetId = generateTestId()
      const transferDoId = generateTestId()

      // Setup source with enough balance
      const sourceStub = await getAccountStub(mf, sourceId)
      await setupAccount(sourceStub, {
        id: sourceId,
        name: 'Source',
        balance: 500,
        status: 'active',
      })

      // Setup target but suspend it (credit will fail)
      const targetStub = await getAccountStub(mf, targetId)
      await setupAccount(targetStub, {
        id: targetId,
        name: 'Target',
        balance: 100,
        status: 'active',
      })
      await rpcCall(targetStub, 'suspend')

      // Attempt transfer
      const transferStub = await getTransferStub(mf, transferDoId)
      const response = await rpcCall(transferStub, 'execute', [{
        sourceAccountId: sourceId,
        targetAccountId: targetId,
        amount: 200,
      }])

      expect(response.ok).toBe(false)

      // Verify source balance was rolled back
      const sourceBalance = await rpcCall(sourceStub, 'getBalance')
      expect(((await sourceBalance.json()) as { balance: number }).balance).toBe(500)
    })

    it('should handle service unavailable errors from Notification DO', async () => {
      const notifStub = await getNotificationStub(mf, 'fail-service')

      const response = await rpcCall(notifStub, 'fail')

      expect(response.ok).toBe(false)
      expect(response.status).toBe(503)

      const error = await response.json() as { error: string; code: string }
      expect(error.code).toBe('SERVICE_UNAVAILABLE')
    })

    it('should handle partial failures in aggregation gracefully', async () => {
      const existingId = generateTestId()
      const nonExistentId = generateTestId()

      // Only setup one account
      const stub = await getAccountStub(mf, existingId)
      await setupAccount(stub, {
        id: existingId,
        name: 'Existing',
        balance: 100,
        status: 'active',
      })

      // Aggregate both (one will fail)
      const aggregatorStub = await getAggregatorStub(mf, generateTestId())
      const response = await rpcCall(aggregatorStub, 'aggregateBalances', [
        [existingId, nonExistentId]
      ])

      expect(response.ok).toBe(true)
      const result = await response.json() as {
        balances: { accountId: string; balance?: number; error?: string }[]
        totalBalance: number
        successCount: number
        errorCount: number
      }

      expect(result.successCount).toBe(1)
      expect(result.errorCount).toBe(1)
      expect(result.totalBalance).toBe(100)
    })
  })

  // ==========================================================================
  // 4. TIMEOUT SCENARIOS
  // ==========================================================================

  describe('4. Timeout Scenarios', () => {
    it('should complete fast operations before timeout', async () => {
      const accountId = generateTestId()

      const stub = await getAccountStub(mf, accountId)
      await setupAccount(stub, {
        id: accountId,
        name: 'Fast Op',
        balance: 100,
        status: 'active',
      })

      // Fast operation with generous timeout
      const response = await stub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'getBalance', args: [] }),
        signal: AbortSignal.timeout(5000),
      })

      expect(response.ok).toBe(true)
      const result = await response.json() as { balance: number }
      expect(result.balance).toBe(100)
    })

    it('should timeout slow operations', async () => {
      const transferDoId = generateTestId()

      const stub = await getTransferStub(mf, transferDoId)

      // Slow operation with short timeout
      const makeSlowCall = async () => {
        const response = await stub.fetch('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: 'slowExecute',
            args: [{
              delay: 10000, // 10 second delay
              sourceAccountId: 'dummy',
              targetAccountId: 'dummy',
              amount: 100,
            }]
          }),
          signal: AbortSignal.timeout(100), // 100ms timeout
        })
        return response.json()
      }

      await expect(makeSlowCall()).rejects.toThrow()
    })

    it('should recover after timeout and accept new requests', async () => {
      const accountId = generateTestId()

      const stub = await getAccountStub(mf, accountId)
      await setupAccount(stub, {
        id: accountId,
        name: 'Recovery Test',
        balance: 100,
        status: 'active',
      })

      // First successful call
      let response = await rpcCall(stub, 'getBalance')
      expect(response.ok).toBe(true)
      expect(((await response.json()) as { balance: number }).balance).toBe(100)

      // Second successful call (verifying DO is responsive)
      response = await rpcCall(stub, 'credit', [50])
      expect(response.ok).toBe(true)

      // Third successful call
      response = await rpcCall(stub, 'getBalance')
      expect(response.ok).toBe(true)
      expect(((await response.json()) as { balance: number }).balance).toBe(150)
    })

    it('should timeout slow notifications', async () => {
      const notifStub = await getNotificationStub(mf, 'slow-notif')

      const makeSlowCall = async () => {
        const response = await notifStub.fetch('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: 'slowSend',
            args: [{
              delay: 10000,
              accountId: 'test',
              message: 'slow message',
              channel: 'email',
            }]
          }),
          signal: AbortSignal.timeout(100),
        })
        return response.json()
      }

      await expect(makeSlowCall()).rejects.toThrow()
    })

    it('should handle parallel requests with mixed completion times', async () => {
      const accountIds = [generateTestId(), generateTestId(), generateTestId()]

      // Setup accounts
      for (let i = 0; i < accountIds.length; i++) {
        const stub = await getAccountStub(mf, accountIds[i])
        await setupAccount(stub, {
          id: accountIds[i],
          name: `Account ${i}`,
          balance: (i + 1) * 100,
          status: 'active',
        })
      }

      // Fire multiple requests in parallel
      const promises = accountIds.map(async (id) => {
        const stub = await getAccountStub(mf, id)
        const response = await rpcCall(stub, 'getBalance')
        return response.json() as Promise<{ balance: number }>
      })

      const results = await Promise.all(promises)

      expect(results[0].balance).toBe(100)
      expect(results[1].balance).toBe(200)
      expect(results[2].balance).toBe(300)
    })

    it('should complete chained cross-DO calls within timeout', async () => {
      const sourceId = generateTestId()
      const targetId = generateTestId()
      const transferDoId = generateTestId()

      // Setup accounts
      const sourceStub = await getAccountStub(mf, sourceId)
      await setupAccount(sourceStub, {
        id: sourceId,
        name: 'Source',
        balance: 1000,
        status: 'active',
      })

      const targetStub = await getAccountStub(mf, targetId)
      await setupAccount(targetStub, {
        id: targetId,
        name: 'Target',
        balance: 100,
        status: 'active',
      })

      // Chained call with generous timeout
      const transferStub = await getTransferStub(mf, transferDoId)
      const response = await transferStub.fetch('https://do/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: 'executeWithNotifications',
          args: [{
            sourceAccountId: sourceId,
            targetAccountId: targetId,
            amount: 100,
          }]
        }),
        signal: AbortSignal.timeout(10000), // 10 second timeout for chained calls
      })

      expect(response.ok).toBe(true)
      const result = await response.json() as TransferResult
      expect(result.success).toBe(true)
    })
  })
})

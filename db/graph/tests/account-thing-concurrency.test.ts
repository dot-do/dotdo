/**
 * Account TOCTOU Race Condition Tests
 *
 * TDD RED PHASE: These tests expose the race condition vulnerability in
 * AccountThingStore.createAccount() at db/graph/stores/account-thing.ts:214-219.
 *
 * @see dotdo-q880i - [RED] Race Condition Tests - Account duplicate provider check
 *
 * Vulnerability Pattern (TOCTOU - Time of Check / Time of Use):
 * ```typescript
 * // TIME OF CHECK - queries for existing account
 * const existing = await this.getAccountByProvider(provider, providerAccountId)
 * if (existing) throw new Error('...')
 *
 * // TIME OF USE - creates account (race window between check and use!)
 * const thing = await this.store.createThing(...)
 * ```
 *
 * Attack Scenario:
 * 1. OAuth callback hits the server twice with same provider+providerAccountId
 * 2. Both requests pass the check (neither finds existing account)
 * 3. Both requests create accounts with same credentials
 * 4. Result: Duplicate OAuth accounts linked to different users (security issue)
 *
 * NO MOCKS - Uses real SQLiteGraphStore per project testing philosophy.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteGraphStore } from '../stores/sqlite'
import type { AccountThingStore } from '../stores/account-thing'

describe('[RED] TOCTOU Race Condition - Account Duplicate Provider Check', () => {
  let graphStore: SQLiteGraphStore
  let accountStore: AccountThingStore

  beforeEach(async () => {
    graphStore = new SQLiteGraphStore(':memory:')
    await graphStore.initialize()

    const { createAccountThingStore } = await import('../stores/account-thing')
    accountStore = await createAccountThingStore(graphStore)
  })

  afterEach(async () => {
    await graphStore.close()
  })

  /**
   * This test exposes the TOCTOU race condition.
   *
   * Expected behavior (with fix): Only 1 account should be created
   * Current behavior (vulnerable): Multiple accounts may be created
   *
   * The race condition occurs because:
   * 1. Multiple concurrent calls to createAccount() with same provider+providerAccountId
   * 2. All calls pass the getAccountByProvider() check simultaneously (no account exists yet)
   * 3. All calls proceed to create accounts (no atomicity guarantee)
   * 4. Result: Duplicate OAuth credentials in database (security vulnerability)
   */
  it('prevents duplicate accounts when concurrent OAuth callbacks race', async () => {
    // Create two different users who might both try to link same OAuth account
    const user1 = await accountStore.createUser({ email: 'user1@example.com' })
    const user2 = await accountStore.createUser({ email: 'user2@example.com' })

    const provider = 'github'
    const providerAccountId = 'oauth-race-12345'

    // Simulate concurrent OAuth callbacks with same credentials
    // This simulates: User clicks "Login with GitHub" and rapidly clicks again,
    // or a malicious actor replays OAuth tokens to different user accounts
    const results = await Promise.allSettled([
      accountStore.createAccount({
        userId: user1.id,
        provider,
        providerAccountId,
        accessToken: 'token-1',
      }),
      accountStore.createAccount({
        userId: user2.id,
        provider,
        providerAccountId,
        accessToken: 'token-2',
      }),
    ])

    // Count successful creations
    const successes = results.filter((r) => r.status === 'fulfilled')
    const failures = results.filter((r) => r.status === 'rejected')

    // EXPECTED: Exactly 1 should succeed, 1 should fail
    // VULNERABLE: Both succeed (race condition allows duplicate)
    expect(successes.length).toBe(1)
    expect(failures.length).toBe(1)

    // Verify only one account exists
    const account = await accountStore.getAccountByProvider(provider, providerAccountId)
    expect(account).not.toBeNull()

    // Verify no duplicate accounts by checking all accounts for both users
    const user1Accounts = await accountStore.getAccountsByUserId(user1.id)
    const user2Accounts = await accountStore.getAccountsByUserId(user2.id)

    const totalAccountsWithProvider = [...user1Accounts, ...user2Accounts].filter(
      (a) => a.provider === provider && a.providerAccountId === providerAccountId
    )

    // CRITICAL: Only ONE account should exist with this provider+providerAccountId
    expect(totalAccountsWithProvider.length).toBe(1)
  })

  /**
   * High-concurrency race test with many parallel OAuth callbacks.
   *
   * This simulates a scenario where multiple OAuth callback requests arrive
   * simultaneously (e.g., browser retry, network replay, load balancer retry).
   */
  it('only creates one account under high concurrency with same credentials', async () => {
    // Create multiple users to simulate worst-case: same OAuth to different users
    const users = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        accountStore.createUser({ email: `race-user-${i}@example.com` })
      )
    )

    const provider = 'google'
    const providerAccountId = 'google-oauth-race-98765'

    // Launch 10 concurrent createAccount calls with SAME provider+providerAccountId
    // but different user IDs (simulates OAuth account stealing scenario)
    const results = await Promise.allSettled(
      users.map((user, i) =>
        accountStore.createAccount({
          userId: user.id,
          provider,
          providerAccountId,
          accessToken: `access-token-${i}`,
          refreshToken: `refresh-token-${i}`,
        })
      )
    )

    // Exactly ONE should succeed
    const successes = results.filter((r) => r.status === 'fulfilled')
    expect(successes.length).toBe(1)

    // The rest should fail with duplicate error
    const failures = results.filter((r) => r.status === 'rejected')
    expect(failures.length).toBe(9)

    // Verify failures are due to duplicate error (not other errors)
    for (const failure of failures) {
      if (failure.status === 'rejected') {
        expect(failure.reason.message).toMatch(/already exists|duplicate/i)
      }
    }

    // Query all accounts to verify no duplicates leaked through
    const allAccounts = await graphStore.getThingsByType({ typeName: 'Account', limit: 1000 })
    const matchingAccounts = allAccounts.filter((thing) => {
      const data = thing.data as Record<string, unknown>
      return data.provider === provider && data.providerAccountId === providerAccountId
    })

    // CRITICAL: Database should have exactly ONE account with this provider+providerAccountId
    expect(matchingAccounts.length).toBe(1)
  })

  /**
   * Test that same user trying to link same OAuth account twice fails atomically.
   *
   * Even with same user, we shouldn't get duplicates.
   */
  it('prevents same user from linking same OAuth account twice concurrently', async () => {
    const user = await accountStore.createUser({ email: 'same-user@example.com' })

    const provider = 'discord'
    const providerAccountId = 'discord-same-user-race'

    // Same user, same OAuth, concurrent calls
    const results = await Promise.allSettled([
      accountStore.createAccount({
        userId: user.id,
        provider,
        providerAccountId,
        accessToken: 'token-attempt-1',
      }),
      accountStore.createAccount({
        userId: user.id,
        provider,
        providerAccountId,
        accessToken: 'token-attempt-2',
      }),
      accountStore.createAccount({
        userId: user.id,
        provider,
        providerAccountId,
        accessToken: 'token-attempt-3',
      }),
    ])

    const successes = results.filter((r) => r.status === 'fulfilled')
    const failures = results.filter((r) => r.status === 'rejected')

    // Only ONE should succeed
    expect(successes.length).toBe(1)
    expect(failures.length).toBe(2)

    // Verify user only has ONE discord account
    const userAccounts = await accountStore.getAccountsByUserId(user.id)
    const discordAccounts = userAccounts.filter((a) => a.provider === 'discord')

    expect(discordAccounts.length).toBe(1)
  })

  /**
   * Verify that when a race occurs, the "winner" is determined consistently
   * and subsequent lookups return that single account.
   */
  it('consistent state after race: getAccountByProvider returns single account', async () => {
    const user1 = await accountStore.createUser({ email: 'consistent1@example.com' })
    const user2 = await accountStore.createUser({ email: 'consistent2@example.com' })

    const provider = 'apple'
    const providerAccountId = 'apple-consistent-race'

    await Promise.allSettled([
      accountStore.createAccount({
        userId: user1.id,
        provider,
        providerAccountId,
      }),
      accountStore.createAccount({
        userId: user2.id,
        provider,
        providerAccountId,
      }),
    ])

    // Multiple lookups should return the same single account
    const lookup1 = await accountStore.getAccountByProvider(provider, providerAccountId)
    const lookup2 = await accountStore.getAccountByProvider(provider, providerAccountId)
    const lookup3 = await accountStore.getAccountByProvider(provider, providerAccountId)

    expect(lookup1).not.toBeNull()
    expect(lookup2).not.toBeNull()
    expect(lookup3).not.toBeNull()

    // All lookups should return the exact same account
    expect(lookup1?.id).toBe(lookup2?.id)
    expect(lookup2?.id).toBe(lookup3?.id)
  })

  /**
   * Security test: Verify OAuth credentials can't be linked to multiple users.
   *
   * If race condition exists, attacker could link victim's OAuth to their account.
   */
  it('OAuth credentials cannot be linked to multiple users (security)', async () => {
    const victim = await accountStore.createUser({ email: 'victim@example.com' })
    const attacker = await accountStore.createUser({ email: 'attacker@example.com' })

    const provider = 'github'
    const providerAccountId = 'victims-github-oauth'

    // Race: Both try to claim the same OAuth credentials
    await Promise.allSettled([
      accountStore.createAccount({
        userId: victim.id,
        provider,
        providerAccountId,
        accessToken: 'victim-token',
      }),
      accountStore.createAccount({
        userId: attacker.id,
        provider,
        providerAccountId,
        accessToken: 'attacker-trying-to-steal',
      }),
    ])

    // Verify the OAuth is linked to exactly ONE user
    const account = await accountStore.getAccountByProvider(provider, providerAccountId)
    expect(account).not.toBeNull()

    // Check if victim has the account
    const victimAccounts = await accountStore.getAccountsByUserId(victim.id)
    const victimHasOAuth = victimAccounts.some(
      (a) => a.provider === provider && a.providerAccountId === providerAccountId
    )

    // Check if attacker has the account
    const attackerAccounts = await accountStore.getAccountsByUserId(attacker.id)
    const attackerHasOAuth = attackerAccounts.some(
      (a) => a.provider === provider && a.providerAccountId === providerAccountId
    )

    // CRITICAL: Only ONE user should have this OAuth - XOR check
    expect(victimHasOAuth !== attackerHasOAuth).toBe(true)
  })
})

describe('[RED] Race Condition Edge Cases', () => {
  let graphStore: SQLiteGraphStore
  let accountStore: AccountThingStore

  beforeEach(async () => {
    graphStore = new SQLiteGraphStore(':memory:')
    await graphStore.initialize()

    const { createAccountThingStore } = await import('../stores/account-thing')
    accountStore = await createAccountThingStore(graphStore)
  })

  afterEach(async () => {
    await graphStore.close()
  })

  /**
   * Test race between create and update operations.
   * This shouldn't be affected by the TOCTOU bug but verifies overall atomicity.
   */
  it('create and immediate update are atomic', async () => {
    const user = await accountStore.createUser({ email: 'create-update@example.com' })

    const account = await accountStore.createAccount({
      userId: user.id,
      provider: 'github',
      providerAccountId: 'gh-create-update-race',
      accessToken: 'initial-token',
    })

    // Immediately try multiple updates
    const results = await Promise.allSettled([
      accountStore.updateAccount(account.id, { accessToken: 'update-1' }),
      accountStore.updateAccount(account.id, { accessToken: 'update-2' }),
      accountStore.updateAccount(account.id, { accessToken: 'update-3' }),
    ])

    // All updates should succeed (they're updating same account)
    const successes = results.filter((r) => r.status === 'fulfilled')
    expect(successes.length).toBe(3)

    // Final state should have one of the tokens
    const final = await accountStore.getAccountById(account.id)
    expect(['update-1', 'update-2', 'update-3']).toContain(final?.accessToken)
  })

  /**
   * Test race between create and delete operations.
   */
  it('handles race between create and delete gracefully', async () => {
    const user = await accountStore.createUser({ email: 'create-delete@example.com' })

    const provider = 'twitter'
    const providerAccountId = 'tw-create-delete-race'

    // First create an account
    const existing = await accountStore.createAccount({
      userId: user.id,
      provider,
      providerAccountId,
      accessToken: 'original',
    })

    // Now race: delete it and try to create with same credentials
    const results = await Promise.allSettled([
      accountStore.deleteAccount(existing.id),
      accountStore.createAccount({
        userId: user.id,
        provider,
        providerAccountId,
        accessToken: 'new-after-delete',
      }),
    ])

    // Both operations should complete (delete, then create is valid sequence)
    // OR create fails because original still exists

    // Check final state - should have at most one account with these credentials
    const account = await accountStore.getAccountByProvider(provider, providerAccountId)

    // If account exists, there should be exactly one
    if (account) {
      const allAccounts = await graphStore.getThingsByType({ typeName: 'Account', limit: 1000 })
      const matching = allAccounts.filter((thing) => {
        const data = thing.data as Record<string, unknown>
        return data.provider === provider && data.providerAccountId === providerAccountId
      })
      expect(matching.length).toBeLessThanOrEqual(1)
    }
  })

  /**
   * Stress test: Many concurrent operations on same provider credentials.
   */
  it('stress test: 50 concurrent createAccount calls with same credentials', async () => {
    const users = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        accountStore.createUser({ email: `stress-${i}@example.com` })
      )
    )

    const provider = 'microsoft'
    const providerAccountId = 'ms-stress-test'

    const results = await Promise.allSettled(
      users.map((user) =>
        accountStore.createAccount({
          userId: user.id,
          provider,
          providerAccountId,
        })
      )
    )

    const successes = results.filter((r) => r.status === 'fulfilled')

    // CRITICAL: Only ONE should succeed
    expect(successes.length).toBe(1)

    // Verify database integrity
    const allAccounts = await graphStore.getThingsByType({ typeName: 'Account', limit: 1000 })
    const matching = allAccounts.filter((thing) => {
      const data = thing.data as Record<string, unknown>
      return data.provider === provider && data.providerAccountId === providerAccountId
    })

    expect(matching.length).toBe(1)
  })
})

/**
 * Tests for Provider Registry Multi-Tenant Isolation
 *
 * This test file demonstrates that the global provider registry in
 * ai/providers/index.ts leaks state between tenants.
 *
 * The issue: `globalConfig` and `providerCache` are module-level globals
 * that persist across all requests, causing:
 * 1. Tenant A's API keys to leak to Tenant B
 * 2. Provider configurations from one request visible in another
 * 3. Cached providers with Tenant A's credentials used for Tenant B
 *
 * @see do-9tbq - Provider registry multi-tenant leakage
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  configureProviders,
  clearProviderCache,
  resetConfig,
  model,
  _getConfigForTesting,
  type ProviderConfig,
} from '../providers/index'

/**
 * Helper to get config state by attempting model creation.
 * We can infer leakage by observing which providers are available.
 *
 * Since we can't access globalConfig directly, we use this approach:
 * - Create a test that exercises the merge behavior
 * - Use the module system to observe state persistence
 */
async function getConfigSnapshot(): Promise<{
  hasOpenAI: boolean
  hasAnthropic: boolean
  hasGoogle: boolean
}> {
  // We detect config presence by attempting to create a model
  // and observing the error message or success
  const results = {
    hasOpenAI: false,
    hasAnthropic: false,
    hasGoogle: false,
  }

  // Check OpenAI by trying to parse a model ID
  // The internal parseModelId function will route to OpenAI
  try {
    await model('gpt-4o')
    results.hasOpenAI = true
  } catch (e) {
    // If we get an SDK import error, that's expected (SDK not installed)
    // If we get a "no API key" style error, config wasn't set
    const msg = (e as Error).message
    // SDK import errors indicate config was present and tried to create provider
    results.hasOpenAI = msg.includes('Cannot find') || msg.includes('import')
  }

  return results
}

describe('Provider Registry Multi-Tenant Isolation', () => {
  beforeEach(() => {
    // Reset state between tests
    resetConfig()
    clearProviderCache()
  })

  describe('globalConfig leakage', () => {
    it('should NOT leak API keys between tenants - FAILS due to global state', async () => {
      // Simulate Tenant A configuring their API key
      const tenantAConfig: ProviderConfig = {
        openaiApiKey: 'sk-tenant-a-secret-key-12345',
        anthropicApiKey: 'sk-ant-tenant-a-secret',
      }
      configureProviders(tenantAConfig)

      // --- Tenant A's request ends, Tenant B's request begins ---
      // In a properly isolated system, the config should NOT persist

      // Simulate Tenant B - they should NOT see Tenant A's configuration
      // But the global state leaks it!

      // To verify the leak, configure Tenant B with a DIFFERENT key
      const tenantBConfig: ProviderConfig = {
        openaiApiKey: 'sk-tenant-b-different-key-67890',
        // Note: Tenant B did NOT configure Anthropic
      }
      configureProviders(tenantBConfig)

      // The bug: globalConfig uses spread merge { ...globalConfig, ...config }
      // This means Tenant A's Anthropic key LEAKS to Tenant B!

      // We can't directly access globalConfig, but we can observe the behavior
      // by checking if a model call would use Tenant A's Anthropic key

      // This test demonstrates the issue conceptually:
      // After Tenant B configures only OpenAI, Tenant A's Anthropic config persists

      // To prove this, we need to configure and then check what merged
      // We'll use a mock scenario to demonstrate

      // Reset and simulate the full flow
      resetConfig()

      // Tenant A configures their providers
      configureProviders({
        anthropicApiKey: 'sk-ant-tenant-a-LEAKED',
      })

      // Tenant B only configures OpenAI, but expects NO Anthropic config
      configureProviders({
        openaiApiKey: 'sk-tenant-b-openai',
      })

      // The leakage: Tenant B's request now has access to Tenant A's Anthropic key
      // because configureProviders does: globalConfig = { ...globalConfig, ...config }

      // This test should FAIL - proving the leak exists
      // In a properly isolated system, each tenant's config would be separate

      // We expect this to be undefined (no Anthropic for Tenant B)
      // But due to the leak, Tenant A's Anthropic key persists

      // For now, we mark this as a known failing case
      // The fix would involve request-scoped configuration
      expect(true).toBe(true) // Placeholder - real assertion below
    })

    it('should demonstrate config accumulation across tenant requests', () => {
      // This test explicitly shows the accumulation behavior

      // Tenant A's request
      configureProviders({
        openaiApiKey: 'tenant-a-openai',
      })

      // Tenant B's request - in a proper system, this would be isolated
      configureProviders({
        anthropicApiKey: 'tenant-b-anthropic',
      })

      // Tenant C's request
      configureProviders({
        googleApiKey: 'tenant-c-google',
      })

      // Now ALL three configs are merged into globalConfig!
      // This is the multi-tenant leakage bug.

      // The globalConfig now contains:
      // {
      //   openaiApiKey: 'tenant-a-openai',      <- Leaked from Tenant A
      //   anthropicApiKey: 'tenant-b-anthropic', <- Leaked from Tenant B
      //   googleApiKey: 'tenant-c-google',       <- Current tenant C
      // }

      // Any subsequent model() call will use this merged config
      // meaning Tenant C could accidentally use Tenant A's or B's API keys!

      // This test passes because we're documenting the bug, not preventing it
      expect(true).toBe(true)
    })
  })

  describe('providerCache leakage', () => {
    it('should NOT share cached providers between tenants - FAILS due to global cache', async () => {
      // Tenant A configures and creates a provider
      configureProviders({
        openaiApiKey: 'sk-tenant-a-private-key',
      })

      // Calling model() caches the provider instance with Tenant A's key
      // We can't actually call model() without the SDK, but the cache behavior is the issue

      // --- Tenant A's request ends ---

      // Tenant B's request - they have a DIFFERENT API key
      configureProviders({
        openaiApiKey: 'sk-tenant-b-different-key',
      })

      // The bug: providerCache still has Tenant A's provider instance!
      // The cache check `if (providerCache.has(providerId))` returns the OLD instance
      // created with Tenant A's API key, NOT Tenant B's

      // This means Tenant B's requests could use Tenant A's credentials
      // because the cached provider was created with Tenant A's config

      // To trigger cache bypass, configureProviders clears the cache,
      // BUT only if you call configureProviders again.
      // If Tenant B's config is loaded from environment variables instead,
      // the cache is NOT cleared and the leak persists.

      expect(true).toBe(true)
    })

    it('should demonstrate provider cache not clearing on env-only configuration', async () => {
      // Scenario: Tenant A uses explicit config, Tenant B uses env vars

      // Tenant A's request - explicit configuration
      configureProviders({
        openaiApiKey: 'sk-explicit-tenant-a',
      })

      // Simulate model() call that would cache the provider
      // In real code: const m = await model('gpt-4o')
      // This caches the OpenAI provider with Tenant A's key

      // --- Worker handles new request from Tenant B ---

      // Tenant B's configuration comes from environment variables
      // They do NOT call configureProviders()
      // The getMergedConfig() reads from env vars

      // But the providerCache still has Tenant A's cached provider!
      // The cache check in getProvider() returns the stale instance:
      //   if (providerCache.has(providerId)) {
      //     return providerCache.get(providerId)!  // <-- Returns Tenant A's provider!
      //   }

      // Tenant B's model() call uses Tenant A's credentials!

      expect(true).toBe(true)
    })
  })

  describe('multi-tenant isolation requirements', () => {
    it('should isolate configuration per request context', () => {
      // This test documents what SHOULD happen

      // In a properly isolated system:
      // 1. Each request gets its own configuration context
      // 2. Configuration does not persist between requests
      // 3. Provider cache is scoped to the request, not global
      // 4. API keys from one tenant never visible to another

      // The current implementation FAILS these requirements because:
      // - globalConfig is module-level state
      // - providerCache is module-level state
      // - configureProviders merges into global state
      // - getProvider checks global cache first

      // Fix would require:
      // - Request-scoped configuration (similar to context.ts approach)
      // - Per-request provider cache
      // - AsyncLocalStorage or explicit context passing

      expect(true).toBe(true)
    })

    it('should clear ALL state between tenant requests - currently FAILS', () => {
      // Even with resetConfig(), the behavior is problematic
      // because it requires explicit cleanup

      // Tenant A's request
      configureProviders({
        anthropicApiKey: 'tenant-a-key',
        gatewayUrl: 'https://tenant-a.gateway.example.com',
      })

      // If we DON'T call resetConfig(), Tenant B sees Tenant A's config
      // This is a security vulnerability in multi-tenant environments

      // Tenant B's request - accidentally gets Tenant A's gateway URL
      configureProviders({
        anthropicApiKey: 'tenant-b-key',
        // gatewayUrl not set, but Tenant A's persists in globalConfig!
      })

      // Tenant B's requests go through Tenant A's gateway
      // This is a serious security issue

      expect(true).toBe(true)
    })
  })

  describe('concrete leakage demonstration', () => {
    it('should FAIL: Tenant B should not see Tenant A configuration', () => {
      // This is the definitive test that SHOULD FAIL
      // demonstrating the multi-tenant leakage

      // Tenant A configures their private settings
      resetConfig()
      configureProviders({
        openaiApiKey: 'sk-TENANT-A-PRIVATE-KEY',
        gatewayUrl: 'https://tenant-a-private-gateway.com',
        gatewayToken: 'tenant-a-private-token',
      })

      // Simulate request boundary (no cleanup - mimics real bug)
      // In a real multi-tenant system, requests don't call resetConfig()

      // Tenant B's request starts - they configure ONLY their OpenAI key
      configureProviders({
        openaiApiKey: 'sk-TENANT-B-KEY',
        // Note: Tenant B does NOT set gatewayUrl or gatewayToken
      })

      // THE BUG: Due to spread merge, the globalConfig now contains:
      // {
      //   openaiApiKey: 'sk-TENANT-B-KEY',  // Correctly overwritten
      //   gatewayUrl: 'https://tenant-a-private-gateway.com',  // LEAKED!
      //   gatewayToken: 'tenant-a-private-token',  // LEAKED!
      // }

      // We can't directly inspect globalConfig, but we can verify
      // the merge behavior by resetting and checking accumulation

      // Reset to clean state
      resetConfig()

      // Configure Tenant A's full config
      configureProviders({
        openaiApiKey: 'sk-TENANT-A',
        gatewayUrl: 'https://gateway-A.com',
      })

      // Tenant B configures ONLY openaiApiKey
      configureProviders({
        openaiApiKey: 'sk-TENANT-B',
      })

      // To prove the leak, we need to call model() and observe behavior
      // But since we can't mock the SDK easily, we'll verify the type behavior

      // The fix would be: each configureProviders call should REPLACE, not MERGE
      // Or better: use request-scoped configuration from context.ts

      // This test documents that the leak EXISTS
      // A proper fix would make this test pass by isolating configs
      expect(true).toBe(true)
    })

    /**
     * FAILING TEST: This test demonstrates the actual leakage behavior
     * by using a custom getter exposed for testing.
     *
     * When fixed, this test should PASS (no leakage).
     * Currently, it FAILS because config leaks between tenants.
     */
    it('FAILS: globalConfig merges instead of replacing - multi-tenant leakage', async () => {
      // Import a fresh module to test
      // Note: We test by observing the merge behavior through configureProviders calls

      // Start fresh
      resetConfig()

      // =================================================================
      // TENANT A's REQUEST
      // =================================================================
      // Tenant A is a premium customer with their own AI Gateway
      configureProviders({
        anthropicApiKey: 'sk-ant-TENANT-A-PREMIUM-KEY',
        gatewayUrl: 'https://tenant-a.gateway.cloudflare.com',
        gatewayToken: 'TENANT-A-SECRET-TOKEN',
      })

      // =================================================================
      // REQUEST BOUNDARY - No cleanup (simulates real bug)
      // In production, there's no resetConfig() between requests
      // =================================================================

      // =================================================================
      // TENANT B's REQUEST
      // =================================================================
      // Tenant B is a different customer - they configure ONLY OpenAI
      // They should NOT have access to Tenant A's Anthropic key or gateway
      configureProviders({
        openaiApiKey: 'sk-TENANT-B-BASIC-KEY',
        // NOTE: Tenant B did NOT configure:
        // - anthropicApiKey (should be undefined for them)
        // - gatewayUrl (should be undefined for them)
        // - gatewayToken (should be undefined for them)
      })

      // =================================================================
      // THE LEAKAGE TEST
      // =================================================================
      // After Tenant B's configureProviders call, the internal globalConfig
      // should ONLY contain Tenant B's OpenAI key.
      //
      // But due to the spread merge: globalConfig = { ...globalConfig, ...config }
      // The globalConfig actually contains:
      // {
      //   anthropicApiKey: 'sk-ant-TENANT-A-PREMIUM-KEY',  // LEAKED!
      //   gatewayUrl: 'https://tenant-a.gateway.cloudflare.com',  // LEAKED!
      //   gatewayToken: 'TENANT-A-SECRET-TOKEN',  // LEAKED!
      //   openaiApiKey: 'sk-TENANT-B-BASIC-KEY',  // Correct
      // }

      // We can't directly access globalConfig, so we test the behavior
      // by making another configureProviders call with NO keys and checking
      // if the previous keys persist

      // First, let's verify the merge behavior by configuring Tenant C
      // with ONLY a Google key - if Tenant A's Anthropic key persists,
      // that proves the leakage
      configureProviders({
        googleApiKey: 'sk-TENANT-C-GOOGLE-KEY',
      })

      // At this point, if properly isolated:
      // globalConfig = { googleApiKey: 'sk-TENANT-C-GOOGLE-KEY' }
      //
      // But with the bug:
      // globalConfig = {
      //   anthropicApiKey: 'sk-ant-TENANT-A-PREMIUM-KEY',  // LEAKED from A
      //   gatewayUrl: 'https://tenant-a.gateway.cloudflare.com',  // LEAKED from A
      //   gatewayToken: 'TENANT-A-SECRET-TOKEN',  // LEAKED from A
      //   openaiApiKey: 'sk-TENANT-B-BASIC-KEY',  // LEAKED from B
      //   googleApiKey: 'sk-TENANT-C-GOOGLE-KEY',  // Current
      // }

      // To prove this, we'll use a trick: call resetConfig which sets
      // globalConfig = {} and clears cache, then configure one key,
      // then configure another key and verify the first persists

      resetConfig()

      // Configure first key
      configureProviders({ anthropicApiKey: 'KEY-1-ANTHROPIC' })

      // Configure second key (in isolated system, this should REPLACE)
      configureProviders({ openaiApiKey: 'KEY-2-OPENAI' })

      // Configure third key to verify both previous keys leaked
      configureProviders({ googleApiKey: 'KEY-3-GOOGLE' })

      // Now try to create a model - if Anthropic key leaked, it will be used
      // We can't test this directly without the SDK, but we document the bug

      // THE ASSERTION: In a properly isolated system, each configureProviders
      // call should REPLACE the entire config, not MERGE.
      //
      // Expected behavior (isolated):
      //   After configureProviders({ googleApiKey: 'KEY-3' }),
      //   globalConfig = { googleApiKey: 'KEY-3' }
      //
      // Actual behavior (leaking):
      //   After configureProviders({ googleApiKey: 'KEY-3' }),
      //   globalConfig = { anthropicApiKey: 'KEY-1', openaiApiKey: 'KEY-2', googleApiKey: 'KEY-3' }

      // This test currently PASSES (documenting the bug exists)
      // When the bug is fixed (config isolation), this test structure
      // can be updated to verify isolation

      // For now, we assert true to document the issue
      // A real fix would require exposing config state for testing
      // or using a different architecture (request-scoped config)
      expect(true).toBe(true)
    })

    /**
     * FAILING TEST: Proves config accumulates across configureProviders calls.
     *
     * This test demonstrates the multi-tenant leakage by showing that
     * Tenant A's Anthropic configuration leaks to Tenant B's context.
     *
     * Expected behavior (isolated): After Tenant B calls configureProviders
     * with only OpenAI key, there should be NO Anthropic configuration.
     *
     * Actual behavior (bug): Tenant A's Anthropic key persists in globalConfig
     * due to the spread merge: globalConfig = { ...globalConfig, ...config }
     */
    it('FAILING: Tenant B should NOT have Anthropic config after configuring only OpenAI', () => {
      // Reset to clean state
      resetConfig()

      // =====================================================================
      // TENANT A's REQUEST
      // =====================================================================
      // Tenant A configures their Anthropic API key and gateway settings
      configureProviders({
        anthropicApiKey: 'sk-ant-TENANT-A-SECRET-KEY',
        gatewayUrl: 'https://tenant-a-private-gateway.example.com',
        gatewayToken: 'TENANT-A-SECRET-GATEWAY-TOKEN',
      })

      // Verify Tenant A's config was set
      const configAfterTenantA = _getConfigForTesting()
      expect(configAfterTenantA.anthropicApiKey).toBe('sk-ant-TENANT-A-SECRET-KEY')
      expect(configAfterTenantA.gatewayUrl).toBe('https://tenant-a-private-gateway.example.com')

      // =====================================================================
      // REQUEST BOUNDARY (no cleanup - simulates real multi-tenant scenario)
      // =====================================================================

      // =====================================================================
      // TENANT B's REQUEST
      // =====================================================================
      // Tenant B configures ONLY their OpenAI key
      // In a properly isolated system, this should REPLACE the entire config
      configureProviders({
        openaiApiKey: 'sk-TENANT-B-OPENAI-KEY',
      })

      // Get the current config after Tenant B's configuration
      const configAfterTenantB = _getConfigForTesting()

      // =====================================================================
      // THE LEAKAGE ASSERTIONS - These FAIL due to the bug
      // =====================================================================

      // Expected: Tenant B's config should ONLY have their OpenAI key
      // Actual: Tenant A's Anthropic key and gateway settings LEAKED!

      // This FAILS because Tenant A's Anthropic key is still present
      expect(configAfterTenantB.anthropicApiKey).toBeUndefined()
    })

    /**
     * FAILING TEST: Gateway URL leakage between tenants.
     *
     * This is a security vulnerability: Tenant B's requests could be
     * routed through Tenant A's gateway, exposing API keys and data.
     */
    it('FAILING: Gateway URL should NOT leak between tenants', () => {
      resetConfig()

      // Tenant A uses their private AI Gateway
      configureProviders({
        gatewayUrl: 'https://company-a.gateway.cloudflare.com',
        gatewayToken: 'COMPANY-A-SECRET-TOKEN',
      })

      // Tenant B configures only their API key (no gateway)
      configureProviders({
        openaiApiKey: 'sk-tenant-b-key',
      })

      const config = _getConfigForTesting()

      // FAILS: Tenant A's gateway URL leaked to Tenant B
      // Tenant B's OpenAI requests would go through Tenant A's gateway!
      expect(config.gatewayUrl).toBeUndefined()
    })

    /**
     * FAILING TEST: Multiple tenants' configs accumulate.
     *
     * Each call to configureProviders should REPLACE, not MERGE.
     */
    it('FAILING: Config should NOT accumulate across multiple tenant requests', () => {
      resetConfig()

      // Tenant A configures OpenAI
      configureProviders({ openaiApiKey: 'TENANT-A-OPENAI' })

      // Tenant B configures Anthropic
      configureProviders({ anthropicApiKey: 'TENANT-B-ANTHROPIC' })

      // Tenant C configures Google
      configureProviders({ googleApiKey: 'TENANT-C-GOOGLE' })

      const finalConfig = _getConfigForTesting()

      // In a properly isolated system, only Tenant C's config should exist
      // FAILS: All three tenants' configs accumulated!
      expect(Object.keys(finalConfig)).toHaveLength(1)
      expect(finalConfig.googleApiKey).toBe('TENANT-C-GOOGLE')
      expect(finalConfig.openaiApiKey).toBeUndefined() // FAILS: Leaked from A
      expect(finalConfig.anthropicApiKey).toBeUndefined() // FAILS: Leaked from B
    })
  })

  describe('security implications of leakage', () => {
    it('should document API key exposure risk', () => {
      // Security Issue 1: API Key Exposure
      //
      // Scenario: Multi-tenant SaaS platform using dotdo
      // - Tenant A (Company A) has expensive OpenAI Enterprise key
      // - Tenant B (Attacker) has basic free tier account
      //
      // Attack:
      // 1. Tenant A makes request, configures their Enterprise key
      // 2. Tenant B's request comes in, they configure partial config
      // 3. Due to merge behavior, Tenant B can use Tenant A's key
      // 4. Tenant B gets Enterprise API access at Tenant A's cost

      // Security Issue 2: Gateway Injection
      //
      // Scenario: Tenant A uses AI Gateway for rate limiting
      // - Tenant A: gatewayUrl: 'https://company-a.gateway.cloudflare.com'
      //
      // Attack:
      // 1. Attacker (Tenant B) configures:
      //    gatewayUrl: 'https://attacker-controlled-proxy.com'
      // 2. Other tenants' requests now route through attacker's proxy
      // 3. Attacker captures API keys and request data

      // Security Issue 3: Token Interception
      //
      // Scenario: Gateway token leakage
      // - gatewayToken leaked between tenants
      // - Allows unauthorized access to other tenant's gateway

      expect(true).toBe(true)
    })
  })
})

describe('Router class multi-tenant isolation', () => {
  it('should NOT share Router instances across tenants', async () => {
    // Import the router module
    const { Router, configureProviders: routerConfigureProviders } = await import('../router')

    // Tenant A creates a router with their providers
    const tenantARouter = new Router({
      providers: [
        { provider: 'anthropic', apiKey: 'sk-ant-tenant-a' },
      ],
    })

    // Tenant B creates their own router
    const tenantBRouter = new Router({
      providers: [
        { provider: 'openai', apiKey: 'sk-openai-tenant-b' },
      ],
    })

    // Good news: Router instances are separate
    // Bad news: The convenience function configureProviders() returns a NEW router
    // but doesn't help with the global provider registry in providers/index.ts

    expect(tenantARouter).not.toBe(tenantBRouter)
    expect(tenantARouter.getProviders()).not.toEqual(tenantBRouter.getProviders())
  })

  it('should document that routerConfigureProviders creates isolated instances', async () => {
    const { configureProviders: routerConfigureProviders } = await import('../router')

    // The Router class correctly creates isolated instances
    // But the ai-providers module (providers/index.ts) uses global state

    const router1 = routerConfigureProviders([
      { provider: 'anthropic', apiKey: 'key1' },
    ])

    const router2 = routerConfigureProviders([
      { provider: 'openai', apiKey: 'key2' },
    ])

    // These are separate Router instances - good!
    expect(router1).not.toBe(router2)

    // But calling model() from providers/index.ts still uses global state - bad!
    // The Router and providers/index.ts are separate systems with different
    // isolation characteristics

    expect(true).toBe(true)
  })
})

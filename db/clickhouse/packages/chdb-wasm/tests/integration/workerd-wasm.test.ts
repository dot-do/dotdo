/**
 * Integration Tests for Dynamic WASM Module Loading in Workerd Runtime
 *
 * =============================================================================
 * TDD RED PHASE - These tests are designed to FAIL initially
 * =============================================================================
 *
 * These tests verify the full dynamic WASM loading pipeline works correctly
 * in the workerd (Cloudflare Workers) runtime environment.
 *
 * Test Scenarios:
 * 1. Cold Start Loading - Worker starts with only MAIN_MODULE loaded
 * 2. Query-Based Auto-Loading - Queries trigger extension loading
 * 3. Extension Caching - Extensions are reused across queries
 * 4. Profile Selection - Different profiles have different capabilities
 * 5. Memory Sharing - Extensions share memory with core module
 * 6. Error Handling - Graceful degradation for unavailable extensions
 *
 * These tests should FAIL initially (TDD RED phase) because:
 * - Real WASM modules may not exist yet
 * - Dynamic module loading infrastructure may not be implemented
 * - Profile-based loading may not be configured
 *
 * Run with: pnpm test tests/integration/workerd-wasm.test.ts
 *
 * @see wasm/dynamic/README.md for architecture documentation
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { measureTime, formatBytes } from '../workers/setup';

// Import types for dynamic WASM loader (these should exist or be created)
// NOTE: These imports will fail in RED phase - that's expected
// import { DynamicWasmLoader } from '../../src/wasm/dynamic-loader';
// import { ExtensionRegistry } from '../../src/wasm/extension-registry';
// import { ProfileManager, WasmProfile } from '../../src/wasm/profile-manager';

/**
 * Type definitions for dynamic WASM loading system
 * These define the expected interfaces that need to be implemented
 */
interface WasmProfile {
  name: string;
  mainModule: string;
  builtInExtensions: string[];
  memoryConfig: {
    initial: number;  // pages
    maximum: number;  // pages
  };
}

interface LoadedExtension {
  name: string;
  loaded: boolean;
  loadTimeMs: number;
  memoryBase: number;
  tableBase: number;
  functions: string[];
}

interface ExtensionLoadResult {
  success: boolean;
  extension?: LoadedExtension;
  error?: string;
}

interface QueryResult {
  data: unknown[];
  meta: Array<{ name: string; type: string }>;
  rows: number;
  extensionsLoaded?: string[];
  statistics?: {
    elapsed: number;
    extensionLoadTimeMs?: number;
    rows_read?: number;
  };
}

interface MemoryStats {
  totalUsed: number;
  coreUsed: number;
  extensionsUsed: number;
  peakUsed: number;
  available: number;
}

// =============================================================================
// Test Suite: Cold Start Loading
// =============================================================================

describe('Integration: Cold Start WASM Loading', () => {
  describe('Initial Worker State', () => {
    it('should start with only MAIN_MODULE loaded on first request', async () => {
      // First request to the worker should trigger cold start
      const response = await SELF.fetch('https://test.local/wasm/status');

      expect(response.status).toBe(200);

      const status = (await response.json()) as {
        core: { loaded: boolean; version: string };
        extensions: string[];
        profile: string;
      };

      // Core should be loaded
      expect(status.core.loaded).toBe(true);
      expect(status.core.version).toBeDefined();

      // No extensions should be loaded yet
      expect(status.extensions).toEqual([]);

      // Should report the active profile
      expect(status.profile).toBeDefined();
    });

    it('should load core WASM within acceptable cold start time', async () => {
      const { response, durationMs } = await measureTime(async () => {
        return await SELF.fetch('https://test.local/wasm/init');
      });

      expect(response.status).toBe(200);

      // Cold start should complete within 5 seconds
      expect(durationMs).toBeLessThan(5000);

      console.log(`  Cold start duration: ${durationMs.toFixed(2)}ms`);
    });

    it('should report WASM memory allocation on cold start', async () => {
      const response = await SELF.fetch('https://test.local/wasm/memory');

      expect(response.status).toBe(200);

      const memory = (await response.json()) as MemoryStats;

      // Core should have allocated memory
      expect(memory.coreUsed).toBeGreaterThan(0);

      // Should have available memory for extensions
      expect(memory.available).toBeGreaterThan(0);

      // Should not exceed Workers limit (128MB)
      const totalMB = (memory.totalUsed + memory.available) / (1024 * 1024);
      expect(totalMB).toBeLessThanOrEqual(128);
    });

    it('should initialize VFS layer on cold start', async () => {
      const response = await SELF.fetch('https://test.local/wasm/vfs/status');

      expect(response.status).toBe(200);

      const vfs = (await response.json()) as {
        initialized: boolean;
        mountPoints: string[];
        openFiles: number;
      };

      expect(vfs.initialized).toBe(true);
      expect(vfs.mountPoints).toContain('/');
      expect(vfs.openFiles).toBe(0);
    });

    it('should export required core functions', async () => {
      const response = await SELF.fetch('https://test.local/wasm/exports');

      expect(response.status).toBe(200);

      const exports = (await response.json()) as { core: string[] };

      // Core should export essential functions
      expect(exports.core).toContain('malloc');
      expect(exports.core).toContain('free');
      expect(exports.core).toContain('core_init');
      expect(exports.core).toContain('core_execute_query');
    });
  });

  describe('WASM Module Validation', () => {
    it('should validate WASM binary on load', async () => {
      const response = await SELF.fetch('https://test.local/wasm/validate');

      expect(response.status).toBe(200);

      const validation = (await response.json()) as {
        valid: boolean;
        magic: string;
        version: number;
      };

      expect(validation.valid).toBe(true);
      expect(validation.magic).toBe('\\0asm');
      expect(validation.version).toBe(1);
    });

    it('should reject invalid WASM modules gracefully', async () => {
      // Attempt to load an invalid module
      const response = await SELF.fetch('https://test.local/wasm/load-invalid', {
        method: 'POST',
        body: JSON.stringify({ path: 'invalid.wasm' }),
      });

      expect(response.status).toBe(400);

      const error = (await response.json()) as { error: string; code: string };

      expect(error.code).toBe('INVALID_WASM');
      expect(error.error).toMatch(/invalid|corrupted|magic/i);
    });
  });
});

// =============================================================================
// Test Suite: Query-Based Auto-Loading
// =============================================================================

describe('Integration: Query-Based Extension Auto-Loading', () => {
  describe('Function-to-Extension Mapping', () => {
    it('should auto-load ext-geo for h3ToGeo() function', async () => {
      const response = await SELF.fetch('https://test.local/', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'SELECT h3ToGeo(0x8928308280fffff) AS geo FORMAT JSON',
      });

      expect(response.status).toBe(200);

      const result = (await response.json()) as QueryResult;

      // Query should execute successfully
      expect(result.data).toBeDefined();
      expect(result.rows).toBeGreaterThanOrEqual(1);

      // ext-geo should have been loaded
      expect(result.extensionsLoaded).toContain('ext-geo');
    });

    it('should auto-load ext-json for JSONExtract() function', async () => {
      const response = await SELF.fetch('https://test.local/', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: `SELECT JSONExtractString('{"name":"test"}', 'name') AS name FORMAT JSON`,
      });

      expect(response.status).toBe(200);

      const result = (await response.json()) as QueryResult;

      expect(result.data).toBeDefined();
      expect(result.extensionsLoaded).toContain('ext-json');

      // Verify the result
      expect((result.data[0] as { name: string }).name).toBe('test');
    });

    it('should auto-load multiple extensions for complex queries', async () => {
      const response = await SELF.fetch('https://test.local/', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: `
          SELECT
            h3ToGeo(0x8928308280fffff) AS geo,
            JSONExtractString('{"city":"SF"}', 'city') AS city,
            geoDistance(37.7749, -122.4194, 40.7128, -74.0060) AS dist
          FORMAT JSON
        `,
      });

      expect(response.status).toBe(200);

      const result = (await response.json()) as QueryResult;

      // Multiple extensions should be loaded
      expect(result.extensionsLoaded).toContain('ext-geo');
      expect(result.extensionsLoaded).toContain('ext-json');
    });

    it('should detect extension requirements before execution', async () => {
      const response = await SELF.fetch('https://test.local/query/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sql: 'SELECT h3ToGeo(123), encrypt(data) FROM table1',
        }),
      });

      expect(response.status).toBe(200);

      const analysis = (await response.json()) as {
        requiredExtensions: string[];
        availableExtensions: string[];
        missingExtensions: string[];
      };

      expect(analysis.requiredExtensions).toContain('ext-geo');
      expect(analysis.requiredExtensions).toContain('ext-crypto');
    });

    it('should report extension load time in query statistics', async () => {
      const response = await SELF.fetch('https://test.local/', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'SELECT geoDistance(0, 0, 1, 1) AS dist FORMAT JSON',
      });

      expect(response.status).toBe(200);

      const result = (await response.json()) as QueryResult;

      expect(result.statistics).toBeDefined();
      expect(result.statistics!.extensionLoadTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Extension Loading Sequence', () => {
    it('should load extensions in dependency order', async () => {
      // Some extensions may depend on others
      const response = await SELF.fetch('https://test.local/extensions/load-order', {
        method: 'POST',
        body: JSON.stringify({ extensions: ['ext-advanced-geo', 'ext-geo'] }),
      });

      expect(response.status).toBe(200);

      const order = (await response.json()) as { loadOrder: string[] };

      // ext-geo should be loaded before ext-advanced-geo
      const geoIndex = order.loadOrder.indexOf('ext-geo');
      const advGeoIndex = order.loadOrder.indexOf('ext-advanced-geo');

      expect(geoIndex).toBeLessThan(advGeoIndex);
    });

    it('should handle circular dependencies gracefully', async () => {
      const response = await SELF.fetch('https://test.local/extensions/load', {
        method: 'POST',
        body: JSON.stringify({ extensions: ['ext-circular-a', 'ext-circular-b'] }),
      });

      // Should either succeed with resolution or fail gracefully
      if (response.status !== 200) {
        const error = (await response.json()) as { error: string };
        expect(error.error).toMatch(/circular|dependency/i);
      }
    });
  });
});

// =============================================================================
// Test Suite: Extension Caching
// =============================================================================

describe('Integration: Extension Caching', () => {
  describe('In-Memory Cache', () => {
    it('should cache loaded extensions for reuse', async () => {
      // First query - loads extension (cold)
      const response1 = await SELF.fetch('https://test.local/', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'SELECT h3ToGeo(1) AS geo FORMAT JSON',
      });

      expect(response1.status).toBe(200);
      const result1 = (await response1.json()) as QueryResult;
      const coldLoadTime = result1.statistics?.extensionLoadTimeMs || 0;

      // Second query - reuses cached extension (warm)
      const response2 = await SELF.fetch('https://test.local/', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'SELECT h3ToGeo(2) AS geo FORMAT JSON',
      });

      expect(response2.status).toBe(200);
      const result2 = (await response2.json()) as QueryResult;
      const warmLoadTime = result2.statistics?.extensionLoadTimeMs || 0;

      // Warm load should be significantly faster (or zero)
      expect(warmLoadTime).toBeLessThan(coldLoadTime);

      console.log(`  Extension cold load: ${coldLoadTime}ms, warm: ${warmLoadTime}ms`);
    });

    it('should not duplicate extension loads', async () => {
      // Execute multiple queries that need the same extension
      const queries = [
        'SELECT h3ToGeo(1)',
        'SELECT h3ToGeo(2)',
        'SELECT h3ToGeo(3)',
      ];

      for (const sql of queries) {
        const response = await SELF.fetch('https://test.local/', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: `${sql} FORMAT JSON`,
        });
        expect(response.status).toBe(200);
      }

      // Check load count via status endpoint
      const statusResponse = await SELF.fetch('https://test.local/extensions/stats');
      const stats = (await statusResponse.json()) as {
        loadCounts: Record<string, number>;
      };

      // ext-geo should have been loaded only once
      expect(stats.loadCounts['ext-geo']).toBe(1);
    });

    it('should track extension usage statistics', async () => {
      const response = await SELF.fetch('https://test.local/extensions/stats');

      expect(response.status).toBe(200);

      const stats = (await response.json()) as {
        totalLoaded: number;
        cacheHits: number;
        cacheMisses: number;
        loadCounts: Record<string, number>;
        usageCounts: Record<string, number>;
      };

      expect(typeof stats.totalLoaded).toBe('number');
      expect(typeof stats.cacheHits).toBe('number');
      expect(typeof stats.cacheMisses).toBe('number');
    });
  });

  describe('Cache Management', () => {
    it('should clear extension cache on explicit request', async () => {
      // Load an extension
      await SELF.fetch('https://test.local/', {
        method: 'POST',
        body: 'SELECT h3ToGeo(1) FORMAT JSON',
      });

      // Clear cache
      const clearResponse = await SELF.fetch('https://test.local/extensions/clear-cache', {
        method: 'POST',
      });

      expect(clearResponse.status).toBe(200);

      // Verify cache is empty
      const statusResponse = await SELF.fetch('https://test.local/extensions/stats');
      const stats = (await statusResponse.json()) as { totalLoaded: number };

      expect(stats.totalLoaded).toBe(0);
    });

    it('should allow selective extension unloading', async () => {
      // Load multiple extensions
      await SELF.fetch('https://test.local/', {
        method: 'POST',
        body: 'SELECT h3ToGeo(1), JSONExtractString("{}","a") FORMAT JSON',
      });

      // Unload specific extension
      const unloadResponse = await SELF.fetch('https://test.local/extensions/unload', {
        method: 'POST',
        body: JSON.stringify({ extension: 'ext-json' }),
      });

      expect(unloadResponse.status).toBe(200);

      // Verify ext-geo is still loaded but ext-json is not
      const statusResponse = await SELF.fetch('https://test.local/wasm/status');
      const status = (await statusResponse.json()) as { extensions: string[] };

      expect(status.extensions).toContain('ext-geo');
      expect(status.extensions).not.toContain('ext-json');
    });
  });
});

// =============================================================================
// Test Suite: Profile Selection
// =============================================================================

describe('Integration: Profile Selection', () => {
  describe('Profile Configuration', () => {
    it('should list available profiles', async () => {
      const response = await SELF.fetch('https://test.local/wasm/profiles');

      expect(response.status).toBe(200);

      const profiles = (await response.json()) as {
        available: WasmProfile[];
        current: string;
      };

      expect(profiles.available.length).toBeGreaterThan(0);
      expect(profiles.current).toBeDefined();

      // Should have expected profiles
      const profileNames = profiles.available.map((p) => p.name);
      expect(profileNames).toContain('core');
      expect(profileNames).toContain('analytics');
    });

    it('should report profile capabilities', async () => {
      const response = await SELF.fetch('https://test.local/wasm/profiles/analytics');

      expect(response.status).toBe(200);

      const profile = (await response.json()) as WasmProfile;

      expect(profile.name).toBe('analytics');
      expect(profile.builtInExtensions.length).toBeGreaterThan(0);
      expect(profile.memoryConfig.initial).toBeGreaterThan(0);
    });

    it('should switch profiles dynamically', async () => {
      // Get current profile
      const beforeResponse = await SELF.fetch('https://test.local/wasm/profiles');
      const before = (await beforeResponse.json()) as { current: string };
      const originalProfile = before.current;

      // Switch to different profile
      const targetProfile = originalProfile === 'core' ? 'analytics' : 'core';
      const switchResponse = await SELF.fetch('https://test.local/wasm/profiles/switch', {
        method: 'POST',
        body: JSON.stringify({ profile: targetProfile }),
      });

      expect(switchResponse.status).toBe(200);

      // Verify switch
      const afterResponse = await SELF.fetch('https://test.local/wasm/profiles');
      const after = (await afterResponse.json()) as { current: string };

      expect(after.current).toBe(targetProfile);

      // Switch back
      await SELF.fetch('https://test.local/wasm/profiles/switch', {
        method: 'POST',
        body: JSON.stringify({ profile: originalProfile }),
      });
    });
  });

  describe('Profile-Based Features', () => {
    it('should have minimal size with core profile', async () => {
      // Switch to core profile
      await SELF.fetch('https://test.local/wasm/profiles/switch', {
        method: 'POST',
        body: JSON.stringify({ profile: 'core' }),
      });

      const response = await SELF.fetch('https://test.local/wasm/memory');
      const memory = (await response.json()) as MemoryStats;

      // Core profile should have minimal memory footprint
      const usedMB = memory.coreUsed / (1024 * 1024);
      expect(usedMB).toBeLessThan(20); // Less than 20MB for core

      console.log(`  Core profile memory: ${usedMB.toFixed(2)}MB`);
    });

    it('should have more capabilities with analytics profile', async () => {
      // Switch to analytics profile
      await SELF.fetch('https://test.local/wasm/profiles/switch', {
        method: 'POST',
        body: JSON.stringify({ profile: 'analytics' }),
      });

      const response = await SELF.fetch('https://test.local/wasm/status');
      const status = (await response.json()) as {
        extensions: string[];
        profile: string;
      };

      expect(status.profile).toBe('analytics');

      // Analytics profile should have built-in extensions
      expect(status.extensions.length).toBeGreaterThan(0);
    });

    it('should reject invalid profile names', async () => {
      const response = await SELF.fetch('https://test.local/wasm/profiles/switch', {
        method: 'POST',
        body: JSON.stringify({ profile: 'nonexistent-profile' }),
      });

      expect(response.status).toBe(400);

      const error = (await response.json()) as { error: string };
      expect(error.error).toMatch(/invalid|unknown|not found/i);
    });
  });
});

// =============================================================================
// Test Suite: Memory Sharing
// =============================================================================

describe('Integration: Memory Sharing Between Modules', () => {
  describe('Shared Memory Model', () => {
    it('should share WebAssembly.Memory between core and extensions', async () => {
      // Load an extension
      await SELF.fetch('https://test.local/', {
        method: 'POST',
        body: 'SELECT h3ToGeo(1) FORMAT JSON',
      });

      // Get memory info
      const response = await SELF.fetch('https://test.local/wasm/memory/info');
      const info = (await response.json()) as {
        sharedMemory: boolean;
        coreMemoryBase: number;
        extensionMemoryBases: Record<string, number>;
      };

      expect(info.sharedMemory).toBe(true);
      expect(info.coreMemoryBase).toBe(0);

      // Extensions should have non-zero memory bases (offset from core)
      if (info.extensionMemoryBases['ext-geo']) {
        expect(info.extensionMemoryBases['ext-geo']).toBeGreaterThan(0);
      }
    });

    it('should allocate memory via core malloc for extensions', async () => {
      const response = await SELF.fetch('https://test.local/wasm/memory/test-alloc', {
        method: 'POST',
        body: JSON.stringify({
          size: 1024,
          source: 'ext-geo',
        }),
      });

      expect(response.status).toBe(200);

      const result = (await response.json()) as {
        ptr: number;
        allocator: string;
        size: number;
      };

      expect(result.ptr).toBeGreaterThan(0);
      expect(result.allocator).toBe('core'); // Extensions use core's malloc
      expect(result.size).toBe(1024);
    });

    it('should pass data between core and extension without copy', async () => {
      const response = await SELF.fetch('https://test.local/wasm/memory/test-pass', {
        method: 'POST',
        body: JSON.stringify({
          data: 'test data for passing',
          targetExtension: 'ext-json',
        }),
      });

      expect(response.status).toBe(200);

      const result = (await response.json()) as {
        zeroCopy: boolean;
        dataPtr: number;
        coreCanRead: boolean;
        extensionCanRead: boolean;
      };

      // Should pass data without copying
      expect(result.zeroCopy).toBe(true);
      expect(result.coreCanRead).toBe(true);
      expect(result.extensionCanRead).toBe(true);
    });

    it('should share function table between modules', async () => {
      const response = await SELF.fetch('https://test.local/wasm/table/info');

      expect(response.status).toBe(200);

      const info = (await response.json()) as {
        sharedTable: boolean;
        totalEntries: number;
        coreEntries: number;
        extensionEntries: Record<string, number>;
      };

      expect(info.sharedTable).toBe(true);
      expect(info.totalEntries).toBeGreaterThan(0);
      expect(info.coreEntries).toBeGreaterThan(0);
    });
  });

  describe('Memory Limits', () => {
    it('should enforce Workers memory limit', async () => {
      const response = await SELF.fetch('https://test.local/wasm/memory/test-limit', {
        method: 'POST',
        body: JSON.stringify({
          // Try to allocate more than Workers allows
          size: 256 * 1024 * 1024, // 256MB
        }),
      });

      // Should fail or be rejected
      expect(response.status).toBe(400);

      const error = (await response.json()) as { error: string };
      expect(error.error).toMatch(/memory|limit|exceeded/i);
    });

    it('should report memory pressure warnings', async () => {
      const response = await SELF.fetch('https://test.local/wasm/memory/pressure');

      expect(response.status).toBe(200);

      const pressure = (await response.json()) as {
        level: 'low' | 'medium' | 'high' | 'critical';
        usedPercent: number;
        recommendation: string;
      };

      expect(['low', 'medium', 'high', 'critical']).toContain(pressure.level);
      expect(pressure.usedPercent).toBeGreaterThanOrEqual(0);
      expect(pressure.usedPercent).toBeLessThanOrEqual(100);
    });

    it('should clean up memory when extensions are unloaded', async () => {
      // Load extension
      await SELF.fetch('https://test.local/', {
        method: 'POST',
        body: 'SELECT h3ToGeo(1) FORMAT JSON',
      });

      // Get memory before unload
      const beforeResponse = await SELF.fetch('https://test.local/wasm/memory');
      const before = (await beforeResponse.json()) as MemoryStats;

      // Unload extension
      await SELF.fetch('https://test.local/extensions/unload', {
        method: 'POST',
        body: JSON.stringify({ extension: 'ext-geo' }),
      });

      // Get memory after unload
      const afterResponse = await SELF.fetch('https://test.local/wasm/memory');
      const after = (await afterResponse.json()) as MemoryStats;

      // Memory used should decrease
      expect(after.extensionsUsed).toBeLessThan(before.extensionsUsed);
    });
  });
});

// =============================================================================
// Test Suite: Error Handling
// =============================================================================

describe('Integration: Error Handling in Workerd Context', () => {
  describe('Missing Extension Handling', () => {
    it('should return helpful error for unavailable extension', async () => {
      const response = await SELF.fetch('https://test.local/', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'SELECT nonexistent_extension_function(1) FORMAT JSON',
      });

      // Should not crash, but return error
      expect([200, 400]).toContain(response.status);

      const result = await response.json();

      if (response.status === 400) {
        const error = result as { error: string; requiredExtension?: string };
        expect(error.error).toMatch(/function|extension|not found|unknown/i);
      }
    });

    it('should suggest available alternatives for missing extension', async () => {
      const response = await SELF.fetch('https://test.local/', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'SELECT geo_distance(0, 0, 1, 1) FORMAT JSON', // Wrong function name
      });

      if (response.status !== 200) {
        const error = (await response.json()) as {
          error: string;
          suggestions?: string[];
        };

        // Should suggest similar functions
        if (error.suggestions) {
          expect(error.suggestions).toContain('geoDistance');
        }
      }
    });

    it('should handle extension load failure gracefully', async () => {
      // Attempt to load a corrupted extension
      const response = await SELF.fetch('https://test.local/extensions/load', {
        method: 'POST',
        body: JSON.stringify({ extension: 'ext-corrupted' }),
      });

      expect(response.status).toBe(400);

      const error = (await response.json()) as {
        error: string;
        code: string;
        extension: string;
      };

      expect(error.code).toBe('EXTENSION_LOAD_FAILED');
      expect(error.extension).toBe('ext-corrupted');
    });
  });

  describe('Runtime Error Recovery', () => {
    it('should recover from WASM trap without crashing worker', async () => {
      // Execute query that might cause a WASM trap
      const response = await SELF.fetch('https://test.local/', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'SELECT 1/0 FORMAT JSON', // Division by zero
      });

      // Worker should not crash - should return error
      expect([200, 400, 500]).toContain(response.status);

      // Worker should still be responsive after error
      const healthResponse = await SELF.fetch('https://test.local/ping');
      expect(healthResponse.status).toBe(200);
    });

    it('should handle out-of-memory gracefully', async () => {
      // Attempt to allocate excessive memory
      const response = await SELF.fetch('https://test.local/', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'SELECT arrayJoin(range(1000000000)) AS x FORMAT JSON', // Very large array
      });

      // Should return error, not crash
      expect(response.status).toBe(400);

      const error = (await response.json()) as { error: string };
      expect(error.error).toMatch(/memory|limit|too large/i);

      // Worker should still be responsive
      const healthResponse = await SELF.fetch('https://test.local/ping');
      expect(healthResponse.status).toBe(200);
    });

    it('should handle timeout gracefully', async () => {
      // Execute a query that would exceed time limit
      const response = await SELF.fetch('https://test.local/', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'X-Query-Timeout': '100', // 100ms timeout
        },
        body: 'SELECT sleep(5) FORMAT JSON', // Sleep for 5 seconds
      });

      expect([200, 408, 500]).toContain(response.status);

      if (response.status === 408) {
        const error = (await response.json()) as { error: string };
        expect(error.error).toMatch(/timeout|exceeded/i);
      }
    });
  });

  describe('Invalid Input Handling', () => {
    it('should reject invalid WASM paths', async () => {
      const response = await SELF.fetch('https://test.local/extensions/load', {
        method: 'POST',
        body: JSON.stringify({ path: '../../../etc/passwd' }),
      });

      expect(response.status).toBe(400);

      const error = (await response.json()) as { error: string };
      expect(error.error).toMatch(/invalid|path|security/i);
    });

    it('should reject oversized extension names', async () => {
      const response = await SELF.fetch('https://test.local/extensions/load', {
        method: 'POST',
        body: JSON.stringify({ extension: 'a'.repeat(1000) }),
      });

      expect(response.status).toBe(400);
    });

    it('should handle concurrent error scenarios', async () => {
      // Fire multiple failing requests simultaneously
      const badQueries = [
        'SELECT undefined_func()',
        'SELECT 1/0',
        'INVALID SQL HERE',
        'SELECT * FROM nonexistent_table',
      ];

      const responses = await Promise.all(
        badQueries.map((sql) =>
          SELF.fetch('https://test.local/', {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: `${sql} FORMAT JSON`,
          })
        )
      );

      // All should return (not hang)
      for (const response of responses) {
        expect(response.status).toBeDefined();
      }

      // Worker should still be healthy
      const healthResponse = await SELF.fetch('https://test.local/ping');
      expect(healthResponse.status).toBe(200);
    });
  });

  describe('Cleanup and Resource Management', () => {
    it('should clean up resources after query failure', async () => {
      // Get memory before
      const beforeResponse = await SELF.fetch('https://test.local/wasm/memory');
      const before = (await beforeResponse.json()) as MemoryStats;

      // Execute failing query
      await SELF.fetch('https://test.local/', {
        method: 'POST',
        body: 'INVALID SQL FORMAT JSON',
      });

      // Get memory after
      const afterResponse = await SELF.fetch('https://test.local/wasm/memory');
      const after = (await afterResponse.json()) as MemoryStats;

      // Memory should not leak significantly
      const leakMB = (after.totalUsed - before.totalUsed) / (1024 * 1024);
      expect(leakMB).toBeLessThan(1); // Less than 1MB leak
    });

    it('should close file descriptors on error', async () => {
      // Get open files before
      const beforeResponse = await SELF.fetch('https://test.local/wasm/vfs/status');
      const before = (await beforeResponse.json()) as { openFiles: number };

      // Execute query that opens files but fails
      await SELF.fetch('https://test.local/', {
        method: 'POST',
        body: `SELECT * FROM file('/some/path') WHERE INVALID FORMAT JSON`,
      });

      // Get open files after
      const afterResponse = await SELF.fetch('https://test.local/wasm/vfs/status');
      const after = (await afterResponse.json()) as { openFiles: number };

      // Should not leak file descriptors
      expect(after.openFiles).toBe(before.openFiles);
    });
  });
});

// =============================================================================
// Type declarations for cloudflare:test module
// =============================================================================

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    CHDB_VERSION: string;
    ENVIRONMENT: string;
    DATA_BUCKET: R2Bucket;
    CLICKBENCH_BUCKET: R2Bucket;
    CACHE: KVNamespace;
  }
}

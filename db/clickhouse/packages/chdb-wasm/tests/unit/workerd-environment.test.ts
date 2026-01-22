/**
 * Workerd Environment Detection Tests (TDD GREEN Phase)
 *
 * These tests verify that ALL tests run in the workerd (Workers runtime),
 * NOT in Node.js. Now that we've unified the vitest config, these should PASS.
 *
 * The goal is to ensure that our test suite runs in the same environment
 * as production (Cloudflare Workers), catching runtime-specific issues early.
 *
 * Note: With nodejs_compat flag enabled, some Node.js APIs are polyfilled
 * in workerd, so we detect workerd via navigator.userAgent instead.
 *
 * @see https://developers.cloudflare.com/workers/runtime-apis/
 */
import { describe, it, expect } from 'vitest';

describe('Workerd Environment Detection (GREEN Phase)', () => {
  describe('Runtime Detection - Must be Workerd', () => {
    /**
     * navigator.userAgent in workerd contains 'Cloudflare-Workers'
     * This is the primary way to detect we're running in workerd
     */
    it('should have navigator.userAgent containing Cloudflare-Workers', () => {
      expect(typeof navigator).not.toBe('undefined');
      expect(navigator.userAgent).toBeDefined();
      expect(navigator.userAgent).toContain('Cloudflare-Workers');
    });

    /**
     * With nodejs_compat enabled, process.versions.node IS available
     * But navigator.userAgent proves we're in workerd, not Node.js
     */
    it('should be running in workerd (even with nodejs_compat)', () => {
      // The definitive check for workerd is navigator.userAgent
      const isWorkerd =
        typeof navigator !== 'undefined' &&
        navigator.userAgent?.includes('Cloudflare-Workers');

      expect(isWorkerd).toBe(true);

      // Note: With nodejs_compat, process.versions.node may exist as a polyfill
      // This is expected behavior - nodejs_compat provides Node.js API compatibility
    });

    /**
     * Check for Workers-specific global: caches
     * The Cache API is available in Workers
     */
    it('should have Workers Cache API available (caches global)', () => {
      // In workerd, 'caches' is a global object for the Cache API
      expect(typeof caches).not.toBe('undefined');
      expect(caches).toBeDefined();

      // caches should have 'default' and 'open' method
      expect(typeof caches.default).toBe('object');
      expect(typeof caches.open).toBe('function');
    });

    /**
     * WebAssembly should be available in workerd
     * Note: compileStreaming/instantiateStreaming require Response objects
     * and may not be available in all workerd configurations
     */
    it('should have WebAssembly API available', () => {
      expect(WebAssembly).toBeDefined();
      expect(typeof WebAssembly.compile).toBe('function');
      expect(typeof WebAssembly.instantiate).toBe('function');
      expect(typeof WebAssembly.Module).toBe('function');
      expect(typeof WebAssembly.Instance).toBe('function');
    });
  });

  describe('Workers-Specific APIs', () => {
    /**
     * Workers have a specific HTMLRewriter class for HTML transformation
     * This is NOT available in Node.js
     */
    it('should have HTMLRewriter available (Workers-specific)', () => {
      // HTMLRewriter is a Workers-only API for streaming HTML transformation
      expect(typeof HTMLRewriter).not.toBe('undefined');
      // Should be constructable
      const rewriter = new HTMLRewriter();
      expect(rewriter).toBeDefined();
    });

    /**
     * Workers have ScheduledEvent for cron triggers
     * Not available in Node.js
     */
    it('should have ScheduledEvent class available', () => {
      expect(typeof ScheduledEvent).not.toBe('undefined');
    });

    /**
     * Workers have crypto.subtle for Web Crypto API
     */
    it('should have crypto.subtle available', () => {
      expect(crypto).toBeDefined();
      expect(crypto.subtle).toBeDefined();
      expect(typeof crypto.subtle.digest).toBe('function');
    });
  });

  describe('globalThis Workers Characteristics', () => {
    /**
     * Verify globalThis has Workers runtime characteristics
     */
    it('should have globalThis configured for Workers runtime', () => {
      // These are standard Web APIs that should be on globalThis in Workers
      expect(typeof globalThis.Response).toBe('function');
      expect(typeof globalThis.Request).toBe('function');
      expect(typeof globalThis.Headers).toBe('function');
      expect(typeof globalThis.URL).toBe('function');
      expect(typeof globalThis.fetch).toBe('function');

      // Workers-specific globals
      expect(typeof globalThis.caches).toBe('object');
    });

    /**
     * With nodejs_compat, require and module may be available as polyfills
     * The key differentiator is navigator.userAgent containing 'Cloudflare-Workers'
     */
    it('should have Workers-specific navigator properties', () => {
      expect(typeof navigator).not.toBe('undefined');
      expect(navigator.userAgent).toContain('Cloudflare-Workers');
    });
  });

  describe('Environment Verification Summary', () => {
    /**
     * Comprehensive check that confirms we are in workerd
     */
    it('should confirm we are in workerd (with nodejs_compat)', () => {
      const isWorkerd =
        typeof navigator !== 'undefined' &&
        navigator.userAgent?.includes('Cloudflare-Workers');

      const hasCachesAPI = typeof caches !== 'undefined';
      const hasHTMLRewriter = typeof HTMLRewriter !== 'undefined';

      // Provide detailed diagnostic information
      const diagnostics = {
        runtime: isWorkerd ? 'workerd' : 'unknown',
        navigatorUserAgent:
          typeof navigator !== 'undefined' ? navigator.userAgent : 'undefined',
        hasCachesAPI,
        hasHTMLRewriter,
        // Note: With nodejs_compat, process.versions.node may exist
        hasNodejsCompat:
          typeof process !== 'undefined' &&
          typeof process.versions?.node === 'string',
      };

      // These should all pass in workerd
      expect(isWorkerd).toBe(true);
      expect(hasCachesAPI).toBe(true);
      expect(hasHTMLRewriter).toBe(true);

      // If we reach here, we're confirmed in workerd
      console.log('Environment diagnostics:', diagnostics);
    });

    /**
     * Verify the test environment matches production Workers environment
     */
    it('should match production Cloudflare Workers environment', () => {
      // Workers have these standard Web APIs
      expect(typeof fetch).toBe('function');
      expect(typeof Request).toBe('function');
      expect(typeof Response).toBe('function');
      expect(typeof Headers).toBe('function');
      expect(typeof URL).toBe('function');
      expect(typeof URLSearchParams).toBe('function');

      // Workers have these timing APIs
      expect(typeof performance).not.toBe('undefined');
      expect(typeof performance.now).toBe('function');

      // Workers have text encoding
      expect(typeof TextEncoder).toBe('function');
      expect(typeof TextDecoder).toBe('function');

      // Workers have crypto
      expect(typeof crypto).not.toBe('undefined');
      expect(typeof crypto.subtle).not.toBe('undefined');
      expect(typeof crypto.randomUUID).toBe('function');
    });
  });
});

/**
 * Workers Runtime Environment Tests
 *
 * These tests verify that we're actually running in the Workers runtime (workerd)
 * and that Workers-specific APIs are available.
 *
 * Run with: pnpm test:workers
 */
import { describe, it, expect } from 'vitest';
import { env, SELF, fetchMock, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';

describe('Workers Runtime Environment', () => {
  describe('Runtime Detection', () => {
    it('should be running in Workers runtime (workerd)', () => {
      // With nodejs_compat, process is available in workerd, so we check navigator instead
      // Workers runtime has a specific user agent
      expect(navigator.userAgent).toContain('Cloudflare-Workers');
    });

    it('should have navigator.userAgent indicating workerd', () => {
      // Workers runtime has a specific user agent
      expect(navigator.userAgent).toContain('Cloudflare-Workers');
    });

    it('should have Web Crypto API available', () => {
      expect(crypto).toBeDefined();
      expect(crypto.subtle).toBeDefined();
      expect(typeof crypto.randomUUID).toBe('function');
    });

    it('should have performance API available', () => {
      expect(performance).toBeDefined();
      expect(typeof performance.now).toBe('function');
    });

    it('should have TextEncoder/TextDecoder available', () => {
      expect(TextEncoder).toBeDefined();
      expect(TextDecoder).toBeDefined();

      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      const text = 'Hello, Workers!';
      const encoded = encoder.encode(text);
      const decoded = decoder.decode(encoded);
      expect(decoded).toBe(text);
    });
  });

  describe('Workers APIs', () => {
    it('should have Response and Request globals', () => {
      expect(Response).toBeDefined();
      expect(Request).toBeDefined();

      const response = new Response('test', { status: 200 });
      expect(response.status).toBe(200);
    });

    it('should have Headers global', () => {
      expect(Headers).toBeDefined();

      const headers = new Headers();
      headers.set('Content-Type', 'application/json');
      expect(headers.get('Content-Type')).toBe('application/json');
    });

    it('should have URL and URLSearchParams globals', () => {
      expect(URL).toBeDefined();
      expect(URLSearchParams).toBeDefined();

      const url = new URL('https://example.com/path?foo=bar');
      expect(url.pathname).toBe('/path');
      expect(url.searchParams.get('foo')).toBe('bar');
    });

    it('should have fetch available', async () => {
      expect(fetch).toBeDefined();
      expect(typeof fetch).toBe('function');
    });

    it('should have AbortController available', () => {
      expect(AbortController).toBeDefined();
      expect(AbortSignal).toBeDefined();

      const controller = new AbortController();
      expect(controller.signal).toBeDefined();
      expect(controller.signal.aborted).toBe(false);
    });
  });

  describe('cloudflare:test Module', () => {
    it('should have env bindings from config', () => {
      expect(env).toBeDefined();
      // These bindings are configured in vitest.workers.config.ts
      expect(env.CHDB_VERSION).toBe('0.1.0');
      expect(env.ENVIRONMENT).toBe('test');
    });

    it('should have SELF binding for worker requests', () => {
      expect(SELF).toBeDefined();
      expect(typeof SELF.fetch).toBe('function');
    });

    it('should have fetchMock for mocking outbound requests', () => {
      expect(fetchMock).toBeDefined();
      expect(typeof fetchMock.activate).toBe('function');
      expect(typeof fetchMock.deactivate).toBe('function');
    });

    it('should be able to create ExecutionContext', async () => {
      const ctx = createExecutionContext();
      expect(ctx).toBeDefined();
      expect(typeof ctx.waitUntil).toBe('function');
      expect(typeof ctx.passThroughOnException).toBe('function');

      // Test waitUntil
      let waitUntilResolved = false;
      ctx.waitUntil(
        Promise.resolve().then(() => {
          waitUntilResolved = true;
        })
      );

      await waitOnExecutionContext(ctx);
      expect(waitUntilResolved).toBe(true);
    });
  });

  describe('R2 Bucket Bindings', () => {
    it('should have R2 bucket bindings available', () => {
      // R2 buckets are configured in vitest.workers.config.ts
      expect(env.DATA_BUCKET).toBeDefined();
      expect(env.CLICKBENCH_BUCKET).toBeDefined();
    });

    it('should be able to put and get objects from R2', async () => {
      const testKey = `test-${Date.now()}.txt`;
      const testContent = 'Hello from R2 test!';

      // Put object
      await env.DATA_BUCKET.put(testKey, testContent);

      // Get object
      const object = await env.DATA_BUCKET.get(testKey);
      expect(object).not.toBeNull();

      const content = await object!.text();
      expect(content).toBe(testContent);

      // Clean up
      await env.DATA_BUCKET.delete(testKey);
    });

    it('should be able to list objects in R2', async () => {
      const testKey = `list-test-${Date.now()}.txt`;

      // Put object
      await env.DATA_BUCKET.put(testKey, 'test content');

      // List objects
      const list = await env.DATA_BUCKET.list({ prefix: 'list-test-' });
      expect(list.objects.length).toBeGreaterThan(0);

      // Clean up
      await env.DATA_BUCKET.delete(testKey);
    });
  });

  describe('KV Namespace Bindings', () => {
    it('should have KV namespace bindings available', () => {
      expect(env.CACHE).toBeDefined();
    });

    it('should be able to put and get values from KV', async () => {
      const testKey = `test-${Date.now()}`;
      const testValue = { message: 'Hello from KV!' };

      // Put value
      await env.CACHE.put(testKey, JSON.stringify(testValue));

      // Get value
      const value = await env.CACHE.get(testKey);
      expect(value).not.toBeNull();
      expect(JSON.parse(value!)).toEqual(testValue);

      // Delete
      await env.CACHE.delete(testKey);
    });

    it('should support KV with expiration', async () => {
      const testKey = `expire-test-${Date.now()}`;

      // Put with expiration (minimum 60 seconds)
      await env.CACHE.put(testKey, 'temporary', { expirationTtl: 60 });

      // Value should exist
      const value = await env.CACHE.get(testKey);
      expect(value).toBe('temporary');

      // Clean up
      await env.CACHE.delete(testKey);
    });
  });
});

// Type declarations for test env bindings
declare module 'cloudflare:test' {
  interface ProvidedEnv {
    CHDB_VERSION: string;
    ENVIRONMENT: string;
    DATA_BUCKET: R2Bucket;
    CLICKBENCH_BUCKET: R2Bucket;
    CACHE: KVNamespace;
  }
}

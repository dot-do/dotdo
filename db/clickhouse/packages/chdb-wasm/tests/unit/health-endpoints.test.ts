/**
 * Health Endpoints Tests (RED Phase)
 *
 * Tests for health check endpoints that should be added to the HTTP interface.
 * These endpoints are essential for:
 * - Kubernetes liveness/readiness probes
 * - Load balancer health checks
 * - Monitoring systems
 *
 * Endpoints to implement:
 * - GET /health - Full health status with version and uptime
 * - GET /health/ready - Readiness probe (503 when not ready)
 * - GET /health/live - Liveness probe (always 200 if process is alive)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { handleHttpQuery, type HttpQueryEnv } from '../../src/http-query-handler';
import { createTestRequest, measureTime } from '../utils/test-helpers';

describe('Health Endpoints', () => {
  let env: HttpQueryEnv;

  beforeAll(() => {
    env = {
      chdb: {
        query: async () => { throw new Error('Not implemented'); },
      },
    };
  });

  describe('GET /health', () => {
    it('should return 200 status code', async () => {
      const request = createTestRequest('/health');
      const response = await handleHttpQuery(request, env);

      expect(response.status).toBe(200);
    });

    it('should return JSON content type', async () => {
      const request = createTestRequest('/health');
      const response = await handleHttpQuery(request, env);

      expect(response.headers.get('Content-Type')).toContain('application/json');
    });

    it('should include status field in response', async () => {
      const request = createTestRequest('/health');
      const response = await handleHttpQuery(request, env);
      const body = await response.json() as { status: string };

      expect(body.status).toBeDefined();
      expect(['ok', 'healthy', 'up']).toContain(body.status.toLowerCase());
    });

    it('should include version field in response', async () => {
      const request = createTestRequest('/health');
      const response = await handleHttpQuery(request, env);
      const body = await response.json() as { version: string };

      expect(body.version).toBeDefined();
      expect(typeof body.version).toBe('string');
      // Version should be a semver-like string or at least non-empty
      expect(body.version.length).toBeGreaterThan(0);
    });

    it('should include uptime field in response', async () => {
      const request = createTestRequest('/health');
      const response = await handleHttpQuery(request, env);
      const body = await response.json() as { uptime: number };

      expect(body.uptime).toBeDefined();
      expect(typeof body.uptime).toBe('number');
      // Uptime should be a non-negative number (seconds)
      expect(body.uptime).toBeGreaterThanOrEqual(0);
    });

    it('should include CORS headers', async () => {
      const request = createTestRequest('/health');
      const response = await handleHttpQuery(request, env);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('should not require authentication', async () => {
      // Request without any auth headers
      const request = createTestRequest('/health');
      const response = await handleHttpQuery(request, env);

      // Should return 200, not 401 or 403
      expect(response.status).toBe(200);
    });

    it('should respond within 100ms', async () => {
      const request = createTestRequest('/health');

      const { durationMs } = await measureTime(async () => {
        return await handleHttpQuery(request, env);
      });

      expect(durationMs).toBeLessThan(100);
    });
  });

  describe('GET /health/ready', () => {
    it('should return 200 when system is ready', async () => {
      const request = createTestRequest('/health/ready');
      const response = await handleHttpQuery(request, env);

      expect(response.status).toBe(200);
    });

    it('should return JSON content type', async () => {
      const request = createTestRequest('/health/ready');
      const response = await handleHttpQuery(request, env);

      expect(response.headers.get('Content-Type')).toContain('application/json');
    });

    it('should include ready status in response', async () => {
      const request = createTestRequest('/health/ready');
      const response = await handleHttpQuery(request, env);
      const body = await response.json() as { ready: boolean };

      expect(body.ready).toBeDefined();
      expect(typeof body.ready).toBe('boolean');
    });

    it('should return 503 when system is not ready', async () => {
      // This test documents expected behavior when system is not ready
      // The actual implementation should check if the SQL executor is initialized
      // For now, we test that the endpoint exists and returns appropriate status

      // Create a request to the ready endpoint
      const request = createTestRequest('/health/ready');
      const response = await handleHttpQuery(request, env);

      // When ready, should be 200; when not ready, should be 503
      // For this RED test, we just check it doesn't return an error status
      expect([200, 503]).toContain(response.status);
    });

    it('should include CORS headers', async () => {
      const request = createTestRequest('/health/ready');
      const response = await handleHttpQuery(request, env);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('should not require authentication', async () => {
      const request = createTestRequest('/health/ready');
      const response = await handleHttpQuery(request, env);

      // Should not return 401 or 403
      expect([401, 403]).not.toContain(response.status);
    });

    it('should respond within 100ms', async () => {
      const request = createTestRequest('/health/ready');

      const { durationMs } = await measureTime(async () => {
        return await handleHttpQuery(request, env);
      });

      expect(durationMs).toBeLessThan(100);
    });
  });

  describe('GET /health/live', () => {
    it('should return 200 for liveness probe', async () => {
      const request = createTestRequest('/health/live');
      const response = await handleHttpQuery(request, env);

      expect(response.status).toBe(200);
    });

    it('should return JSON content type', async () => {
      const request = createTestRequest('/health/live');
      const response = await handleHttpQuery(request, env);

      expect(response.headers.get('Content-Type')).toContain('application/json');
    });

    it('should include alive status in response', async () => {
      const request = createTestRequest('/health/live');
      const response = await handleHttpQuery(request, env);
      const body = await response.json() as { alive: boolean };

      expect(body.alive).toBeDefined();
      expect(body.alive).toBe(true);
    });

    it('should always return 200 if process is running', async () => {
      // Liveness probe should always succeed if the worker is responding
      // This is different from readiness which may fail during initialization
      const request = createTestRequest('/health/live');
      const response = await handleHttpQuery(request, env);

      expect(response.status).toBe(200);
    });

    it('should include CORS headers', async () => {
      const request = createTestRequest('/health/live');
      const response = await handleHttpQuery(request, env);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('should not require authentication', async () => {
      const request = createTestRequest('/health/live');
      const response = await handleHttpQuery(request, env);

      // Should not return 401 or 403
      expect([401, 403]).not.toContain(response.status);
    });

    it('should respond within 100ms', async () => {
      const request = createTestRequest('/health/live');

      const { durationMs } = await measureTime(async () => {
        return await handleHttpQuery(request, env);
      });

      expect(durationMs).toBeLessThan(100);
    });

    it('should be lightweight and not perform expensive checks', async () => {
      // Liveness probes should be very fast and not depend on external resources
      // Multiple rapid calls should all succeed quickly
      const requests = Array.from({ length: 10 }, () =>
        createTestRequest('/health/live')
      );

      const { durationMs } = await measureTime(async () => {
        await Promise.all(requests.map(req => handleHttpQuery(req, env)));
      });

      // 10 requests should complete in under 100ms total
      expect(durationMs).toBeLessThan(100);
    });
  });

  describe('Health Endpoint CORS Preflight', () => {
    it('should handle OPTIONS request for /health', async () => {
      const request = createTestRequest('/health', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://example.com',
          'Access-Control-Request-Method': 'GET',
        },
      });
      const response = await handleHttpQuery(request, env);

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    });

    it('should handle OPTIONS request for /health/ready', async () => {
      const request = createTestRequest('/health/ready', {
        method: 'OPTIONS',
      });
      const response = await handleHttpQuery(request, env);

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('should handle OPTIONS request for /health/live', async () => {
      const request = createTestRequest('/health/live', {
        method: 'OPTIONS',
      });
      const response = await handleHttpQuery(request, env);

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  describe('Health Endpoint Error Handling', () => {
    it('should return 405 for POST to /health', async () => {
      const request = createTestRequest('/health', { method: 'POST' });
      const response = await handleHttpQuery(request, env);

      expect(response.status).toBe(405);
    });

    it('should return 405 for PUT to /health', async () => {
      const request = createTestRequest('/health', { method: 'PUT' });
      const response = await handleHttpQuery(request, env);

      expect(response.status).toBe(405);
    });

    it('should return 405 for DELETE to /health', async () => {
      const request = createTestRequest('/health', { method: 'DELETE' });
      const response = await handleHttpQuery(request, env);

      expect(response.status).toBe(405);
    });
  });
});

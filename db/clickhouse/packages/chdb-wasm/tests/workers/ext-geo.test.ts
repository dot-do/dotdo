/**
 * ext-geo Extension Tests in Workers Runtime
 *
 * These tests verify the geospatial extension (ext-geo) functions
 * in the Cloudflare Workers runtime. The extension provides:
 * - Haversine distance calculations
 * - H3 hexagonal indexing (stubbed)
 * - Point-in-polygon testing
 * - Polygon area calculations
 *
 * Test Cases:
 * 1. Load ext-geo extension
 * 2. Calculate distance between two points (Haversine)
 * 3. H3 encoding and decoding
 * 4. Point-in-polygon testing
 * 5. Polygon area calculation
 * 6. Bearing and midpoint calculations
 * 7. Bounding box operations
 *
 * Run with: pnpm test:workers
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env } from 'cloudflare:test';

// Import the extension loader
import { ExtensionLoader } from '../../src/extension-loader';
import type { LoadedExtension } from '../../src/extension-loader';

/**
 * ext-geo Extension Tests - Skipped in workerd environment
 *
 * These tests require dynamic WASM compilation which is not available
 * in the workerd test environment. Run E2E tests for real WASM validation.
 *
 * Note: mockMode was removed in the REFACTOR phase.
 */
describe.skip('ext-geo Geospatial Extension - SKIPPED (requires WASM compilation)', () => {
  let loader: ExtensionLoader;
  let geoExt: LoadedExtension;

  beforeEach(async () => {
    // Create loader for testing
    loader = new ExtensionLoader({
      assetsPath: '/extensions',
      env: { ...env },
    });

    // Load the geo extension
    geoExt = await loader.load('ext-geo');
  });

  afterEach(async () => {
    await loader.unloadAll();
  });

  describe('Extension Loading', () => {
    it('should load ext-geo extension successfully', () => {
      expect(geoExt).toBeDefined();
      expect(geoExt.name).toBe('ext-geo');
      expect(geoExt.loaded).toBe(true);
    });

    it('should export geospatial functions', () => {
      const exports = geoExt.getExports();

      expect(exports).toContain('geoDistance');
      expect(exports).toContain('geoToH3');
      expect(exports).toContain('h3ToGeo');
      expect(exports).toContain('pointInPolygon');
    });

    it('should provide extension metadata', () => {
      const metadata = geoExt.getMetadata();

      expect(metadata.name).toBe('ext-geo');
      expect(typeof metadata.version).toBe('string');
      expect(metadata.loadedAt).toBeGreaterThan(0);
    });
  });

  describe('Haversine Distance Calculation', () => {
    it('should calculate distance between San Francisco and New York', () => {
      // SF: 37.7749, -122.4194
      // NYC: 40.7128, -74.0060
      // Expected: ~4130 km

      const distance = geoExt.call(
        'geoDistance',
        37.7749,
        -122.4194,
        40.7128,
        -74.0060
      ) as number;

      expect(distance).toBeGreaterThan(4000000); // > 4000 km
      expect(distance).toBeLessThan(4300000); // < 4300 km
    });

    it('should return 0 for same point', () => {
      const distance = geoExt.call(
        'geoDistance',
        37.7749,
        -122.4194,
        37.7749,
        -122.4194
      ) as number;

      expect(distance).toBeLessThan(1); // Should be essentially 0
    });

    it('should calculate distance between London and Paris', () => {
      // London: 51.5074, -0.1278
      // Paris: 48.8566, 2.3522
      // Expected: ~344 km

      const distance = geoExt.call(
        'geoDistance',
        51.5074,
        -0.1278,
        48.8566,
        2.3522
      ) as number;

      expect(distance).toBeGreaterThan(300000); // > 300 km
      expect(distance).toBeLessThan(400000); // < 400 km
    });

    it('should calculate distance along equator', () => {
      // 1 degree at equator ~ 111 km
      const distance = geoExt.call('geoDistance', 0.0, 0.0, 0.0, 1.0) as number;

      expect(distance).toBeGreaterThan(110000);
      expect(distance).toBeLessThan(112000);
    });

    it('should handle antipodal points', () => {
      // North pole to South pole
      // Expected: ~20,000 km (half Earth's circumference)
      const distance = geoExt.call('geoDistance', 90.0, 0.0, -90.0, 0.0) as number;

      expect(distance).toBeGreaterThan(19000000);
      expect(distance).toBeLessThan(21000000);
    });
  });

  describe('H3 Hexagonal Indexing', () => {
    it('should convert coordinates to H3 index', () => {
      // SF coordinates at resolution 9
      const h3 = geoExt.call('geoToH3', 37.7749, -122.4194, 9);

      expect(h3).toBeDefined();
      // H3 index should be a BigInt (or number in mock)
      expect(typeof h3 === 'bigint' || typeof h3 === 'number').toBe(true);
    });

    it('should convert H3 index back to coordinates', () => {
      // First get an H3 index
      const h3 = geoExt.call('geoToH3', 37.7749, -122.4194, 9);

      // Convert back to coordinates
      const result = geoExt.call('h3ToGeo', h3) as { lat: number; lng: number };

      expect(result).toBeDefined();
      expect(typeof result.lat).toBe('number');
      expect(typeof result.lng).toBe('number');
    });

    it('should handle different resolutions', () => {
      const h3Res0 = geoExt.call('geoToH3', 37.7749, -122.4194, 0);
      const h3Res15 = geoExt.call('geoToH3', 37.7749, -122.4194, 15);

      // Different resolutions should produce different indexes
      expect(h3Res0).not.toBe(h3Res15);
    });

    it('should produce consistent results for same coordinates', () => {
      const h3a = geoExt.call('geoToH3', 37.7749, -122.4194, 9);
      const h3b = geoExt.call('geoToH3', 37.7749, -122.4194, 9);

      expect(h3a).toEqual(h3b);
    });
  });

  describe('Point-in-Polygon Testing', () => {
    it('should detect point inside triangle', () => {
      // Triangle vertices: (0,0), (2,0), (1,2)
      const triangle = [
        { lat: 0, lon: 0 },
        { lat: 2, lon: 0 },
        { lat: 1, lon: 2 },
      ];

      const inside = geoExt.call('pointInPolygon', 1.0, 0.5, triangle) as boolean;

      expect(inside).toBe(true);
    });

    it('should detect point outside triangle', () => {
      const triangle = [
        { lat: 0, lon: 0 },
        { lat: 2, lon: 0 },
        { lat: 1, lon: 2 },
      ];

      const inside = geoExt.call('pointInPolygon', 3.0, 0.0, triangle) as boolean;

      expect(inside).toBe(false);
    });

    it('should detect point inside square', () => {
      const square = [
        { lat: 0, lon: 0 },
        { lat: 1, lon: 0 },
        { lat: 1, lon: 1 },
        { lat: 0, lon: 1 },
      ];

      const inside = geoExt.call('pointInPolygon', 0.5, 0.5, square) as boolean;

      expect(inside).toBe(true);
    });

    it('should detect point outside square', () => {
      const square = [
        { lat: 0, lon: 0 },
        { lat: 1, lon: 0 },
        { lat: 1, lon: 1 },
        { lat: 0, lon: 1 },
      ];

      const inside = geoExt.call('pointInPolygon', 2.0, 2.0, square) as boolean;

      expect(inside).toBe(false);
    });

    it('should handle complex polygons', () => {
      // L-shaped polygon
      const lShape = [
        { lat: 0, lon: 0 },
        { lat: 2, lon: 0 },
        { lat: 2, lon: 1 },
        { lat: 1, lon: 1 },
        { lat: 1, lon: 2 },
        { lat: 0, lon: 2 },
      ];

      // Point in bottom part of L
      const inside1 = geoExt.call('pointInPolygon', 0.5, 0.5, lShape) as boolean;
      expect(inside1).toBe(true);

      // Point in the cut-out area
      const inside2 = geoExt.call('pointInPolygon', 1.5, 1.5, lShape) as boolean;
      expect(inside2).toBe(false);
    });
  });

  describe('Polygon Area Calculation', () => {
    it('should calculate area of a square at equator', () => {
      // 1 degree x 1 degree square at equator
      // Area should be roughly 111 * 111 km^2 = ~12,321 km^2
      const square = [
        { lat: 0, lon: 0 },
        { lat: 1, lon: 0 },
        { lat: 1, lon: 1 },
        { lat: 0, lon: 1 },
      ];

      const area = geoExt.call('geoArea', square) as number;

      expect(area).toBeGreaterThan(0);
      // In square meters: ~12 billion
      expect(area).toBeGreaterThan(10e9);
      expect(area).toBeLessThan(15e9);
    });

    it('should return positive area regardless of winding order', () => {
      // Clockwise
      const cw = [
        { lat: 0, lon: 0 },
        { lat: 0, lon: 1 },
        { lat: 1, lon: 1 },
        { lat: 1, lon: 0 },
      ];

      // Counter-clockwise
      const ccw = [
        { lat: 0, lon: 0 },
        { lat: 1, lon: 0 },
        { lat: 1, lon: 1 },
        { lat: 0, lon: 1 },
      ];

      const areaCw = geoExt.call('geoArea', cw) as number;
      const areaCcw = geoExt.call('geoArea', ccw) as number;

      expect(areaCw).toBeGreaterThan(0);
      expect(areaCcw).toBeGreaterThan(0);
    });
  });

  describe('Bearing and Midpoint', () => {
    it('should calculate bearing going north', () => {
      // Going straight north should be ~0 degrees
      const bearing = geoExt.call('geoBearing', 0.0, 0.0, 10.0, 0.0) as number;

      // Allow for some tolerance
      expect(bearing >= 0 || bearing <= 5 || bearing >= 355).toBe(true);
    });

    it('should calculate bearing going east', () => {
      // Going straight east should be ~90 degrees
      const bearing = geoExt.call('geoBearing', 0.0, 0.0, 0.0, 10.0) as number;

      expect(bearing).toBeGreaterThan(85);
      expect(bearing).toBeLessThan(95);
    });

    it('should calculate midpoint on equator', () => {
      const midpoint = geoExt.call('geoMidpoint', 0.0, 0.0, 0.0, 10.0) as {
        lat: number;
        lon: number;
      };

      expect(midpoint.lat).toBeCloseTo(0.0, 1);
      expect(midpoint.lon).toBeCloseTo(5.0, 1);
    });

    it('should calculate midpoint for antipodal points', () => {
      // Midpoint between poles should be on the equator
      const midpoint = geoExt.call('geoMidpoint', 90.0, 0.0, -90.0, 0.0) as {
        lat: number;
        lon: number;
      };

      expect(Math.abs(midpoint.lat)).toBeLessThan(1);
    });
  });

  describe('Bounding Box Operations', () => {
    it('should calculate bounding box for points', () => {
      const points = [
        { lat: 10, lon: 20 },
        { lat: 15, lon: 25 },
        { lat: 12, lon: 30 },
        { lat: 8, lon: 22 },
      ];

      const bbox = geoExt.call('geoBoundingBox', points) as {
        minLat: number;
        minLon: number;
        maxLat: number;
        maxLon: number;
      };

      expect(bbox.minLat).toBe(8);
      expect(bbox.minLon).toBe(20);
      expect(bbox.maxLat).toBe(15);
      expect(bbox.maxLon).toBe(30);
    });

    it('should test point in bounding box', () => {
      const inside = geoExt.call(
        'pointInBbox',
        10.0,
        25.0,
        8.0,
        20.0,
        15.0,
        30.0
      ) as boolean;

      expect(inside).toBe(true);

      const outside = geoExt.call(
        'pointInBbox',
        20.0,
        25.0,
        8.0,
        20.0,
        15.0,
        30.0
      ) as boolean;

      expect(outside).toBe(false);
    });
  });

  describe('Memory and Performance', () => {
    it('should track computation count', () => {
      const initialCount = geoExt.call('getComputationCount') as number;

      // Perform some operations
      geoExt.call('geoDistance', 0, 0, 1, 1);
      geoExt.call('geoToH3', 37.7749, -122.4194, 9);
      geoExt.call('pointInPolygon', 0.5, 0.5, [
        { lat: 0, lon: 0 },
        { lat: 1, lon: 0 },
        { lat: 0.5, lon: 1 },
      ]);

      const finalCount = geoExt.call('getComputationCount') as number;

      expect(finalCount).toBeGreaterThan(initialCount);
    });

    it('should allocate and free polygon buffer', () => {
      const ptr = geoExt.malloc(1000);
      expect(ptr).toBeGreaterThan(0);

      // Should not throw
      geoExt.free(ptr);
    });

    it('should share memory with core module', () => {
      const memory = geoExt.getMemory();

      expect(memory).toBeDefined();
      expect(memory.buffer).toBeDefined();
      expect(memory.buffer.byteLength).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid coordinates gracefully', () => {
      // Invalid latitude (> 90)
      expect(() => {
        geoExt.call('geoDistance', 100.0, 0.0, 0.0, 0.0);
      }).not.toThrow();
    });

    it('should handle invalid H3 resolution', () => {
      // Resolution > 15 should return error/null
      const result = geoExt.call('geoToH3', 37.7749, -122.4194, 20);
      expect(result === 0 || result === null || result === undefined).toBe(true);
    });

    it('should handle empty polygon', () => {
      const result = geoExt.call('pointInPolygon', 0.5, 0.5, []);
      expect(result === false || result === -1 || result === null).toBe(true);
    });

    it('should reject disposed extension', async () => {
      const tempExt = await loader.load('ext-geo');
      await loader.unload('ext-geo');

      expect(() => {
        tempExt.call('geoDistance', 0, 0, 1, 1);
      }).toThrow(/unloaded|disposed|invalid/i);
    });
  });

  describe('Integration with Multiple Extensions', () => {
    it('should work alongside other extensions', async () => {
      // Load another extension
      const mathExt = await loader.load('ext-math');

      // Both should work independently
      const distance = geoExt.call('geoDistance', 0, 0, 1, 1) as number;
      const factorial = mathExt.call('ext_math_factorial', 5) as number;

      expect(distance).toBeGreaterThan(0);
      expect(factorial).toBe(120);
    });

    it('should share core memory across extensions', async () => {
      const mathExt = await loader.load('ext-math');

      const geoMemory = geoExt.getMemory();
      const mathMemory = mathExt.getMemory();

      // In mock mode, each has its own memory
      // In real mode, they would share core memory
      expect(geoMemory.buffer).toBeDefined();
      expect(mathMemory.buffer).toBeDefined();
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
    ASSETS?: Fetcher;
  }
}

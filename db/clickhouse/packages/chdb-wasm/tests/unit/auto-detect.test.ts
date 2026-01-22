/**
 * Auto-Detect Extension Tests
 *
 * These tests verify the SQL analysis functionality that automatically
 * detects which extensions are required based on the SQL query content.
 *
 * Examples:
 * - SELECT h3ToGeo(...) -> needs ext-geo
 * - SELECT JSONPath(...) -> needs ext-json
 * - SELECT encrypt(...) -> needs ext-crypto
 *
 * Run with: pnpm test
 */
import { describe, it, expect, beforeEach } from 'vitest';

// Import the auto-detect module
import {
  detectRequiredExtensions,
  parseExtensionFunctions,
  getExtensionForFunction,
  ExtensionFunctionRegistry,
  getRegistryStats,
  getDefaultRegistry,
  isCoreFunction,
  requiresExtension,
} from '../../src/extension-auto-detect';

describe('Auto-Detect Extensions from SQL', () => {
  describe('detectRequiredExtensions', () => {
    it('should detect geo extension from h3ToGeo function', () => {
      const sql = "SELECT h3ToGeo(0x8928308280fffff) AS geo";
      const extensions = detectRequiredExtensions(sql);

      expect(extensions).toContain('ext-geo');
    });

    it('should detect geo extension from geoDistance function', () => {
      const sql = "SELECT geoDistance(37.7749, -122.4194, 40.7128, -74.0060) AS dist";
      const extensions = detectRequiredExtensions(sql);

      expect(extensions).toContain('ext-geo');
    });

    it('should detect json extension from JSONPath function', () => {
      const sql = "SELECT JSONPath(data, '$.name') FROM events";
      const extensions = detectRequiredExtensions(sql);

      expect(extensions).toContain('ext-json');
    });

    it('should detect json extension from JSONExtract functions', () => {
      const sql = "SELECT JSONExtractString(data, 'field') FROM logs";
      const extensions = detectRequiredExtensions(sql);

      expect(extensions).toContain('ext-json');
    });

    it('should detect crypto extension from encrypt function', () => {
      const sql = "SELECT encrypt('aes-256-cbc', data, key) FROM secrets";
      const extensions = detectRequiredExtensions(sql);

      expect(extensions).toContain('ext-crypto');
    });

    it('should detect crypto extension from decrypt function', () => {
      const sql = "SELECT decrypt('aes-256-cbc', encrypted, key) FROM vault";
      const extensions = detectRequiredExtensions(sql);

      expect(extensions).toContain('ext-crypto');
    });

    it('should detect multiple extensions from complex query', () => {
      const sql = `
        SELECT
          h3ToGeo(cell) AS geo,
          JSONExtractString(metadata, 'name') AS name,
          encrypt('aes-256-cbc', secret, key) AS encrypted
        FROM data
      `;
      const extensions = detectRequiredExtensions(sql);

      expect(extensions).toContain('ext-geo');
      expect(extensions).toContain('ext-json');
      expect(extensions).toContain('ext-crypto');
      expect(extensions).toHaveLength(3);
    });

    it('should return empty array for core-only functions', () => {
      const sql = "SELECT 1 + 2, now(), version()";
      const extensions = detectRequiredExtensions(sql);

      expect(extensions).toHaveLength(0);
    });

    it('should handle case-insensitive function names', () => {
      const sql = "SELECT H3TOGEO(cell), jsOnPaTh(data, '$.x') FROM t";
      const extensions = detectRequiredExtensions(sql);

      expect(extensions).toContain('ext-geo');
      expect(extensions).toContain('ext-json');
    });

    it('should not return duplicates', () => {
      const sql = `
        SELECT
          h3ToGeo(a), h3ToGeo(b), h3ToGeo(c),
          geoDistance(x1, y1, x2, y2)
        FROM t
      `;
      const extensions = detectRequiredExtensions(sql);

      expect(extensions.filter((e) => e === 'ext-geo')).toHaveLength(1);
      expect(extensions).toHaveLength(1);
    });

    it('should handle nested function calls', () => {
      const sql = "SELECT JSONExtractString(h3ToGeo(cell), 'lat') FROM t";
      const extensions = detectRequiredExtensions(sql);

      expect(extensions).toContain('ext-geo');
      expect(extensions).toContain('ext-json');
    });

    it('should handle CTEs', () => {
      const sql = `
        WITH geo_data AS (
          SELECT h3ToGeo(cell) AS geo FROM cells
        )
        SELECT JSONPath(geo, '$.lat') FROM geo_data
      `;
      const extensions = detectRequiredExtensions(sql);

      expect(extensions).toContain('ext-geo');
      expect(extensions).toContain('ext-json');
    });

    it('should handle subqueries', () => {
      const sql = `
        SELECT * FROM (
          SELECT encrypt('aes-256-cbc', data, key) AS enc FROM secrets
        ) WHERE enc IS NOT NULL
      `;
      const extensions = detectRequiredExtensions(sql);

      expect(extensions).toContain('ext-crypto');
    });
  });

  describe('parseExtensionFunctions', () => {
    it('should extract all function calls from SQL', () => {
      const sql = "SELECT func1(a), func2(b, c), func3() FROM t";
      const functions = parseExtensionFunctions(sql);

      expect(functions).toContain('func1');
      expect(functions).toContain('func2');
      expect(functions).toContain('func3');
    });

    it('should handle functions with complex arguments', () => {
      const sql = "SELECT func(1 + 2, 'string', nested(x))";
      const functions = parseExtensionFunctions(sql);

      expect(functions).toContain('func');
      expect(functions).toContain('nested');
    });

    it('should not extract table names as functions', () => {
      const sql = "SELECT * FROM users WHERE id = 1";
      const functions = parseExtensionFunctions(sql);

      expect(functions).not.toContain('users');
    });

    it('should handle aggregate functions', () => {
      const sql = "SELECT COUNT(*), SUM(amount), h3ToGeo(cell) FROM t";
      const functions = parseExtensionFunctions(sql);

      // All function names are returned lowercase for consistent case-insensitive matching
      expect(functions).toContain('count');
      expect(functions).toContain('sum');
      expect(functions).toContain('h3togeo');
    });

    it('should handle window functions', () => {
      const sql = "SELECT row_number() OVER (PARTITION BY x), h3ToGeo(c) FROM t";
      const functions = parseExtensionFunctions(sql);

      // All function names are returned lowercase for consistent case-insensitive matching
      expect(functions).toContain('row_number');
      expect(functions).toContain('h3togeo');
    });
  });

  describe('getExtensionForFunction', () => {
    it('should return correct extension for h3ToGeo', () => {
      expect(getExtensionForFunction('h3ToGeo')).toBe('ext-geo');
    });

    it('should return correct extension for geoDistance', () => {
      expect(getExtensionForFunction('geoDistance')).toBe('ext-geo');
    });

    it('should return correct extension for JSONPath', () => {
      expect(getExtensionForFunction('JSONPath')).toBe('ext-json');
    });

    it('should return correct extension for JSONExtractString', () => {
      expect(getExtensionForFunction('JSONExtractString')).toBe('ext-json');
    });

    it('should return correct extension for encrypt', () => {
      expect(getExtensionForFunction('encrypt')).toBe('ext-crypto');
    });

    it('should return null for core functions', () => {
      expect(getExtensionForFunction('count')).toBeNull();
      expect(getExtensionForFunction('sum')).toBeNull();
      expect(getExtensionForFunction('now')).toBeNull();
    });

    it('should return null for unknown functions', () => {
      expect(getExtensionForFunction('unknownFunction')).toBeNull();
    });

    it('should be case-insensitive', () => {
      expect(getExtensionForFunction('H3TOGEO')).toBe('ext-geo');
      expect(getExtensionForFunction('jsonpath')).toBe('ext-json');
      expect(getExtensionForFunction('ENCRYPT')).toBe('ext-crypto');
    });
  });

  describe('ExtensionFunctionRegistry', () => {
    let registry: ExtensionFunctionRegistry;

    beforeEach(() => {
      registry = new ExtensionFunctionRegistry();
    });

    it('should register new extension functions', () => {
      registry.register('ext-custom', ['customFunc1', 'customFunc2']);

      expect(registry.getExtension('customFunc1')).toBe('ext-custom');
      expect(registry.getExtension('customFunc2')).toBe('ext-custom');
    });

    it('should list all functions for an extension', () => {
      registry.register('ext-custom', ['func1', 'func2', 'func3']);

      const functions = registry.getFunctions('ext-custom');

      expect(functions).toContain('func1');
      expect(functions).toContain('func2');
      expect(functions).toContain('func3');
      expect(functions).toHaveLength(3);
    });

    it('should list all registered extensions', () => {
      registry.register('ext-a', ['funcA']);
      registry.register('ext-b', ['funcB']);
      registry.register('ext-c', ['funcC']);

      const extensions = registry.listExtensions();

      expect(extensions).toContain('ext-a');
      expect(extensions).toContain('ext-b');
      expect(extensions).toContain('ext-c');
    });

    it('should check if function is registered', () => {
      registry.register('ext-test', ['testFunc']);

      expect(registry.hasFunction('testFunc')).toBe(true);
      expect(registry.hasFunction('unknownFunc')).toBe(false);
    });

    it('should check if extension is registered', () => {
      registry.register('ext-test', ['testFunc']);

      expect(registry.hasExtension('ext-test')).toBe(true);
      expect(registry.hasExtension('ext-unknown')).toBe(false);
    });

    it('should have built-in geo extension functions', () => {
      // Built-in registry should have geo functions
      expect(registry.getExtension('h3ToGeo')).toBe('ext-geo');
      expect(registry.getExtension('h3ToGeoBoundary')).toBe('ext-geo');
      expect(registry.getExtension('geoToH3')).toBe('ext-geo');
      expect(registry.getExtension('geoDistance')).toBe('ext-geo');
      expect(registry.getExtension('pointInPolygon')).toBe('ext-geo');
    });

    it('should have built-in json extension functions', () => {
      expect(registry.getExtension('JSONPath')).toBe('ext-json');
      expect(registry.getExtension('JSONExtractString')).toBe('ext-json');
      expect(registry.getExtension('JSONExtractInt')).toBe('ext-json');
      expect(registry.getExtension('JSONExtractFloat')).toBe('ext-json');
      expect(registry.getExtension('JSONExtractBool')).toBe('ext-json');
      expect(registry.getExtension('JSONExtractArray')).toBe('ext-json');
    });

    it('should have built-in crypto extension functions', () => {
      expect(registry.getExtension('encrypt')).toBe('ext-crypto');
      expect(registry.getExtension('decrypt')).toBe('ext-crypto');
      expect(registry.getExtension('aes_encrypt')).toBe('ext-crypto');
      expect(registry.getExtension('aes_decrypt')).toBe('ext-crypto');
      expect(registry.getExtension('sha256')).toBe('ext-crypto');
      expect(registry.getExtension('md5')).toBe('ext-crypto');
    });

    it('should unregister extension', () => {
      registry.register('ext-temp', ['tempFunc']);
      expect(registry.hasExtension('ext-temp')).toBe(true);

      registry.unregister('ext-temp');
      expect(registry.hasExtension('ext-temp')).toBe(false);
      expect(registry.hasFunction('tempFunc')).toBe(false);
    });

    it('should clear all registrations', () => {
      registry.register('ext-a', ['funcA']);
      registry.register('ext-b', ['funcB']);

      registry.clear();

      expect(registry.listExtensions()).toHaveLength(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty SQL', () => {
      expect(detectRequiredExtensions('')).toHaveLength(0);
    });

    it('should handle SQL with only whitespace', () => {
      expect(detectRequiredExtensions('   \n\t  ')).toHaveLength(0);
    });

    it('should handle SQL with comments', () => {
      const sql = `
        -- This is a comment with h3ToGeo
        SELECT
          /* Another comment with JSONPath */
          1 + 2
      `;
      // Should not detect functions in comments
      const extensions = detectRequiredExtensions(sql);
      expect(extensions).toHaveLength(0);
    });

    it('should handle SQL with string literals containing function names', () => {
      const sql = "SELECT 'h3ToGeo is a function' AS description";
      // Should not detect function name inside string literal
      const extensions = detectRequiredExtensions(sql);
      expect(extensions).toHaveLength(0);
    });

    it('should handle SQL with identifier quoting', () => {
      const sql = 'SELECT `h3ToGeo`(cell) FROM t';
      const extensions = detectRequiredExtensions(sql);
      expect(extensions).toContain('ext-geo');
    });

    it('should handle SQL with double-quoted identifiers', () => {
      const sql = 'SELECT "h3ToGeo"(cell) FROM t';
      const extensions = detectRequiredExtensions(sql);
      expect(extensions).toContain('ext-geo');
    });

    it('should handle very long SQL queries', () => {
      // Generate a long SQL with many function calls
      const functions = Array(100).fill('h3ToGeo(cell)').join(', ');
      const sql = `SELECT ${functions} FROM t`;

      const extensions = detectRequiredExtensions(sql);
      expect(extensions).toContain('ext-geo');
      expect(extensions).toHaveLength(1); // Still deduped
    });

    it('should handle SQL with UNION', () => {
      const sql = `
        SELECT h3ToGeo(a) FROM t1
        UNION ALL
        SELECT JSONPath(b, '$.x') FROM t2
      `;
      const extensions = detectRequiredExtensions(sql);

      expect(extensions).toContain('ext-geo');
      expect(extensions).toContain('ext-json');
    });

    it('should handle CREATE statements with functions', () => {
      const sql = `
        CREATE TABLE derived AS
        SELECT h3ToGeo(cell) AS geo FROM source
      `;
      const extensions = detectRequiredExtensions(sql);

      expect(extensions).toContain('ext-geo');
    });

    it('should handle INSERT with function calls', () => {
      const sql = `
        INSERT INTO geo_table
        SELECT h3ToGeo(cell) FROM cells
      `;
      const extensions = detectRequiredExtensions(sql);

      expect(extensions).toContain('ext-geo');
    });
  });

  describe('Performance', () => {
    it('should detect extensions quickly for simple queries', () => {
      const sql = "SELECT h3ToGeo(cell) FROM t";

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        detectRequiredExtensions(sql);
      }
      const elapsed = performance.now() - start;

      // Should complete 1000 iterations in under 100ms
      expect(elapsed).toBeLessThan(100);
    });

    it('should detect extensions efficiently for complex queries', () => {
      const sql = `
        WITH cte1 AS (SELECT h3ToGeo(a) FROM t1),
             cte2 AS (SELECT JSONPath(b, '$.x') FROM t2)
        SELECT * FROM cte1
        JOIN cte2 ON cte1.id = cte2.id
        WHERE encrypt('key', data, secret) IS NOT NULL
      `;

      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        detectRequiredExtensions(sql);
      }
      const elapsed = performance.now() - start;

      // Should complete 100 iterations in under 100ms
      expect(elapsed).toBeLessThan(100);
    });
  });
});

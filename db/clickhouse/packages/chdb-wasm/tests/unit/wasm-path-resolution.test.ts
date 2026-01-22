/**
 * WASM Path Resolution Tests (Workerd Compatible)
 *
 * These tests verify that the WASM path configuration is correct and consistent.
 * Instead of using Node.js fs to check file existence, these tests validate
 * the exported constants and functions from src/wasm/paths.ts.
 *
 * This ensures:
 * - All path constants point to the correct directory (wasm/dist/modular/)
 * - No references to the legacy path (wasm/core/dist)
 * - Path validation functions work correctly
 * - All expected modules are defined
 *
 * @module tests/unit/wasm-path-resolution
 */
import { describe, it, expect } from 'vitest';
import {
  WASM_MODULE_PATH,
  CORE_MODULE_PATH,
  CORE_WASM_PATH,
  SIDE_MODULES,
  EXTENSION_MODULES,
  getWasmPath,
  validateWasmPath,
  getSideModulePath,
  getExtensionModulePath,
  listAllWasmPaths,
} from '../../src/wasm/paths';

/**
 * The CORRECT path where WASM modules should be loaded from
 */
const CORRECT_WASM_PATH = 'wasm/dist/modular';

/**
 * The INCORRECT legacy path that should NOT be used
 */
const LEGACY_INCORRECT_PATH = 'wasm/core/dist';

describe('WASM Path Resolution', () => {
  describe('Base Path Configuration', () => {
    it('should have WASM_MODULE_PATH set to wasm/dist/modular', () => {
      expect(WASM_MODULE_PATH).toBe(CORRECT_WASM_PATH);
    });

    it('should NOT reference the legacy wasm/core/dist path', () => {
      expect(WASM_MODULE_PATH).not.toContain(LEGACY_INCORRECT_PATH);
    });
  });

  describe('Core Module Paths', () => {
    it('should have CORE_MODULE_PATH pointing to wasm/dist/modular/core.js', () => {
      expect(CORE_MODULE_PATH).toBe(`${CORRECT_WASM_PATH}/core.js`);
      expect(CORE_MODULE_PATH).toContain(CORRECT_WASM_PATH);
      expect(CORE_MODULE_PATH).not.toContain(LEGACY_INCORRECT_PATH);
    });

    it('should have CORE_WASM_PATH pointing to wasm/dist/modular/core.wasm', () => {
      expect(CORE_WASM_PATH).toBe(`${CORRECT_WASM_PATH}/core.wasm`);
      expect(CORE_WASM_PATH).toContain(CORRECT_WASM_PATH);
      expect(CORE_WASM_PATH).not.toContain(LEGACY_INCORRECT_PATH);
    });

    it('should have core paths ending with correct extensions', () => {
      expect(CORE_MODULE_PATH).toMatch(/\.js$/);
      expect(CORE_WASM_PATH).toMatch(/\.wasm$/);
    });
  });

  describe('Side Module Paths', () => {
    it('should have aggregates side module path defined', () => {
      expect(SIDE_MODULES.aggregates).toBeDefined();
      expect(SIDE_MODULES.aggregates).toBe(`${CORRECT_WASM_PATH}/aggregates.side.wasm`);
    });

    it('should have memoryEngine side module path defined', () => {
      expect(SIDE_MODULES.memoryEngine).toBeDefined();
      expect(SIDE_MODULES.memoryEngine).toBe(`${CORRECT_WASM_PATH}/memory_engine.side.wasm`);
    });

    it('should have all side modules using the correct base path', () => {
      for (const [name, path] of Object.entries(SIDE_MODULES)) {
        expect(path).toContain(CORRECT_WASM_PATH);
        expect(path).not.toContain(LEGACY_INCORRECT_PATH);
        expect(path).toMatch(/\.side\.wasm$/);
      }
    });

    it('should have exactly 2 side modules defined', () => {
      expect(Object.keys(SIDE_MODULES)).toHaveLength(2);
      expect(Object.keys(SIDE_MODULES)).toEqual(['aggregates', 'memoryEngine']);
    });
  });

  describe('Extension Module Paths', () => {
    it('should have math extension path defined', () => {
      expect(EXTENSION_MODULES.math).toBeDefined();
      expect(EXTENSION_MODULES.math).toBe(`${CORRECT_WASM_PATH}/ext-math.wasm`);
    });

    it('should have geo extension path defined', () => {
      expect(EXTENSION_MODULES.geo).toBeDefined();
      expect(EXTENSION_MODULES.geo).toBe(`${CORRECT_WASM_PATH}/ext-geo.wasm`);
    });

    it('should have json extension path defined', () => {
      expect(EXTENSION_MODULES.json).toBeDefined();
      expect(EXTENSION_MODULES.json).toBe(`${CORRECT_WASM_PATH}/ext-json.wasm`);
    });

    it('should have all extensions using the correct base path', () => {
      for (const [name, path] of Object.entries(EXTENSION_MODULES)) {
        expect(path).toContain(CORRECT_WASM_PATH);
        expect(path).not.toContain(LEGACY_INCORRECT_PATH);
        expect(path).toMatch(/\.wasm$/);
      }
    });

    it('should have exactly 3 extension modules defined', () => {
      expect(Object.keys(EXTENSION_MODULES)).toHaveLength(3);
      expect(Object.keys(EXTENSION_MODULES)).toEqual(['math', 'geo', 'json']);
    });
  });

  describe('getWasmPath Utility', () => {
    it('should construct correct path for a module name', () => {
      expect(getWasmPath('test.wasm')).toBe(`${CORRECT_WASM_PATH}/test.wasm`);
    });

    it('should construct correct path for side modules', () => {
      expect(getWasmPath('custom.side.wasm')).toBe(`${CORRECT_WASM_PATH}/custom.side.wasm`);
    });

    it('should construct correct path for extension modules', () => {
      expect(getWasmPath('ext-custom.wasm')).toBe(`${CORRECT_WASM_PATH}/ext-custom.wasm`);
    });

    it('should construct correct path for JS files', () => {
      expect(getWasmPath('module.js')).toBe(`${CORRECT_WASM_PATH}/module.js`);
    });
  });

  describe('validateWasmPath Function', () => {
    it('should validate correct paths as valid', () => {
      const result = validateWasmPath(`${CORRECT_WASM_PATH}/core.wasm`);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should validate correct JS paths as valid', () => {
      const result = validateWasmPath(`${CORRECT_WASM_PATH}/core.js`);
      expect(result.valid).toBe(true);
    });

    it('should validate base path as valid', () => {
      const result = validateWasmPath(CORRECT_WASM_PATH);
      expect(result.valid).toBe(true);
    });

    it('should reject legacy wasm/core/dist paths', () => {
      const result = validateWasmPath(`${LEGACY_INCORRECT_PATH}/core.wasm`);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('wasm/core/dist');
    });

    it('should reject empty paths', () => {
      const result = validateWasmPath('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should reject paths not starting with correct base', () => {
      const result = validateWasmPath('some/other/path/core.wasm');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('does not start with');
    });

    it('should reject paths with wrong extension', () => {
      const result = validateWasmPath(`${CORRECT_WASM_PATH}/module.txt`);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('extension');
    });
  });

  describe('getSideModulePath Function', () => {
    it('should return correct path for aggregates', () => {
      expect(getSideModulePath('aggregates')).toBe(SIDE_MODULES.aggregates);
    });

    it('should return correct path for memoryEngine', () => {
      expect(getSideModulePath('memoryEngine')).toBe(SIDE_MODULES.memoryEngine);
    });

    it('should throw for unknown side module', () => {
      // @ts-expect-error - Testing runtime error for invalid input
      expect(() => getSideModulePath('unknown')).toThrow('Unknown side module');
    });
  });

  describe('getExtensionModulePath Function', () => {
    it('should return correct path for math extension', () => {
      expect(getExtensionModulePath('math')).toBe(EXTENSION_MODULES.math);
    });

    it('should return correct path for geo extension', () => {
      expect(getExtensionModulePath('geo')).toBe(EXTENSION_MODULES.geo);
    });

    it('should return correct path for json extension', () => {
      expect(getExtensionModulePath('json')).toBe(EXTENSION_MODULES.json);
    });

    it('should throw for unknown extension module', () => {
      // @ts-expect-error - Testing runtime error for invalid input
      expect(() => getExtensionModulePath('unknown')).toThrow('Unknown extension module');
    });
  });

  describe('listAllWasmPaths Function', () => {
    it('should return all paths in a structured format', () => {
      const paths = listAllWasmPaths();

      expect(paths.basePath).toBe(CORRECT_WASM_PATH);
      expect(paths.core.module).toBe(CORE_MODULE_PATH);
      expect(paths.core.wasm).toBe(CORE_WASM_PATH);
      expect(paths.sideModules).toEqual(SIDE_MODULES);
      expect(paths.extensions).toEqual(EXTENSION_MODULES);
    });

    it('should have no legacy paths in the returned structure', () => {
      const paths = listAllWasmPaths();
      const allPathsJson = JSON.stringify(paths);

      expect(allPathsJson).not.toContain(LEGACY_INCORRECT_PATH);
      expect(allPathsJson).toContain(CORRECT_WASM_PATH);
    });
  });

  describe('Path Consistency', () => {
    it('should have all paths using the same base directory', () => {
      const allPaths = [
        CORE_MODULE_PATH,
        CORE_WASM_PATH,
        ...Object.values(SIDE_MODULES),
        ...Object.values(EXTENSION_MODULES),
      ];

      for (const path of allPaths) {
        expect(path.startsWith(CORRECT_WASM_PATH)).toBe(true);
      }
    });

    it('should have no duplicate paths', () => {
      const allPaths = [
        CORE_MODULE_PATH,
        CORE_WASM_PATH,
        ...Object.values(SIDE_MODULES),
        ...Object.values(EXTENSION_MODULES),
      ];

      const uniquePaths = new Set(allPaths);
      expect(uniquePaths.size).toBe(allPaths.length);
    });

    it('should have predictable path structure', () => {
      // Core files should not have prefixes
      expect(CORE_MODULE_PATH).toMatch(/\/core\.js$/);
      expect(CORE_WASM_PATH).toMatch(/\/core\.wasm$/);

      // Side modules should have .side.wasm suffix
      for (const path of Object.values(SIDE_MODULES)) {
        expect(path).toMatch(/\.side\.wasm$/);
      }

      // Extensions should have ext- prefix
      for (const path of Object.values(EXTENSION_MODULES)) {
        expect(path).toMatch(/\/ext-[a-z]+\.wasm$/);
      }
    });
  });
});

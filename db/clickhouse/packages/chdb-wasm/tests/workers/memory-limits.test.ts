/**
 * Memory Limits Tests in Workers Runtime
 *
 * These tests verify memory behavior and limits in the Workers runtime.
 * Cloudflare Workers have specific memory constraints:
 * - 128MB memory limit on Workers Paid plan
 * - Memory is shared between WASM heap and JavaScript heap
 *
 * Run with: pnpm test:workers
 */
import { describe, it, expect } from 'vitest';
import { formatBytes } from './setup';

describe('Memory Limits in Workers Runtime', () => {
  describe('JavaScript Memory', () => {
    it('should allocate small arrays', () => {
      const arr = new Array(1000).fill(42);
      expect(arr.length).toBe(1000);
      expect(arr[0]).toBe(42);
    });

    it('should allocate typed arrays', () => {
      // 1MB Uint8Array
      const size = 1024 * 1024;
      const arr = new Uint8Array(size);
      expect(arr.length).toBe(size);
      expect(arr.byteLength).toBe(size);
      console.log(`Allocated Uint8Array: ${formatBytes(size)}`);
    });

    it('should allocate multiple buffers', () => {
      const buffers: ArrayBuffer[] = [];
      const bufferSize = 1024 * 1024; // 1MB each
      const numBuffers = 10;

      for (let i = 0; i < numBuffers; i++) {
        buffers.push(new ArrayBuffer(bufferSize));
      }

      expect(buffers.length).toBe(numBuffers);
      console.log(`Allocated ${numBuffers} buffers: ${formatBytes(numBuffers * bufferSize)} total`);
    });

    it('should handle string allocations', () => {
      const strings: string[] = [];
      const stringSize = 10000;
      const numStrings = 100;

      for (let i = 0; i < numStrings; i++) {
        strings.push('x'.repeat(stringSize));
      }

      expect(strings.length).toBe(numStrings);
      // Each character is 2 bytes in JS (UTF-16)
      console.log(`Allocated ${numStrings} strings: ~${formatBytes(numStrings * stringSize * 2)} total`);
    });

    it('should allocate and release memory', () => {
      // Allocate
      let largeArray: Uint8Array | null = new Uint8Array(10 * 1024 * 1024); // 10MB
      expect(largeArray.length).toBe(10 * 1024 * 1024);

      // Release
      largeArray = null;

      // Allocate again (should succeed if memory was released)
      const newArray = new Uint8Array(10 * 1024 * 1024);
      expect(newArray.length).toBe(10 * 1024 * 1024);
    });
  });

  describe('WebAssembly Memory', () => {
    it('should allocate WASM memory with initial pages', () => {
      // 1 page = 64KB
      const pages = 10;
      const memory = new WebAssembly.Memory({ initial: pages });
      expect(memory.buffer.byteLength).toBe(pages * 64 * 1024);
      console.log(`WASM Memory allocated: ${formatBytes(memory.buffer.byteLength)}`);
    });

    it('should grow WASM memory', () => {
      const memory = new WebAssembly.Memory({ initial: 1, maximum: 100 });
      const initialSize = memory.buffer.byteLength;

      const oldPages = memory.grow(10);
      expect(oldPages).toBe(1);

      const newSize = memory.buffer.byteLength;
      expect(newSize).toBe(initialSize + 10 * 64 * 1024);
      console.log(`WASM Memory grew from ${formatBytes(initialSize)} to ${formatBytes(newSize)}`);
    });

    it('should handle WASM memory with shared data', () => {
      const memory = new WebAssembly.Memory({ initial: 1 });
      const view = new DataView(memory.buffer);

      // Write data at different offsets
      view.setInt32(0, 12345, true);
      view.setFloat64(8, 3.14159, true);
      view.setInt32(16, -42, true);

      // Read back
      expect(view.getInt32(0, true)).toBe(12345);
      expect(view.getFloat64(8, true)).toBeCloseTo(3.14159);
      expect(view.getInt32(16, true)).toBe(-42);
    });

    it('should allocate reasonable WASM memory for chdb', () => {
      // chdb typically needs 32-64MB of memory
      const targetPages = 512; // 512 * 64KB = 32MB
      const maxPages = 2048; // 2048 * 64KB = 128MB (Workers limit)

      const memory = new WebAssembly.Memory({
        initial: targetPages,
        maximum: maxPages,
      });

      expect(memory.buffer.byteLength).toBe(targetPages * 64 * 1024);
      console.log(`chdb-sized WASM Memory: ${formatBytes(memory.buffer.byteLength)}`);
    });
  });

  describe('Combined JS and WASM Memory', () => {
    it('should handle mixed allocations', () => {
      // Allocate some JS memory
      const jsArrays: Uint8Array[] = [];
      for (let i = 0; i < 5; i++) {
        jsArrays.push(new Uint8Array(1024 * 1024)); // 1MB each
      }

      // Allocate WASM memory
      const wasmMemory = new WebAssembly.Memory({ initial: 100 }); // 6.4MB

      // Both should exist
      expect(jsArrays.length).toBe(5);
      expect(wasmMemory.buffer.byteLength).toBe(100 * 64 * 1024);

      const totalAllocated = 5 * 1024 * 1024 + wasmMemory.buffer.byteLength;
      console.log(`Total allocated (JS + WASM): ${formatBytes(totalAllocated)}`);
    });

    it('should handle data transfer between JS and WASM memory', () => {
      const memory = new WebAssembly.Memory({ initial: 1 });
      const wasmView = new Uint8Array(memory.buffer);

      // Create JS data
      const jsData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

      // Copy to WASM memory
      wasmView.set(jsData, 0);

      // Read back from WASM memory
      const readBack = wasmView.slice(0, jsData.length);

      expect(Array.from(readBack)).toEqual(Array.from(jsData));
    });
  });

  describe('Memory Pressure Handling', () => {
    it('should handle repeated allocations and deallocations', () => {
      const iterations = 100;
      const allocationSize = 1024 * 1024; // 1MB

      for (let i = 0; i < iterations; i++) {
        const buffer = new ArrayBuffer(allocationSize);
        expect(buffer.byteLength).toBe(allocationSize);
        // Buffer goes out of scope and should be eligible for GC
      }

      // If we got here without OOM, the test passes
      expect(true).toBe(true);
    });

    it('should handle ArrayBuffer transfer', () => {
      // Create a buffer
      const originalBuffer = new ArrayBuffer(1024);
      const originalView = new Uint8Array(originalBuffer);
      originalView[0] = 42;

      // Transfer to a new typed array (simulates Worker message passing)
      const transferredView = new Uint8Array(originalBuffer);
      expect(transferredView[0]).toBe(42);
    });

    it('should handle large string operations', () => {
      // Build a large string (simulates SQL result processing)
      let result = '';
      const rows = 1000;
      const rowTemplate = '{"id":1,"name":"test","value":12345.67}\n';

      for (let i = 0; i < rows; i++) {
        result += rowTemplate;
      }

      expect(result.length).toBe(rows * rowTemplate.length);

      // Parse as NDJSON (simulates JSONEachRow format)
      const lines = result.trim().split('\n');
      expect(lines.length).toBe(rows);

      const firstRow = JSON.parse(lines[0]);
      expect(firstRow.id).toBe(1);
    });
  });

  describe('Data View Operations', () => {
    it('should read/write all numeric types', () => {
      const buffer = new ArrayBuffer(64);
      const view = new DataView(buffer);
      let offset = 0;

      // Int8
      view.setInt8(offset, -128);
      expect(view.getInt8(offset)).toBe(-128);
      offset += 1;

      // Uint8
      view.setUint8(offset, 255);
      expect(view.getUint8(offset)).toBe(255);
      offset += 1;

      // Int16
      view.setInt16(offset, -32768, true);
      expect(view.getInt16(offset, true)).toBe(-32768);
      offset += 2;

      // Uint16
      view.setUint16(offset, 65535, true);
      expect(view.getUint16(offset, true)).toBe(65535);
      offset += 2;

      // Int32
      view.setInt32(offset, -2147483648, true);
      expect(view.getInt32(offset, true)).toBe(-2147483648);
      offset += 4;

      // Uint32
      view.setUint32(offset, 4294967295, true);
      expect(view.getUint32(offset, true)).toBe(4294967295);
      offset += 4;

      // Float32
      view.setFloat32(offset, 3.14, true);
      expect(view.getFloat32(offset, true)).toBeCloseTo(3.14, 5);
      offset += 4;

      // Float64
      view.setFloat64(offset, Math.PI, true);
      expect(view.getFloat64(offset, true)).toBe(Math.PI);
      offset += 8;

      // BigInt64
      view.setBigInt64(offset, BigInt('-9223372036854775808'), true);
      expect(view.getBigInt64(offset, true)).toBe(BigInt('-9223372036854775808'));
      offset += 8;

      // BigUint64
      view.setBigUint64(offset, BigInt('18446744073709551615'), true);
      expect(view.getBigUint64(offset, true)).toBe(BigInt('18446744073709551615'));
    });
  });
});

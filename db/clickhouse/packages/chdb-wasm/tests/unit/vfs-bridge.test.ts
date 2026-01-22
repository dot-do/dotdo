/**
 * VFS Bridge Unit Tests
 *
 * Tests the VFS bridge that connects WASM to DO/R2 backends:
 * - Path parsing for MergeTree data structure
 * - File type detection (data files vs metadata files)
 * - InMemoryStorageProvider for isolated testing
 * - VFSBridge file operations (open, read, write, close)
 * - VFSBridge directory operations (opendir, readdir, closedir)
 * - MergeTreeStorageProvider DO/R2 routing
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  VFSBridge,
  InMemoryStorageProvider,
  MergeTreeStorageProvider,
  parseMergeTreePath,
  isDataFile,
  isPartMetadataFile,
  VFS_OK,
  VFS_ENOENT,
  VFS_EBADF,
  VFS_EINVAL,
  VFS_EEXIST,
  VFS_EISDIR,
  VFS_ENOTDIR,
  VFS_ENOTEMPTY,
  VFS_O_RDONLY,
  VFS_O_WRONLY,
  VFS_O_RDWR,
  VFS_O_CREAT,
  VFS_O_TRUNC,
  VFS_O_EXCL,
  VFS_SEEK_SET,
  VFS_SEEK_CUR,
  VFS_SEEK_END,
  VFS_S_IFREG,
  VFS_S_IFDIR,
  type VFSStorageProvider,
  type FileStat,
  type DirEntry,
  type PartMetadata,
} from '../../wasm/vfs/vfs_bridge';

// ---------------------------------------------------------------------------
// Path Parsing Tests
// ---------------------------------------------------------------------------

describe('parseMergeTreePath', () => {
  it('should parse root path', () => {
    const result = parseMergeTreePath('');
    expect(result.type).toBe('root');
    expect(result.partition).toBeNull();
    expect(result.partName).toBeNull();
    expect(result.fileName).toBeNull();
  });

  it('should parse root path with slash', () => {
    const result = parseMergeTreePath('/');
    expect(result.type).toBe('root');
    expect(result.partition).toBeNull();
  });

  it('should parse data directory', () => {
    const result = parseMergeTreePath('data');
    expect(result.type).toBe('data');
    expect(result.partition).toBeNull();
    expect(result.partName).toBeNull();
    expect(result.fileName).toBeNull();
  });

  it('should parse data directory with trailing slash', () => {
    const result = parseMergeTreePath('data/');
    expect(result.type).toBe('data');
    expect(result.partition).toBeNull();
  });

  it('should parse partition path', () => {
    const result = parseMergeTreePath('data/202401_1_1_0');
    expect(result.type).toBe('data');
    expect(result.partition).toBe('202401_1_1_0');
    expect(result.partName).toBeNull();
    expect(result.fileName).toBeNull();
  });

  it('should parse part path', () => {
    const result = parseMergeTreePath('data/202401_1_1_0/all_1_1_0');
    expect(result.type).toBe('data');
    expect(result.partition).toBe('202401_1_1_0');
    expect(result.partName).toBe('all_1_1_0');
    expect(result.fileName).toBeNull();
  });

  it('should parse file path', () => {
    const result = parseMergeTreePath('data/202401_1_1_0/all_1_1_0/id.bin');
    expect(result.type).toBe('data');
    expect(result.partition).toBe('202401_1_1_0');
    expect(result.partName).toBe('all_1_1_0');
    expect(result.fileName).toBe('id.bin');
  });

  it('should normalize multiple slashes', () => {
    const result = parseMergeTreePath('//data///202401_1_1_0//all_1_1_0//');
    expect(result.type).toBe('data');
    expect(result.partition).toBe('202401_1_1_0');
    expect(result.partName).toBe('all_1_1_0');
  });

  it('should parse metadata path', () => {
    const result = parseMergeTreePath('metadata/schema.json');
    expect(result.type).toBe('metadata');
    expect(result.partition).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// File Type Detection Tests
// ---------------------------------------------------------------------------

describe('isDataFile', () => {
  it('should identify .bin files as data files', () => {
    expect(isDataFile('id.bin')).toBe(true);
    expect(isDataFile('name.bin')).toBe(true);
    expect(isDataFile('column.BIN')).toBe(true);
  });

  it('should identify .mrk files as data files', () => {
    expect(isDataFile('id.mrk')).toBe(true);
    expect(isDataFile('id.mrk2')).toBe(true);
    expect(isDataFile('id.mrk3')).toBe(true);
  });

  it('should identify .idx files as data files', () => {
    expect(isDataFile('primary.idx')).toBe(true);
    expect(isDataFile('minmax_id.idx')).toBe(true);
  });

  it('should identify .cidx files as data files', () => {
    expect(isDataFile('column.cidx')).toBe(true);
  });

  it('should not identify non-data files', () => {
    expect(isDataFile('checksums.txt')).toBe(false);
    expect(isDataFile('columns.txt')).toBe(false);
    expect(isDataFile('count.txt')).toBe(false);
    expect(isDataFile('readme.md')).toBe(false);
  });

  it('should handle empty or null input', () => {
    expect(isDataFile('')).toBe(false);
    expect(isDataFile(null as unknown as string)).toBe(false);
  });
});

describe('isPartMetadataFile', () => {
  it('should identify checksums.txt as metadata', () => {
    expect(isPartMetadataFile('checksums.txt')).toBe(true);
  });

  it('should identify columns.txt as metadata', () => {
    expect(isPartMetadataFile('columns.txt')).toBe(true);
  });

  it('should identify count.txt as metadata', () => {
    expect(isPartMetadataFile('count.txt')).toBe(true);
  });

  it('should identify partition.dat as metadata', () => {
    expect(isPartMetadataFile('partition.dat')).toBe(true);
  });

  it('should identify primary.idx as metadata', () => {
    expect(isPartMetadataFile('primary.idx')).toBe(true);
  });

  it('should identify minmax_* files as metadata', () => {
    expect(isPartMetadataFile('minmax_id.idx')).toBe(true);
    expect(isPartMetadataFile('minmax_date.idx')).toBe(true);
  });

  it('should not identify data files as metadata', () => {
    expect(isPartMetadataFile('id.bin')).toBe(false);
    expect(isPartMetadataFile('id.mrk')).toBe(false);
  });

  it('should handle empty or null input', () => {
    expect(isPartMetadataFile('')).toBe(false);
    expect(isPartMetadataFile(null as unknown as string)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// InMemoryStorageProvider Tests
// ---------------------------------------------------------------------------

describe('InMemoryStorageProvider', () => {
  let storage: InMemoryStorageProvider;

  beforeEach(() => {
    storage = new InMemoryStorageProvider();
  });

  describe('stat', () => {
    it('should return null for non-existent file', async () => {
      const stat = await storage.stat('nonexistent.txt');
      expect(stat).toBeNull();
    });

    it('should return stats for existing file', async () => {
      const data = new TextEncoder().encode('hello');
      await storage.write('test.txt', data.buffer);

      const stat = await storage.stat('test.txt');
      expect(stat).not.toBeNull();
      expect(stat!.size).toBe(5);
      expect(stat!.isDirectory).toBe(false);
    });

    it('should return stats for root directory', async () => {
      const stat = await storage.stat('');
      expect(stat).not.toBeNull();
      expect(stat!.isDirectory).toBe(true);
    });

    it('should return stats for created directory', async () => {
      await storage.mkdir('mydir');
      const stat = await storage.stat('mydir');
      expect(stat).not.toBeNull();
      expect(stat!.isDirectory).toBe(true);
    });
  });

  describe('read/write', () => {
    it('should write and read data', async () => {
      const original = new TextEncoder().encode('hello world');
      await storage.write('test.txt', original.buffer);

      const read = await storage.readFile('test.txt');
      const decoded = new TextDecoder().decode(read);
      expect(decoded).toBe('hello world');
    });

    it('should read partial data with offset and length', async () => {
      const original = new TextEncoder().encode('hello world');
      await storage.write('test.txt', original.buffer);

      const read = await storage.read('test.txt', 6, 5);
      const decoded = new TextDecoder().decode(read);
      expect(decoded).toBe('world');
    });

    it('should throw error when reading non-existent file', async () => {
      await expect(storage.readFile('nonexistent.txt')).rejects.toThrow('File not found');
    });
  });

  describe('append', () => {
    it('should append to existing file', async () => {
      const data1 = new TextEncoder().encode('hello');
      const data2 = new TextEncoder().encode(' world');

      await storage.write('test.txt', data1.buffer);
      await storage.append('test.txt', data2.buffer);

      const read = await storage.readFile('test.txt');
      const decoded = new TextDecoder().decode(read);
      expect(decoded).toBe('hello world');
    });

    it('should create file if it does not exist', async () => {
      const data = new TextEncoder().encode('hello');
      await storage.append('new.txt', data.buffer);

      const read = await storage.readFile('new.txt');
      const decoded = new TextDecoder().decode(read);
      expect(decoded).toBe('hello');
    });
  });

  describe('delete', () => {
    it('should delete existing file', async () => {
      const data = new TextEncoder().encode('hello');
      await storage.write('test.txt', data.buffer);

      await storage.delete('test.txt');
      const stat = await storage.stat('test.txt');
      expect(stat).toBeNull();
    });

    it('should delete directory', async () => {
      await storage.mkdir('mydir');
      await storage.delete('mydir');
      const stat = await storage.stat('mydir');
      expect(stat).toBeNull();
    });
  });

  describe('list', () => {
    it('should list files in directory', async () => {
      await storage.write('file1.txt', new ArrayBuffer(0));
      await storage.write('file2.txt', new ArrayBuffer(0));

      const entries = await storage.list('');
      const names = entries.map(e => e.name);
      expect(names).toContain('file1.txt');
      expect(names).toContain('file2.txt');
    });

    it('should list subdirectories', async () => {
      await storage.mkdir('subdir');
      await storage.write('subdir/file.txt', new ArrayBuffer(0));

      const entries = await storage.list('');
      const names = entries.map(e => e.name);
      expect(names).toContain('subdir');

      const subEntry = entries.find(e => e.name === 'subdir');
      expect(subEntry?.isDirectory).toBe(true);
    });

    it('should list files in subdirectory', async () => {
      await storage.write('subdir/file1.txt', new ArrayBuffer(0));
      await storage.write('subdir/file2.txt', new ArrayBuffer(0));

      const entries = await storage.list('subdir');
      const names = entries.map(e => e.name);
      expect(names).toContain('file1.txt');
      expect(names).toContain('file2.txt');
    });
  });

  describe('rename', () => {
    it('should rename file', async () => {
      const data = new TextEncoder().encode('hello');
      await storage.write('old.txt', data.buffer);

      await storage.rename('old.txt', 'new.txt');

      const oldStat = await storage.stat('old.txt');
      expect(oldStat).toBeNull();

      const newData = await storage.readFile('new.txt');
      const decoded = new TextDecoder().decode(newData);
      expect(decoded).toBe('hello');
    });

    it('should rename directory with contents', async () => {
      await storage.mkdir('olddir');
      await storage.write('olddir/file.txt', new TextEncoder().encode('hello').buffer);

      await storage.rename('olddir', 'newdir');

      const oldStat = await storage.stat('olddir');
      expect(oldStat).toBeNull();

      const newStat = await storage.stat('newdir');
      expect(newStat?.isDirectory).toBe(true);

      const fileData = await storage.readFile('newdir/file.txt');
      const decoded = new TextDecoder().decode(fileData);
      expect(decoded).toBe('hello');
    });

    it('should throw error when renaming non-existent path', async () => {
      await expect(storage.rename('nonexistent', 'new')).rejects.toThrow('Path not found');
    });
  });

  describe('mkdir', () => {
    it('should create directory', async () => {
      await storage.mkdir('newdir');
      const stat = await storage.stat('newdir');
      expect(stat?.isDirectory).toBe(true);
    });

    it('should create nested directories', async () => {
      await storage.mkdir('a/b/c');
      const stat = await storage.stat('a/b/c');
      expect(stat?.isDirectory).toBe(true);

      const parentStat = await storage.stat('a/b');
      expect(parentStat?.isDirectory).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// VFSBridge Tests
// ---------------------------------------------------------------------------

describe('VFSBridge', () => {
  let storage: InMemoryStorageProvider;
  let bridge: VFSBridge;
  let wasmMemory: ArrayBuffer;
  let stringBuffer: Map<number, string>;
  let nextStringPtr: number;

  beforeEach(() => {
    storage = new InMemoryStorageProvider();
    bridge = new VFSBridge(storage);

    // Create mock WASM memory (1MB)
    wasmMemory = new ArrayBuffer(1024 * 1024);
    const mockMemory = {
      buffer: wasmMemory,
    } as WebAssembly.Memory;
    bridge.setWasmMemory(mockMemory);

    // String tracking for path arguments
    stringBuffer = new Map();
    nextStringPtr = 1024; // Start strings at offset 1024
  });

  /**
   * Helper to write a string to mock WASM memory and return pointer
   */
  function writeString(str: string): number {
    const ptr = nextStringPtr;
    const bytes = new TextEncoder().encode(str);
    const view = new Uint8Array(wasmMemory);
    view.set(bytes, ptr);
    view[ptr + bytes.length] = 0; // Null terminator
    nextStringPtr += bytes.length + 1;
    stringBuffer.set(ptr, str);
    return ptr;
  }

  describe('vfs_init/vfs_shutdown', () => {
    it('should initialize and shutdown successfully', async () => {
      const dbPtr = writeString('testdb');
      const tablePtr = writeString('testtable');

      const initResult = await bridge.vfs_init(dbPtr, tablePtr);
      expect(initResult).toBe(VFS_OK);

      const shutdownResult = await bridge.vfs_shutdown();
      expect(shutdownResult).toBe(VFS_OK);
    });
  });

  describe('vfs_open', () => {
    it('should return ENOENT for non-existent file without O_CREAT', async () => {
      const pathPtr = writeString('nonexistent.txt');
      const result = await bridge.vfs_open(pathPtr, VFS_O_RDONLY);
      expect(result).toBe(VFS_ENOENT);
    });

    it('should create file with O_CREAT flag', async () => {
      const pathPtr = writeString('newfile.txt');
      const result = await bridge.vfs_open(pathPtr, VFS_O_WRONLY | VFS_O_CREAT);
      expect(result).toBeGreaterThan(0);

      // Close the handle
      await bridge.vfs_close(result);
    });

    it('should return EEXIST with O_CREAT and O_EXCL for existing file', async () => {
      await storage.write('existing.txt', new ArrayBuffer(0));

      const pathPtr = writeString('existing.txt');
      const result = await bridge.vfs_open(pathPtr, VFS_O_WRONLY | VFS_O_CREAT | VFS_O_EXCL);
      expect(result).toBe(VFS_EEXIST);
    });

    it('should return EISDIR when opening directory as file', async () => {
      await storage.mkdir('mydir');

      const pathPtr = writeString('mydir');
      const result = await bridge.vfs_open(pathPtr, VFS_O_RDONLY);
      expect(result).toBe(VFS_EISDIR);
    });

    it('should return valid handle for existing file', async () => {
      await storage.write('existing.txt', new TextEncoder().encode('hello').buffer);

      const pathPtr = writeString('existing.txt');
      const result = await bridge.vfs_open(pathPtr, VFS_O_RDONLY);
      expect(result).toBeGreaterThan(0);

      await bridge.vfs_close(result);
    });
  });

  describe('vfs_close', () => {
    it('should return EBADF for invalid handle', async () => {
      const result = await bridge.vfs_close(9999);
      expect(result).toBe(VFS_EBADF);
    });

    it('should close valid handle', async () => {
      await storage.write('test.txt', new ArrayBuffer(0));
      const pathPtr = writeString('test.txt');
      const handle = await bridge.vfs_open(pathPtr, VFS_O_RDONLY);

      const result = await bridge.vfs_close(handle);
      expect(result).toBe(VFS_OK);
    });

    it('should flush writes on close', async () => {
      const pathPtr = writeString('output.txt');
      const handle = await bridge.vfs_open(pathPtr, VFS_O_WRONLY | VFS_O_CREAT);

      // Write some data
      const data = new TextEncoder().encode('hello');
      const dataPtr = 2048;
      new Uint8Array(wasmMemory).set(data, dataPtr);
      await bridge.vfs_write(handle, dataPtr, data.length);

      // Close to flush
      await bridge.vfs_close(handle);

      // Verify data was written
      const read = await storage.readFile('output.txt');
      expect(new TextDecoder().decode(read)).toBe('hello');
    });
  });

  describe('vfs_read', () => {
    it('should return EBADF for invalid handle', async () => {
      const result = await bridge.vfs_read(9999, 0, 100);
      expect(result).toBe(VFS_EBADF);
    });

    it('should return EINVAL for write-only handle', async () => {
      const pathPtr = writeString('test.txt');
      const handle = await bridge.vfs_open(pathPtr, VFS_O_WRONLY | VFS_O_CREAT);

      const result = await bridge.vfs_read(handle, 2048, 100);
      expect(result).toBe(VFS_EINVAL);

      await bridge.vfs_close(handle);
    });

    it('should read file contents into buffer', async () => {
      const content = 'hello world';
      await storage.write('test.txt', new TextEncoder().encode(content).buffer);

      const pathPtr = writeString('test.txt');
      const handle = await bridge.vfs_open(pathPtr, VFS_O_RDONLY);

      const bufferPtr = 2048;
      const bytesRead = await bridge.vfs_read(handle, bufferPtr, 100);
      expect(bytesRead).toBe(content.length);

      const readData = new Uint8Array(wasmMemory, bufferPtr, bytesRead);
      expect(new TextDecoder().decode(readData)).toBe(content);

      await bridge.vfs_close(handle);
    });

    it('should return 0 at EOF', async () => {
      await storage.write('test.txt', new TextEncoder().encode('hi').buffer);

      const pathPtr = writeString('test.txt');
      const handle = await bridge.vfs_open(pathPtr, VFS_O_RDONLY);

      // Read all content
      await bridge.vfs_read(handle, 2048, 100);

      // Try to read more
      const result = await bridge.vfs_read(handle, 2048, 100);
      expect(result).toBe(0);

      await bridge.vfs_close(handle);
    });
  });

  describe('vfs_write', () => {
    it('should return EBADF for invalid handle', async () => {
      const result = await bridge.vfs_write(9999, 0, 100);
      expect(result).toBe(VFS_EBADF);
    });

    it('should return EINVAL for read-only handle', async () => {
      await storage.write('test.txt', new ArrayBuffer(0));
      const pathPtr = writeString('test.txt');
      const handle = await bridge.vfs_open(pathPtr, VFS_O_RDONLY);

      const result = await bridge.vfs_write(handle, 2048, 100);
      expect(result).toBe(VFS_EINVAL);

      await bridge.vfs_close(handle);
    });

    it('should write data from buffer', async () => {
      const pathPtr = writeString('output.txt');
      const handle = await bridge.vfs_open(pathPtr, VFS_O_WRONLY | VFS_O_CREAT);

      const content = 'test data';
      const data = new TextEncoder().encode(content);
      const dataPtr = 2048;
      new Uint8Array(wasmMemory).set(data, dataPtr);

      const bytesWritten = await bridge.vfs_write(handle, dataPtr, data.length);
      expect(bytesWritten).toBe(data.length);

      await bridge.vfs_close(handle);

      const read = await storage.readFile('output.txt');
      expect(new TextDecoder().decode(read)).toBe(content);
    });
  });

  describe('vfs_seek', () => {
    it('should return EBADF for invalid handle', () => {
      const result = bridge.vfs_seek(9999, 0, VFS_SEEK_SET);
      expect(result).toBe(VFS_EBADF);
    });

    it('should seek with SEEK_SET', async () => {
      await storage.write('test.txt', new TextEncoder().encode('hello world').buffer);
      const pathPtr = writeString('test.txt');
      const handle = await bridge.vfs_open(pathPtr, VFS_O_RDONLY);

      const result = bridge.vfs_seek(handle, 6, VFS_SEEK_SET);
      expect(result).toBe(6);

      await bridge.vfs_close(handle);
    });

    it('should seek with SEEK_CUR', async () => {
      await storage.write('test.txt', new TextEncoder().encode('hello world').buffer);
      const pathPtr = writeString('test.txt');
      const handle = await bridge.vfs_open(pathPtr, VFS_O_RDONLY);

      bridge.vfs_seek(handle, 3, VFS_SEEK_SET);
      const result = bridge.vfs_seek(handle, 2, VFS_SEEK_CUR);
      expect(result).toBe(5);

      await bridge.vfs_close(handle);
    });

    it('should seek with SEEK_END', async () => {
      await storage.write('test.txt', new TextEncoder().encode('hello world').buffer);
      const pathPtr = writeString('test.txt');
      const handle = await bridge.vfs_open(pathPtr, VFS_O_RDONLY);

      const result = bridge.vfs_seek(handle, -5, VFS_SEEK_END);
      expect(result).toBe(6); // 11 - 5

      await bridge.vfs_close(handle);
    });

    it('should return EINVAL for negative position', async () => {
      await storage.write('test.txt', new TextEncoder().encode('hello').buffer);
      const pathPtr = writeString('test.txt');
      const handle = await bridge.vfs_open(pathPtr, VFS_O_RDONLY);

      const result = bridge.vfs_seek(handle, -100, VFS_SEEK_SET);
      expect(result).toBe(VFS_EINVAL);

      await bridge.vfs_close(handle);
    });
  });

  describe('vfs_stat', () => {
    it('should return ENOENT for non-existent file', async () => {
      const pathPtr = writeString('nonexistent.txt');
      const statPtr = 4096;
      const result = await bridge.vfs_stat(pathPtr, statPtr);
      expect(result).toBe(VFS_ENOENT);
    });

    it('should return stats for file', async () => {
      await storage.write('test.txt', new TextEncoder().encode('hello').buffer);

      const pathPtr = writeString('test.txt');
      const statPtr = 4096;
      const result = await bridge.vfs_stat(pathPtr, statPtr);
      expect(result).toBe(VFS_OK);

      const view = new DataView(wasmMemory);
      const mode = view.getUint32(statPtr, true);
      const size = Number(view.getBigUint64(statPtr + 8, true));

      expect(mode).toBe(VFS_S_IFREG);
      expect(size).toBe(5);
    });

    it('should return stats for directory', async () => {
      await storage.mkdir('mydir');

      const pathPtr = writeString('mydir');
      const statPtr = 4096;
      const result = await bridge.vfs_stat(pathPtr, statPtr);
      expect(result).toBe(VFS_OK);

      const view = new DataView(wasmMemory);
      const mode = view.getUint32(statPtr, true);
      expect(mode).toBe(VFS_S_IFDIR);
    });
  });

  describe('vfs_opendir/vfs_readdir/vfs_closedir', () => {
    beforeEach(async () => {
      await storage.write('file1.txt', new ArrayBuffer(0));
      await storage.write('file2.txt', new ArrayBuffer(100));
      await storage.mkdir('subdir');
    });

    it('should open directory and list entries', async () => {
      const pathPtr = writeString('');
      const handle = await bridge.vfs_opendir(pathPtr);
      expect(handle).toBeGreaterThan(0);

      const entries: string[] = [];
      const entryPtr = 8192;

      let readResult = bridge.vfs_readdir(handle, entryPtr);
      while (readResult === VFS_OK) {
        // Read name from dirent struct (first 256 bytes)
        const nameBytes = new Uint8Array(wasmMemory, entryPtr, 256);
        let nameEnd = 0;
        while (nameBytes[nameEnd] !== 0 && nameEnd < 256) nameEnd++;
        const name = new TextDecoder().decode(nameBytes.slice(0, nameEnd));
        entries.push(name);
        readResult = bridge.vfs_readdir(handle, entryPtr);
      }

      expect(entries).toContain('file1.txt');
      expect(entries).toContain('file2.txt');
      expect(entries).toContain('subdir');

      const closeResult = bridge.vfs_closedir(handle);
      expect(closeResult).toBe(VFS_OK);
    });

    it('should return EBADF for invalid directory handle', () => {
      const result = bridge.vfs_readdir(9999, 0);
      expect(result).toBe(VFS_EBADF);
    });

    it('should return EBADF when closing invalid handle', () => {
      const result = bridge.vfs_closedir(9999);
      expect(result).toBe(VFS_EBADF);
    });
  });

  describe('vfs_unlink', () => {
    it('should delete file', async () => {
      await storage.write('test.txt', new ArrayBuffer(0));

      const pathPtr = writeString('test.txt');
      const result = await bridge.vfs_unlink(pathPtr);
      expect(result).toBe(VFS_OK);

      const stat = await storage.stat('test.txt');
      expect(stat).toBeNull();
    });

    it('should return ENOENT for non-existent file', async () => {
      const pathPtr = writeString('nonexistent.txt');
      const result = await bridge.vfs_unlink(pathPtr);
      expect(result).toBe(VFS_ENOENT);
    });

    it('should return EISDIR for directory', async () => {
      await storage.mkdir('mydir');

      const pathPtr = writeString('mydir');
      const result = await bridge.vfs_unlink(pathPtr);
      expect(result).toBe(VFS_EISDIR);
    });
  });

  describe('vfs_rmdir', () => {
    it('should delete empty directory', async () => {
      await storage.mkdir('emptydir');

      const pathPtr = writeString('emptydir');
      const result = await bridge.vfs_rmdir(pathPtr);
      expect(result).toBe(VFS_OK);
    });

    it('should return ENOENT for non-existent directory', async () => {
      const pathPtr = writeString('nonexistent');
      const result = await bridge.vfs_rmdir(pathPtr);
      expect(result).toBe(VFS_ENOENT);
    });

    it('should return ENOTDIR for file', async () => {
      await storage.write('file.txt', new ArrayBuffer(0));

      const pathPtr = writeString('file.txt');
      const result = await bridge.vfs_rmdir(pathPtr);
      expect(result).toBe(VFS_ENOTDIR);
    });

    it('should return ENOTEMPTY for non-empty directory', async () => {
      await storage.mkdir('nonempty');
      await storage.write('nonempty/file.txt', new ArrayBuffer(0));

      const pathPtr = writeString('nonempty');
      const result = await bridge.vfs_rmdir(pathPtr);
      expect(result).toBe(VFS_ENOTEMPTY);
    });
  });

  describe('vfs_rename', () => {
    it('should rename file', async () => {
      await storage.write('old.txt', new TextEncoder().encode('content').buffer);

      const oldPathPtr = writeString('old.txt');
      const newPathPtr = writeString('new.txt');
      const result = await bridge.vfs_rename(oldPathPtr, newPathPtr);
      expect(result).toBe(VFS_OK);

      const oldStat = await storage.stat('old.txt');
      expect(oldStat).toBeNull();

      const newData = await storage.readFile('new.txt');
      expect(new TextDecoder().decode(newData)).toBe('content');
    });

    it('should return ENOENT for non-existent source', async () => {
      const oldPathPtr = writeString('nonexistent.txt');
      const newPathPtr = writeString('new.txt');
      const result = await bridge.vfs_rename(oldPathPtr, newPathPtr);
      expect(result).toBe(VFS_ENOENT);
    });
  });

  describe('vfs_fsync', () => {
    it('should return EBADF for invalid handle', async () => {
      const result = await bridge.vfs_fsync(9999);
      expect(result).toBe(VFS_EBADF);
    });

    it('should flush pending writes', async () => {
      const pathPtr = writeString('output.txt');
      const handle = await bridge.vfs_open(pathPtr, VFS_O_WRONLY | VFS_O_CREAT);

      const data = new TextEncoder().encode('test');
      const dataPtr = 2048;
      new Uint8Array(wasmMemory).set(data, dataPtr);
      await bridge.vfs_write(handle, dataPtr, data.length);

      const result = await bridge.vfs_fsync(handle);
      expect(result).toBe(VFS_OK);

      // Data should be persisted
      const read = await storage.readFile('output.txt');
      expect(new TextDecoder().decode(read)).toBe('test');

      await bridge.vfs_close(handle);
    });
  });
});

// ---------------------------------------------------------------------------
// MergeTreeStorageProvider Mock Tests
// ---------------------------------------------------------------------------

describe('MergeTreeStorageProvider', () => {
  let mockR2Storage: {
    stat: ReturnType<typeof vi.fn>;
    read: ReturnType<typeof vi.fn>;
    readFile: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    append: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
  };

  let mockDurableObject: {
    listParts: ReturnType<typeof vi.fn>;
    registerPart: ReturnType<typeof vi.fn>;
    unregisterPart: ReturnType<typeof vi.fn>;
    renamePart: ReturnType<typeof vi.fn>;
    flush: ReturnType<typeof vi.fn>;
  };

  let provider: MergeTreeStorageProvider;

  beforeEach(() => {
    mockR2Storage = {
      stat: vi.fn(),
      read: vi.fn(),
      readFile: vi.fn(),
      write: vi.fn(),
      append: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
    };

    mockDurableObject = {
      listParts: vi.fn().mockResolvedValue([]),
      registerPart: vi.fn().mockResolvedValue(undefined),
      unregisterPart: vi.fn().mockResolvedValue(undefined),
      renamePart: vi.fn().mockResolvedValue(undefined),
      flush: vi.fn().mockResolvedValue(undefined),
    };

    provider = new MergeTreeStorageProvider(
      mockR2Storage as any,
      mockDurableObject as any,
      'testdb',
      'testtable'
    );
  });

  describe('stat', () => {
    it('should return directory stat for root', async () => {
      const stat = await provider.stat('');
      expect(stat).not.toBeNull();
      expect(stat!.isDirectory).toBe(true);
    });

    it('should return directory stat for data directory', async () => {
      const stat = await provider.stat('data');
      expect(stat).not.toBeNull();
      expect(stat!.isDirectory).toBe(true);
    });

    it('should return partition stat when parts exist', async () => {
      mockDurableObject.listParts.mockResolvedValue([
        {
          partName: 'all_1_1_0',
          partition: '202401',
          rowCount: 100,
          sizeBytes: 1024,
          createdAt: Date.now(),
          minBlock: 1,
          maxBlock: 1,
          level: 0,
        },
      ]);

      const stat = await provider.stat('data/202401');
      expect(stat).not.toBeNull();
      expect(stat!.isDirectory).toBe(true);
    });

    it('should return null for non-existent partition', async () => {
      mockDurableObject.listParts.mockResolvedValue([]);

      const stat = await provider.stat('data/nonexistent');
      expect(stat).toBeNull();
    });

    it('should return part stat when part exists', async () => {
      const createdAt = Date.now();
      mockDurableObject.listParts.mockResolvedValue([
        {
          partName: 'all_1_1_0',
          partition: '202401',
          rowCount: 100,
          sizeBytes: 2048,
          createdAt,
          minBlock: 1,
          maxBlock: 1,
          level: 0,
        },
      ]);

      const stat = await provider.stat('data/202401/all_1_1_0');
      expect(stat).not.toBeNull();
      expect(stat!.isDirectory).toBe(true);
      expect(stat!.size).toBe(2048);
    });

    it('should return file stat from R2', async () => {
      mockR2Storage.stat.mockResolvedValue({
        size: 512,
        modified: new Date(),
      });

      const stat = await provider.stat('data/202401/all_1_1_0/id.bin');
      expect(stat).not.toBeNull();
      expect(stat!.isDirectory).toBe(false);
      expect(stat!.size).toBe(512);

      expect(mockR2Storage.stat).toHaveBeenCalledWith('testdb/testtable/data/202401/all_1_1_0/id.bin');
    });
  });

  describe('read', () => {
    it('should read file from R2', async () => {
      const content = new TextEncoder().encode('test data');
      mockR2Storage.read.mockResolvedValue(content.buffer);

      const data = await provider.read('data/202401/all_1_1_0/id.bin', 0, 100);
      expect(new TextDecoder().decode(data)).toBe('test data');
      expect(mockR2Storage.read).toHaveBeenCalledWith(
        'testdb/testtable/data/202401/all_1_1_0/id.bin',
        0,
        100
      );
    });

    it('should throw error for non-data path', async () => {
      await expect(provider.read('data/202401', 0, 100)).rejects.toThrow(
        'Cannot read directory'
      );
    });
  });

  describe('write', () => {
    it('should write file to R2', async () => {
      mockR2Storage.write.mockResolvedValue(undefined);

      const data = new TextEncoder().encode('test data');
      await provider.write('data/202401/all_1_1_0/id.bin', data.buffer);

      expect(mockR2Storage.write).toHaveBeenCalledWith(
        'testdb/testtable/data/202401/all_1_1_0/id.bin',
        data.buffer
      );
    });

    it('should throw error for non-data path', async () => {
      await expect(provider.write('data/202401', new ArrayBuffer(0))).rejects.toThrow(
        'Cannot write to directory'
      );
    });
  });

  describe('list', () => {
    it('should return data directory for root', async () => {
      const entries = await provider.list('');
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('data');
      expect(entries[0].isDirectory).toBe(true);
    });

    it('should list partitions from DO', async () => {
      mockDurableObject.listParts.mockResolvedValue([
        { partName: 'part1', partition: '202401', rowCount: 0, sizeBytes: 0, createdAt: 0, minBlock: 0, maxBlock: 0, level: 0 },
        { partName: 'part2', partition: '202402', rowCount: 0, sizeBytes: 0, createdAt: 0, minBlock: 0, maxBlock: 0, level: 0 },
      ]);

      const entries = await provider.list('data');
      const names = entries.map(e => e.name);
      expect(names).toContain('202401');
      expect(names).toContain('202402');
    });

    it('should list parts in partition from DO', async () => {
      mockDurableObject.listParts.mockResolvedValue([
        { partName: 'all_1_1_0', partition: '202401', rowCount: 100, sizeBytes: 1024, createdAt: 0, minBlock: 0, maxBlock: 0, level: 0 },
        { partName: 'all_2_2_0', partition: '202401', rowCount: 200, sizeBytes: 2048, createdAt: 0, minBlock: 0, maxBlock: 0, level: 0 },
      ]);

      const entries = await provider.list('data/202401');
      const names = entries.map(e => e.name);
      expect(names).toContain('all_1_1_0');
      expect(names).toContain('all_2_2_0');
    });

    it('should list files in part from R2', async () => {
      mockR2Storage.list.mockResolvedValue([
        'testdb/testtable/data/202401/all_1_1_0/id.bin',
        'testdb/testtable/data/202401/all_1_1_0/id.mrk2',
        'testdb/testtable/data/202401/all_1_1_0/checksums.txt',
      ]);

      const entries = await provider.list('data/202401/all_1_1_0');
      const names = entries.map(e => e.name);
      expect(names).toContain('id.bin');
      expect(names).toContain('id.mrk2');
      expect(names).toContain('checksums.txt');
    });
  });

  describe('mkdir', () => {
    it('should register part with DO', async () => {
      await provider.mkdir('data/202401/all_1_1_0');

      expect(mockDurableObject.registerPart).toHaveBeenCalledWith(
        expect.objectContaining({
          partName: 'all_1_1_0',
          partition: '202401',
        })
      );
    });
  });

  describe('delete', () => {
    it('should delete file from R2', async () => {
      mockR2Storage.delete.mockResolvedValue(undefined);

      await provider.delete('data/202401/all_1_1_0/id.bin');

      expect(mockR2Storage.delete).toHaveBeenCalledWith(
        'testdb/testtable/data/202401/all_1_1_0/id.bin'
      );
    });

    it('should delete part from R2 and DO', async () => {
      mockR2Storage.list.mockResolvedValue([
        'testdb/testtable/data/202401/all_1_1_0/id.bin',
        'testdb/testtable/data/202401/all_1_1_0/id.mrk2',
      ]);
      mockR2Storage.delete.mockResolvedValue(undefined);

      await provider.delete('data/202401/all_1_1_0');

      expect(mockR2Storage.delete).toHaveBeenCalledTimes(2);
      expect(mockDurableObject.unregisterPart).toHaveBeenCalledWith('all_1_1_0');
    });
  });

  describe('rename', () => {
    it('should rename file in R2', async () => {
      const content = new TextEncoder().encode('data');
      mockR2Storage.readFile.mockResolvedValue(content.buffer);
      mockR2Storage.write.mockResolvedValue(undefined);
      mockR2Storage.delete.mockResolvedValue(undefined);

      await provider.rename(
        'data/202401/all_1_1_0/old.bin',
        'data/202401/all_1_1_0/new.bin'
      );

      expect(mockR2Storage.readFile).toHaveBeenCalled();
      expect(mockR2Storage.write).toHaveBeenCalled();
      expect(mockR2Storage.delete).toHaveBeenCalled();
    });

    it('should rename part in R2 and DO', async () => {
      mockR2Storage.list.mockResolvedValue([
        'testdb/testtable/data/202401/all_1_1_0/id.bin',
      ]);
      mockR2Storage.readFile.mockResolvedValue(new ArrayBuffer(0));
      mockR2Storage.write.mockResolvedValue(undefined);
      mockR2Storage.delete.mockResolvedValue(undefined);

      // Pre-populate part cache
      mockDurableObject.listParts.mockResolvedValue([
        { partName: 'all_1_1_0', partition: '202401', rowCount: 0, sizeBytes: 0, createdAt: 0, minBlock: 0, maxBlock: 0, level: 0 },
      ]);
      await provider.list('data/202401'); // Force cache population

      await provider.rename('data/202401/all_1_1_0', 'data/202401/all_2_2_0');

      expect(mockDurableObject.renamePart).toHaveBeenCalledWith('all_1_1_0', 'all_2_2_0');
    });
  });

  describe('flush', () => {
    it('should flush DO', async () => {
      await provider.flush();
      expect(mockDurableObject.flush).toHaveBeenCalled();
    });
  });

  describe('cache behavior', () => {
    it('should cache part metadata', async () => {
      mockDurableObject.listParts.mockResolvedValue([
        { partName: 'all_1_1_0', partition: '202401', rowCount: 100, sizeBytes: 1024, createdAt: Date.now(), minBlock: 1, maxBlock: 1, level: 0 },
      ]);

      // First call - fetches from DO
      await provider.stat('data/202401/all_1_1_0');
      expect(mockDurableObject.listParts).toHaveBeenCalledTimes(1);

      // Second call - uses cache
      await provider.stat('data/202401/all_1_1_0');
      expect(mockDurableObject.listParts).toHaveBeenCalledTimes(1);
    });

    it('should invalidate cache', async () => {
      mockDurableObject.listParts.mockResolvedValue([
        { partName: 'all_1_1_0', partition: '202401', rowCount: 100, sizeBytes: 1024, createdAt: Date.now(), minBlock: 1, maxBlock: 1, level: 0 },
      ]);

      await provider.stat('data/202401/all_1_1_0');
      expect(mockDurableObject.listParts).toHaveBeenCalledTimes(1);

      provider.invalidateCache();

      await provider.stat('data/202401/all_1_1_0');
      expect(mockDurableObject.listParts).toHaveBeenCalledTimes(2);
    });
  });
});

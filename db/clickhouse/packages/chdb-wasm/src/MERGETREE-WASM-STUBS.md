# MergeTree WASM Compatibility Stubs

This document describes how ClickHouse's MergeTree storage engine is adapted for WASM environments (specifically Cloudflare Workers).

## Architecture Overview

ClickHouse's MergeTree relies on several system-level features that are problematic in WASM:

1. **Direct File I/O** - Native `open()`, `read()`, `write()`, `close()`
2. **Memory-Mapped Files** - `mmap()`, `munmap()`, `MAP_SHARED`
3. **Background Threading** - `std::thread`, `ThreadPool`, `BackgroundSchedulePool`
4. **Disk Space Management** - `statvfs()`, disk space reservation
5. **File System Metadata** - `stat()`, `fstat()`, timestamps

## ClickHouse C++ Abstraction Points

### 1. IDataPartStorage Interface

**Location**: `vendor/chdb/src/Storages/MergeTree/IDataPartStorage.h`

This abstract interface provides the primary extension point for part storage:

```cpp
class IDataPartStorage : public boost::noncopyable
{
public:
    // File operations
    virtual std::unique_ptr<ReadBufferFromFileBase> readFile(...) const = 0;
    virtual std::unique_ptr<WriteBufferFromFileBase> writeFile(...) = 0;

    // Directory operations
    virtual void createDirectories() = 0;
    virtual bool exists() const = 0;
    virtual bool existsFile(const std::string & name) const = 0;

    // Metadata
    virtual size_t getFileSize(const std::string & file_name) const = 0;
    virtual Poco::Timestamp getLastModified() const = 0;
};
```

**WASM Strategy**: Implement a `WasmDataPartStorage` that delegates to our VFS bridge.

### 2. IDisk Interface

**Location**: `vendor/chdb/src/Disks/IDisk.h`

The disk abstraction handles storage-level operations:

```cpp
class IDisk : public Space
{
public:
    // Space management
    virtual std::optional<UInt64> getTotalSpace() const = 0;
    virtual std::optional<UInt64> getAvailableSpace() const = 0;
    virtual ReservationPtr reserve(UInt64 bytes) = 0;

    // File operations
    virtual std::unique_ptr<ReadBufferFromFileBase> readFile(...) const = 0;
    virtual std::unique_ptr<WriteBufferFromFileBase> writeFile(...) = 0;

    // Hard links
    virtual void createHardLink(const String & src, const String & dst) = 0;
    virtual bool supportsHardLinks() const { return true; }
};
```

**WASM Strategy**:
- `getTotalSpace()`/`getAvailableSpace()` -> Return infinite (object storage)
- `reserve()` -> Always succeed
- `createHardLink()` -> Fall back to copy
- `supportsHardLinks()` -> Return false

### 3. ReadSettings

**Location**: `vendor/chdb/src/IO/ReadSettings.h`

Controls read behavior including mmap:

```cpp
struct ReadSettings
{
    LocalFSReadMethod local_fs_method = LocalFSReadMethod::pread;
    size_t mmap_threshold = 0;
    MMappedFileCache * mmap_cache = nullptr;
    bool load_marks_asynchronously = true;
};
```

**WASM Strategy**:
- `local_fs_method` -> Force `pread` (never `mmap`)
- `mmap_threshold` -> Set to 0 (disable mmap)
- `load_marks_asynchronously` -> false (no async in WASM)

### 4. MergeTreeBackgroundExecutor

**Location**: `vendor/chdb/src/Storages/MergeTree/MergeTreeBackgroundExecutor.h`

Manages background merge and mutation tasks:

```cpp
template <class Queue>
class MergeTreeBackgroundExecutor final : boost::noncopyable
{
public:
    bool trySchedule(ExecutableTaskPtr task);
    void removeTasksCorrespondingToStorage(StorageID id);
    void wait();
private:
    std::unique_ptr<ThreadPool> pool;
};
```

**WASM Strategy**: Disable completely. Merges/mutations are either:
- Synchronous during query execution
- Skipped entirely (read-only mode)

### 5. MMappedFile Classes

**Location**: `vendor/chdb/src/IO/MMappedFileDescriptor.h`, `MMappedFile.h`

Direct memory mapping:

```cpp
class MMappedFileDescriptor
{
public:
    MMappedFileDescriptor(int fd_, size_t offset_, size_t length_);
    char * getData() { return data; }
private:
    char * data = nullptr;  // Points to mmap'd region
};
```

**WASM Strategy**:
- Never instantiate these classes
- Use pread-based buffers instead
- Set `min_bytes_to_use_mmap_io = 0` in settings

## TypeScript VFS Bridge

The VFS bridge (`src/wasm/vfs-bridge.ts`) provides the JavaScript side:

### File Handle Operations

| VFS Function | ClickHouse Equivalent | Implementation |
|--------------|----------------------|----------------|
| `vfs_open()` | `open()` | Create handle, track state |
| `vfs_close()` | `close()` | Flush buffers, cleanup |
| `vfs_read()` | `pread()` | Delegate to storage provider |
| `vfs_write()` | `write()` | Buffer then delegate |
| `vfs_seek()` | `lseek()` | Update position in handle |
| `vfs_stat()` | `stat()` | Get metadata from storage |

### Directory Operations

| VFS Function | ClickHouse Equivalent | Implementation |
|--------------|----------------------|----------------|
| `vfs_opendir()` | `opendir()` | List from storage provider |
| `vfs_readdir()` | `readdir()` | Return next entry |
| `vfs_closedir()` | `closedir()` | Cleanup handle |
| `vfs_mkdir()` | `mkdir()` | Delegate to storage provider |

## What's Real vs Stubbed

### REAL (Fully Functional)

| Feature | Implementation |
|---------|---------------|
| File read | VFS bridge -> Storage provider |
| File write | VFS bridge with buffering |
| Directory ops | VFS bridge -> Storage provider |
| Part metadata | columns.txt, checksums.txt parsing |
| Column data | *.bin file reading |
| Mark files | *.mrk, *.mrk2, *.mrk3 reading |
| Primary index | primary.idx reading |

### STUBBED (No-op or Fixed Response)

| Feature | Stub Behavior | Reason |
|---------|--------------|--------|
| `mmap()` | Disabled | Not available in WASM |
| Background merges | Disabled | No threads in WASM |
| Background mutations | Disabled | No threads in WASM |
| Disk space checks | Return infinite | Object storage has no limit |
| `fsync()` | No-op | Object storage handles consistency |
| Hard links | Copy fallback | Object storage doesn't support |
| File locking | No-op | Single-worker model |
| io_uring | Disabled | Not available in WASM |

### DISABLED (Throws Error)

| Feature | Error | Reason |
|---------|-------|--------|
| Replicated tables | Not supported | Requires ZooKeeper |
| Part fetches | Not supported | Requires replica network |
| Backup/restore | Not supported | Requires local disk |

## Compile-Time Flags

When building chdb for WASM, these flags should be set:

```cmake
# Disable mmap
set(ENABLE_MMAP_IO OFF)

# Disable threading features
set(ENABLE_MULTITHREADING OFF)
set(MAX_BACKGROUND_THREADS 0)

# Disable io_uring
set(ENABLE_IO_URING OFF)

# Force pread method
set(DEFAULT_READ_METHOD pread)

# Disable replicated tables
set(ENABLE_REPLICATED OFF)
```

## Runtime Configuration

The WASM module should be initialized with these settings:

```sql
SET min_bytes_to_use_mmap_io = 0;
SET local_filesystem_read_method = 'pread';
SET max_threads = 1;
SET max_insert_threads = 1;
SET enable_async_events = 0;
```

## Storage Provider Interface

The `VFSStorageProvider` interface connects to actual storage:

```typescript
interface VFSStorageProvider {
  stat(path: string): Promise<FileStat | null>;
  read(path: string, offset: number, length: number): Promise<ArrayBuffer>;
  readFile(path: string): Promise<ArrayBuffer>;
  write(path: string, data: ArrayBuffer): Promise<void>;
  append(path: string, data: ArrayBuffer): Promise<void>;
  delete(path: string): Promise<void>;
  list(path: string): Promise<DirEntry[]>;
  mkdir(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  flush(): Promise<void>;
}
```

Implementations include:
- `InMemoryStorageProvider` - For testing
- R2StorageProvider - For production (Cloudflare R2)
- DOStorageProvider - For metadata (Durable Objects)

## Performance Considerations

1. **No mmap means more copies**: Data must be copied into WASM memory
2. **No async marks loading**: Marks are loaded synchronously
3. **No background merges**: Parts accumulate until manual merge
4. **Buffer sizes matter**: Tune `readBufferSize` for workload

## Future Work

1. **Partial mmap emulation**: Use SharedArrayBuffer if available
2. **Web Workers for merges**: Offload merge work to separate workers
3. **Streaming reads**: Implement ReadableStream support
4. **Compressed storage**: Store parts compressed in R2

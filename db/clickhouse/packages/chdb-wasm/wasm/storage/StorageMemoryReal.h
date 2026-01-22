/**
 * StorageMemoryReal.h - Real ClickHouse StorageMemory patterns for WASM
 *
 * This implementation follows the REAL ClickHouse StorageMemory.cpp patterns:
 *   - Uses MultiVersion<Blocks> for thread-safe data storage
 *   - Stores data as std::vector<Block>
 *   - Implements read/write operations following ClickHouse conventions
 *   - No disk I/O (perfect for WASM)
 *
 * Reference: vendor/chdb/src/Storages/StorageMemory.cpp
 *
 * Key patterns from real StorageMemory:
 *   1. MultiVersion<Blocks> data - copy-on-write block storage
 *   2. SnapshotData - point-in-time view of blocks
 *   3. MemorySink - batched writes with block append
 *   4. Atomic size counters for rows/bytes
 */

#pragma once

#include "StorageStandalone.h"
#include <atomic>
#include <mutex>

namespace DB
{

/**
 * StorageMemory - In-memory table storage (REAL ClickHouse pattern)
 *
 * This class implements the same data model as ClickHouse's StorageMemory:
 *   - Data stored as MultiVersion<Blocks> for thread-safe reads during writes
 *   - Atomic counters for total_size_bytes and total_size_rows
 *   - Snapshot-based reads for consistent query results
 */
class StorageMemory : public std::enable_shared_from_this<StorageMemory>
{
    friend class MemorySink;

public:
    StorageMemory(
        const StorageID& table_id,
        ColumnsDescription columns_description,
        ConstraintsDescription constraints,
        const String& comment);

    ~StorageMemory() = default;

    String getName() const { return "Memory"; }

    const StorageID& getStorageID() const { return storage_id_; }
    size_t getSize() const { return data_.get()->size(); }

    /// Snapshot for StorageMemory contains current set of blocks
    /// at the moment of the start of query (same as real ClickHouse)
    struct SnapshotData
    {
        std::shared_ptr<const Blocks> blocks;
        size_t rows_approx = 0;
    };

    /// Get a snapshot for reading (thread-safe)
    SnapshotData getSnapshot() const;

    /// Get metadata
    StorageMetadataPtr getMetadata() const { return metadata_.get(); }
    const ColumnsDescription& getColumns() const { return metadata_.get()->getColumns(); }

    /// Read operations - returns blocks matching the query
    Blocks read(
        const std::vector<String>& column_names,
        size_t max_block_size = 0);

    /// Write operations - insert a block of data
    void write(const Block& block);

    /// Write multiple blocks
    void write(const Blocks& blocks);

    /// Drop - clear all data
    void drop();

    /// Truncate - clear all data (same as drop for Memory engine)
    void truncate();

    /// Get total row count (atomic read)
    std::optional<size_t> totalRows() const;

    /// Get total bytes (atomic read)
    std::optional<size_t> totalBytes() const;

    /// Check if storage supports certain operations
    bool supportsParallelInsert() const { return true; }
    bool supportsSubcolumns() const { return true; }
    bool prefersLargeBlocks() const { return false; }
    bool hasEvenlyDistributedRead() const { return true; }

private:
    StorageID storage_id_;

    /// MultiVersion data storage (same as real ClickHouse)
    /// Allows concurrent reads while writing
    MultiVersion<Blocks> data_;

    /// Metadata (columns, constraints, etc.)
    MultiVersionStorageMetadataPtr metadata_;

    /// Mutex for write operations
    mutable std::mutex mutex_;

    /// Atomic counters (same as real ClickHouse)
    std::atomic<size_t> total_size_bytes_{0};
    std::atomic<size_t> total_size_rows_{0};
};

/**
 * MemorySink - Write sink for StorageMemory
 *
 * Collects blocks during a write operation and commits them atomically.
 * Same pattern as ClickHouse's MemorySink class.
 */
class MemorySink
{
public:
    MemorySink(StorageMemory& storage, const StorageMetadataPtr& metadata_snapshot);

    String getName() const { return "MemorySink"; }

    /// Consume a chunk of data (block)
    void consume(const Block& block);

    /// Finish writing - commit all blocks atomically
    void onFinish();

private:
    Blocks new_blocks_;
    StorageMemory& storage_;
    StorageMetadataPtr metadata_snapshot_;
};

// =============================================================================
// Implementation
// =============================================================================

inline StorageMemory::StorageMemory(
    const StorageID& table_id,
    ColumnsDescription columns_description,
    ConstraintsDescription constraints,
    const String& comment)
    : storage_id_(table_id)
    , data_(std::make_unique<const Blocks>())
{
    auto storage_metadata = std::make_unique<StorageInMemoryMetadata>();
    storage_metadata->setColumns(std::move(columns_description));
    storage_metadata->setConstraints(std::move(constraints));
    storage_metadata->setComment(comment);
    metadata_.set(std::move(storage_metadata));
}

inline StorageMemory::SnapshotData StorageMemory::getSnapshot() const
{
    SnapshotData snapshot;
    snapshot.blocks = data_.get();
    snapshot.rows_approx = total_size_rows_.load(std::memory_order_relaxed);
    return snapshot;
}

inline Blocks StorageMemory::read(
    const std::vector<String>& column_names,
    size_t /*max_block_size*/)
{
    auto snapshot = getSnapshot();
    if (!snapshot.blocks || snapshot.blocks->empty())
        return {};

    // If reading all columns, return blocks as-is
    if (column_names.empty())
        return *snapshot.blocks;

    // Project only requested columns
    Blocks result;
    result.reserve(snapshot.blocks->size());

    for (const auto& block : *snapshot.blocks)
    {
        Block projected;
        for (const auto& name : column_names)
        {
            if (block.has(name))
                projected.insert(block.getByName(name));
        }
        if (!projected.empty())
            result.push_back(std::move(projected));
    }

    return result;
}

inline void StorageMemory::write(const Block& block)
{
    write(Blocks{block});
}

inline void StorageMemory::write(const Blocks& blocks)
{
    if (blocks.empty())
        return;

    size_t inserted_bytes = 0;
    size_t inserted_rows = 0;

    for (const auto& block : blocks)
    {
        inserted_bytes += block.allocatedBytes();
        inserted_rows += block.rows();
    }

    std::lock_guard lock(mutex_);

    // Copy-on-write: create new data with old + new blocks
    auto new_data = std::make_unique<Blocks>(*data_.get());
    new_data->insert(new_data->end(), blocks.begin(), blocks.end());

    // Atomic update
    data_.set(std::move(new_data));
    total_size_bytes_.fetch_add(inserted_bytes, std::memory_order_relaxed);
    total_size_rows_.fetch_add(inserted_rows, std::memory_order_relaxed);
}

inline void StorageMemory::drop()
{
    data_.set(std::make_unique<Blocks>());
    total_size_bytes_.store(0, std::memory_order_relaxed);
    total_size_rows_.store(0, std::memory_order_relaxed);
}

inline void StorageMemory::truncate()
{
    drop();
}

inline std::optional<size_t> StorageMemory::totalRows() const
{
    return total_size_rows_.load(std::memory_order_relaxed);
}

inline std::optional<size_t> StorageMemory::totalBytes() const
{
    return total_size_bytes_.load(std::memory_order_relaxed);
}

// MemorySink implementation
inline MemorySink::MemorySink(StorageMemory& storage, const StorageMetadataPtr& metadata_snapshot)
    : storage_(storage)
    , metadata_snapshot_(metadata_snapshot)
{
}

inline void MemorySink::consume(const Block& block)
{
    // Validate block against metadata
    metadata_snapshot_->check(block, true);
    new_blocks_.push_back(block);
}

inline void MemorySink::onFinish()
{
    if (new_blocks_.empty())
        return;

    storage_.write(new_blocks_);
    new_blocks_.clear();
}

} // namespace DB

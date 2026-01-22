/**
 * AggregatesStandalone.h - Standalone Aggregate Functions for WASM
 *
 * This header provides a minimal implementation of ClickHouse-style aggregate
 * functions that can be compiled to WASM without the full ClickHouse dependency chain.
 *
 * The design mirrors the real ClickHouse interfaces:
 *   - IAggregateFunction: Abstract base class for aggregate functions
 *   - AggregateFunctionData: State storage for aggregates
 *   - AggregateFunctionFactory: Registration and lookup
 *
 * Supported aggregates:
 *   - COUNT(*), COUNT(column), COUNT(DISTINCT column)
 *   - SUM(column)
 *   - AVG(column)
 *   - MIN(column), MAX(column)
 *
 * This is a WASM-compatible subset that follows ClickHouse patterns,
 * enabling future integration with real ClickHouse code when the full
 * dependency chain becomes compilable to WASM.
 *
 * Reference: vendor/chdb/src/AggregateFunctions/
 */

#pragma once

#include <cstdint>
#include <cstring>
#include <cmath>
#include <string>
#include <vector>
#include <variant>
#include <memory>
#include <unordered_set>
#include <unordered_map>
#include <functional>
#include <limits>

namespace DB {
namespace WASM {

// ============================================================================
// Type System (mirrors ClickHouse TypeIndex)
// ============================================================================

enum class TypeIndex : uint8_t {
    Nothing = 0,
    UInt8,
    UInt16,
    UInt32,
    UInt64,
    Int8,
    Int16,
    Int32,
    Int64,
    Float32,
    Float64,
    String,
    // Simplified - real ClickHouse has many more types
};

// ============================================================================
// Value Type (simplified Field equivalent)
// ============================================================================

using Value = std::variant<std::monostate, int64_t, uint64_t, double, std::string>;

inline bool isNull(const Value& v) {
    return std::holds_alternative<std::monostate>(v);
}

inline double toDouble(const Value& v) {
    if (std::holds_alternative<int64_t>(v)) return static_cast<double>(std::get<int64_t>(v));
    if (std::holds_alternative<uint64_t>(v)) return static_cast<double>(std::get<uint64_t>(v));
    if (std::holds_alternative<double>(v)) return std::get<double>(v);
    return std::numeric_limits<double>::quiet_NaN();
}

inline bool isNumeric(const Value& v) {
    return std::holds_alternative<int64_t>(v) ||
           std::holds_alternative<uint64_t>(v) ||
           std::holds_alternative<double>(v);
}

// ============================================================================
// AggregateDataPtr (matches ClickHouse IAggregateFunction_fwd.h)
// ============================================================================

using AggregateDataPtr = char*;
using ConstAggregateDataPtr = const char*;

// ============================================================================
// IAggregateFunction (simplified interface)
// ============================================================================

/**
 * Base class for aggregate functions.
 * Mirrors the essential parts of ClickHouse's IAggregateFunction.
 *
 * In ClickHouse, this is a complex interface with many methods for:
 *   - State management (create, destroy, sizeOfData, alignOfData)
 *   - Data manipulation (add, merge)
 *   - Serialization (serialize, deserialize)
 *   - Result extraction (insertResultInto)
 *
 * This simplified version focuses on the core aggregation logic.
 */
class IAggregateFunction {
public:
    virtual ~IAggregateFunction() = default;

    /// Get function name (e.g., "count", "sum", "avg")
    virtual std::string getName() const = 0;

    /// Size of aggregate state in bytes
    virtual size_t sizeOfData() const = 0;

    /// Alignment requirement for aggregate state
    virtual size_t alignOfData() const = 0;

    /// Initialize state at given memory location
    virtual void create(AggregateDataPtr place) const = 0;

    /// Destroy state (call destructor)
    virtual void destroy(AggregateDataPtr place) const noexcept = 0;

    /// Add a single value to the aggregate state
    virtual void add(AggregateDataPtr place, const Value& value) const = 0;

    /// Merge another aggregate state into this one
    virtual void merge(AggregateDataPtr place, ConstAggregateDataPtr rhs) const = 0;

    /// Get the final result
    virtual Value getResult(ConstAggregateDataPtr place) const = 0;

    /// Check if result should be NULL when no values were aggregated
    virtual bool returnsDefaultWhenOnlyNull() const { return false; }
};

using AggregateFunctionPtr = std::shared_ptr<const IAggregateFunction>;

// ============================================================================
// COUNT(*) - AggregateFunctionCount
// ============================================================================

/**
 * State for COUNT aggregate.
 * Matches: vendor/chdb/src/AggregateFunctions/AggregateFunctionCount.h
 */
struct AggregateFunctionCountData {
    uint64_t count = 0;
};

/**
 * COUNT(*) - counts all rows.
 * COUNT(column) - counts non-NULL values.
 */
class AggregateFunctionCount final : public IAggregateFunction {
public:
    explicit AggregateFunctionCount(bool countStar = true) : countStar_(countStar) {}

    std::string getName() const override { return "count"; }

    size_t sizeOfData() const override { return sizeof(AggregateFunctionCountData); }
    size_t alignOfData() const override { return alignof(AggregateFunctionCountData); }

    void create(AggregateDataPtr place) const override {
        new (place) AggregateFunctionCountData();
    }

    void destroy(AggregateDataPtr place) const noexcept override {
        reinterpret_cast<AggregateFunctionCountData*>(place)->~AggregateFunctionCountData();
    }

    void add(AggregateDataPtr place, const Value& value) const override {
        auto& data = *reinterpret_cast<AggregateFunctionCountData*>(place);
        if (countStar_ || !isNull(value)) {
            ++data.count;
        }
    }

    void merge(AggregateDataPtr place, ConstAggregateDataPtr rhs) const override {
        auto& data = *reinterpret_cast<AggregateFunctionCountData*>(place);
        const auto& rhsData = *reinterpret_cast<const AggregateFunctionCountData*>(rhs);
        data.count += rhsData.count;
    }

    Value getResult(ConstAggregateDataPtr place) const override {
        const auto& data = *reinterpret_cast<const AggregateFunctionCountData*>(place);
        return static_cast<int64_t>(data.count);
    }

    bool returnsDefaultWhenOnlyNull() const override { return true; }

private:
    bool countStar_;
};

// ============================================================================
// COUNT(DISTINCT) - AggregateFunctionCountDistinct
// ============================================================================

/**
 * State for COUNT(DISTINCT) aggregate.
 * Uses hash set for distinct value tracking.
 */
struct AggregateFunctionCountDistinctData {
    struct ValueHash {
        size_t operator()(const Value& v) const {
            if (std::holds_alternative<std::monostate>(v)) return 0;
            if (std::holds_alternative<int64_t>(v)) return std::hash<int64_t>{}(std::get<int64_t>(v));
            if (std::holds_alternative<uint64_t>(v)) return std::hash<uint64_t>{}(std::get<uint64_t>(v));
            if (std::holds_alternative<double>(v)) return std::hash<double>{}(std::get<double>(v));
            return std::hash<std::string>{}(std::get<std::string>(v));
        }
    };

    std::unordered_set<Value, ValueHash> distinctValues;
};

/**
 * COUNT(DISTINCT column) - counts unique non-NULL values.
 */
class AggregateFunctionCountDistinct final : public IAggregateFunction {
public:
    std::string getName() const override { return "countDistinct"; }

    size_t sizeOfData() const override { return sizeof(AggregateFunctionCountDistinctData); }
    size_t alignOfData() const override { return alignof(AggregateFunctionCountDistinctData); }

    void create(AggregateDataPtr place) const override {
        new (place) AggregateFunctionCountDistinctData();
    }

    void destroy(AggregateDataPtr place) const noexcept override {
        reinterpret_cast<AggregateFunctionCountDistinctData*>(place)->~AggregateFunctionCountDistinctData();
    }

    void add(AggregateDataPtr place, const Value& value) const override {
        if (isNull(value)) return;
        auto& data = *reinterpret_cast<AggregateFunctionCountDistinctData*>(place);
        data.distinctValues.insert(value);
    }

    void merge(AggregateDataPtr place, ConstAggregateDataPtr rhs) const override {
        auto& data = *reinterpret_cast<AggregateFunctionCountDistinctData*>(place);
        const auto& rhsData = *reinterpret_cast<const AggregateFunctionCountDistinctData*>(rhs);
        for (const auto& v : rhsData.distinctValues) {
            data.distinctValues.insert(v);
        }
    }

    Value getResult(ConstAggregateDataPtr place) const override {
        const auto& data = *reinterpret_cast<const AggregateFunctionCountDistinctData*>(place);
        return static_cast<int64_t>(data.distinctValues.size());
    }

    bool returnsDefaultWhenOnlyNull() const override { return true; }
};

// ============================================================================
// SUM - AggregateFunctionSum
// ============================================================================

/**
 * State for SUM aggregate.
 * Matches: vendor/chdb/src/AggregateFunctions/AggregateFunctionSum.h
 */
template <typename T>
struct AggregateFunctionSumData {
    T sum{};

    void add(T value) {
        sum += value;
    }

    void merge(const AggregateFunctionSumData& rhs) {
        sum += rhs.sum;
    }

    T get() const {
        return sum;
    }
};

/**
 * SUM(column) - returns sum of numeric values.
 */
class AggregateFunctionSum final : public IAggregateFunction {
public:
    std::string getName() const override { return "sum"; }

    size_t sizeOfData() const override { return sizeof(AggregateFunctionSumData<double>); }
    size_t alignOfData() const override { return alignof(AggregateFunctionSumData<double>); }

    void create(AggregateDataPtr place) const override {
        new (place) AggregateFunctionSumData<double>();
    }

    void destroy(AggregateDataPtr place) const noexcept override {
        reinterpret_cast<AggregateFunctionSumData<double>*>(place)->~AggregateFunctionSumData();
    }

    void add(AggregateDataPtr place, const Value& value) const override {
        if (!isNumeric(value)) return;
        auto& data = *reinterpret_cast<AggregateFunctionSumData<double>*>(place);
        data.add(toDouble(value));
    }

    void merge(AggregateDataPtr place, ConstAggregateDataPtr rhs) const override {
        auto& data = *reinterpret_cast<AggregateFunctionSumData<double>*>(place);
        const auto& rhsData = *reinterpret_cast<const AggregateFunctionSumData<double>*>(rhs);
        data.merge(rhsData);
    }

    Value getResult(ConstAggregateDataPtr place) const override {
        const auto& data = *reinterpret_cast<const AggregateFunctionSumData<double>*>(place);
        return data.get();
    }
};

// ============================================================================
// AVG - AggregateFunctionAvg
// ============================================================================

/**
 * State for AVG aggregate.
 * Matches: vendor/chdb/src/AggregateFunctions/AggregateFunctionAvg.h
 */
template <typename Numerator, typename Denominator>
struct AvgFraction {
    Numerator numerator{};
    Denominator denominator{};

    double divide() const {
        if (denominator == 0) return std::numeric_limits<double>::quiet_NaN();
        return static_cast<double>(numerator) / static_cast<double>(denominator);
    }
};

/**
 * AVG(column) - returns average of numeric values.
 */
class AggregateFunctionAvg final : public IAggregateFunction {
public:
    std::string getName() const override { return "avg"; }

    size_t sizeOfData() const override { return sizeof(AvgFraction<double, uint64_t>); }
    size_t alignOfData() const override { return alignof(AvgFraction<double, uint64_t>); }

    void create(AggregateDataPtr place) const override {
        new (place) AvgFraction<double, uint64_t>();
    }

    void destroy(AggregateDataPtr place) const noexcept override {
        reinterpret_cast<AvgFraction<double, uint64_t>*>(place)->~AvgFraction();
    }

    void add(AggregateDataPtr place, const Value& value) const override {
        if (!isNumeric(value)) return;
        auto& data = *reinterpret_cast<AvgFraction<double, uint64_t>*>(place);
        data.numerator += toDouble(value);
        ++data.denominator;
    }

    void merge(AggregateDataPtr place, ConstAggregateDataPtr rhs) const override {
        auto& data = *reinterpret_cast<AvgFraction<double, uint64_t>*>(place);
        const auto& rhsData = *reinterpret_cast<const AvgFraction<double, uint64_t>*>(rhs);
        data.numerator += rhsData.numerator;
        data.denominator += rhsData.denominator;
    }

    Value getResult(ConstAggregateDataPtr place) const override {
        const auto& data = *reinterpret_cast<const AvgFraction<double, uint64_t>*>(place);
        if (data.denominator == 0) return std::monostate{};
        return data.divide();
    }
};

// ============================================================================
// MIN/MAX - AggregateFunctionMinMax
// ============================================================================

/**
 * State for MIN/MAX aggregate.
 * Matches: vendor/chdb/src/AggregateFunctions/AggregateFunctionsMinMax.cpp
 */
struct AggregateFunctionMinMaxData {
    Value value;
    bool hasValue = false;
};

/**
 * Compare two Values for MIN/MAX operations.
 */
inline int compareValues(const Value& a, const Value& b) {
    // Handle NULL
    if (isNull(a) && isNull(b)) return 0;
    if (isNull(a)) return 1;   // NULL sorts last
    if (isNull(b)) return -1;

    // Both are numeric
    if (isNumeric(a) && isNumeric(b)) {
        double da = toDouble(a);
        double db = toDouble(b);
        if (da < db) return -1;
        if (da > db) return 1;
        return 0;
    }

    // Both are strings
    if (std::holds_alternative<std::string>(a) && std::holds_alternative<std::string>(b)) {
        return std::get<std::string>(a).compare(std::get<std::string>(b));
    }

    // Mixed types - compare as strings (simplified)
    return 0;
}

/**
 * MIN(column) - returns minimum value.
 */
class AggregateFunctionMin final : public IAggregateFunction {
public:
    std::string getName() const override { return "min"; }

    size_t sizeOfData() const override { return sizeof(AggregateFunctionMinMaxData); }
    size_t alignOfData() const override { return alignof(AggregateFunctionMinMaxData); }

    void create(AggregateDataPtr place) const override {
        new (place) AggregateFunctionMinMaxData();
    }

    void destroy(AggregateDataPtr place) const noexcept override {
        reinterpret_cast<AggregateFunctionMinMaxData*>(place)->~AggregateFunctionMinMaxData();
    }

    void add(AggregateDataPtr place, const Value& value) const override {
        if (isNull(value)) return;
        auto& data = *reinterpret_cast<AggregateFunctionMinMaxData*>(place);
        if (!data.hasValue || compareValues(value, data.value) < 0) {
            data.value = value;
            data.hasValue = true;
        }
    }

    void merge(AggregateDataPtr place, ConstAggregateDataPtr rhs) const override {
        auto& data = *reinterpret_cast<AggregateFunctionMinMaxData*>(place);
        const auto& rhsData = *reinterpret_cast<const AggregateFunctionMinMaxData*>(rhs);
        if (!rhsData.hasValue) return;
        if (!data.hasValue || compareValues(rhsData.value, data.value) < 0) {
            data.value = rhsData.value;
            data.hasValue = true;
        }
    }

    Value getResult(ConstAggregateDataPtr place) const override {
        const auto& data = *reinterpret_cast<const AggregateFunctionMinMaxData*>(place);
        return data.hasValue ? data.value : Value{std::monostate{}};
    }
};

/**
 * MAX(column) - returns maximum value.
 */
class AggregateFunctionMax final : public IAggregateFunction {
public:
    std::string getName() const override { return "max"; }

    size_t sizeOfData() const override { return sizeof(AggregateFunctionMinMaxData); }
    size_t alignOfData() const override { return alignof(AggregateFunctionMinMaxData); }

    void create(AggregateDataPtr place) const override {
        new (place) AggregateFunctionMinMaxData();
    }

    void destroy(AggregateDataPtr place) const noexcept override {
        reinterpret_cast<AggregateFunctionMinMaxData*>(place)->~AggregateFunctionMinMaxData();
    }

    void add(AggregateDataPtr place, const Value& value) const override {
        if (isNull(value)) return;
        auto& data = *reinterpret_cast<AggregateFunctionMinMaxData*>(place);
        if (!data.hasValue || compareValues(value, data.value) > 0) {
            data.value = value;
            data.hasValue = true;
        }
    }

    void merge(AggregateDataPtr place, ConstAggregateDataPtr rhs) const override {
        auto& data = *reinterpret_cast<AggregateFunctionMinMaxData*>(place);
        const auto& rhsData = *reinterpret_cast<const AggregateFunctionMinMaxData*>(rhs);
        if (!rhsData.hasValue) return;
        if (!data.hasValue || compareValues(rhsData.value, data.value) > 0) {
            data.value = rhsData.value;
            data.hasValue = true;
        }
    }

    Value getResult(ConstAggregateDataPtr place) const override {
        const auto& data = *reinterpret_cast<const AggregateFunctionMinMaxData*>(place);
        return data.hasValue ? data.value : Value{std::monostate{}};
    }
};

// ============================================================================
// AggregateFunctionFactory (simplified)
// ============================================================================

/**
 * Factory for creating aggregate functions.
 * Mirrors: vendor/chdb/src/AggregateFunctions/AggregateFunctionFactory.h
 */
class AggregateFunctionFactory {
public:
    using Creator = std::function<AggregateFunctionPtr(const std::vector<TypeIndex>&)>;

    static AggregateFunctionFactory& instance() {
        static AggregateFunctionFactory factory;
        return factory;
    }

    void registerFunction(const std::string& name, Creator creator) {
        std::string upperName = name;
        for (char& c : upperName) c = std::toupper(c);
        creators_[upperName] = std::move(creator);
    }

    AggregateFunctionPtr get(const std::string& name, const std::vector<TypeIndex>& argumentTypes = {}) const {
        std::string upperName = name;
        for (char& c : upperName) c = std::toupper(c);

        auto it = creators_.find(upperName);
        if (it != creators_.end()) {
            return it->second(argumentTypes);
        }
        return nullptr;
    }

    bool isAggregateFunctionName(const std::string& name) const {
        std::string upperName = name;
        for (char& c : upperName) c = std::toupper(c);
        return creators_.find(upperName) != creators_.end();
    }

private:
    AggregateFunctionFactory() {
        // Register built-in aggregate functions
        registerBuiltins();
    }

    void registerBuiltins() {
        // COUNT - matches registerAggregateFunctionCount
        registerFunction("COUNT", [](const std::vector<TypeIndex>&) {
            return std::make_shared<AggregateFunctionCount>(true);
        });

        // SUM - matches registerAggregateFunctionSum
        registerFunction("SUM", [](const std::vector<TypeIndex>&) {
            return std::make_shared<AggregateFunctionSum>();
        });

        // AVG - matches registerAggregateFunctionAvg
        registerFunction("AVG", [](const std::vector<TypeIndex>&) {
            return std::make_shared<AggregateFunctionAvg>();
        });

        // MIN - matches registerAggregateFunctionsMinMax
        registerFunction("MIN", [](const std::vector<TypeIndex>&) {
            return std::make_shared<AggregateFunctionMin>();
        });

        // MAX - matches registerAggregateFunctionsMinMax
        registerFunction("MAX", [](const std::vector<TypeIndex>&) {
            return std::make_shared<AggregateFunctionMax>();
        });

        // UNIQ - alias for COUNT(DISTINCT)
        registerFunction("UNIQ", [](const std::vector<TypeIndex>&) {
            return std::make_shared<AggregateFunctionCountDistinct>();
        });

        // UNIQEXACT - exact count distinct
        registerFunction("UNIQEXACT", [](const std::vector<TypeIndex>&) {
            return std::make_shared<AggregateFunctionCountDistinct>();
        });
    }

    std::unordered_map<std::string, Creator> creators_;
};

// ============================================================================
// AggregateState - Runtime state management
// ============================================================================

/**
 * Manages aggregate function state at runtime.
 * Handles memory allocation and aggregate lifecycle.
 */
class AggregateState {
public:
    explicit AggregateState(AggregateFunctionPtr func)
        : function_(std::move(func))
        , state_(nullptr)
    {
        if (function_) {
            // Allocate aligned memory for state
            size_t size = function_->sizeOfData();
            size_t align = function_->alignOfData();

            // Simple aligned allocation
            state_ = static_cast<char*>(std::aligned_alloc(align, size));
            if (state_) {
                function_->create(state_);
            }
        }
    }

    ~AggregateState() {
        if (state_ && function_) {
            function_->destroy(state_);
            std::free(state_);
        }
    }

    // Non-copyable, movable
    AggregateState(const AggregateState&) = delete;
    AggregateState& operator=(const AggregateState&) = delete;

    AggregateState(AggregateState&& other) noexcept
        : function_(std::move(other.function_))
        , state_(other.state_)
    {
        other.state_ = nullptr;
    }

    AggregateState& operator=(AggregateState&& other) noexcept {
        if (this != &other) {
            if (state_ && function_) {
                function_->destroy(state_);
                std::free(state_);
            }
            function_ = std::move(other.function_);
            state_ = other.state_;
            other.state_ = nullptr;
        }
        return *this;
    }

    void add(const Value& value) {
        if (function_ && state_) {
            function_->add(state_, value);
        }
    }

    void merge(const AggregateState& other) {
        if (function_ && state_ && other.state_) {
            function_->merge(state_, other.state_);
        }
    }

    Value getResult() const {
        if (function_ && state_) {
            return function_->getResult(state_);
        }
        return std::monostate{};
    }

    const IAggregateFunction* getFunction() const {
        return function_.get();
    }

private:
    AggregateFunctionPtr function_;
    char* state_;
};

} // namespace WASM
} // namespace DB

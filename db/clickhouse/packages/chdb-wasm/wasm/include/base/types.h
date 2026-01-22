#pragma once

/**
 * base/types.h stub for Parser WASM build
 *
 * Provides basic type definitions used throughout ClickHouse.
 */

#include <cstdint>
#include <string>
#include <vector>

/// Note: Using standard types instead of ClickHouse's char8_t-based UInt8
/// to avoid compatibility issues with the WASM build.
using UInt8 = uint8_t;
using UInt16 = uint16_t;
using UInt32 = uint32_t;
using UInt64 = uint64_t;

using Int8 = int8_t;
using Int16 = int16_t;
using Int32 = int32_t;
using Int64 = int64_t;

using Float32 = float;
using Float64 = double;

using String = std::string;
using Strings = std::vector<String>;

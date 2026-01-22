#pragma once

/**
 * Common/ErrorCodes.h stub for Parser WASM build
 *
 * Provides minimal error code definitions for parser standalone build.
 * Error codes used by the parser infrastructure are defined here.
 */

#include <string_view>
#include <vector>
#include <cstddef>

namespace DB
{

namespace ErrorCodes
{
    using ErrorCode = int;
    using Value = size_t;
    using FramePointers = std::vector<void *>;

    // Error codes used by parser infrastructure
    // These are declared extern here and defined in parser_error_codes.cpp
    // The original ClickHouse code uses 'extern const int' declarations
    extern const int TOO_DEEP_RECURSION;
    extern const int LOGICAL_ERROR;
    extern const int SYNTAX_ERROR;
    extern const int TOO_SLOW_PARSING;
    extern const int BAD_ARGUMENTS;
    extern const int UNKNOWN_IDENTIFIER;

    /// Get name of error_code by identifier (stub).
    inline std::string_view getName(ErrorCode /*error_code*/)
    {
        return "UNKNOWN_ERROR";
    }

    /// Get error code value by name (stub).
    inline ErrorCode getErrorCodeByName(std::string_view /*error_name*/)
    {
        return 0;
    }
}

}

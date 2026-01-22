/**
 * parser_error_codes.cpp - Error code definitions for Parser WASM build
 *
 * The ClickHouse parser code uses 'extern const int' declarations for error codes.
 * This file provides the actual definitions that must be linked.
 */

namespace DB
{

namespace ErrorCodes
{
    // Error codes used by parser infrastructure
    extern const int TOO_DEEP_RECURSION = 1;
    extern const int LOGICAL_ERROR = 2;
    extern const int SYNTAX_ERROR = 3;
    extern const int TOO_SLOW_PARSING = 4;
    extern const int BAD_ARGUMENTS = 5;
    extern const int UNKNOWN_IDENTIFIER = 6;
}

}

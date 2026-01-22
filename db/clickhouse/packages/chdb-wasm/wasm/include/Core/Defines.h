#pragma once

/**
 * Core/Defines.h stub for Parser WASM build
 *
 * Contains various constants and includes base defines.
 */

#include <base/defines.h>
#include <base/unit.h>

#include <cstddef>

namespace DB
{

// Parser-related constants
static constexpr auto DBMS_DEFAULT_MAX_PARSER_DEPTH = 1000;
static constexpr auto DBMS_DEFAULT_MAX_PARSER_BACKTRACKS = 1000000;
static constexpr auto DBMS_DEFAULT_MAX_QUERY_SIZE = 262144;

// Other constants that might be referenced
static constexpr auto SHOW_CHARS_ON_SYNTAX_ERROR = ptrdiff_t(160);

}

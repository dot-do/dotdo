#pragma once

/**
 * Common/Exception.h stub for Parser WASM build
 *
 * Provides a minimal Exception class compatible with ClickHouse parser code.
 */

#include <stdexcept>
#include <string>
#include <atomic>

namespace DB
{

class Exception : public std::runtime_error
{
public:
    Exception(int code, const std::string & msg)
        : std::runtime_error(msg), error_code(code) {}

    template <typename... Args>
    Exception(int code, const char * fmt, Args &&... /*args*/)
        : std::runtime_error(fmt), error_code(code) {}

    int code() const { return error_code; }

private:
    int error_code;
};

// Stubs for abort behavior
inline std::atomic_bool abort_on_logical_error{false};
inline bool terminate_on_any_exception = false;

}

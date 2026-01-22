#pragma once

/**
 * ParserStandalone.h - Minimal stubs for building Parser to WASM
 *
 * This header provides minimal implementations of ClickHouse dependencies
 * needed to compile the Parser to WebAssembly without pulling in the
 * entire ClickHouse codebase.
 *
 * Key challenges addressed:
 * - std::shared_ptr<IAST> - uses standard C++ (requires -fexceptions)
 * - absl::InlinedVector - stubbed with std::vector
 * - Exception handling - minimal Exception class
 * - checkStackSize - stubbed (no-op in WASM)
 *
 * Build with: emcc -fexceptions -DPARSER_STANDALONE_BUILD
 *
 * IMPORTANT: Do NOT define LEXER_STANDALONE_BUILD with this header.
 * The LexerStandalone.h macros conflict with standard library headers.
 * Instead, we provide stubs for the dependencies the Lexer needs.
 */

#ifdef PARSER_STANDALONE_BUILD

// Standard includes needed for Parser
#include <memory>
#include <vector>
#include <string>
#include <set>
#include <cstdint>
#include <cstddef>
#include <functional>
#include <stdexcept>
#include <algorithm>
#include <cassert>
#include <atomic>
#include <cstring>
#include <string_view>

// =============================================================================
// Stub absl::InlinedVector with std::vector
// =============================================================================
namespace absl
{
template <typename T, size_t N>
using InlinedVector = std::vector<T>;
}

// =============================================================================
// Base types (from base/types.h)
// =============================================================================
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

// =============================================================================
// Base defines (from base/defines.h)
// =============================================================================
#ifndef ALWAYS_INLINE
#define ALWAYS_INLINE __attribute__((__always_inline__))
#endif

#ifndef NO_INLINE
#define NO_INLINE __attribute__((__noinline__))
#endif

#ifndef likely
#define likely(x) __builtin_expect(!!(x), 1)
#endif

#ifndef unlikely
#define unlikely(x) __builtin_expect(!!(x), 0)
#endif

// =============================================================================
// checkStackSize stub (no-op in WASM - single stack)
// =============================================================================
inline void checkStackSize() {}

// =============================================================================
// Minimal Exception class
// =============================================================================
namespace DB
{

namespace ErrorCodes
{
    inline constexpr int TOO_DEEP_RECURSION = 1;
    inline constexpr int LOGICAL_ERROR = 2;
    inline constexpr int SYNTAX_ERROR = 3;
}

class Exception : public std::runtime_error
{
public:
    Exception(int code, const std::string & msg)
        : std::runtime_error(msg), error_code(code) {}

    template <typename... Args>
    Exception(int code, const char * fmt, Args &&... args)
        : std::runtime_error(fmt), error_code(code) {}

    int code() const { return error_code; }

private:
    int error_code;
};

// Stub for abort on logical error
inline std::atomic_bool abort_on_logical_error{false};
inline bool terminate_on_any_exception = false;

} // namespace DB

// =============================================================================
// WriteBuffer stub (minimal for AST formatting)
// =============================================================================
namespace DB
{

class WriteBuffer
{
public:
    WriteBuffer() = default;
    virtual ~WriteBuffer() = default;

    void write(const char * data, size_t size)
    {
        buffer.append(data, size);
    }

    void write(char c)
    {
        buffer.push_back(c);
    }

    WriteBuffer & operator<<(const char * s)
    {
        buffer.append(s);
        return *this;
    }

    WriteBuffer & operator<<(const std::string & s)
    {
        buffer.append(s);
        return *this;
    }

    WriteBuffer & operator<<(char c)
    {
        buffer.push_back(c);
        return *this;
    }

    WriteBuffer & operator<<(int val)
    {
        buffer.append(std::to_string(val));
        return *this;
    }

    WriteBuffer & operator<<(size_t val)
    {
        buffer.append(std::to_string(val));
        return *this;
    }

    const std::string & str() const { return buffer; }

private:
    std::string buffer;
};

// Helper for writing strings
inline void writeString(const std::string & s, WriteBuffer & buf)
{
    buf.write(s.data(), s.size());
}

inline void writeString(const char * s, WriteBuffer & buf)
{
    buf.write(s, strlen(s));
}

inline void writeChar(char c, WriteBuffer & buf)
{
    buf.write(c);
}

} // namespace DB

// =============================================================================
// SipHash stub (for AST hashing)
// =============================================================================
class SipHash
{
public:
    void update(const char * data, size_t size)
    {
        // Simple hash stub - just XOR bytes
        for (size_t i = 0; i < size; ++i)
            hash ^= static_cast<uint64_t>(data[i]) << ((i % 8) * 8);
    }

    void update(const std::string & s)
    {
        update(s.data(), s.size());
    }

    uint64_t get64() const { return hash; }

private:
    uint64_t hash = 0;
};

// =============================================================================
// TypePromotion stub
// =============================================================================
namespace DB
{

template <typename T>
class TypePromotion
{
public:
    template <typename U>
    U * as()
    {
        return dynamic_cast<U *>(static_cast<T *>(this));
    }

    template <typename U>
    const U * as() const
    {
        return dynamic_cast<const U *>(static_cast<const T *>(this));
    }
};

} // namespace DB

// =============================================================================
// IASTHash stub
// =============================================================================
namespace DB
{

struct IASTHash
{
    uint64_t low64 = 0;
    uint64_t high64 = 0;

    bool operator==(const IASTHash & other) const
    {
        return low64 == other.low64 && high64 == other.high64;
    }
};

} // namespace DB

// =============================================================================
// IdentifierQuotingStyle stub
// =============================================================================
namespace DB
{

enum class IdentifierQuotingStyle
{
    None,
    Backticks,
    DoubleQuotes,
    BackticksMySQL
};

enum class IdentifierQuotingRule
{
    WhenNecessary,
    Always,
    UserDisplay
};

enum class LiteralEscapingStyle
{
    Regular,
    JSON
};

} // namespace DB

// =============================================================================
// Core/Field stub (for literals)
// =============================================================================
namespace DB
{

class Field
{
public:
    enum Types
    {
        Null,
        UInt64,
        Int64,
        Float64,
        String,
        Array,
        Tuple,
        Map,
        Bool
    };

    Field() : field_type(Null) {}
    Field(uint64_t val) : field_type(UInt64), uint_val(val) {}
    Field(int64_t val) : field_type(Int64), int_val(val) {}
    Field(double val) : field_type(Float64), float_val(val) {}
    Field(const std::string & val) : field_type(String), str_val(val) {}
    Field(const char * val) : field_type(String), str_val(val) {}
    Field(bool val) : field_type(Bool), bool_val(val) {}

    Types getType() const { return field_type; }

    template <typename T>
    T get() const;

    bool isNull() const { return field_type == Null; }

private:
    Types field_type;
    union
    {
        uint64_t uint_val;
        int64_t int_val;
        double float_val;
        bool bool_val;
    };
    std::string str_val;
};

template <>
inline uint64_t Field::get<uint64_t>() const { return uint_val; }

template <>
inline int64_t Field::get<int64_t>() const { return int_val; }

template <>
inline double Field::get<double>() const { return float_val; }

template <>
inline std::string Field::get<std::string>() const { return str_val; }

template <>
inline bool Field::get<bool>() const { return bool_val; }

} // namespace DB

// =============================================================================
// MultiEnum stub
// =============================================================================
namespace DB
{

template <typename Enum, typename StorageType = uint64_t>
class MultiEnum
{
public:
    MultiEnum() = default;

    template <typename... Args>
    MultiEnum(Args... args)
    {
        ((value |= (StorageType(1) << static_cast<StorageType>(args))), ...);
    }

    bool isSet(Enum e) const
    {
        return value & (StorageType(1) << static_cast<StorageType>(e));
    }

    void set(Enum e)
    {
        value |= (StorageType(1) << static_cast<StorageType>(e));
    }

private:
    StorageType value = 0;
};

} // namespace DB

// =============================================================================
// Stubs for Lexer dependencies (when NOT using LEXER_STANDALONE_BUILD)
// These are from base/defines.h, Common/StringUtils.h, etc.
// =============================================================================

// chassert - debug assertion
#ifndef chassert
#define chassert(x) assert(x)
#endif

// =============================================================================
// find_symbols (from base/find_symbols.h)
// =============================================================================
template <char... symbols>
inline const char * find_first_symbols(const char * begin, const char * end)
{
    for (; begin != end; ++begin)
        if (((*begin == symbols) || ...))
            break;
    return begin;
}

template <char... symbols>
inline const char * find_first_not_symbols(const char * begin, const char * end)
{
    for (; begin != end; ++begin)
        if (((*begin != symbols) && ...))
            break;
    return begin;
}

// =============================================================================
// String utilities (from Common/StringUtils.h)
// =============================================================================
inline bool isNumericASCII(char c)
{
    return (c >= '0' && c <= '9');
}

inline bool isLowerAlphaASCII(char c)
{
    return (c >= 'a' && c <= 'z');
}

inline bool isUpperAlphaASCII(char c)
{
    return (c >= 'A' && c <= 'Z');
}

inline bool isAlphaASCII(char c)
{
    return isLowerAlphaASCII(c) || isUpperAlphaASCII(c);
}

inline bool isAlphaNumericASCII(char c)
{
    return isAlphaASCII(c) || isNumericASCII(c);
}

inline bool isHexDigit(char c)
{
    return isNumericASCII(c)
           || (c >= 'a' && c <= 'f')
           || (c >= 'A' && c <= 'F');
}

inline bool isNumberSeparator(bool is_start_of_block, bool is_hex, const char * pos, const char * end)
{
    if (*pos != '_')
        return false;
    if (is_start_of_block && *pos == '_')
        return false;
    if (pos + 1 < end && !(is_hex ? isHexDigit(pos[1]) : isNumericASCII(pos[1])))
        return false;
    if (pos + 1 == end)
        return false;
    return true;
}

inline bool isWhitespaceASCII(char c)
{
    return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v';
}

inline bool isWordCharASCII(char c)
{
    return isAlphaNumericASCII(c) || c == '_';
}

// =============================================================================
// UTF8 helpers (from Common/UTF8Helpers.h)
// =============================================================================
namespace UTF8
{

inline bool isContinuationOctet(uint8_t octet)
{
    return (octet & 0b11000000u) == 0b10000000u;
}

} // namespace UTF8

inline const char * skipWhitespacesUTF8(const char * pos, const char * end)
{
    while (pos < end)
    {
        if (isWhitespaceASCII(*pos))
        {
            ++pos;
        }
        else
        {
            const uint8_t * upos = reinterpret_cast<const uint8_t *>(pos);

            if (pos + 1 < end && upos[0] == 0xC2 && (upos[1] == 0x85 || upos[1] == 0xA0))
            {
                pos += 2;
            }
            else if (pos + 2 < end
                     && ((upos[0] == 0xE1 && upos[1] == 0xA0 && upos[2] == 0x8E)
                         || (upos[0] == 0xE2
                             && ((upos[1] == 0x80
                                  && ((upos[2] >= 0x80 && upos[2] <= 0x8A)
                                      || (upos[2] >= 0xA8 && upos[2] <= 0xA9)
                                      || (upos[2] >= 0x8B && upos[2] <= 0x8D)
                                      || (upos[2] == 0xAF)))
                                 || (upos[1] == 0x81 && (upos[2] == 0x9F || upos[2] == 0xA0))))
                         || (upos[0] == 0xE3 && upos[1] == 0x80 && upos[2] == 0x80)
                         || (upos[0] == 0xEF && upos[1] == 0xBB && upos[2] == 0xBF)))
            {
                pos += 3;
            }
            else
                break;
        }
    }

    return pos;
}

#endif // PARSER_STANDALONE_BUILD

#pragma once

/**
 * Common/StringUtils.h stub for Parser WASM build
 *
 * Provides character classification utilities.
 */

#include <cstdint>
#include <string>
#include <string_view>

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

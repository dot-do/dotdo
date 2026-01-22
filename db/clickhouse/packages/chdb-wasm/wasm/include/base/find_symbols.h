#pragma once

/**
 * base/find_symbols.h stub for Parser WASM build
 *
 * Provides character search utilities.
 */

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

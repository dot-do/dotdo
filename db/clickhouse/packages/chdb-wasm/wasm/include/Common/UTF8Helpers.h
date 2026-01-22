#pragma once

/**
 * Common/UTF8Helpers.h stub for Parser WASM build
 *
 * Provides UTF-8 handling utilities.
 */

#include <cstdint>
#include <Common/StringUtils.h>

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

            // Check for various UTF-8 whitespace characters
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

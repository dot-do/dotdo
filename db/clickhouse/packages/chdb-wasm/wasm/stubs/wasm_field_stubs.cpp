/**
 * wasm_field_stubs.cpp - Field template instantiation fixes for WASM
 *
 * In WASM builds (like macOS/Darwin), `unsigned long` is a distinct type from
 * UInt64 (which is `unsigned long long`). ClickHouse's Field.cpp only instantiates
 * the `unsigned long` template specialization for OS_DARWIN, but WASM also needs it.
 *
 * This file provides the missing template instantiation for WASM builds.
 */

// Only include these stubs for WASM builds
#if defined(__EMSCRIPTEN__) || defined(OS_EMSCRIPTEN) || defined(OS_WASM)

// Include the Field header to get the template definition
#include <Core/Field.h>

namespace DB
{

// Explicit instantiation for unsigned long - needed for WASM builds
// This matches the instantiation in Field.cpp that's only enabled for OS_DARWIN
template NearestFieldType<std::decay_t<unsigned long>> & Field::safeGet<unsigned long>() &;

} // namespace DB

#endif // WASM builds

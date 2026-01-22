#pragma once

/**
 * base/defines.h stub for Parser WASM build
 *
 * Provides minimal definitions needed by ClickHouse code.
 * This file is used when compiling with PARSER_STANDALONE_BUILD.
 */

#include <cassert>
#include <cstdlib>

// ALWAYS_INLINE and NO_INLINE
#ifndef ALWAYS_INLINE
#define ALWAYS_INLINE __attribute__((__always_inline__))
#endif

#ifndef NO_INLINE
#define NO_INLINE __attribute__((__noinline__))
#endif

#ifndef MAY_ALIAS
#define MAY_ALIAS __attribute__((__may_alias__))
#endif

// Likely/unlikely branch hints
#ifndef likely
#define likely(x) __builtin_expect(!!(x), 1)
#endif

#ifndef unlikely
#define unlikely(x) __builtin_expect(!!(x), 0)
#endif

// chassert - debug assertion (simplified)
#ifndef chassert
#define chassert(x) assert(x)
#endif

// UNREACHABLE
#ifndef UNREACHABLE
#define UNREACHABLE() __builtin_unreachable()
#endif

// Template for suppressing unused warnings
template <typename... Args>
constexpr void UNUSED(Args &&... /*args*/) {}

// Sanitizer macros (disabled in WASM)
#ifndef NO_SANITIZE_UNDEFINED
#define NO_SANITIZE_UNDEFINED
#endif

#ifndef NO_SANITIZE_ADDRESS
#define NO_SANITIZE_ADDRESS
#endif

#ifndef NO_SANITIZE_THREAD
#define NO_SANITIZE_THREAD
#endif

#ifndef ALWAYS_INLINE_NO_SANITIZE_UNDEFINED
#define ALWAYS_INLINE_NO_SANITIZE_UNDEFINED ALWAYS_INLINE
#endif

// Thread safety analysis macros (no-op in WASM)
#define TSA_GUARDED_BY(...)
#define TSA_PT_GUARDED_BY(...)
#define TSA_REQUIRES(...)
#define TSA_REQUIRES_SHARED(...)
#define TSA_NO_THREAD_SAFETY_ANALYSIS

// Platform check - WASM/Emscripten is explicitly supported

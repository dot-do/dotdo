#pragma once

/**
 * base/unit.h stub for Parser WASM build
 *
 * Provides unit literal operators (e.g., 5_GiB, 100_MiB)
 */

#include <cstddef>
#include <cstdint>

// Unit literal operators
constexpr size_t operator""_KiB(unsigned long long value) { return value * 1024; }
constexpr size_t operator""_MiB(unsigned long long value) { return value * 1024 * 1024; }
constexpr size_t operator""_GiB(unsigned long long value) { return value * 1024 * 1024 * 1024; }

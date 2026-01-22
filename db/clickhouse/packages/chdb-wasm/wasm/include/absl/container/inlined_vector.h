#pragma once

/**
 * absl/container/inlined_vector.h stub for Parser WASM build
 *
 * Maps absl::InlinedVector to std::vector for WASM builds.
 */

#include <vector>

namespace absl
{

template <typename T, size_t N>
using InlinedVector = std::vector<T>;

}

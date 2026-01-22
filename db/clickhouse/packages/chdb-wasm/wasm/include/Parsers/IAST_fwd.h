#pragma once

/**
 * Parsers/IAST_fwd.h stub for Parser WASM build
 *
 * Forward declarations for AST types.
 */

#include <memory>
#include <vector>

namespace DB
{

class IAST;
using ASTPtr = std::shared_ptr<IAST>;
using ASTs = std::vector<ASTPtr>;

}

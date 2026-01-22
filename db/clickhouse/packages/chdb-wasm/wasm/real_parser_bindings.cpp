/**
 * real_parser_bindings.cpp - JavaScript bindings for REAL ClickHouse SQL Parser
 *
 * This file provides a C interface for the REAL ClickHouse parser compiled with
 * PARSER_STANDALONE_BUILD mode. Unlike parser_bindings.cpp which only uses
 * Lexer and TokenIterator, this module includes the full parser infrastructure:
 *
 * - Lexer.cpp: Lexical analysis (tokenization)
 * - TokenIterator.cpp: Token stream with lookahead
 * - IParser.cpp: Base parser class with position/depth tracking
 * - IParserBase.cpp: Parser base implementation
 * - CommonParsers.cpp: Keyword parsing (ParserKeyword, ParserToken, etc.)
 *
 * Build with: emcc -std=c++23 -fexceptions -DPARSER_STANDALONE_BUILD -DNDEBUG
 */

#ifdef PARSER_STANDALONE_BUILD

// Include our stubs FIRST (before any chdb headers)
#include <base/defines.h>
#include <base/types.h>
#include <Common/Exception.h>
#include <Common/checkStackSize.h>
#include <Common/ErrorCodes.h>
#include <Parsers/IAST_fwd.h>
#include <absl/container/inlined_vector.h>

#endif // PARSER_STANDALONE_BUILD

// Now include ClickHouse headers
#include <Parsers/Lexer.h>
#include <Parsers/TokenIterator.h>
#include <Parsers/IParser.h>
#include <Parsers/CommonParsers.h>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define EXPORT
#endif

#include <cstring>

extern "C" {

/**
 * Parser context structure for the REAL parser
 */
struct RealParserContext {
    DB::Tokens* tokens;
    const char* input;
    size_t input_len;
    char* error_message;
    size_t error_position;
};

/**
 * Create a new parser context for the given SQL input.
 *
 * @param input Pointer to SQL string (must stay valid during parser lifetime)
 * @param len Length of the SQL string
 * @return Pointer to RealParserContext, or nullptr on failure
 */
EXPORT
void* real_parser_create(const char* input, size_t len) {
    if (!input || len == 0) {
        return nullptr;
    }

    RealParserContext* ctx = new RealParserContext();
    ctx->input = input;
    ctx->input_len = len;
    ctx->tokens = new DB::Tokens(input, input + len, 0, true);
    ctx->error_message = nullptr;
    ctx->error_position = 0;

    return ctx;
}

/**
 * Destroy a parser context and free resources.
 *
 * @param ctx Pointer to RealParserContext from real_parser_create
 */
EXPORT
void real_parser_destroy(void* ctx) {
    if (ctx) {
        RealParserContext* pctx = static_cast<RealParserContext*>(ctx);
        delete pctx->tokens;
        if (pctx->error_message) {
            delete[] pctx->error_message;
        }
        delete pctx;
    }
}

/**
 * Get the number of tokens in the query.
 *
 * This tokenizes the entire query and returns the count.
 *
 * @param ctx Pointer to RealParserContext
 * @return Number of significant tokens
 */
EXPORT
size_t real_parser_get_token_count(void* ctx) {
    if (!ctx) return 0;

    RealParserContext* pctx = static_cast<RealParserContext*>(ctx);
    DB::TokenIterator it(*pctx->tokens);

    size_t count = 0;
    while (it.isValid()) {
        count++;
        ++it;
    }

    return count;
}

/**
 * Check if parentheses are balanced in the query.
 *
 * @param ctx Pointer to RealParserContext
 * @return 1 if balanced, 0 if not balanced
 */
EXPORT
int real_parser_check_balanced(void* ctx) {
    if (!ctx) return 0;

    RealParserContext* pctx = static_cast<RealParserContext*>(ctx);
    DB::TokenIterator it(*pctx->tokens);

    DB::UnmatchedParentheses unmatched = DB::checkUnmatchedParentheses(it);
    return unmatched.empty() ? 1 : 0;
}

/**
 * Get the position of unmatched parenthesis if any.
 *
 * @param ctx Pointer to RealParserContext
 * @return Position of first unmatched paren, or -1 if all balanced
 */
EXPORT
long real_parser_get_unmatched_paren_pos(void* ctx) {
    if (!ctx) return -1;

    RealParserContext* pctx = static_cast<RealParserContext*>(ctx);
    DB::TokenIterator it(*pctx->tokens);

    DB::UnmatchedParentheses unmatched = DB::checkUnmatchedParentheses(it);
    if (unmatched.empty()) {
        return -1;
    }

    return unmatched.front().begin - pctx->input;
}

/**
 * Simple token validation - checks if all tokens are valid (no errors).
 *
 * @param ctx Pointer to RealParserContext
 * @return 1 if all tokens valid, 0 if there are lexer errors
 */
EXPORT
int real_parser_validate_tokens(void* ctx) {
    if (!ctx) return 0;

    RealParserContext* pctx = static_cast<RealParserContext*>(ctx);
    DB::TokenIterator it(*pctx->tokens);

    while (it.isValid()) {
        if (it->isError()) {
            return 0;
        }
        ++it;
    }

    return 1;
}

/**
 * Get information about an error token if present.
 *
 * @param ctx Pointer to RealParserContext
 * @return Position of first error token, or -1 if no errors
 */
EXPORT
long real_parser_get_error_pos(void* ctx) {
    if (!ctx) return -1;

    RealParserContext* pctx = static_cast<RealParserContext*>(ctx);
    DB::TokenIterator it(*pctx->tokens);

    while (it.isValid()) {
        if (it->isError()) {
            return it->begin - pctx->input;
        }
        ++it;
    }

    return -1;
}

/**
 * Get a specific token from the stream.
 *
 * @param ctx Pointer to RealParserContext
 * @param index Token index (0-based)
 * @param out_begin Output: start position in input
 * @param out_end Output: end position in input
 * @param out_type Output: token type
 * @return 1 if token exists, 0 if out of bounds
 */
EXPORT
int real_parser_get_token(void* ctx, size_t index, size_t* out_begin, size_t* out_end, unsigned char* out_type) {
    if (!ctx) return 0;

    RealParserContext* pctx = static_cast<RealParserContext*>(ctx);
    DB::TokenIterator it(*pctx->tokens);

    size_t i = 0;
    while (it.isValid()) {
        if (i == index) {
            *out_begin = it->begin - pctx->input;
            *out_end = it->end - pctx->input;
            *out_type = static_cast<unsigned char>(it->type);
            return 1;
        }
        ++it;
        ++i;
    }

    return 0;
}

/**
 * Try to parse a keyword at the current position.
 * This uses the REAL ParserKeyword from CommonParsers.cpp.
 *
 * @param ctx Pointer to RealParserContext
 * @param keyword The keyword to try parsing (e.g., "SELECT", "FROM", "WHERE")
 * @param start_token Token index to start parsing from
 * @param out_end_token Output: token index after successful parse
 * @return 1 if keyword matched, 0 otherwise
 */
EXPORT
int real_parser_parse_keyword(void* ctx, const char* keyword, size_t start_token, size_t* out_end_token) {
    if (!ctx || !keyword) return 0;

    RealParserContext* pctx = static_cast<RealParserContext*>(ctx);

    // Create a position starting at the given token
    DB::IParser::Pos pos(*pctx->tokens, 1000, 1000000);

    // Advance to the start token
    for (size_t i = 0; i < start_token && pos.isValid(); ++i) {
        ++pos;
    }

    if (!pos.isValid()) return 0;

    // Try to parse the keyword using the REAL ParserKeyword
    // Note: ParserKeyword::createDeprecated is used for dynamic keyword strings
    DB::ParserKeyword parser = DB::ParserKeyword::createDeprecated(keyword);
    DB::ASTPtr node;
    DB::Expected expected;

    if (parser.parse(pos, node, expected)) {
        // Count how many tokens were consumed
        size_t end_index = start_token;
        DB::TokenIterator it(*pctx->tokens);
        while (it.isValid() && &it.get() != &pos.get()) {
            ++it;
            ++end_index;
        }
        *out_end_token = end_index;
        return 1;
    }

    return 0;
}

/**
 * Get the name of the token type.
 * Uses the REAL getTokenName function from ClickHouse.
 *
 * @param token_type Token type value
 * @return Pointer to static string with token name
 */
EXPORT
const char* real_parser_token_type_name(unsigned char token_type) {
    return DB::getTokenName(static_cast<DB::TokenType>(token_type));
}

/**
 * Test function to verify the module loaded correctly.
 * Tests REAL parser functionality including keyword parsing.
 */
EXPORT
int real_parser_test() {
    // Quick self-test
    const char* sql = "SELECT id, name FROM users WHERE age > 21";
    size_t len = strlen(sql);

    // Test tokenization
    DB::Tokens tokens(sql, sql + len, 0, true);
    DB::TokenIterator it(tokens);

    // Check we get some tokens
    int count = 0;
    while (it.isValid()) {
        count++;
        ++it;
    }

    // Should have multiple tokens (SELECT, id, ,, name, FROM, users, WHERE, age, >, 21)
    if (count < 10) return -1;

    // Check balanced parens
    DB::Tokens tokens2(sql, sql + len, 0, true);
    DB::TokenIterator it2(tokens2);
    DB::UnmatchedParentheses unmatched = checkUnmatchedParentheses(it2);
    if (!unmatched.empty()) return -2;

    // Test REAL keyword parsing
    DB::Tokens tokens3(sql, sql + len, 0, true);
    DB::IParser::Pos pos(tokens3, 1000, 1000000);

    DB::ParserKeyword selectParser = DB::ParserKeyword::createDeprecated("SELECT");
    DB::ASTPtr node;
    DB::Expected expected;

    if (!selectParser.parse(pos, node, expected)) return -3;

    // After parsing SELECT, the position should have advanced
    // The next token should be 'id'
    if (pos->type != DB::TokenType::BareWord) return -4;

    return 0; // Success
}

} // extern "C"

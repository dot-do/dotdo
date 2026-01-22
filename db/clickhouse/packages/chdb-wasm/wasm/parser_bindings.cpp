/**
 * parser_bindings.cpp - JavaScript bindings for ClickHouse SQL Parser
 *
 * This provides a C interface for the Parser that can be called from JavaScript
 * via Emscripten's ccall/cwrap functions.
 *
 * The Parser builds on top of the Lexer and creates an Abstract Syntax Tree (AST)
 * from SQL queries.
 *
 * Build with: emcc -fexceptions -DPARSER_STANDALONE_BUILD
 */

#ifdef PARSER_STANDALONE_BUILD
// Include ParserStandalone.h FIRST - it includes standard headers
// before LexerStandalone.h can pollute the namespace
#include "ParserStandalone.h"
#endif

// Now include ClickHouse headers
// When LEXER_STANDALONE_BUILD is defined, Lexer.h includes LexerStandalone.h
#include <Parsers/Lexer.h>
#include <Parsers/TokenIterator.h>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define EXPORT
#endif

extern "C" {

/**
 * Parser context structure
 */
struct ParserContext {
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
 * @return Pointer to ParserContext, or nullptr on failure
 */
EXPORT
void* parser_create(const char* input, size_t len) {
    if (!input || len == 0) {
        return nullptr;
    }

    ParserContext* ctx = new ParserContext();
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
 * @param ctx Pointer to ParserContext from parser_create
 */
EXPORT
void parser_destroy(void* ctx) {
    if (ctx) {
        ParserContext* pctx = static_cast<ParserContext*>(ctx);
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
 * @param ctx Pointer to ParserContext
 * @return Number of significant tokens
 */
EXPORT
size_t parser_get_token_count(void* ctx) {
    if (!ctx) return 0;

    ParserContext* pctx = static_cast<ParserContext*>(ctx);
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
 * @param ctx Pointer to ParserContext
 * @return 1 if balanced, 0 if not balanced
 */
EXPORT
int parser_check_balanced(void* ctx) {
    if (!ctx) return 0;

    ParserContext* pctx = static_cast<ParserContext*>(ctx);
    DB::TokenIterator it(*pctx->tokens);

    DB::UnmatchedParentheses unmatched = DB::checkUnmatchedParentheses(it);
    return unmatched.empty() ? 1 : 0;
}

/**
 * Get the position of unmatched parenthesis if any.
 *
 * @param ctx Pointer to ParserContext
 * @return Position of first unmatched paren, or -1 if all balanced
 */
EXPORT
long parser_get_unmatched_paren_pos(void* ctx) {
    if (!ctx) return -1;

    ParserContext* pctx = static_cast<ParserContext*>(ctx);
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
 * @param ctx Pointer to ParserContext
 * @return 1 if all tokens valid, 0 if there are lexer errors
 */
EXPORT
int parser_validate_tokens(void* ctx) {
    if (!ctx) return 0;

    ParserContext* pctx = static_cast<ParserContext*>(ctx);
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
 * @param ctx Pointer to ParserContext
 * @return Position of first error token, or -1 if no errors
 */
EXPORT
long parser_get_error_pos(void* ctx) {
    if (!ctx) return -1;

    ParserContext* pctx = static_cast<ParserContext*>(ctx);
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
 * @param ctx Pointer to ParserContext
 * @param index Token index (0-based)
 * @param out_begin Output: start position in input
 * @param out_end Output: end position in input
 * @param out_type Output: token type
 * @return 1 if token exists, 0 if out of bounds
 */
EXPORT
int parser_get_token(void* ctx, size_t index, size_t* out_begin, size_t* out_end, unsigned char* out_type) {
    if (!ctx) return 0;

    ParserContext* pctx = static_cast<ParserContext*>(ctx);
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
 * Test function to verify the module loaded correctly.
 */
EXPORT
int parser_test() {
    // Quick self-test
    const char* sql = "SELECT id, name FROM users WHERE age > 21";
    size_t len = strlen(sql);

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

    return 0; // Success
}

} // extern "C"

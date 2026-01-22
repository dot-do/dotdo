/**
 * lexer_bindings.cpp - JavaScript bindings for ClickHouse SQL Lexer
 *
 * This provides a C interface for the Lexer that can be called from JavaScript
 * via Emscripten's ccall/cwrap functions.
 *
 * Usage from JavaScript:
 *   const module = await createLexerModule();
 *   const lexer = module._lexer_create(ptr, len);
 *   while (!module._lexer_is_end(lexer)) {
 *     const token = module._lexer_next_token(lexer);
 *     // process token
 *   }
 *   module._lexer_destroy(lexer);
 */

// Include LexerStandalone.h first for minimal definitions when in standalone mode
#ifdef LEXER_STANDALONE_BUILD
#include <Parsers/LexerStandalone.h>
#endif

#include <Parsers/Lexer.h>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define EXPORT
#endif

extern "C" {

/**
 * Token type names for JavaScript
 */
static const char* TOKEN_NAMES[] = {
    "Whitespace",
    "Comment",
    "BareWord",
    "Number",
    "StringLiteral",
    "QuotedIdentifier",
    "OpeningRoundBracket",
    "ClosingRoundBracket",
    "OpeningSquareBracket",
    "ClosingSquareBracket",
    "OpeningCurlyBrace",
    "ClosingCurlyBrace",
    "Comma",
    "Semicolon",
    "VerticalDelimiter",
    "Dot",
    "Asterisk",
    "HereDoc",
    "DollarSign",
    "Plus",
    "Minus",
    "Slash",
    "Percent",
    "Arrow",
    "QuestionMark",
    "Colon",
    "Caret",
    "DoubleColon",
    "Equals",
    "NotEquals",
    "Less",
    "Greater",
    "LessOrEquals",
    "GreaterOrEquals",
    "Spaceship",
    "PipeMark",
    "Concatenation",
    "At",
    "DoubleAt",
    "EndOfStream",
    "Error",
    "ErrorMultilineCommentIsNotClosed",
    "ErrorSingleQuoteIsNotClosed",
    "ErrorDoubleQuoteIsNotClosed",
    "ErrorBackQuoteIsNotClosed",
    "ErrorSingleExclamationMark",
    "ErrorSinglePipeMark",
    "ErrorWrongNumber",
    "ErrorMaxQuerySizeExceeded"
};

/**
 * Lexer context structure - holds the lexer and last token info
 */
struct LexerContext {
    DB::Lexer* lexer;
    const char* input;
    size_t input_len;
    // Last token info for retrieval
    unsigned char last_type;
    const char* last_begin;
    const char* last_end;
};

/**
 * Create a new lexer for the given SQL input.
 *
 * @param input Pointer to SQL string (must stay valid during lexer lifetime)
 * @param len Length of the SQL string
 * @return Pointer to LexerContext, or nullptr on failure
 */
EXPORT
void* lexer_create(const char* input, size_t len) {
    if (!input || len == 0) {
        return nullptr;
    }

    LexerContext* ctx = new LexerContext();
    ctx->input = input;
    ctx->input_len = len;
    ctx->lexer = new DB::Lexer(input, input + len, 0);
    ctx->last_type = 0;
    ctx->last_begin = nullptr;
    ctx->last_end = nullptr;

    return ctx;
}

/**
 * Destroy a lexer and free resources.
 *
 * @param ctx Pointer to LexerContext from lexer_create
 */
EXPORT
void lexer_destroy(void* ctx) {
    if (ctx) {
        LexerContext* lctx = static_cast<LexerContext*>(ctx);
        delete lctx->lexer;
        delete lctx;
    }
}

/**
 * Get the next token from the lexer.
 *
 * Returns token type (0-based enum). Use lexer_get_token_* functions
 * to get token details after this call.
 *
 * @param ctx Pointer to LexerContext
 * @return Token type as unsigned char
 */
EXPORT
unsigned char lexer_next_token(void* ctx) {
    if (!ctx) return static_cast<unsigned char>(DB::TokenType::Error);

    LexerContext* lctx = static_cast<LexerContext*>(ctx);
    DB::Token token = lctx->lexer->nextToken();

    lctx->last_type = static_cast<unsigned char>(token.type);
    lctx->last_begin = token.begin;
    lctx->last_end = token.end;

    return lctx->last_type;
}

/**
 * Get the start offset of the last token.
 */
EXPORT
size_t lexer_get_token_begin(void* ctx) {
    if (!ctx) return 0;
    LexerContext* lctx = static_cast<LexerContext*>(ctx);
    if (!lctx->last_begin) return 0;
    return lctx->last_begin - lctx->input;
}

/**
 * Get the end offset of the last token.
 */
EXPORT
size_t lexer_get_token_end(void* ctx) {
    if (!ctx) return 0;
    LexerContext* lctx = static_cast<LexerContext*>(ctx);
    if (!lctx->last_end) return 0;
    return lctx->last_end - lctx->input;
}

/**
 * Get the type of the last token.
 */
EXPORT
unsigned char lexer_get_token_type(void* ctx) {
    if (!ctx) return static_cast<unsigned char>(DB::TokenType::Error);
    LexerContext* lctx = static_cast<LexerContext*>(ctx);
    return lctx->last_type;
}

/**
 * Check if a token type is significant (not whitespace or comment).
 */
EXPORT
int lexer_token_is_significant(unsigned char token_type) {
    return token_type != static_cast<unsigned char>(DB::TokenType::Whitespace)
        && token_type != static_cast<unsigned char>(DB::TokenType::Comment);
}

/**
 * Check if a token type is an error.
 */
EXPORT
int lexer_token_is_error(unsigned char token_type) {
    return token_type > static_cast<unsigned char>(DB::TokenType::EndOfStream);
}

/**
 * Check if a token type is end of stream.
 */
EXPORT
int lexer_token_is_end(unsigned char token_type) {
    return token_type == static_cast<unsigned char>(DB::TokenType::EndOfStream);
}

/**
 * Get the name of a token type.
 *
 * @param token_type Token type value
 * @return Pointer to static string with token name
 */
EXPORT
const char* token_type_name(unsigned char token_type) {
    if (token_type < sizeof(TOKEN_NAMES) / sizeof(TOKEN_NAMES[0])) {
        return TOKEN_NAMES[token_type];
    }
    return "Unknown";
}

/**
 * Test function to verify the module loaded correctly.
 */
EXPORT
int lexer_test() {
    // Quick self-test
    const char* sql = "SELECT 1";
    DB::Lexer lexer(sql, sql + 8, 0);

    // First token should be "SELECT" (BareWord)
    DB::Token token = lexer.nextToken();
    if (token.type != DB::TokenType::BareWord) return -1;
    if (token.size() != 6) return -2;

    return 0; // Success
}

} // extern "C"

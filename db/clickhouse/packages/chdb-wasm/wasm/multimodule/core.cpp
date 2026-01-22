/**
 * core.cpp - Core SQL Parser and Query Coordinator Module
 *
 * This is the "always loaded" module in the multi-module architecture.
 * It handles:
 *   - SQL parsing and validation
 *   - Query planning (determining which format modules are needed)
 *   - Result coordination
 *
 * Build with: emcc -Os -s EXPORTED_FUNCTIONS="['_malloc','_free','_parse_sql','_get_required_format','_coordinate_result','_get_error']" -s EXPORTED_RUNTIME_METHODS="['cwrap','ccall','UTF8ToString','stringToUTF8','lengthBytesUTF8']" -o core.wasm core.cpp
 */

#include <cstdlib>
#include <cstring>
#include <cstdio>
#include <cstdint>
#include <string>
#include <vector>
#include <map>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define EXPORT extern "C" EMSCRIPTEN_KEEPALIVE
#else
#define EXPORT extern "C"
#endif

// ============================================================================
// Error handling
// ============================================================================

static std::string g_last_error;

EXPORT const char* get_error() {
    return g_last_error.c_str();
}

static void set_error(const std::string& msg) {
    g_last_error = msg;
}

static void clear_error() {
    g_last_error.clear();
}

// ============================================================================
// SQL Token Types
// ============================================================================

enum class TokenType {
    KEYWORD,
    IDENTIFIER,
    NUMBER,
    STRING,
    OPERATOR,
    PUNCTUATION,
    WHITESPACE,
    END_OF_INPUT,
    UNKNOWN
};

struct Token {
    TokenType type;
    std::string value;
    size_t position;
};

// ============================================================================
// Simple SQL Lexer
// ============================================================================

class SQLLexer {
public:
    explicit SQLLexer(const std::string& input) : input_(input), pos_(0) {}

    Token nextToken() {
        skipWhitespace();

        if (pos_ >= input_.size()) {
            return {TokenType::END_OF_INPUT, "", pos_};
        }

        size_t start = pos_;
        char c = input_[pos_];

        // Keywords and identifiers
        if (isalpha(c) || c == '_') {
            return readIdentifier(start);
        }

        // Numbers
        if (isdigit(c)) {
            return readNumber(start);
        }

        // Strings
        if (c == '\'' || c == '"') {
            return readString(start, c);
        }

        // Operators
        if (strchr("=<>!+-*/%", c)) {
            return readOperator(start);
        }

        // Punctuation
        if (strchr("(),;.", c)) {
            pos_++;
            return {TokenType::PUNCTUATION, std::string(1, c), start};
        }

        // Unknown
        pos_++;
        return {TokenType::UNKNOWN, std::string(1, c), start};
    }

    std::vector<Token> tokenize() {
        std::vector<Token> tokens;
        Token tok;
        do {
            tok = nextToken();
            if (tok.type != TokenType::WHITESPACE) {
                tokens.push_back(tok);
            }
        } while (tok.type != TokenType::END_OF_INPUT);
        return tokens;
    }

private:
    void skipWhitespace() {
        while (pos_ < input_.size() && isspace(input_[pos_])) {
            pos_++;
        }
    }

    Token readIdentifier(size_t start) {
        while (pos_ < input_.size() && (isalnum(input_[pos_]) || input_[pos_] == '_')) {
            pos_++;
        }
        std::string value = input_.substr(start, pos_ - start);

        // Check if it's a keyword
        std::string upper = toUpper(value);
        if (isKeyword(upper)) {
            return {TokenType::KEYWORD, upper, start};
        }
        return {TokenType::IDENTIFIER, value, start};
    }

    Token readNumber(size_t start) {
        while (pos_ < input_.size() && (isdigit(input_[pos_]) || input_[pos_] == '.')) {
            pos_++;
        }
        return {TokenType::NUMBER, input_.substr(start, pos_ - start), start};
    }

    Token readString(size_t start, char quote) {
        pos_++; // skip opening quote
        std::string value;
        while (pos_ < input_.size() && input_[pos_] != quote) {
            if (input_[pos_] == '\\' && pos_ + 1 < input_.size()) {
                pos_++;
                value += input_[pos_];
            } else {
                value += input_[pos_];
            }
            pos_++;
        }
        if (pos_ < input_.size()) {
            pos_++; // skip closing quote
        }
        return {TokenType::STRING, value, start};
    }

    Token readOperator(size_t start) {
        std::string op(1, input_[pos_++]);
        if (pos_ < input_.size()) {
            char next = input_[pos_];
            if ((op[0] == '<' || op[0] == '>' || op[0] == '!' || op[0] == '=') && next == '=') {
                op += next;
                pos_++;
            } else if (op[0] == '<' && next == '>') {
                op += next;
                pos_++;
            }
        }
        return {TokenType::OPERATOR, op, start};
    }

    std::string toUpper(const std::string& s) {
        std::string result = s;
        for (char& c : result) {
            c = toupper(c);
        }
        return result;
    }

    bool isKeyword(const std::string& s) {
        static const char* keywords[] = {
            "SELECT", "FROM", "WHERE", "GROUP", "BY", "ORDER", "ASC", "DESC",
            "LIMIT", "OFFSET", "AS", "AND", "OR", "NOT", "IN", "IS", "NULL",
            "TRUE", "FALSE", "LIKE", "BETWEEN", "JOIN", "LEFT", "RIGHT", "INNER",
            "OUTER", "ON", "HAVING", "DISTINCT", "FORMAT", "INSERT", "INTO",
            "VALUES", "UPDATE", "SET", "DELETE", "CREATE", "TABLE", "DROP",
            "ALTER", "INDEX", "IF", "EXISTS", "WITH", "UNION", "ALL", "EXCEPT",
            "INTERSECT", "CASE", "WHEN", "THEN", "ELSE", "END", "CAST"
        };
        for (const char* kw : keywords) {
            if (s == kw) return true;
        }
        return false;
    }

    std::string input_;
    size_t pos_;
};

// ============================================================================
// Parsed Query Structure
// ============================================================================

struct ParsedQuery {
    std::string type;              // SELECT, INSERT, etc.
    std::vector<std::string> columns;
    std::string tableName;
    std::string whereClause;
    std::string orderBy;
    std::string format;            // FORMAT clause (JSON, JSONEachRow, etc.)
    int limit = -1;
    int offset = 0;
    bool valid = false;
    std::string error;
};

// Global parsed query for communication
static ParsedQuery g_parsed_query;

// ============================================================================
// Simple SQL Parser
// ============================================================================

class SQLParser {
public:
    ParsedQuery parse(const std::string& sql) {
        ParsedQuery query;
        SQLLexer lexer(sql);
        tokens_ = lexer.tokenize();
        pos_ = 0;

        if (tokens_.empty() || tokens_[0].type == TokenType::END_OF_INPUT) {
            query.error = "Empty query";
            return query;
        }

        // Determine query type
        if (tokens_[0].value == "SELECT") {
            return parseSelect();
        } else if (tokens_[0].value == "INSERT") {
            query.type = "INSERT";
            query.valid = true;
            return query;
        } else if (tokens_[0].value == "CREATE") {
            query.type = "CREATE";
            query.valid = true;
            return query;
        } else if (tokens_[0].value == "DROP") {
            query.type = "DROP";
            query.valid = true;
            return query;
        }

        query.error = "Unsupported query type: " + tokens_[0].value;
        return query;
    }

private:
    ParsedQuery parseSelect() {
        ParsedQuery query;
        query.type = "SELECT";
        pos_++; // skip SELECT

        // Parse columns
        while (pos_ < tokens_.size()) {
            Token& tok = tokens_[pos_];

            if (tok.value == "FROM") break;

            if (tok.type == TokenType::IDENTIFIER ||
                tok.type == TokenType::NUMBER ||
                tok.value == "*") {
                // Check for function call
                std::string col = tok.value;
                pos_++;

                // Handle function calls like COUNT(*)
                if (pos_ < tokens_.size() && tokens_[pos_].value == "(") {
                    col += "(";
                    pos_++;
                    int depth = 1;
                    while (pos_ < tokens_.size() && depth > 0) {
                        if (tokens_[pos_].value == "(") depth++;
                        else if (tokens_[pos_].value == ")") depth--;
                        col += tokens_[pos_].value;
                        pos_++;
                    }
                }

                // Handle AS alias
                if (pos_ < tokens_.size() && tokens_[pos_].value == "AS") {
                    pos_++; // skip AS
                    if (pos_ < tokens_.size()) {
                        col += " AS " + tokens_[pos_].value;
                        pos_++;
                    }
                }

                query.columns.push_back(col);
            } else if (tok.value == ",") {
                pos_++;
            } else {
                pos_++;
            }
        }

        // Parse FROM
        if (pos_ < tokens_.size() && tokens_[pos_].value == "FROM") {
            pos_++; // skip FROM
            if (pos_ < tokens_.size() &&
                (tokens_[pos_].type == TokenType::IDENTIFIER ||
                 tokens_[pos_].type == TokenType::STRING)) {
                query.tableName = tokens_[pos_].value;
                pos_++;
            }
        }

        // Parse remaining clauses
        while (pos_ < tokens_.size()) {
            Token& tok = tokens_[pos_];

            if (tok.value == "WHERE") {
                pos_++;
                query.whereClause = parseUntil({"GROUP", "ORDER", "LIMIT", "FORMAT"});
            } else if (tok.value == "GROUP") {
                pos_++; // skip GROUP
                if (pos_ < tokens_.size() && tokens_[pos_].value == "BY") {
                    pos_++; // skip BY
                    parseUntil({"HAVING", "ORDER", "LIMIT", "FORMAT"});
                }
            } else if (tok.value == "ORDER") {
                pos_++; // skip ORDER
                if (pos_ < tokens_.size() && tokens_[pos_].value == "BY") {
                    pos_++; // skip BY
                    query.orderBy = parseUntil({"LIMIT", "FORMAT"});
                }
            } else if (tok.value == "LIMIT") {
                pos_++;
                if (pos_ < tokens_.size() && tokens_[pos_].type == TokenType::NUMBER) {
                    query.limit = std::stoi(tokens_[pos_].value);
                    pos_++;
                }
            } else if (tok.value == "OFFSET") {
                pos_++;
                if (pos_ < tokens_.size() && tokens_[pos_].type == TokenType::NUMBER) {
                    query.offset = std::stoi(tokens_[pos_].value);
                    pos_++;
                }
            } else if (tok.value == "FORMAT") {
                pos_++;
                if (pos_ < tokens_.size()) {
                    query.format = tokens_[pos_].value;
                    pos_++;
                }
            } else {
                pos_++;
            }
        }

        // Default format if not specified
        if (query.format.empty()) {
            query.format = "TabSeparated";
        }

        query.valid = true;
        return query;
    }

    std::string parseUntil(const std::vector<std::string>& stopWords) {
        std::string result;
        while (pos_ < tokens_.size()) {
            for (const auto& stop : stopWords) {
                if (tokens_[pos_].value == stop) {
                    return result;
                }
            }
            if (!result.empty()) result += " ";
            result += tokens_[pos_].value;
            pos_++;
        }
        return result;
    }

    std::vector<Token> tokens_;
    size_t pos_;
};

// ============================================================================
// Export Functions
// ============================================================================

/**
 * Parse SQL and return 1 on success, 0 on failure.
 * Use get_error() to retrieve error message on failure.
 * Use get_required_format() to get the format module needed.
 */
EXPORT int parse_sql(const char* sql) {
    clear_error();

    if (!sql || !*sql) {
        set_error("Empty SQL query");
        return 0;
    }

    SQLParser parser;
    g_parsed_query = parser.parse(sql);

    if (!g_parsed_query.valid) {
        set_error(g_parsed_query.error);
        return 0;
    }

    return 1;
}

/**
 * Get the format module required for the parsed query.
 * Returns: "none", "json", "csv", "parquet", etc.
 *
 * This tells the orchestrator which format module to load.
 */
EXPORT const char* get_required_format() {
    static std::string result;

    if (!g_parsed_query.valid) {
        result = "none";
        return result.c_str();
    }

    std::string fmt = g_parsed_query.format;
    // Convert to lowercase
    for (char& c : fmt) {
        c = tolower(c);
    }

    // Determine which module is needed
    if (fmt == "json" || fmt == "jsoneachrow" || fmt == "jsoncompact" ||
        fmt == "jsoncompacteachrow" || fmt == "jsonstrings" ||
        fmt == "jsoncompactstrings") {
        result = "json";
    } else if (fmt == "csv" || fmt == "csvwithnames" || fmt == "tsvwithnames") {
        result = "csv";
    } else if (fmt == "parquet") {
        result = "parquet";
    } else {
        result = "none"; // Built-in format
    }

    return result.c_str();
}

/**
 * Get parsed query type (SELECT, INSERT, etc.)
 */
EXPORT const char* get_query_type() {
    static std::string result;
    result = g_parsed_query.type;
    return result.c_str();
}

/**
 * Get parsed table name
 */
EXPORT const char* get_table_name() {
    static std::string result;
    result = g_parsed_query.tableName;
    return result.c_str();
}

/**
 * Get requested format
 */
EXPORT const char* get_format() {
    static std::string result;
    result = g_parsed_query.format;
    return result.c_str();
}

/**
 * Get column count
 */
EXPORT int get_column_count() {
    return static_cast<int>(g_parsed_query.columns.size());
}

/**
 * Get column name by index
 */
EXPORT const char* get_column(int index) {
    static std::string result;
    if (index >= 0 && index < static_cast<int>(g_parsed_query.columns.size())) {
        result = g_parsed_query.columns[index];
    } else {
        result = "";
    }
    return result.c_str();
}

/**
 * Get LIMIT value (-1 if not specified)
 */
EXPORT int get_limit() {
    return g_parsed_query.limit;
}

/**
 * Get OFFSET value
 */
EXPORT int get_offset() {
    return g_parsed_query.offset;
}

// ============================================================================
// Result Coordination
// ============================================================================

// Buffer for result coordination
static std::vector<uint8_t> g_result_buffer;

/**
 * Allocate a result buffer of given size.
 * Returns pointer to buffer, or 0 on failure.
 */
EXPORT uint8_t* allocate_result_buffer(int size) {
    if (size <= 0 || size > 100 * 1024 * 1024) { // Max 100MB
        set_error("Invalid buffer size");
        return nullptr;
    }
    g_result_buffer.resize(size);
    return g_result_buffer.data();
}

/**
 * Get current result buffer pointer
 */
EXPORT uint8_t* get_result_buffer() {
    return g_result_buffer.empty() ? nullptr : g_result_buffer.data();
}

/**
 * Get current result buffer size
 */
EXPORT int get_result_buffer_size() {
    return static_cast<int>(g_result_buffer.size());
}

/**
 * Coordinate result from format module.
 * This function takes raw data and applies any post-processing
 * (e.g., limiting rows, adding metadata).
 *
 * @param data Pointer to formatted data
 * @param size Size of formatted data
 * @return Size of final result in buffer, or -1 on error
 */
EXPORT int coordinate_result(const uint8_t* data, int size) {
    if (!data || size <= 0) {
        set_error("Invalid input data");
        return -1;
    }

    // For now, just copy data to result buffer
    // In a real implementation, this would:
    // 1. Apply LIMIT/OFFSET
    // 2. Add metadata/headers
    // 3. Handle streaming

    g_result_buffer.assign(data, data + size);
    return size;
}

// ============================================================================
// Version and Info
// ============================================================================

EXPORT const char* core_version() {
    return "1.0.0-spike";
}

EXPORT const char* core_info() {
    return "chdb-wasm core module (SQL parser + coordinator)";
}

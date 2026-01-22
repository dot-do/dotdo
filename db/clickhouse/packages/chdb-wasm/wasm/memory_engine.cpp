/**
 * memory_engine.cpp - Memory Storage Engine for WASM
 *
 * Extends the minimal SQL executor with in-memory table support.
 * This is a standalone implementation that doesn't require ClickHouse's
 * storage infrastructure - it implements tables directly in WASM linear memory.
 *
 * Supported operations:
 *   - CREATE TABLE name (col1 type1, col2 type2, ...) ENGINE = Memory
 *   - INSERT INTO name VALUES (val1, val2, ...), ...
 *   - SELECT col1, col2, ... FROM name [WHERE condition]
 *   - SELECT * FROM name
 *   - DROP TABLE name
 *   - SHOW TABLES
 *
 * Supported data types:
 *   - Int8, Int16, Int32, Int64, UInt8, UInt16, UInt32, UInt64
 *   - Float32, Float64
 *   - String
 *   - Nullable variants (basic support)
 *
 * Build with: emcc -fexceptions -DMEMORY_ENGINE_BUILD
 *
 * Target size: ~400KB total (including base executor)
 */

#include <cstdlib>
#include <cstring>
#include <cstdio>
#include <cmath>
#include <string>
#include <vector>
#include <variant>
#include <memory>
#include <sstream>
#include <iomanip>
#include <unordered_map>
#include <algorithm>
#include <optional>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define EXPORT
#endif

// ============================================================================
// Value Types (extended from executor_bindings.cpp)
// ============================================================================

// Value can be: null, int64, double, or string
using Value = std::variant<std::monostate, int64_t, double, std::string>;

enum class ValueType {
    Null,
    Int64,
    Float64,
    String
};

// Data type for schema definition
enum class DataType {
    Int8, Int16, Int32, Int64,
    UInt8, UInt16, UInt32, UInt64,
    Float32, Float64,
    String,
    Unknown
};

ValueType getValueType(const Value& v) {
    if (std::holds_alternative<std::monostate>(v)) return ValueType::Null;
    if (std::holds_alternative<int64_t>(v)) return ValueType::Int64;
    if (std::holds_alternative<double>(v)) return ValueType::Float64;
    return ValueType::String;
}

std::string valueToString(const Value& v) {
    if (std::holds_alternative<std::monostate>(v)) {
        return "NULL";
    }
    if (std::holds_alternative<int64_t>(v)) {
        return std::to_string(std::get<int64_t>(v));
    }
    if (std::holds_alternative<double>(v)) {
        std::ostringstream oss;
        oss << std::setprecision(15) << std::get<double>(v);
        return oss.str();
    }
    return std::get<std::string>(v);
}

std::string dataTypeToString(DataType dt) {
    switch (dt) {
        case DataType::Int8: return "Int8";
        case DataType::Int16: return "Int16";
        case DataType::Int32: return "Int32";
        case DataType::Int64: return "Int64";
        case DataType::UInt8: return "UInt8";
        case DataType::UInt16: return "UInt16";
        case DataType::UInt32: return "UInt32";
        case DataType::UInt64: return "UInt64";
        case DataType::Float32: return "Float32";
        case DataType::Float64: return "Float64";
        case DataType::String: return "String";
        default: return "Unknown";
    }
}

DataType stringToDataType(const std::string& s) {
    std::string upper = s;
    for (char& c : upper) c = toupper(c);

    if (upper == "INT8" || upper == "TINYINT") return DataType::Int8;
    if (upper == "INT16" || upper == "SMALLINT") return DataType::Int16;
    if (upper == "INT32" || upper == "INT" || upper == "INTEGER") return DataType::Int32;
    if (upper == "INT64" || upper == "BIGINT") return DataType::Int64;
    if (upper == "UINT8") return DataType::UInt8;
    if (upper == "UINT16") return DataType::UInt16;
    if (upper == "UINT32") return DataType::UInt32;
    if (upper == "UINT64") return DataType::UInt64;
    if (upper == "FLOAT32" || upper == "FLOAT") return DataType::Float32;
    if (upper == "FLOAT64" || upper == "DOUBLE") return DataType::Float64;
    if (upper == "STRING" || upper == "VARCHAR" || upper == "TEXT") return DataType::String;
    return DataType::Unknown;
}

bool isNumericType(DataType dt) {
    return dt != DataType::String && dt != DataType::Unknown;
}

bool isIntegerType(DataType dt) {
    return dt == DataType::Int8 || dt == DataType::Int16 ||
           dt == DataType::Int32 || dt == DataType::Int64 ||
           dt == DataType::UInt8 || dt == DataType::UInt16 ||
           dt == DataType::UInt32 || dt == DataType::UInt64;
}

// ============================================================================
// Column Definition
// ============================================================================

struct ColumnDef {
    std::string name;
    DataType type;
    bool nullable = true;
};

// ============================================================================
// Row - a single row in a table
// ============================================================================

using Row = std::vector<Value>;

// ============================================================================
// MemoryTable - in-memory table storage
// ============================================================================

class MemoryTable {
public:
    MemoryTable(const std::string& name, std::vector<ColumnDef> columns)
        : name_(name), columns_(std::move(columns)) {
        // Build column name to index map
        for (size_t i = 0; i < columns_.size(); i++) {
            columnIndex_[columns_[i].name] = i;
        }
    }

    const std::string& getName() const { return name_; }
    const std::vector<ColumnDef>& getColumns() const { return columns_; }
    const std::vector<Row>& getRows() const { return rows_; }
    size_t rowCount() const { return rows_.size(); }
    size_t columnCount() const { return columns_.size(); }

    // Get column index by name (-1 if not found)
    int getColumnIndex(const std::string& name) const {
        auto it = columnIndex_.find(name);
        if (it != columnIndex_.end()) return static_cast<int>(it->second);
        // Case-insensitive search
        std::string lowerName = name;
        for (char& c : lowerName) c = tolower(c);
        for (size_t i = 0; i < columns_.size(); i++) {
            std::string colLower = columns_[i].name;
            for (char& c : colLower) c = tolower(c);
            if (colLower == lowerName) return static_cast<int>(i);
        }
        return -1;
    }

    // Insert a row (validates column count)
    bool insertRow(Row row, std::string& error) {
        if (row.size() != columns_.size()) {
            error = "Column count mismatch: expected " +
                    std::to_string(columns_.size()) + ", got " +
                    std::to_string(row.size());
            return false;
        }
        rows_.push_back(std::move(row));
        return true;
    }

    // Clear all rows
    void truncate() {
        rows_.clear();
    }

private:
    std::string name_;
    std::vector<ColumnDef> columns_;
    std::vector<Row> rows_;
    std::unordered_map<std::string, size_t> columnIndex_;
};

// ============================================================================
// Table Catalog - manages all tables
// ============================================================================

class TableCatalog {
public:
    static TableCatalog& instance() {
        static TableCatalog catalog;
        return catalog;
    }

    bool createTable(const std::string& name, std::vector<ColumnDef> columns, std::string& error) {
        std::string lowerName = toLower(name);
        if (tables_.find(lowerName) != tables_.end()) {
            error = "Table '" + name + "' already exists";
            return false;
        }
        tables_[lowerName] = std::make_shared<MemoryTable>(name, std::move(columns));
        return true;
    }

    bool dropTable(const std::string& name, std::string& error) {
        std::string lowerName = toLower(name);
        auto it = tables_.find(lowerName);
        if (it == tables_.end()) {
            error = "Table '" + name + "' does not exist";
            return false;
        }
        tables_.erase(it);
        return true;
    }

    std::shared_ptr<MemoryTable> getTable(const std::string& name) {
        std::string lowerName = toLower(name);
        auto it = tables_.find(lowerName);
        if (it != tables_.end()) return it->second;
        return nullptr;
    }

    std::vector<std::string> listTables() const {
        std::vector<std::string> names;
        for (const auto& [key, table] : tables_) {
            names.push_back(table->getName());
        }
        return names;
    }

    void clear() {
        tables_.clear();
    }

private:
    TableCatalog() = default;

    std::string toLower(const std::string& s) const {
        std::string result = s;
        for (char& c : result) c = tolower(c);
        return result;
    }

    std::unordered_map<std::string, std::shared_ptr<MemoryTable>> tables_;
};

// ============================================================================
// Tokenizer (extended from executor_bindings.cpp)
// ============================================================================

enum class TokenKind {
    End,
    Number,
    String,
    Identifier,
    Plus,
    Minus,
    Star,
    Slash,
    Percent,
    LParen,
    RParen,
    Comma,
    Semicolon,
    Dot,
    Eq,       // =
    Ne,       // != or <>
    Lt,       // <
    Le,       // <=
    Gt,       // >
    Ge,       // >=
    // Keywords
    As,
    Select,
    From,
    Where,
    And,
    Or,
    Not,
    Create,
    Table,
    Insert,
    Into,
    Values,
    Drop,
    Show,
    Tables,
    Engine,
    Memory,
    Null,
    True_,
    False_,
    Truncate,
    Error
};

struct Token {
    TokenKind kind;
    std::string text;
    size_t pos;
};

class Lexer {
public:
    Lexer(const char* input, size_t len)
        : input_(input), len_(len), pos_(0) {}

    Token next() {
        skipWhitespace();

        if (pos_ >= len_) {
            return {TokenKind::End, "", pos_};
        }

        char c = input_[pos_];
        size_t startPos = pos_;

        // Two-character operators
        if (pos_ + 1 < len_) {
            char c2 = input_[pos_ + 1];
            if (c == '!' && c2 == '=') { pos_ += 2; return {TokenKind::Ne, "!=", startPos}; }
            if (c == '<' && c2 == '>') { pos_ += 2; return {TokenKind::Ne, "<>", startPos}; }
            if (c == '<' && c2 == '=') { pos_ += 2; return {TokenKind::Le, "<=", startPos}; }
            if (c == '>' && c2 == '=') { pos_ += 2; return {TokenKind::Ge, ">=", startPos}; }
        }

        // Single character tokens
        switch (c) {
            case '+': pos_++; return {TokenKind::Plus, "+", startPos};
            case '-': pos_++; return {TokenKind::Minus, "-", startPos};
            case '*': pos_++; return {TokenKind::Star, "*", startPos};
            case '/': pos_++; return {TokenKind::Slash, "/", startPos};
            case '%': pos_++; return {TokenKind::Percent, "%", startPos};
            case '(': pos_++; return {TokenKind::LParen, "(", startPos};
            case ')': pos_++; return {TokenKind::RParen, ")", startPos};
            case ',': pos_++; return {TokenKind::Comma, ",", startPos};
            case ';': pos_++; return {TokenKind::Semicolon, ";", startPos};
            case '.': pos_++; return {TokenKind::Dot, ".", startPos};
            case '=': pos_++; return {TokenKind::Eq, "=", startPos};
            case '<': pos_++; return {TokenKind::Lt, "<", startPos};
            case '>': pos_++; return {TokenKind::Gt, ">", startPos};
        }

        // String literal
        if (c == '\'' || c == '"') {
            return scanString(c);
        }

        // Number
        if (isdigit(c) || (c == '.' && pos_ + 1 < len_ && isdigit(input_[pos_ + 1]))) {
            return scanNumber();
        }

        // Identifier or keyword
        if (isalpha(c) || c == '_') {
            return scanIdentifier();
        }

        // Unknown character
        pos_++;
        return {TokenKind::Error, std::string(1, c), startPos};
    }

    Token peek() {
        size_t savedPos = pos_;
        Token t = next();
        pos_ = savedPos;
        return t;
    }

    size_t getPos() const { return pos_; }
    void setPos(size_t pos) { pos_ = pos; }

private:
    void skipWhitespace() {
        while (pos_ < len_ && isspace(input_[pos_])) {
            pos_++;
        }
        // Skip single-line comments
        if (pos_ + 1 < len_ && input_[pos_] == '-' && input_[pos_ + 1] == '-') {
            while (pos_ < len_ && input_[pos_] != '\n') pos_++;
            skipWhitespace();
        }
    }

    Token scanString(char quote) {
        size_t startPos = pos_;
        pos_++; // Skip opening quote
        std::string value;

        while (pos_ < len_) {
            char c = input_[pos_];
            if (c == quote) {
                // Check for escaped quote (doubled)
                if (pos_ + 1 < len_ && input_[pos_ + 1] == quote) {
                    value += quote;
                    pos_ += 2;
                } else {
                    pos_++; // Skip closing quote
                    return {TokenKind::String, value, startPos};
                }
            } else if (c == '\\' && pos_ + 1 < len_) {
                // Handle escape sequences
                pos_++;
                char escaped = input_[pos_];
                switch (escaped) {
                    case 'n': value += '\n'; break;
                    case 't': value += '\t'; break;
                    case 'r': value += '\r'; break;
                    case '\\': value += '\\'; break;
                    case '\'': value += '\''; break;
                    case '"': value += '"'; break;
                    default: value += escaped; break;
                }
                pos_++;
            } else {
                value += c;
                pos_++;
            }
        }

        // Unclosed string
        return {TokenKind::Error, "unclosed string", startPos};
    }

    Token scanNumber() {
        size_t startPos = pos_;
        std::string num;
        bool hasDot = false;
        bool hasE = false;

        while (pos_ < len_) {
            char c = input_[pos_];
            if (isdigit(c)) {
                num += c;
                pos_++;
            } else if (c == '.' && !hasDot && !hasE) {
                hasDot = true;
                num += c;
                pos_++;
            } else if ((c == 'e' || c == 'E') && !hasE) {
                hasE = true;
                num += c;
                pos_++;
                // Handle optional +/- after e
                if (pos_ < len_ && (input_[pos_] == '+' || input_[pos_] == '-')) {
                    num += input_[pos_];
                    pos_++;
                }
            } else {
                break;
            }
        }

        return {TokenKind::Number, num, startPos};
    }

    Token scanIdentifier() {
        size_t startPos = pos_;
        std::string ident;

        while (pos_ < len_ && (isalnum(input_[pos_]) || input_[pos_] == '_')) {
            ident += input_[pos_];
            pos_++;
        }

        // Convert to uppercase for keyword comparison
        std::string upper = ident;
        for (char& c : upper) c = toupper(c);

        // Check keywords
        if (upper == "SELECT") return {TokenKind::Select, ident, startPos};
        if (upper == "FROM") return {TokenKind::From, ident, startPos};
        if (upper == "WHERE") return {TokenKind::Where, ident, startPos};
        if (upper == "AND") return {TokenKind::And, ident, startPos};
        if (upper == "OR") return {TokenKind::Or, ident, startPos};
        if (upper == "NOT") return {TokenKind::Not, ident, startPos};
        if (upper == "AS") return {TokenKind::As, ident, startPos};
        if (upper == "CREATE") return {TokenKind::Create, ident, startPos};
        if (upper == "TABLE") return {TokenKind::Table, ident, startPos};
        if (upper == "INSERT") return {TokenKind::Insert, ident, startPos};
        if (upper == "INTO") return {TokenKind::Into, ident, startPos};
        if (upper == "VALUES") return {TokenKind::Values, ident, startPos};
        if (upper == "DROP") return {TokenKind::Drop, ident, startPos};
        if (upper == "SHOW") return {TokenKind::Show, ident, startPos};
        if (upper == "TABLES") return {TokenKind::Tables, ident, startPos};
        if (upper == "ENGINE") return {TokenKind::Engine, ident, startPos};
        if (upper == "MEMORY") return {TokenKind::Memory, ident, startPos};
        if (upper == "NULL") return {TokenKind::Null, ident, startPos};
        if (upper == "TRUE") return {TokenKind::True_, ident, startPos};
        if (upper == "FALSE") return {TokenKind::False_, ident, startPos};
        if (upper == "TRUNCATE") return {TokenKind::Truncate, ident, startPos};

        return {TokenKind::Identifier, ident, startPos};
    }

    const char* input_;
    size_t len_;
    size_t pos_;
};

// ============================================================================
// Expression AST
// ============================================================================

struct Expr;
using ExprPtr = std::shared_ptr<Expr>;

enum class ExprKind {
    Literal,
    ColumnRef,
    BinaryOp,
    UnaryOp,
    Star  // For SELECT *
};

struct Expr {
    ExprKind kind;
    Value literalValue;          // For Literal
    std::string columnName;      // For ColumnRef
    char op;                     // For BinaryOp/UnaryOp (arithmetic: + - * / %)
    std::string compareOp;       // For comparison operators: = != < <= > >=
    ExprPtr left;                // For BinaryOp
    ExprPtr right;               // For BinaryOp, or operand for UnaryOp

    static ExprPtr makeLiteral(Value v) {
        auto e = std::make_shared<Expr>();
        e->kind = ExprKind::Literal;
        e->literalValue = std::move(v);
        return e;
    }

    static ExprPtr makeColumnRef(const std::string& name) {
        auto e = std::make_shared<Expr>();
        e->kind = ExprKind::ColumnRef;
        e->columnName = name;
        return e;
    }

    static ExprPtr makeStar() {
        auto e = std::make_shared<Expr>();
        e->kind = ExprKind::Star;
        return e;
    }

    static ExprPtr makeBinaryOp(char op, ExprPtr left, ExprPtr right) {
        auto e = std::make_shared<Expr>();
        e->kind = ExprKind::BinaryOp;
        e->op = op;
        e->left = std::move(left);
        e->right = std::move(right);
        return e;
    }

    static ExprPtr makeCompareOp(const std::string& op, ExprPtr left, ExprPtr right) {
        auto e = std::make_shared<Expr>();
        e->kind = ExprKind::BinaryOp;
        e->compareOp = op;
        e->op = 0;
        e->left = std::move(left);
        e->right = std::move(right);
        return e;
    }

    static ExprPtr makeUnaryOp(char op, ExprPtr operand) {
        auto e = std::make_shared<Expr>();
        e->kind = ExprKind::UnaryOp;
        e->op = op;
        e->right = std::move(operand);
        return e;
    }

    static ExprPtr makeLogicalOp(const std::string& op, ExprPtr left, ExprPtr right) {
        auto e = std::make_shared<Expr>();
        e->kind = ExprKind::BinaryOp;
        e->compareOp = op;
        e->op = 0;
        e->left = std::move(left);
        e->right = std::move(right);
        return e;
    }
};

// ============================================================================
// SelectColumn - column in SELECT list
// ============================================================================

struct SelectColumn {
    ExprPtr expr;
    std::string alias;
};

// ============================================================================
// Parser - parses SQL statements
// ============================================================================

class Parser {
public:
    Parser(Lexer& lexer) : lexer_(lexer) {
        advance();
    }

    // Parse expression
    ExprPtr parseExpr() {
        return parseOr();
    }

    // Parse OR expressions
    ExprPtr parseOr() {
        ExprPtr left = parseAnd();
        if (!left) return nullptr;

        while (current_.kind == TokenKind::Or) {
            advance();
            ExprPtr right = parseAnd();
            if (!right) return nullptr;
            left = Expr::makeLogicalOp("OR", left, right);
        }
        return left;
    }

    // Parse AND expressions
    ExprPtr parseAnd() {
        ExprPtr left = parseComparison();
        if (!left) return nullptr;

        while (current_.kind == TokenKind::And) {
            advance();
            ExprPtr right = parseComparison();
            if (!right) return nullptr;
            left = Expr::makeLogicalOp("AND", left, right);
        }
        return left;
    }

    // Parse comparison expressions
    ExprPtr parseComparison() {
        ExprPtr left = parseAddSub();
        if (!left) return nullptr;

        std::string op;
        switch (current_.kind) {
            case TokenKind::Eq: op = "="; break;
            case TokenKind::Ne: op = "!="; break;
            case TokenKind::Lt: op = "<"; break;
            case TokenKind::Le: op = "<="; break;
            case TokenKind::Gt: op = ">"; break;
            case TokenKind::Ge: op = ">="; break;
            default: return left;
        }

        advance();
        ExprPtr right = parseAddSub();
        if (!right) return nullptr;
        return Expr::makeCompareOp(op, left, right);
    }

    // Parse addition/subtraction
    ExprPtr parseAddSub() {
        ExprPtr left = parseMulDiv();
        if (!left) return nullptr;

        while (current_.kind == TokenKind::Plus || current_.kind == TokenKind::Minus) {
            char op = (current_.kind == TokenKind::Plus) ? '+' : '-';
            advance();
            ExprPtr right = parseMulDiv();
            if (!right) return nullptr;
            left = Expr::makeBinaryOp(op, left, right);
        }
        return left;
    }

    // Parse multiplication/division
    ExprPtr parseMulDiv() {
        ExprPtr left = parseUnary();
        if (!left) return nullptr;

        while (current_.kind == TokenKind::Star ||
               current_.kind == TokenKind::Slash ||
               current_.kind == TokenKind::Percent) {
            char op;
            switch (current_.kind) {
                case TokenKind::Star: op = '*'; break;
                case TokenKind::Slash: op = '/'; break;
                case TokenKind::Percent: op = '%'; break;
                default: op = '?'; break;
            }
            advance();
            ExprPtr right = parseUnary();
            if (!right) return nullptr;
            left = Expr::makeBinaryOp(op, left, right);
        }
        return left;
    }

    // Parse unary operators
    ExprPtr parseUnary() {
        if (current_.kind == TokenKind::Minus) {
            advance();
            ExprPtr operand = parseUnary();
            if (!operand) return nullptr;
            return Expr::makeUnaryOp('-', operand);
        }
        if (current_.kind == TokenKind::Plus) {
            advance();
            return parseUnary();
        }
        if (current_.kind == TokenKind::Not) {
            advance();
            ExprPtr operand = parseUnary();
            if (!operand) return nullptr;
            return Expr::makeUnaryOp('!', operand);
        }
        return parsePrimary();
    }

    // Parse primary expressions
    ExprPtr parsePrimary() {
        if (current_.kind == TokenKind::Number) {
            std::string numStr = current_.text;
            advance();
            if (numStr.find('.') != std::string::npos ||
                numStr.find('e') != std::string::npos ||
                numStr.find('E') != std::string::npos) {
                return Expr::makeLiteral(std::stod(numStr));
            } else {
                return Expr::makeLiteral(static_cast<int64_t>(std::stoll(numStr)));
            }
        }

        if (current_.kind == TokenKind::String) {
            std::string str = current_.text;
            advance();
            return Expr::makeLiteral(str);
        }

        if (current_.kind == TokenKind::Null) {
            advance();
            return Expr::makeLiteral(std::monostate{});
        }

        if (current_.kind == TokenKind::True_) {
            advance();
            return Expr::makeLiteral(int64_t{1});
        }

        if (current_.kind == TokenKind::False_) {
            advance();
            return Expr::makeLiteral(int64_t{0});
        }

        if (current_.kind == TokenKind::Star) {
            advance();
            return Expr::makeStar();
        }

        if (current_.kind == TokenKind::Identifier) {
            std::string ident = current_.text;
            advance();
            return Expr::makeColumnRef(ident);
        }

        if (current_.kind == TokenKind::LParen) {
            advance();
            ExprPtr expr = parseExpr();
            if (!expr) return nullptr;
            if (current_.kind != TokenKind::RParen) {
                error_ = "Expected closing parenthesis";
                return nullptr;
            }
            advance();
            return expr;
        }

        error_ = "Unexpected token: " + current_.text;
        return nullptr;
    }

    // Parse SELECT column list
    bool parseSelectList(std::vector<SelectColumn>& columns, std::string& error) {
        do {
            SelectColumn col;
            col.expr = parseExpr();
            if (!col.expr) {
                error = error_.empty() ? "Failed to parse expression" : error_;
                return false;
            }

            // Check for AS alias
            if (current_.kind == TokenKind::As) {
                advance();
                if (current_.kind != TokenKind::Identifier) {
                    error = "Expected identifier after AS";
                    return false;
                }
                col.alias = current_.text;
                advance();
            } else if (current_.kind == TokenKind::Identifier &&
                       current_.kind != TokenKind::From &&
                       current_.kind != TokenKind::Where) {
                // Implicit alias
                col.alias = current_.text;
                advance();
            }

            columns.push_back(std::move(col));

        } while (current_.kind == TokenKind::Comma && (advance(), true));

        return true;
    }

    // Parse column definition for CREATE TABLE
    bool parseColumnDef(ColumnDef& col, std::string& error) {
        if (current_.kind != TokenKind::Identifier) {
            error = "Expected column name";
            return false;
        }
        col.name = current_.text;
        advance();

        if (current_.kind != TokenKind::Identifier) {
            error = "Expected data type for column " + col.name;
            return false;
        }
        col.type = stringToDataType(current_.text);
        if (col.type == DataType::Unknown) {
            error = "Unknown data type: " + current_.text;
            return false;
        }
        advance();

        // Check for Nullable wrapper (simplified)
        col.nullable = true;

        return true;
    }

    // Parse value list for INSERT
    bool parseValueList(std::vector<Value>& values, std::string& error) {
        if (current_.kind != TokenKind::LParen) {
            error = "Expected '(' before values";
            return false;
        }
        advance();

        do {
            ExprPtr expr = parsePrimary();
            if (!expr) {
                error = error_.empty() ? "Failed to parse value" : error_;
                return false;
            }
            if (expr->kind == ExprKind::Literal) {
                values.push_back(expr->literalValue);
            } else if (expr->kind == ExprKind::UnaryOp && expr->op == '-') {
                // Handle negative numbers
                if (expr->right && expr->right->kind == ExprKind::Literal) {
                    Value v = expr->right->literalValue;
                    if (std::holds_alternative<int64_t>(v)) {
                        values.push_back(-std::get<int64_t>(v));
                    } else if (std::holds_alternative<double>(v)) {
                        values.push_back(-std::get<double>(v));
                    } else {
                        error = "Cannot negate non-numeric value";
                        return false;
                    }
                } else {
                    error = "Invalid negative value";
                    return false;
                }
            } else {
                error = "Only literal values are supported in INSERT";
                return false;
            }
        } while (current_.kind == TokenKind::Comma && (advance(), true));

        if (current_.kind != TokenKind::RParen) {
            error = "Expected ')' after values";
            return false;
        }
        advance();

        return true;
    }

    Token current() const { return current_; }
    void advance() { current_ = lexer_.next(); }
    std::string getError() const { return error_; }

private:
    Lexer& lexer_;
    Token current_;
    std::string error_;
};

// ============================================================================
// Expression Evaluator
// ============================================================================

class ExprEvaluator {
public:
    ExprEvaluator(const MemoryTable* table = nullptr, const Row* row = nullptr)
        : table_(table), row_(row) {}

    Value evaluate(const ExprPtr& expr) {
        if (!expr) return std::monostate{};

        switch (expr->kind) {
            case ExprKind::Literal:
                return expr->literalValue;

            case ExprKind::ColumnRef: {
                if (!table_ || !row_) {
                    return std::monostate{};
                }
                int idx = table_->getColumnIndex(expr->columnName);
                if (idx < 0 || idx >= static_cast<int>(row_->size())) {
                    return std::monostate{};
                }
                return (*row_)[idx];
            }

            case ExprKind::Star:
                // Star is handled at a higher level
                return std::monostate{};

            case ExprKind::UnaryOp: {
                Value operand = evaluate(expr->right);
                if (expr->op == '-') {
                    if (std::holds_alternative<int64_t>(operand)) {
                        return -std::get<int64_t>(operand);
                    }
                    if (std::holds_alternative<double>(operand)) {
                        return -std::get<double>(operand);
                    }
                }
                if (expr->op == '!') {
                    // Logical NOT
                    if (std::holds_alternative<int64_t>(operand)) {
                        return int64_t{std::get<int64_t>(operand) == 0 ? 1 : 0};
                    }
                    if (std::holds_alternative<double>(operand)) {
                        return int64_t{std::get<double>(operand) == 0.0 ? 1 : 0};
                    }
                }
                return operand;
            }

            case ExprKind::BinaryOp: {
                Value left = evaluate(expr->left);
                Value right = evaluate(expr->right);

                // Handle comparison operators
                if (!expr->compareOp.empty()) {
                    return evalCompareOp(expr->compareOp, left, right);
                }

                // Handle arithmetic operators
                return evalBinaryOp(expr->op, left, right);
            }
        }

        return std::monostate{};
    }

    bool evaluateBool(const ExprPtr& expr) {
        Value v = evaluate(expr);
        if (std::holds_alternative<int64_t>(v)) {
            return std::get<int64_t>(v) != 0;
        }
        if (std::holds_alternative<double>(v)) {
            return std::get<double>(v) != 0.0;
        }
        if (std::holds_alternative<std::string>(v)) {
            return !std::get<std::string>(v).empty();
        }
        return false;  // NULL is false
    }

private:
    Value evalBinaryOp(char op, const Value& left, const Value& right) {
        // Handle NULL propagation
        if (std::holds_alternative<std::monostate>(left) ||
            std::holds_alternative<std::monostate>(right)) {
            return std::monostate{};
        }

        // String concatenation with +
        if (op == '+' && (std::holds_alternative<std::string>(left) ||
                         std::holds_alternative<std::string>(right))) {
            return valueToString(left) + valueToString(right);
        }

        // Numeric operations
        bool leftIsDouble = std::holds_alternative<double>(left);
        bool rightIsDouble = std::holds_alternative<double>(right);
        bool leftIsInt = std::holds_alternative<int64_t>(left);
        bool rightIsInt = std::holds_alternative<int64_t>(right);

        if ((leftIsDouble || leftIsInt) && (rightIsDouble || rightIsInt)) {
            if (leftIsDouble || rightIsDouble) {
                double l = leftIsDouble ? std::get<double>(left)
                                        : static_cast<double>(std::get<int64_t>(left));
                double r = rightIsDouble ? std::get<double>(right)
                                         : static_cast<double>(std::get<int64_t>(right));
                switch (op) {
                    case '+': return l + r;
                    case '-': return l - r;
                    case '*': return l * r;
                    case '/':
                        if (r != 0) return l / r;
                        return Value{std::monostate{}};
                    case '%':
                        if (r != 0) return std::fmod(l, r);
                        return Value{std::monostate{}};
                }
            } else {
                int64_t l = std::get<int64_t>(left);
                int64_t r = std::get<int64_t>(right);
                switch (op) {
                    case '+': return l + r;
                    case '-': return l - r;
                    case '*': return l * r;
                    case '/':
                        if (r != 0) return l / r;
                        return Value{std::monostate{}};
                    case '%':
                        if (r != 0) return l % r;
                        return Value{std::monostate{}};
                }
            }
        }

        return std::monostate{};
    }

    Value evalCompareOp(const std::string& op, const Value& left, const Value& right) {
        // Handle logical operators
        if (op == "AND") {
            bool lb = valueToBool(left);
            bool rb = valueToBool(right);
            return int64_t{lb && rb ? 1 : 0};
        }
        if (op == "OR") {
            bool lb = valueToBool(left);
            bool rb = valueToBool(right);
            return int64_t{lb || rb ? 1 : 0};
        }

        // Handle NULL comparison
        if (std::holds_alternative<std::monostate>(left) ||
            std::holds_alternative<std::monostate>(right)) {
            return std::monostate{};
        }

        // Compare values
        int cmp = compareValues(left, right);
        bool result = false;

        if (op == "=") result = (cmp == 0);
        else if (op == "!=") result = (cmp != 0);
        else if (op == "<") result = (cmp < 0);
        else if (op == "<=") result = (cmp <= 0);
        else if (op == ">") result = (cmp > 0);
        else if (op == ">=") result = (cmp >= 0);

        return int64_t{result ? 1 : 0};
    }

    bool valueToBool(const Value& v) {
        if (std::holds_alternative<int64_t>(v)) return std::get<int64_t>(v) != 0;
        if (std::holds_alternative<double>(v)) return std::get<double>(v) != 0.0;
        if (std::holds_alternative<std::string>(v)) return !std::get<std::string>(v).empty();
        return false;
    }

    int compareValues(const Value& left, const Value& right) {
        // String comparison
        if (std::holds_alternative<std::string>(left) ||
            std::holds_alternative<std::string>(right)) {
            std::string ls = valueToString(left);
            std::string rs = valueToString(right);
            return ls.compare(rs);
        }

        // Numeric comparison
        double l = 0, r = 0;
        if (std::holds_alternative<int64_t>(left)) l = static_cast<double>(std::get<int64_t>(left));
        else if (std::holds_alternative<double>(left)) l = std::get<double>(left);

        if (std::holds_alternative<int64_t>(right)) r = static_cast<double>(std::get<int64_t>(right));
        else if (std::holds_alternative<double>(right)) r = std::get<double>(right);

        if (l < r) return -1;
        if (l > r) return 1;
        return 0;
    }

    const MemoryTable* table_;
    const Row* row_;
};

// ============================================================================
// Query Result
// ============================================================================

struct QueryResult {
    std::vector<ColumnDef> columns;
    std::vector<Row> rows;
    std::string message;  // For non-SELECT queries
    bool success = true;
    std::string error;
};

// ============================================================================
// Query Executor
// ============================================================================

class QueryExecutor {
public:
    QueryResult execute(const char* query, size_t len) {
        QueryResult result;
        Lexer lexer(query, len);
        Parser parser(lexer);

        Token first = parser.current();

        switch (first.kind) {
            case TokenKind::Select:
                return executeSelect(parser);
            case TokenKind::Create:
                return executeCreate(parser);
            case TokenKind::Insert:
                return executeInsert(parser);
            case TokenKind::Drop:
                return executeDrop(parser);
            case TokenKind::Show:
                return executeShow(parser);
            case TokenKind::Truncate:
                return executeTruncate(parser);
            default:
                result.success = false;
                result.error = "Unsupported statement type";
                return result;
        }
    }

private:
    QueryResult executeSelect(Parser& parser) {
        QueryResult result;

        // Skip SELECT
        parser.advance();

        // Parse select list
        std::vector<SelectColumn> selectCols;
        std::string error;
        if (!parser.parseSelectList(selectCols, error)) {
            result.success = false;
            result.error = error;
            return result;
        }

        // Check for FROM clause
        std::shared_ptr<MemoryTable> table = nullptr;
        if (parser.current().kind == TokenKind::From) {
            parser.advance();
            if (parser.current().kind != TokenKind::Identifier) {
                result.success = false;
                result.error = "Expected table name after FROM";
                return result;
            }
            std::string tableName = parser.current().text;
            parser.advance();

            table = TableCatalog::instance().getTable(tableName);
            if (!table) {
                result.success = false;
                result.error = "Table '" + tableName + "' does not exist";
                return result;
            }
        }

        // Parse WHERE clause
        ExprPtr whereExpr = nullptr;
        if (parser.current().kind == TokenKind::Where) {
            parser.advance();
            whereExpr = parser.parseExpr();
            if (!whereExpr) {
                result.success = false;
                result.error = parser.getError().empty() ? "Failed to parse WHERE condition" : parser.getError();
                return result;
            }
        }

        // Expand SELECT * if needed
        bool hasStar = false;
        for (const auto& col : selectCols) {
            if (col.expr->kind == ExprKind::Star) {
                hasStar = true;
                break;
            }
        }

        if (hasStar) {
            if (!table) {
                result.success = false;
                result.error = "Cannot use * without a table";
                return result;
            }
            // Replace * with all columns
            std::vector<SelectColumn> expanded;
            for (const auto& col : selectCols) {
                if (col.expr->kind == ExprKind::Star) {
                    for (const auto& tcol : table->getColumns()) {
                        SelectColumn sc;
                        sc.expr = Expr::makeColumnRef(tcol.name);
                        sc.alias = tcol.name;
                        expanded.push_back(sc);
                    }
                } else {
                    expanded.push_back(col);
                }
            }
            selectCols = std::move(expanded);
        }

        // Build result columns
        for (size_t i = 0; i < selectCols.size(); i++) {
            ColumnDef col;
            if (!selectCols[i].alias.empty()) {
                col.name = selectCols[i].alias;
            } else if (selectCols[i].expr->kind == ExprKind::ColumnRef) {
                col.name = selectCols[i].expr->columnName;
            } else {
                col.name = "column" + std::to_string(i);
            }
            col.type = DataType::String;  // Default, could infer from expression
            result.columns.push_back(col);
        }

        // Execute query
        if (table) {
            // Query from table
            for (const auto& srcRow : table->getRows()) {
                ExprEvaluator eval(table.get(), &srcRow);

                // Check WHERE condition
                if (whereExpr && !eval.evaluateBool(whereExpr)) {
                    continue;
                }

                // Evaluate SELECT expressions
                Row outRow;
                for (const auto& col : selectCols) {
                    outRow.push_back(eval.evaluate(col.expr));
                }
                result.rows.push_back(std::move(outRow));
            }
        } else {
            // Expression-only query (no FROM)
            ExprEvaluator eval;
            Row outRow;
            for (const auto& col : selectCols) {
                outRow.push_back(eval.evaluate(col.expr));
            }
            result.rows.push_back(std::move(outRow));
        }

        return result;
    }

    QueryResult executeCreate(Parser& parser) {
        QueryResult result;

        // Skip CREATE
        parser.advance();

        if (parser.current().kind != TokenKind::Table) {
            result.success = false;
            result.error = "Expected TABLE after CREATE";
            return result;
        }
        parser.advance();

        if (parser.current().kind != TokenKind::Identifier) {
            result.success = false;
            result.error = "Expected table name";
            return result;
        }
        std::string tableName = parser.current().text;
        parser.advance();

        // Parse column definitions
        if (parser.current().kind != TokenKind::LParen) {
            result.success = false;
            result.error = "Expected '(' after table name";
            return result;
        }
        parser.advance();

        std::vector<ColumnDef> columns;
        std::string error;
        do {
            ColumnDef col;
            if (!parser.parseColumnDef(col, error)) {
                result.success = false;
                result.error = error;
                return result;
            }
            columns.push_back(std::move(col));
        } while (parser.current().kind == TokenKind::Comma && (parser.advance(), true));

        if (parser.current().kind != TokenKind::RParen) {
            result.success = false;
            result.error = "Expected ')' after column definitions";
            return result;
        }
        parser.advance();

        // Parse ENGINE = Memory (optional for this implementation)
        if (parser.current().kind == TokenKind::Engine) {
            parser.advance();
            if (parser.current().kind != TokenKind::Eq) {
                result.success = false;
                result.error = "Expected '=' after ENGINE";
                return result;
            }
            parser.advance();

            if (parser.current().kind != TokenKind::Memory &&
                parser.current().kind != TokenKind::Identifier) {
                result.success = false;
                result.error = "Only Memory engine is supported";
                return result;
            }
            std::string engine = parser.current().text;
            std::string upperEngine = engine;
            for (char& c : upperEngine) c = toupper(c);
            if (upperEngine != "MEMORY") {
                result.success = false;
                result.error = "Only Memory engine is supported, got: " + engine;
                return result;
            }
            parser.advance();
        }

        // Create the table
        if (!TableCatalog::instance().createTable(tableName, std::move(columns), error)) {
            result.success = false;
            result.error = error;
            return result;
        }

        result.message = "OK";
        return result;
    }

    QueryResult executeInsert(Parser& parser) {
        QueryResult result;

        // Skip INSERT
        parser.advance();

        if (parser.current().kind != TokenKind::Into) {
            result.success = false;
            result.error = "Expected INTO after INSERT";
            return result;
        }
        parser.advance();

        if (parser.current().kind != TokenKind::Identifier) {
            result.success = false;
            result.error = "Expected table name";
            return result;
        }
        std::string tableName = parser.current().text;
        parser.advance();

        auto table = TableCatalog::instance().getTable(tableName);
        if (!table) {
            result.success = false;
            result.error = "Table '" + tableName + "' does not exist";
            return result;
        }

        // Optional column list (not implemented, assume all columns)
        // Skip to VALUES
        if (parser.current().kind != TokenKind::Values) {
            result.success = false;
            result.error = "Expected VALUES";
            return result;
        }
        parser.advance();

        // Parse value rows
        int rowCount = 0;
        std::string error;
        do {
            std::vector<Value> values;
            if (!parser.parseValueList(values, error)) {
                result.success = false;
                result.error = error;
                return result;
            }

            if (!table->insertRow(std::move(values), error)) {
                result.success = false;
                result.error = error;
                return result;
            }
            rowCount++;
        } while (parser.current().kind == TokenKind::Comma && (parser.advance(), true));

        result.message = "OK: " + std::to_string(rowCount) + " row(s) inserted";
        return result;
    }

    QueryResult executeDrop(Parser& parser) {
        QueryResult result;

        // Skip DROP
        parser.advance();

        if (parser.current().kind != TokenKind::Table) {
            result.success = false;
            result.error = "Expected TABLE after DROP";
            return result;
        }
        parser.advance();

        if (parser.current().kind != TokenKind::Identifier) {
            result.success = false;
            result.error = "Expected table name";
            return result;
        }
        std::string tableName = parser.current().text;
        parser.advance();

        std::string error;
        if (!TableCatalog::instance().dropTable(tableName, error)) {
            result.success = false;
            result.error = error;
            return result;
        }

        result.message = "OK";
        return result;
    }

    QueryResult executeShow(Parser& parser) {
        QueryResult result;

        // Skip SHOW
        parser.advance();

        if (parser.current().kind != TokenKind::Tables) {
            result.success = false;
            result.error = "Only SHOW TABLES is supported";
            return result;
        }
        parser.advance();

        // Return list of tables
        ColumnDef col;
        col.name = "name";
        col.type = DataType::String;
        result.columns.push_back(col);

        for (const auto& name : TableCatalog::instance().listTables()) {
            Row row;
            row.push_back(name);
            result.rows.push_back(std::move(row));
        }

        return result;
    }

    QueryResult executeTruncate(Parser& parser) {
        QueryResult result;

        // Skip TRUNCATE
        parser.advance();

        // Optional TABLE keyword
        if (parser.current().kind == TokenKind::Table) {
            parser.advance();
        }

        if (parser.current().kind != TokenKind::Identifier) {
            result.success = false;
            result.error = "Expected table name";
            return result;
        }
        std::string tableName = parser.current().text;
        parser.advance();

        auto table = TableCatalog::instance().getTable(tableName);
        if (!table) {
            result.success = false;
            result.error = "Table '" + tableName + "' does not exist";
            return result;
        }

        table->truncate();
        result.message = "OK";
        return result;
    }
};

// ============================================================================
// Result Formatting
// ============================================================================

std::string formatResultCSV(const QueryResult& result) {
    if (!result.success) {
        return "Error: " + result.error + "\n";
    }

    if (!result.message.empty() && result.columns.empty()) {
        return result.message + "\n";
    }

    std::string output;

    // Header row
    for (size_t i = 0; i < result.columns.size(); i++) {
        if (i > 0) output += ",";
        output += "\"" + result.columns[i].name + "\"";
    }
    output += "\n";

    // Data rows
    for (const auto& row : result.rows) {
        for (size_t i = 0; i < row.size(); i++) {
            if (i > 0) output += ",";
            ValueType t = getValueType(row[i]);
            if (t == ValueType::String) {
                std::string s = std::get<std::string>(row[i]);
                output += "\"";
                for (char c : s) {
                    if (c == '"') output += "\"\"";
                    else output += c;
                }
                output += "\"";
            } else {
                output += valueToString(row[i]);
            }
        }
        output += "\n";
    }

    return output;
}

std::string formatResultTSV(const QueryResult& result) {
    if (!result.success) {
        return "Error: " + result.error + "\n";
    }

    if (!result.message.empty() && result.columns.empty()) {
        return result.message + "\n";
    }

    std::string output;

    // Header row
    for (size_t i = 0; i < result.columns.size(); i++) {
        if (i > 0) output += "\t";
        output += result.columns[i].name;
    }
    output += "\n";

    // Data rows
    for (const auto& row : result.rows) {
        for (size_t i = 0; i < row.size(); i++) {
            if (i > 0) output += "\t";
            output += valueToString(row[i]);
        }
        output += "\n";
    }

    return output;
}

std::string formatResultJSON(const QueryResult& result) {
    if (!result.success) {
        return "{\"error\": \"" + result.error + "\"}\n";
    }

    if (!result.message.empty() && result.columns.empty()) {
        return "{\"message\": \"" + result.message + "\"}\n";
    }

    std::string output = "{\n";
    output += "  \"meta\": [\n";

    for (size_t i = 0; i < result.columns.size(); i++) {
        output += "    {\"name\": \"" + result.columns[i].name + "\", \"type\": \"";
        output += dataTypeToString(result.columns[i].type);
        output += "\"}";
        if (i < result.columns.size() - 1) output += ",";
        output += "\n";
    }

    output += "  ],\n";
    output += "  \"data\": [\n";

    for (size_t r = 0; r < result.rows.size(); r++) {
        output += "    {";
        for (size_t c = 0; c < result.rows[r].size(); c++) {
            if (c > 0) output += ", ";
            output += "\"" + result.columns[c].name + "\": ";
            ValueType t = getValueType(result.rows[r][c]);
            if (t == ValueType::String) {
                output += "\"";
                for (char ch : std::get<std::string>(result.rows[r][c])) {
                    switch (ch) {
                        case '"': output += "\\\""; break;
                        case '\\': output += "\\\\"; break;
                        case '\n': output += "\\n"; break;
                        case '\r': output += "\\r"; break;
                        case '\t': output += "\\t"; break;
                        default: output += ch; break;
                    }
                }
                output += "\"";
            } else if (t == ValueType::Null) {
                output += "null";
            } else {
                output += valueToString(result.rows[r][c]);
            }
        }
        output += "}";
        if (r < result.rows.size() - 1) output += ",";
        output += "\n";
    }

    output += "  ],\n";
    output += "  \"rows\": " + std::to_string(result.rows.size()) + ",\n";
    output += "  \"statistics\": {\"elapsed\": 0.001, \"rows_read\": " +
              std::to_string(result.rows.size()) + ", \"bytes_read\": 0}\n";
    output += "}\n";

    return output;
}

// ============================================================================
// Engine Context
// ============================================================================

struct EngineContext {
    char* lastResult;
    size_t lastResultLen;
    char* lastError;

    EngineContext() : lastResult(nullptr), lastResultLen(0), lastError(nullptr) {}

    ~EngineContext() {
        if (lastResult) free(lastResult);
        if (lastError) free(lastError);
    }

    void setResult(const std::string& result) {
        if (lastResult) free(lastResult);
        if (lastError) {
            free(lastError);
            lastError = nullptr;
        }
        lastResultLen = result.size();
        lastResult = static_cast<char*>(malloc(lastResultLen + 1));
        memcpy(lastResult, result.c_str(), lastResultLen + 1);
    }

    void setError(const std::string& error) {
        if (lastError) free(lastError);
        lastError = strdup(error.c_str());
        lastResultLen = 0;
        if (lastResult) {
            free(lastResult);
            lastResult = nullptr;
        }
    }
};

// ============================================================================
// C API
// ============================================================================

extern "C" {

/**
 * Create a new engine context.
 */
EXPORT
void* memory_engine_create() {
    return new EngineContext();
}

/**
 * Destroy an engine context.
 */
EXPORT
void memory_engine_destroy(void* ctx) {
    if (ctx) {
        delete static_cast<EngineContext*>(ctx);
    }
}

/**
 * Execute a SQL query.
 * @param ctx Engine context
 * @param query SQL query string
 * @param query_len Length of query
 * @param format Output format: "CSV", "TSV", "JSON"
 * @return 0 on success, -1 on error
 */
EXPORT
int memory_engine_query(void* ctx, const char* query, size_t query_len, const char* format) {
    if (!ctx || !query) return -1;

    EngineContext* engine = static_cast<EngineContext*>(ctx);
    QueryExecutor executor;

    QueryResult result = executor.execute(query, query_len);

    if (!result.success) {
        engine->setError(result.error);
        return -1;
    }

    // Format result
    std::string fmt = format ? format : "CSV";
    for (char& c : fmt) c = toupper(c);

    std::string output;
    if (fmt == "JSON" || fmt == "JSONEACHROW") {
        output = formatResultJSON(result);
    } else if (fmt == "TSV" || fmt == "TABSEPARATED") {
        output = formatResultTSV(result);
    } else {
        output = formatResultCSV(result);
    }

    engine->setResult(output);
    return 0;
}

/**
 * Get the result buffer from last query.
 */
EXPORT
const char* memory_engine_get_result(void* ctx) {
    if (!ctx) return nullptr;
    return static_cast<EngineContext*>(ctx)->lastResult;
}

/**
 * Get the result length from last query.
 */
EXPORT
size_t memory_engine_get_result_len(void* ctx) {
    if (!ctx) return 0;
    return static_cast<EngineContext*>(ctx)->lastResultLen;
}

/**
 * Get the error message from last query.
 */
EXPORT
const char* memory_engine_get_error(void* ctx) {
    if (!ctx) return nullptr;
    return static_cast<EngineContext*>(ctx)->lastError;
}

/**
 * Clear all tables from the catalog.
 */
EXPORT
void memory_engine_reset() {
    TableCatalog::instance().clear();
}

/**
 * Test function to verify the module loaded correctly.
 */
EXPORT
int memory_engine_test() {
    // Reset state
    TableCatalog::instance().clear();

    EngineContext ctx;
    std::string sql;
    int rc;

    // Test 1: Simple expression (backward compatible with executor)
    sql = "SELECT 1 + 2 AS result";
    rc = memory_engine_query(&ctx, sql.c_str(), sql.size(), "CSV");
    if (rc != 0) return -1;
    if (!ctx.lastResult || strstr(ctx.lastResult, "3") == nullptr) return -2;

    // Test 2: CREATE TABLE
    sql = "CREATE TABLE users (id Int32, name String, age Int32) ENGINE = Memory";
    rc = memory_engine_query(&ctx, sql.c_str(), sql.size(), "CSV");
    if (rc != 0) return -3;
    if (!ctx.lastResult || strstr(ctx.lastResult, "OK") == nullptr) return -4;

    // Test 3: INSERT INTO
    sql = "INSERT INTO users VALUES (1, 'Alice', 30), (2, 'Bob', 25), (3, 'Charlie', 35)";
    rc = memory_engine_query(&ctx, sql.c_str(), sql.size(), "CSV");
    if (rc != 0) return -5;
    if (!ctx.lastResult || strstr(ctx.lastResult, "3 row") == nullptr) return -6;

    // Test 4: SELECT *
    sql = "SELECT * FROM users";
    rc = memory_engine_query(&ctx, sql.c_str(), sql.size(), "CSV");
    if (rc != 0) return -7;
    if (!ctx.lastResult) return -8;
    if (strstr(ctx.lastResult, "Alice") == nullptr) return -9;
    if (strstr(ctx.lastResult, "Bob") == nullptr) return -10;
    if (strstr(ctx.lastResult, "Charlie") == nullptr) return -11;

    // Test 5: SELECT with WHERE
    sql = "SELECT name, age FROM users WHERE age > 28";
    rc = memory_engine_query(&ctx, sql.c_str(), sql.size(), "CSV");
    if (rc != 0) return -12;
    if (!ctx.lastResult) return -13;
    if (strstr(ctx.lastResult, "Alice") == nullptr) return -14;  // age 30
    if (strstr(ctx.lastResult, "Charlie") == nullptr) return -15; // age 35
    if (strstr(ctx.lastResult, "Bob") != nullptr) return -16;    // age 25, should not appear

    // Test 6: SELECT with expression
    sql = "SELECT name, age * 2 AS double_age FROM users WHERE id = 1";
    rc = memory_engine_query(&ctx, sql.c_str(), sql.size(), "CSV");
    if (rc != 0) return -17;
    if (!ctx.lastResult) return -18;
    if (strstr(ctx.lastResult, "60") == nullptr) return -19;  // 30 * 2 = 60

    // Test 7: SHOW TABLES
    sql = "SHOW TABLES";
    rc = memory_engine_query(&ctx, sql.c_str(), sql.size(), "CSV");
    if (rc != 0) return -20;
    if (!ctx.lastResult || strstr(ctx.lastResult, "users") == nullptr) return -21;

    // Test 8: DROP TABLE
    sql = "DROP TABLE users";
    rc = memory_engine_query(&ctx, sql.c_str(), sql.size(), "CSV");
    if (rc != 0) return -22;

    // Verify table is gone
    sql = "SHOW TABLES";
    rc = memory_engine_query(&ctx, sql.c_str(), sql.size(), "CSV");
    if (rc != 0) return -23;
    if (ctx.lastResult && strstr(ctx.lastResult, "users") != nullptr) return -24;

    // Clean up
    TableCatalog::instance().clear();

    return 0; // All tests passed
}

/**
 * Get version string.
 */
EXPORT
const char* memory_engine_version() {
    return "chdb-memory-engine 0.1.0 (WASM in-memory SQL engine)";
}

} // extern "C"

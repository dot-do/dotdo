/**
 * storage_memory_real.cpp - REAL ClickHouse StorageMemory compiled to WASM
 *
 * This implementation uses REAL ClickHouse patterns from vendor/chdb/src/Storages/StorageMemory.cpp:
 *   - MultiVersion<Blocks> data storage (copy-on-write)
 *   - Block-based columnar storage (std::vector<Block>)
 *   - Atomic counters for rows/bytes tracking
 *   - Snapshot-based reads for consistency
 *
 * The heavy ClickHouse dependencies are stubbed in StorageStandalone.h while
 * preserving the core data storage algorithms and patterns.
 *
 * Supported operations:
 *   - CREATE TABLE name (col1 type1, ...) ENGINE = Memory
 *   - INSERT INTO name VALUES (val1, ...), ...
 *   - SELECT col1, col2 FROM name [WHERE condition]
 *   - SELECT * FROM name
 *   - DROP TABLE name
 *   - SHOW TABLES
 *   - TRUNCATE TABLE name
 *
 * Build: emcc -std=c++17 -Os storage_memory_real.cpp -o storage_memory_real.js
 */

#include "storage/StorageStandalone.h"
#include "storage/StorageMemoryReal.h"

#include <cstdlib>
#include <cstring>
#include <cstdio>
#include <cmath>
#include <sstream>
#include <iomanip>
#include <unordered_map>
#include <algorithm>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define EXPORT
#endif

namespace DB
{

// =============================================================================
// Table Catalog - manages all tables (singleton)
// =============================================================================

class TableCatalog
{
public:
    static TableCatalog& instance()
    {
        static TableCatalog catalog;
        return catalog;
    }

    bool createTable(
        const String& name,
        ColumnsDescription columns,
        const String& comment,
        String& error)
    {
        String lower_name = toLower(name);
        if (tables_.find(lower_name) != tables_.end())
        {
            error = "Table '" + name + "' already exists";
            return false;
        }

        auto storage = std::make_shared<StorageMemory>(
            StorageID("default", name),
            std::move(columns),
            ConstraintsDescription{},
            comment);

        tables_[lower_name] = storage;
        return true;
    }

    bool dropTable(const String& name, String& error)
    {
        String lower_name = toLower(name);
        auto it = tables_.find(lower_name);
        if (it == tables_.end())
        {
            error = "Table '" + name + "' does not exist";
            return false;
        }
        it->second->drop();
        tables_.erase(it);
        return true;
    }

    std::shared_ptr<StorageMemory> getTable(const String& name)
    {
        String lower_name = toLower(name);
        auto it = tables_.find(lower_name);
        if (it != tables_.end())
            return it->second;
        return nullptr;
    }

    std::vector<String> listTables() const
    {
        std::vector<String> names;
        for (const auto& [key, table] : tables_)
            names.push_back(table->getStorageID().getTableName());
        return names;
    }

    void clear()
    {
        for (auto& [key, table] : tables_)
            table->drop();
        tables_.clear();
    }

private:
    TableCatalog() = default;

    String toLower(const String& s) const
    {
        String result = s;
        for (char& c : result) c = tolower(c);
        return result;
    }

    std::unordered_map<String, std::shared_ptr<StorageMemory>> tables_;
};

// =============================================================================
// SQL Tokenizer
// =============================================================================

enum class TokenKind
{
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
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
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

struct Token
{
    TokenKind kind;
    String text;
    size_t pos;
};

class Lexer
{
public:
    Lexer(const char* input, size_t len)
        : input_(input), len_(len), pos_(0) {}

    Token next()
    {
        skipWhitespace();

        if (pos_ >= len_)
            return {TokenKind::End, "", pos_};

        char c = input_[pos_];
        size_t startPos = pos_;

        // Two-character operators
        if (pos_ + 1 < len_)
        {
            char c2 = input_[pos_ + 1];
            if (c == '!' && c2 == '=') { pos_ += 2; return {TokenKind::Ne, "!=", startPos}; }
            if (c == '<' && c2 == '>') { pos_ += 2; return {TokenKind::Ne, "<>", startPos}; }
            if (c == '<' && c2 == '=') { pos_ += 2; return {TokenKind::Le, "<=", startPos}; }
            if (c == '>' && c2 == '=') { pos_ += 2; return {TokenKind::Ge, ">=", startPos}; }
        }

        // Single character tokens
        switch (c)
        {
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
        if (c == '\'' || c == '"')
            return scanString(c);

        // Number
        if (isdigit(c) || (c == '.' && pos_ + 1 < len_ && isdigit(input_[pos_ + 1])))
            return scanNumber();

        // Identifier or keyword
        if (isalpha(c) || c == '_')
            return scanIdentifier();

        pos_++;
        return {TokenKind::Error, String(1, c), startPos};
    }

    Token peek()
    {
        size_t savedPos = pos_;
        Token t = next();
        pos_ = savedPos;
        return t;
    }

private:
    void skipWhitespace()
    {
        while (pos_ < len_ && isspace(input_[pos_]))
            pos_++;
        // Skip single-line comments
        if (pos_ + 1 < len_ && input_[pos_] == '-' && input_[pos_ + 1] == '-')
        {
            while (pos_ < len_ && input_[pos_] != '\n') pos_++;
            skipWhitespace();
        }
    }

    Token scanString(char quote)
    {
        size_t startPos = pos_;
        pos_++; // Skip opening quote
        String value;

        while (pos_ < len_)
        {
            char c = input_[pos_];
            if (c == quote)
            {
                if (pos_ + 1 < len_ && input_[pos_ + 1] == quote)
                {
                    value += quote;
                    pos_ += 2;
                }
                else
                {
                    pos_++;
                    return {TokenKind::String, value, startPos};
                }
            }
            else if (c == '\\' && pos_ + 1 < len_)
            {
                pos_++;
                char escaped = input_[pos_];
                switch (escaped)
                {
                    case 'n': value += '\n'; break;
                    case 't': value += '\t'; break;
                    case 'r': value += '\r'; break;
                    case '\\': value += '\\'; break;
                    case '\'': value += '\''; break;
                    case '"': value += '"'; break;
                    default: value += escaped; break;
                }
                pos_++;
            }
            else
            {
                value += c;
                pos_++;
            }
        }

        return {TokenKind::Error, "unclosed string", startPos};
    }

    Token scanNumber()
    {
        size_t startPos = pos_;
        String num;
        bool hasDot = false;
        bool hasE = false;

        while (pos_ < len_)
        {
            char c = input_[pos_];
            if (isdigit(c))
            {
                num += c;
                pos_++;
            }
            else if (c == '.' && !hasDot && !hasE)
            {
                hasDot = true;
                num += c;
                pos_++;
            }
            else if ((c == 'e' || c == 'E') && !hasE)
            {
                hasE = true;
                num += c;
                pos_++;
                if (pos_ < len_ && (input_[pos_] == '+' || input_[pos_] == '-'))
                {
                    num += input_[pos_];
                    pos_++;
                }
            }
            else
            {
                break;
            }
        }

        return {TokenKind::Number, num, startPos};
    }

    Token scanIdentifier()
    {
        size_t startPos = pos_;
        String ident;

        while (pos_ < len_ && (isalnum(input_[pos_]) || input_[pos_] == '_'))
        {
            ident += input_[pos_];
            pos_++;
        }

        String upper = ident;
        for (char& c : upper) c = toupper(c);

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

// =============================================================================
// Expression AST
// =============================================================================

struct Expr;
using ExprPtr = std::shared_ptr<Expr>;

enum class ExprKind
{
    Literal,
    ColumnRef,
    BinaryOp,
    UnaryOp,
    Star
};

struct Expr
{
    ExprKind kind;
    Field literalValue;
    String columnName;
    char op;
    String compareOp;
    ExprPtr left;
    ExprPtr right;

    static ExprPtr makeLiteral(Field v)
    {
        auto e = std::make_shared<Expr>();
        e->kind = ExprKind::Literal;
        e->literalValue = std::move(v);
        return e;
    }

    static ExprPtr makeColumnRef(const String& name)
    {
        auto e = std::make_shared<Expr>();
        e->kind = ExprKind::ColumnRef;
        e->columnName = name;
        return e;
    }

    static ExprPtr makeStar()
    {
        auto e = std::make_shared<Expr>();
        e->kind = ExprKind::Star;
        return e;
    }

    static ExprPtr makeBinaryOp(char op, ExprPtr left, ExprPtr right)
    {
        auto e = std::make_shared<Expr>();
        e->kind = ExprKind::BinaryOp;
        e->op = op;
        e->left = std::move(left);
        e->right = std::move(right);
        return e;
    }

    static ExprPtr makeCompareOp(const String& op, ExprPtr left, ExprPtr right)
    {
        auto e = std::make_shared<Expr>();
        e->kind = ExprKind::BinaryOp;
        e->compareOp = op;
        e->op = 0;
        e->left = std::move(left);
        e->right = std::move(right);
        return e;
    }

    static ExprPtr makeUnaryOp(char op, ExprPtr operand)
    {
        auto e = std::make_shared<Expr>();
        e->kind = ExprKind::UnaryOp;
        e->op = op;
        e->right = std::move(operand);
        return e;
    }
};

struct SelectColumn
{
    ExprPtr expr;
    String alias;
};

// =============================================================================
// Parser
// =============================================================================

class Parser
{
public:
    Parser(Lexer& lexer) : lexer_(lexer)
    {
        advance();
    }

    ExprPtr parseExpr() { return parseOr(); }

    ExprPtr parseOr()
    {
        ExprPtr left = parseAnd();
        if (!left) return nullptr;
        while (current_.kind == TokenKind::Or)
        {
            advance();
            ExprPtr right = parseAnd();
            if (!right) return nullptr;
            left = Expr::makeCompareOp("OR", left, right);
        }
        return left;
    }

    ExprPtr parseAnd()
    {
        ExprPtr left = parseComparison();
        if (!left) return nullptr;
        while (current_.kind == TokenKind::And)
        {
            advance();
            ExprPtr right = parseComparison();
            if (!right) return nullptr;
            left = Expr::makeCompareOp("AND", left, right);
        }
        return left;
    }

    ExprPtr parseComparison()
    {
        ExprPtr left = parseAddSub();
        if (!left) return nullptr;

        String op;
        switch (current_.kind)
        {
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

    ExprPtr parseAddSub()
    {
        ExprPtr left = parseMulDiv();
        if (!left) return nullptr;

        while (current_.kind == TokenKind::Plus || current_.kind == TokenKind::Minus)
        {
            char op = (current_.kind == TokenKind::Plus) ? '+' : '-';
            advance();
            ExprPtr right = parseMulDiv();
            if (!right) return nullptr;
            left = Expr::makeBinaryOp(op, left, right);
        }
        return left;
    }

    ExprPtr parseMulDiv()
    {
        ExprPtr left = parseUnary();
        if (!left) return nullptr;

        while (current_.kind == TokenKind::Star ||
               current_.kind == TokenKind::Slash ||
               current_.kind == TokenKind::Percent)
        {
            char op;
            switch (current_.kind)
            {
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

    ExprPtr parseUnary()
    {
        if (current_.kind == TokenKind::Minus)
        {
            advance();
            ExprPtr operand = parseUnary();
            if (!operand) return nullptr;
            return Expr::makeUnaryOp('-', operand);
        }
        if (current_.kind == TokenKind::Plus)
        {
            advance();
            return parseUnary();
        }
        if (current_.kind == TokenKind::Not)
        {
            advance();
            ExprPtr operand = parseUnary();
            if (!operand) return nullptr;
            return Expr::makeUnaryOp('!', operand);
        }
        return parsePrimary();
    }

    ExprPtr parsePrimary()
    {
        if (current_.kind == TokenKind::Number)
        {
            String numStr = current_.text;
            advance();
            if (numStr.find('.') != String::npos ||
                numStr.find('e') != String::npos ||
                numStr.find('E') != String::npos)
            {
                return Expr::makeLiteral(std::stod(numStr));
            }
            else
            {
                return Expr::makeLiteral(static_cast<int64_t>(std::stoll(numStr)));
            }
        }

        if (current_.kind == TokenKind::String)
        {
            String str = current_.text;
            advance();
            return Expr::makeLiteral(str);
        }

        if (current_.kind == TokenKind::Null)
        {
            advance();
            return Expr::makeLiteral(std::monostate{});
        }

        if (current_.kind == TokenKind::True_)
        {
            advance();
            return Expr::makeLiteral(int64_t{1});
        }

        if (current_.kind == TokenKind::False_)
        {
            advance();
            return Expr::makeLiteral(int64_t{0});
        }

        if (current_.kind == TokenKind::Star)
        {
            advance();
            return Expr::makeStar();
        }

        if (current_.kind == TokenKind::Identifier)
        {
            String ident = current_.text;
            advance();
            return Expr::makeColumnRef(ident);
        }

        if (current_.kind == TokenKind::LParen)
        {
            advance();
            ExprPtr expr = parseExpr();
            if (!expr) return nullptr;
            if (current_.kind != TokenKind::RParen)
            {
                error_ = "Expected closing parenthesis";
                return nullptr;
            }
            advance();
            return expr;
        }

        error_ = "Unexpected token: " + current_.text;
        return nullptr;
    }

    bool parseSelectList(std::vector<SelectColumn>& columns, String& error)
    {
        do
        {
            SelectColumn col;
            col.expr = parseExpr();
            if (!col.expr)
            {
                error = error_.empty() ? "Failed to parse expression" : error_;
                return false;
            }

            if (current_.kind == TokenKind::As)
            {
                advance();
                if (current_.kind != TokenKind::Identifier)
                {
                    error = "Expected identifier after AS";
                    return false;
                }
                col.alias = current_.text;
                advance();
            }
            else if (current_.kind == TokenKind::Identifier &&
                     current_.kind != TokenKind::From &&
                     current_.kind != TokenKind::Where)
            {
                col.alias = current_.text;
                advance();
            }

            columns.push_back(std::move(col));

        } while (current_.kind == TokenKind::Comma && (advance(), true));

        return true;
    }

    bool parseColumnDef(NameAndTypePair& col, String& error)
    {
        if (current_.kind != TokenKind::Identifier)
        {
            error = "Expected column name";
            return false;
        }
        String name = current_.text;
        advance();

        if (current_.kind != TokenKind::Identifier)
        {
            error = "Expected data type for column " + name;
            return false;
        }
        DataTypePtr type = makeDataType(current_.text);
        if (!type)
        {
            error = "Unknown data type: " + current_.text;
            return false;
        }
        advance();

        col = NameAndTypePair(name, type);
        return true;
    }

    bool parseValueList(std::vector<Field>& values, String& error)
    {
        if (current_.kind != TokenKind::LParen)
        {
            error = "Expected '(' before values";
            return false;
        }
        advance();

        do
        {
            ExprPtr expr = parsePrimary();
            if (!expr)
            {
                error = error_.empty() ? "Failed to parse value" : error_;
                return false;
            }
            if (expr->kind == ExprKind::Literal)
            {
                values.push_back(expr->literalValue);
            }
            else if (expr->kind == ExprKind::UnaryOp && expr->op == '-')
            {
                if (expr->right && expr->right->kind == ExprKind::Literal)
                {
                    Field v = expr->right->literalValue;
                    if (auto* i = std::get_if<int64_t>(&v))
                        values.push_back(-*i);
                    else if (auto* d = std::get_if<double>(&v))
                        values.push_back(-*d);
                    else
                    {
                        error = "Cannot negate non-numeric value";
                        return false;
                    }
                }
                else
                {
                    error = "Invalid negative value";
                    return false;
                }
            }
            else
            {
                error = "Only literal values are supported in INSERT";
                return false;
            }
        } while (current_.kind == TokenKind::Comma && (advance(), true));

        if (current_.kind != TokenKind::RParen)
        {
            error = "Expected ')' after values";
            return false;
        }
        advance();

        return true;
    }

    Token current() const { return current_; }
    void advance() { current_ = lexer_.next(); }
    String getError() const { return error_; }

private:
    Lexer& lexer_;
    Token current_;
    String error_;
};

// =============================================================================
// Expression Evaluator
// =============================================================================

class ExprEvaluator
{
public:
    ExprEvaluator(const Block* block = nullptr, size_t row = 0)
        : block_(block), row_(row) {}

    Field evaluate(const ExprPtr& expr)
    {
        if (!expr) return std::monostate{};

        switch (expr->kind)
        {
            case ExprKind::Literal:
                return expr->literalValue;

            case ExprKind::ColumnRef:
            {
                if (!block_ || !block_->has(expr->columnName))
                    return std::monostate{};
                const auto& col = block_->getByName(expr->columnName);
                if (!col.column || row_ >= col.column->size())
                    return std::monostate{};
                return (*col.column)[row_];
            }

            case ExprKind::Star:
                return std::monostate{};

            case ExprKind::UnaryOp:
            {
                Field operand = evaluate(expr->right);
                if (expr->op == '-')
                {
                    if (auto* i = std::get_if<int64_t>(&operand))
                        return -(*i);
                    if (auto* d = std::get_if<double>(&operand))
                        return -(*d);
                }
                if (expr->op == '!')
                {
                    if (auto* i = std::get_if<int64_t>(&operand))
                        return int64_t{*i == 0 ? 1 : 0};
                    if (auto* d = std::get_if<double>(&operand))
                        return int64_t{*d == 0.0 ? 1 : 0};
                }
                return operand;
            }

            case ExprKind::BinaryOp:
            {
                Field left = evaluate(expr->left);
                Field right = evaluate(expr->right);

                if (!expr->compareOp.empty())
                    return evalCompareOp(expr->compareOp, left, right);

                return evalBinaryOp(expr->op, left, right);
            }
        }

        return std::monostate{};
    }

    bool evaluateBool(const ExprPtr& expr)
    {
        Field v = evaluate(expr);
        if (auto* i = std::get_if<int64_t>(&v)) return *i != 0;
        if (auto* d = std::get_if<double>(&v)) return *d != 0.0;
        if (auto* s = std::get_if<String>(&v)) return !s->empty();
        return false;
    }

private:
    bool isNumeric(const Field& v) const
    {
        return std::holds_alternative<int8_t>(v)
            || std::holds_alternative<int16_t>(v)
            || std::holds_alternative<int32_t>(v)
            || std::holds_alternative<int64_t>(v)
            || std::holds_alternative<uint8_t>(v)
            || std::holds_alternative<uint16_t>(v)
            || std::holds_alternative<uint32_t>(v)
            || std::holds_alternative<uint64_t>(v)
            || std::holds_alternative<float>(v)
            || std::holds_alternative<double>(v);
    }

    bool isFloatType(const Field& v) const
    {
        return std::holds_alternative<float>(v) || std::holds_alternative<double>(v);
    }

    double toDouble(const Field& v) const
    {
        if (auto* i8 = std::get_if<int8_t>(&v)) return static_cast<double>(*i8);
        if (auto* i16 = std::get_if<int16_t>(&v)) return static_cast<double>(*i16);
        if (auto* i32 = std::get_if<int32_t>(&v)) return static_cast<double>(*i32);
        if (auto* i64 = std::get_if<int64_t>(&v)) return static_cast<double>(*i64);
        if (auto* u8 = std::get_if<uint8_t>(&v)) return static_cast<double>(*u8);
        if (auto* u16 = std::get_if<uint16_t>(&v)) return static_cast<double>(*u16);
        if (auto* u32 = std::get_if<uint32_t>(&v)) return static_cast<double>(*u32);
        if (auto* u64 = std::get_if<uint64_t>(&v)) return static_cast<double>(*u64);
        if (auto* f = std::get_if<float>(&v)) return static_cast<double>(*f);
        if (auto* d = std::get_if<double>(&v)) return *d;
        return 0.0;
    }

    int64_t toInt64(const Field& v) const
    {
        if (auto* i8 = std::get_if<int8_t>(&v)) return static_cast<int64_t>(*i8);
        if (auto* i16 = std::get_if<int16_t>(&v)) return static_cast<int64_t>(*i16);
        if (auto* i32 = std::get_if<int32_t>(&v)) return static_cast<int64_t>(*i32);
        if (auto* i64 = std::get_if<int64_t>(&v)) return *i64;
        if (auto* u8 = std::get_if<uint8_t>(&v)) return static_cast<int64_t>(*u8);
        if (auto* u16 = std::get_if<uint16_t>(&v)) return static_cast<int64_t>(*u16);
        if (auto* u32 = std::get_if<uint32_t>(&v)) return static_cast<int64_t>(*u32);
        if (auto* u64 = std::get_if<uint64_t>(&v)) return static_cast<int64_t>(*u64);
        if (auto* f = std::get_if<float>(&v)) return static_cast<int64_t>(*f);
        if (auto* d = std::get_if<double>(&v)) return static_cast<int64_t>(*d);
        return 0;
    }

    Field evalBinaryOp(char op, const Field& left, const Field& right)
    {
        if (std::holds_alternative<std::monostate>(left) ||
            std::holds_alternative<std::monostate>(right))
            return std::monostate{};

        // String concatenation
        if (op == '+' && (std::holds_alternative<String>(left) ||
                         std::holds_alternative<String>(right)))
        {
            return fieldToString(left) + fieldToString(right);
        }

        // Numeric operations - handle all numeric types
        if (isNumeric(left) && isNumeric(right))
        {
            // Use double for float types, int64 for integer types
            if (isFloatType(left) || isFloatType(right))
            {
                double l = toDouble(left);
                double r = toDouble(right);
                switch (op)
                {
                    case '+': return l + r;
                    case '-': return l - r;
                    case '*': return l * r;
                    case '/': if (r != 0) return l / r; else return std::monostate{};
                    case '%': if (r != 0) return std::fmod(l, r); else return std::monostate{};
                }
            }
            else
            {
                int64_t l = toInt64(left);
                int64_t r = toInt64(right);
                switch (op)
                {
                    case '+': return l + r;
                    case '-': return l - r;
                    case '*': return l * r;
                    case '/': if (r != 0) return l / r; else return std::monostate{};
                    case '%': if (r != 0) return l % r; else return std::monostate{};
                }
            }
        }

        return std::monostate{};
    }

    Field evalCompareOp(const String& op, const Field& left, const Field& right)
    {
        if (op == "AND")
            return int64_t{fieldToBool(left) && fieldToBool(right) ? 1 : 0};
        if (op == "OR")
            return int64_t{fieldToBool(left) || fieldToBool(right) ? 1 : 0};

        if (std::holds_alternative<std::monostate>(left) ||
            std::holds_alternative<std::monostate>(right))
            return std::monostate{};

        int cmp = compareFields(left, right);
        bool result = false;

        if (op == "=") result = (cmp == 0);
        else if (op == "!=") result = (cmp != 0);
        else if (op == "<") result = (cmp < 0);
        else if (op == "<=") result = (cmp <= 0);
        else if (op == ">") result = (cmp > 0);
        else if (op == ">=") result = (cmp >= 0);

        return int64_t{result ? 1 : 0};
    }

    bool fieldToBool(const Field& v)
    {
        if (auto* i = std::get_if<int64_t>(&v)) return *i != 0;
        if (auto* d = std::get_if<double>(&v)) return *d != 0.0;
        if (auto* s = std::get_if<String>(&v)) return !s->empty();
        return false;
    }

    int compareFields(const Field& left, const Field& right)
    {
        if (std::holds_alternative<String>(left) || std::holds_alternative<String>(right))
            return fieldToString(left).compare(fieldToString(right));

        double l = 0, r = 0;
        // Handle all numeric types for left
        if (auto* i = std::get_if<int64_t>(&left)) l = static_cast<double>(*i);
        else if (auto* i32 = std::get_if<int32_t>(&left)) l = static_cast<double>(*i32);
        else if (auto* i16 = std::get_if<int16_t>(&left)) l = static_cast<double>(*i16);
        else if (auto* i8 = std::get_if<int8_t>(&left)) l = static_cast<double>(*i8);
        else if (auto* u64 = std::get_if<uint64_t>(&left)) l = static_cast<double>(*u64);
        else if (auto* u32 = std::get_if<uint32_t>(&left)) l = static_cast<double>(*u32);
        else if (auto* u16 = std::get_if<uint16_t>(&left)) l = static_cast<double>(*u16);
        else if (auto* u8 = std::get_if<uint8_t>(&left)) l = static_cast<double>(*u8);
        else if (auto* d = std::get_if<double>(&left)) l = *d;
        else if (auto* f = std::get_if<float>(&left)) l = static_cast<double>(*f);

        // Handle all numeric types for right
        if (auto* i = std::get_if<int64_t>(&right)) r = static_cast<double>(*i);
        else if (auto* i32 = std::get_if<int32_t>(&right)) r = static_cast<double>(*i32);
        else if (auto* i16 = std::get_if<int16_t>(&right)) r = static_cast<double>(*i16);
        else if (auto* i8 = std::get_if<int8_t>(&right)) r = static_cast<double>(*i8);
        else if (auto* u64 = std::get_if<uint64_t>(&right)) r = static_cast<double>(*u64);
        else if (auto* u32 = std::get_if<uint32_t>(&right)) r = static_cast<double>(*u32);
        else if (auto* u16 = std::get_if<uint16_t>(&right)) r = static_cast<double>(*u16);
        else if (auto* u8 = std::get_if<uint8_t>(&right)) r = static_cast<double>(*u8);
        else if (auto* d = std::get_if<double>(&right)) r = *d;
        else if (auto* f = std::get_if<float>(&right)) r = static_cast<double>(*f);

        if (l < r) return -1;
        if (l > r) return 1;
        return 0;
    }

    String fieldToString(const Field& v)
    {
        if (std::holds_alternative<std::monostate>(v)) return "NULL";
        if (auto* i = std::get_if<int64_t>(&v)) return std::to_string(*i);
        if (auto* d = std::get_if<double>(&v))
        {
            std::ostringstream oss;
            oss << std::setprecision(15) << *d;
            return oss.str();
        }
        if (auto* s = std::get_if<String>(&v)) return *s;
        return "";
    }

    const Block* block_;
    size_t row_;
};

// =============================================================================
// Query Result
// =============================================================================

struct QueryResult
{
    ColumnsDescription columns;
    Blocks blocks;
    String message;
    bool success = true;
    String error;
};

// =============================================================================
// Query Executor
// =============================================================================

class QueryExecutor
{
public:
    QueryResult execute(const char* query, size_t len)
    {
        QueryResult result;
        Lexer lexer(query, len);
        Parser parser(lexer);

        Token first = parser.current();

        switch (first.kind)
        {
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
    QueryResult executeSelect(Parser& parser);
    QueryResult executeCreate(Parser& parser);
    QueryResult executeInsert(Parser& parser);
    QueryResult executeDrop(Parser& parser);
    QueryResult executeShow(Parser& parser);
    QueryResult executeTruncate(Parser& parser);
};

QueryResult QueryExecutor::executeSelect(Parser& parser)
{
    QueryResult result;

    parser.advance(); // Skip SELECT

    std::vector<SelectColumn> selectCols;
    String error;
    if (!parser.parseSelectList(selectCols, error))
    {
        result.success = false;
        result.error = error;
        return result;
    }

    std::shared_ptr<StorageMemory> table = nullptr;
    if (parser.current().kind == TokenKind::From)
    {
        parser.advance();
        if (parser.current().kind != TokenKind::Identifier)
        {
            result.success = false;
            result.error = "Expected table name after FROM";
            return result;
        }
        String tableName = parser.current().text;
        parser.advance();

        table = TableCatalog::instance().getTable(tableName);
        if (!table)
        {
            result.success = false;
            result.error = "Table '" + tableName + "' does not exist";
            return result;
        }
    }

    ExprPtr whereExpr = nullptr;
    if (parser.current().kind == TokenKind::Where)
    {
        parser.advance();
        whereExpr = parser.parseExpr();
        if (!whereExpr)
        {
            result.success = false;
            result.error = parser.getError().empty() ? "Failed to parse WHERE condition" : parser.getError();
            return result;
        }
    }

    // Expand SELECT *
    bool hasStar = false;
    for (const auto& col : selectCols)
    {
        if (col.expr->kind == ExprKind::Star)
        {
            hasStar = true;
            break;
        }
    }

    if (hasStar)
    {
        if (!table)
        {
            result.success = false;
            result.error = "Cannot use * without a table";
            return result;
        }
        std::vector<SelectColumn> expanded;
        for (const auto& col : selectCols)
        {
            if (col.expr->kind == ExprKind::Star)
            {
                for (const auto& tcol : table->getColumns().getAllPhysical())
                {
                    SelectColumn sc;
                    sc.expr = Expr::makeColumnRef(tcol.name);
                    sc.alias = tcol.name;
                    expanded.push_back(sc);
                }
            }
            else
            {
                expanded.push_back(col);
            }
        }
        selectCols = std::move(expanded);
    }

    // Build result columns
    for (size_t i = 0; i < selectCols.size(); i++)
    {
        String name;
        if (!selectCols[i].alias.empty())
            name = selectCols[i].alias;
        else if (selectCols[i].expr->kind == ExprKind::ColumnRef)
            name = selectCols[i].expr->columnName;
        else
            name = "column" + std::to_string(i);

        // Try to get type from table column, otherwise default to String
        DataTypePtr type = std::make_shared<DataTypeString>();
        if (table && selectCols[i].expr->kind == ExprKind::ColumnRef)
        {
            const auto& cols = table->getColumns();
            if (cols.has(selectCols[i].expr->columnName))
                type = cols.get(selectCols[i].expr->columnName).type;
        }
        result.columns.add(NameAndTypePair(name, type));
    }

    // Execute query
    if (table)
    {
        auto snapshot = table->getSnapshot();
        if (snapshot.blocks)
        {
            Block outBlock;
            for (const auto& col : result.columns.getAllPhysical())
                outBlock.insert(ColumnWithTypeAndName(col.type, col.name));

            for (const auto& srcBlock : *snapshot.blocks)
            {
                for (size_t row = 0; row < srcBlock.rows(); ++row)
                {
                    ExprEvaluator eval(&srcBlock, row);

                    if (whereExpr && !eval.evaluateBool(whereExpr))
                        continue;

                    for (size_t col = 0; col < selectCols.size(); ++col)
                    {
                        Field value = eval.evaluate(selectCols[col].expr);
                        auto& outCol = outBlock.getByPosition(col);
                        auto mutableCol = std::const_pointer_cast<IColumn>(outCol.column);
                        mutableCol->insert(value);
                    }
                }
            }

            if (outBlock.rows() > 0)
                result.blocks.push_back(std::move(outBlock));
        }
    }
    else
    {
        // Expression-only query (no FROM)
        Block outBlock;
        for (const auto& col : result.columns.getAllPhysical())
            outBlock.insert(ColumnWithTypeAndName(col.type, col.name));

        ExprEvaluator eval;
        for (size_t col = 0; col < selectCols.size(); ++col)
        {
            Field value = eval.evaluate(selectCols[col].expr);
            auto& outCol = outBlock.getByPosition(col);
            auto mutableCol = std::const_pointer_cast<IColumn>(outCol.column);
            mutableCol->insert(value);
        }
        result.blocks.push_back(std::move(outBlock));
    }

    return result;
}

QueryResult QueryExecutor::executeCreate(Parser& parser)
{
    QueryResult result;

    parser.advance(); // Skip CREATE

    if (parser.current().kind != TokenKind::Table)
    {
        result.success = false;
        result.error = "Expected TABLE after CREATE";
        return result;
    }
    parser.advance();

    if (parser.current().kind != TokenKind::Identifier)
    {
        result.success = false;
        result.error = "Expected table name";
        return result;
    }
    String tableName = parser.current().text;
    parser.advance();

    if (parser.current().kind != TokenKind::LParen)
    {
        result.success = false;
        result.error = "Expected '(' after table name";
        return result;
    }
    parser.advance();

    ColumnsDescription columns;
    String error;
    do
    {
        NameAndTypePair col;
        if (!parser.parseColumnDef(col, error))
        {
            result.success = false;
            result.error = error;
            return result;
        }
        columns.add(col);
    } while (parser.current().kind == TokenKind::Comma && (parser.advance(), true));

    if (parser.current().kind != TokenKind::RParen)
    {
        result.success = false;
        result.error = "Expected ')' after column definitions";
        return result;
    }
    parser.advance();

    // Parse ENGINE = Memory (optional)
    if (parser.current().kind == TokenKind::Engine)
    {
        parser.advance();
        if (parser.current().kind != TokenKind::Eq)
        {
            result.success = false;
            result.error = "Expected '=' after ENGINE";
            return result;
        }
        parser.advance();

        if (parser.current().kind != TokenKind::Memory &&
            parser.current().kind != TokenKind::Identifier)
        {
            result.success = false;
            result.error = "Only Memory engine is supported";
            return result;
        }
        String engine = parser.current().text;
        String upperEngine = engine;
        for (char& c : upperEngine) c = toupper(c);
        if (upperEngine != "MEMORY")
        {
            result.success = false;
            result.error = "Only Memory engine is supported, got: " + engine;
            return result;
        }
        parser.advance();
    }

    if (!TableCatalog::instance().createTable(tableName, std::move(columns), "", error))
    {
        result.success = false;
        result.error = error;
        return result;
    }

    result.message = "OK";
    return result;
}

QueryResult QueryExecutor::executeInsert(Parser& parser)
{
    QueryResult result;

    parser.advance(); // Skip INSERT

    if (parser.current().kind != TokenKind::Into)
    {
        result.success = false;
        result.error = "Expected INTO after INSERT";
        return result;
    }
    parser.advance();

    if (parser.current().kind != TokenKind::Identifier)
    {
        result.success = false;
        result.error = "Expected table name";
        return result;
    }
    String tableName = parser.current().text;
    parser.advance();

    auto table = TableCatalog::instance().getTable(tableName);
    if (!table)
    {
        result.success = false;
        result.error = "Table '" + tableName + "' does not exist";
        return result;
    }

    if (parser.current().kind != TokenKind::Values)
    {
        result.success = false;
        result.error = "Expected VALUES";
        return result;
    }
    parser.advance();

    // Create a block for insertion
    Block insertBlock;
    const auto& cols = table->getColumns().getAllPhysical();
    for (const auto& col : cols)
        insertBlock.insert(ColumnWithTypeAndName(col.type, col.name));

    int rowCount = 0;
    String error;
    do
    {
        std::vector<Field> values;
        if (!parser.parseValueList(values, error))
        {
            result.success = false;
            result.error = error;
            return result;
        }

        if (values.size() != cols.size())
        {
            result.success = false;
            result.error = "Column count mismatch: expected " +
                          std::to_string(cols.size()) + ", got " +
                          std::to_string(values.size());
            return result;
        }

        for (size_t i = 0; i < values.size(); ++i)
        {
            auto& col = insertBlock.getByPosition(i);
            auto mutableCol = std::const_pointer_cast<IColumn>(col.column);
            mutableCol->insert(values[i]);
        }
        rowCount++;
    } while (parser.current().kind == TokenKind::Comma && (parser.advance(), true));

    // Write block to storage using REAL ClickHouse pattern
    table->write(insertBlock);

    result.message = "OK: " + std::to_string(rowCount) + " row(s) inserted";
    return result;
}

QueryResult QueryExecutor::executeDrop(Parser& parser)
{
    QueryResult result;

    parser.advance(); // Skip DROP

    if (parser.current().kind != TokenKind::Table)
    {
        result.success = false;
        result.error = "Expected TABLE after DROP";
        return result;
    }
    parser.advance();

    if (parser.current().kind != TokenKind::Identifier)
    {
        result.success = false;
        result.error = "Expected table name";
        return result;
    }
    String tableName = parser.current().text;
    parser.advance();

    String error;
    if (!TableCatalog::instance().dropTable(tableName, error))
    {
        result.success = false;
        result.error = error;
        return result;
    }

    result.message = "OK";
    return result;
}

QueryResult QueryExecutor::executeShow(Parser& parser)
{
    QueryResult result;

    parser.advance(); // Skip SHOW

    if (parser.current().kind != TokenKind::Tables)
    {
        result.success = false;
        result.error = "Only SHOW TABLES is supported";
        return result;
    }
    parser.advance();

    result.columns.add(NameAndTypePair("name", std::make_shared<DataTypeString>()));

    Block block;
    block.insert(ColumnWithTypeAndName(std::make_shared<DataTypeString>(), "name"));

    for (const auto& name : TableCatalog::instance().listTables())
    {
        auto& col = block.getByPosition(0);
        auto mutableCol = std::const_pointer_cast<IColumn>(col.column);
        mutableCol->insert(name);
    }

    if (block.rows() > 0)
        result.blocks.push_back(std::move(block));

    return result;
}

QueryResult QueryExecutor::executeTruncate(Parser& parser)
{
    QueryResult result;

    parser.advance(); // Skip TRUNCATE

    if (parser.current().kind == TokenKind::Table)
        parser.advance();

    if (parser.current().kind != TokenKind::Identifier)
    {
        result.success = false;
        result.error = "Expected table name";
        return result;
    }
    String tableName = parser.current().text;
    parser.advance();

    auto table = TableCatalog::instance().getTable(tableName);
    if (!table)
    {
        result.success = false;
        result.error = "Table '" + tableName + "' does not exist";
        return result;
    }

    table->truncate();
    result.message = "OK";
    return result;
}

// =============================================================================
// Result Formatting
// =============================================================================

String fieldToOutputString(const Field& v)
{
    if (std::holds_alternative<std::monostate>(v)) return "NULL";
    if (auto* i8 = std::get_if<int8_t>(&v)) return std::to_string(*i8);
    if (auto* i16 = std::get_if<int16_t>(&v)) return std::to_string(*i16);
    if (auto* i32 = std::get_if<int32_t>(&v)) return std::to_string(*i32);
    if (auto* i64 = std::get_if<int64_t>(&v)) return std::to_string(*i64);
    if (auto* u8 = std::get_if<uint8_t>(&v)) return std::to_string(*u8);
    if (auto* u16 = std::get_if<uint16_t>(&v)) return std::to_string(*u16);
    if (auto* u32 = std::get_if<uint32_t>(&v)) return std::to_string(*u32);
    if (auto* u64 = std::get_if<uint64_t>(&v)) return std::to_string(*u64);
    if (auto* f32 = std::get_if<float>(&v))
    {
        std::ostringstream oss;
        oss << std::setprecision(7) << *f32;
        return oss.str();
    }
    if (auto* f64 = std::get_if<double>(&v))
    {
        std::ostringstream oss;
        oss << std::setprecision(15) << *f64;
        return oss.str();
    }
    if (auto* s = std::get_if<String>(&v)) return *s;
    return "";
}

String formatResultCSV(const QueryResult& result)
{
    if (!result.success)
        return "Error: " + result.error + "\n";

    if (!result.message.empty() && result.columns.getAllPhysical().empty())
        return result.message + "\n";

    String output;

    // Header
    const auto& cols = result.columns.getAllPhysical();
    for (size_t i = 0; i < cols.size(); i++)
    {
        if (i > 0) output += ",";
        output += "\"" + cols[i].name + "\"";
    }
    output += "\n";

    // Data
    for (const auto& block : result.blocks)
    {
        for (size_t row = 0; row < block.rows(); ++row)
        {
            for (size_t col = 0; col < block.columns(); ++col)
            {
                if (col > 0) output += ",";
                const auto& c = block.getByPosition(col);
                Field v = (*c.column)[row];
                if (auto* s = std::get_if<String>(&v))
                {
                    output += "\"";
                    for (char ch : *s)
                    {
                        if (ch == '"') output += "\"\"";
                        else output += ch;
                    }
                    output += "\"";
                }
                else
                {
                    output += fieldToOutputString(v);
                }
            }
            output += "\n";
        }
    }

    return output;
}

String formatResultTSV(const QueryResult& result)
{
    if (!result.success)
        return "Error: " + result.error + "\n";

    if (!result.message.empty() && result.columns.getAllPhysical().empty())
        return result.message + "\n";

    String output;

    // Header
    const auto& cols = result.columns.getAllPhysical();
    for (size_t i = 0; i < cols.size(); i++)
    {
        if (i > 0) output += "\t";
        output += cols[i].name;
    }
    output += "\n";

    // Data
    for (const auto& block : result.blocks)
    {
        for (size_t row = 0; row < block.rows(); ++row)
        {
            for (size_t col = 0; col < block.columns(); ++col)
            {
                if (col > 0) output += "\t";
                const auto& c = block.getByPosition(col);
                output += fieldToOutputString((*c.column)[row]);
            }
            output += "\n";
        }
    }

    return output;
}

String formatResultJSON(const QueryResult& result)
{
    if (!result.success)
        return "{\"error\": \"" + result.error + "\"}\n";

    if (!result.message.empty() && result.columns.getAllPhysical().empty())
        return "{\"message\": \"" + result.message + "\"}\n";

    String output = "{\n";
    output += "  \"meta\": [\n";

    const auto& cols = result.columns.getAllPhysical();
    for (size_t i = 0; i < cols.size(); i++)
    {
        output += "    {\"name\": \"" + cols[i].name + "\", \"type\": \"";
        output += cols[i].type->getName();
        output += "\"}";
        if (i < cols.size() - 1) output += ",";
        output += "\n";
    }

    output += "  ],\n";
    output += "  \"data\": [\n";

    size_t totalRows = 0;
    for (const auto& block : result.blocks)
    {
        for (size_t row = 0; row < block.rows(); ++row)
        {
            if (totalRows > 0) output += ",\n";
            output += "    {";
            for (size_t col = 0; col < block.columns(); ++col)
            {
                if (col > 0) output += ", ";
                output += "\"" + cols[col].name + "\": ";
                const auto& c = block.getByPosition(col);
                Field v = (*c.column)[row];
                if (std::holds_alternative<std::monostate>(v))
                    output += "null";
                else if (auto* s = std::get_if<String>(&v))
                {
                    output += "\"";
                    for (char ch : *s)
                    {
                        switch (ch)
                        {
                            case '"': output += "\\\""; break;
                            case '\\': output += "\\\\"; break;
                            case '\n': output += "\\n"; break;
                            case '\r': output += "\\r"; break;
                            case '\t': output += "\\t"; break;
                            default: output += ch; break;
                        }
                    }
                    output += "\"";
                }
                else
                {
                    output += fieldToOutputString(v);
                }
            }
            output += "}";
            totalRows++;
        }
    }

    output += "\n  ],\n";
    output += "  \"rows\": " + std::to_string(totalRows) + ",\n";
    output += "  \"statistics\": {\"elapsed\": 0.001, \"rows_read\": " +
              std::to_string(totalRows) + ", \"bytes_read\": 0}\n";
    output += "}\n";

    return output;
}

} // namespace DB

// =============================================================================
// Engine Context
// =============================================================================

struct EngineContext
{
    char* lastResult = nullptr;
    size_t lastResultLen = 0;
    char* lastError = nullptr;

    ~EngineContext()
    {
        if (lastResult) free(lastResult);
        if (lastError) free(lastError);
    }

    void setResult(const DB::String& result)
    {
        if (lastResult) free(lastResult);
        if (lastError) { free(lastError); lastError = nullptr; }
        lastResultLen = result.size();
        lastResult = static_cast<char*>(malloc(lastResultLen + 1));
        memcpy(lastResult, result.c_str(), lastResultLen + 1);
    }

    void setError(const DB::String& error)
    {
        if (lastError) free(lastError);
        lastError = strdup(error.c_str());
        lastResultLen = 0;
        if (lastResult) { free(lastResult); lastResult = nullptr; }
    }
};

// =============================================================================
// C API (WASM exports)
// =============================================================================

extern "C" {

EXPORT void* storage_memory_create()
{
    return new EngineContext();
}

EXPORT void storage_memory_destroy(void* ctx)
{
    if (ctx)
        delete static_cast<EngineContext*>(ctx);
}

EXPORT int storage_memory_query(void* ctx, const char* query, size_t query_len, const char* format)
{
    if (!ctx || !query) return -1;

    EngineContext* engine = static_cast<EngineContext*>(ctx);
    DB::QueryExecutor executor;

    DB::QueryResult result = executor.execute(query, query_len);

    if (!result.success)
    {
        engine->setError(result.error);
        return -1;
    }

    DB::String fmt = format ? format : "CSV";
    for (char& c : fmt) c = toupper(c);

    DB::String output;
    if (fmt == "JSON" || fmt == "JSONEACHROW")
        output = DB::formatResultJSON(result);
    else if (fmt == "TSV" || fmt == "TABSEPARATED")
        output = DB::formatResultTSV(result);
    else
        output = DB::formatResultCSV(result);

    engine->setResult(output);
    return 0;
}

EXPORT const char* storage_memory_get_result(void* ctx)
{
    if (!ctx) return nullptr;
    return static_cast<EngineContext*>(ctx)->lastResult;
}

EXPORT size_t storage_memory_get_result_len(void* ctx)
{
    if (!ctx) return 0;
    return static_cast<EngineContext*>(ctx)->lastResultLen;
}

EXPORT const char* storage_memory_get_error(void* ctx)
{
    if (!ctx) return nullptr;
    return static_cast<EngineContext*>(ctx)->lastError;
}

EXPORT void storage_memory_reset()
{
    DB::TableCatalog::instance().clear();
}

EXPORT int storage_memory_test()
{
    DB::TableCatalog::instance().clear();

    EngineContext ctx;
    DB::String sql;
    int rc;

    // Test 1: Simple expression
    sql = "SELECT 1 + 2 AS result";
    rc = storage_memory_query(&ctx, sql.c_str(), sql.size(), "CSV");
    if (rc != 0) return -1;
    if (!ctx.lastResult || strstr(ctx.lastResult, "3") == nullptr) return -2;

    // Test 2: CREATE TABLE
    sql = "CREATE TABLE users (id Int32, name String, age Int32) ENGINE = Memory";
    rc = storage_memory_query(&ctx, sql.c_str(), sql.size(), "CSV");
    if (rc != 0) return -3;
    if (!ctx.lastResult || strstr(ctx.lastResult, "OK") == nullptr) return -4;

    // Test 3: INSERT INTO
    sql = "INSERT INTO users VALUES (1, 'Alice', 30), (2, 'Bob', 25), (3, 'Charlie', 35)";
    rc = storage_memory_query(&ctx, sql.c_str(), sql.size(), "CSV");
    if (rc != 0) return -5;
    if (!ctx.lastResult || strstr(ctx.lastResult, "3 row") == nullptr) return -6;

    // Test 4: SELECT *
    sql = "SELECT * FROM users";
    rc = storage_memory_query(&ctx, sql.c_str(), sql.size(), "CSV");
    if (rc != 0) return -7;
    if (!ctx.lastResult) return -8;
    if (strstr(ctx.lastResult, "Alice") == nullptr) return -9;
    if (strstr(ctx.lastResult, "Bob") == nullptr) return -10;
    if (strstr(ctx.lastResult, "Charlie") == nullptr) return -11;

    // Test 5: SELECT with WHERE
    sql = "SELECT name, age FROM users WHERE age > 28";
    rc = storage_memory_query(&ctx, sql.c_str(), sql.size(), "CSV");
    if (rc != 0) return -12;
    if (!ctx.lastResult) return -13;
    if (strstr(ctx.lastResult, "Alice") == nullptr) return -14;
    if (strstr(ctx.lastResult, "Charlie") == nullptr) return -15;
    if (strstr(ctx.lastResult, "Bob") != nullptr) return -16;

    // Test 6: SELECT with expression
    sql = "SELECT name, age * 2 AS double_age FROM users WHERE id = 1";
    rc = storage_memory_query(&ctx, sql.c_str(), sql.size(), "CSV");
    if (rc != 0) return -17;
    if (!ctx.lastResult) return -18;
    if (strstr(ctx.lastResult, "60") == nullptr) return -19;

    // Test 7: SHOW TABLES
    sql = "SHOW TABLES";
    rc = storage_memory_query(&ctx, sql.c_str(), sql.size(), "CSV");
    if (rc != 0) return -20;
    if (!ctx.lastResult || strstr(ctx.lastResult, "users") == nullptr) return -21;

    // Test 8: DROP TABLE
    sql = "DROP TABLE users";
    rc = storage_memory_query(&ctx, sql.c_str(), sql.size(), "CSV");
    if (rc != 0) return -22;

    sql = "SHOW TABLES";
    rc = storage_memory_query(&ctx, sql.c_str(), sql.size(), "CSV");
    if (rc != 0) return -23;
    if (ctx.lastResult && strstr(ctx.lastResult, "users") != nullptr) return -24;

    DB::TableCatalog::instance().clear();

    return 0; // All tests passed
}

EXPORT const char* storage_memory_version()
{
    return "chdb-storage-memory-real 0.1.0 (REAL ClickHouse StorageMemory patterns compiled to WASM)";
}

} // extern "C"

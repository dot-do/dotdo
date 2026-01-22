/**
 * executor_bindings.cpp - SQL Expression Executor for WASM with Aggregates
 *
 * This provides a SQL query executor that can evaluate expressions and aggregates
 * without requiring the full ClickHouse interpreter infrastructure.
 *
 * Supported query patterns:
 *   - SELECT <literal> [AS <alias>]
 *   - SELECT <expr> [AS <alias>]
 *   - Multiple columns: SELECT 1, 2, 3
 *   - Aggregates: SELECT COUNT(*), SUM(x), AVG(x), MIN(x), MAX(x)
 *   - UNION ALL: SELECT 1 UNION ALL SELECT 2
 *   - Subqueries: SELECT * FROM (SELECT 1, 2)
 *   - Table functions: SELECT * FROM numbers(100)
 *   - GROUP BY: SELECT x, COUNT(*) FROM ... GROUP BY x
 *
 * Supported expressions:
 *   - Integer literals: 42, -17
 *   - Float literals: 3.14, -2.5
 *   - String literals: 'hello', "world"
 *   - Basic arithmetic: +, -, *, /, %
 *   - Parentheses: (1 + 2) * 3
 *   - Column references: x, y, column_name
 *
 * Aggregate functions:
 *   - COUNT(*) - count all rows
 *   - COUNT(column) - count non-null values
 *   - SUM(column) - sum numeric values
 *   - AVG(column) - average of numeric values
 *   - MIN(column) - minimum value
 *   - MAX(column) - maximum value
 *
 * Build with: emcc -fno-exceptions -std=c++17 -Os -DEXECUTOR_STANDALONE_BUILD
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
#include <algorithm>
#include <unordered_map>
#include <unordered_set>
#include <set>
#include <cctype>
#include <limits>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define EXPORT
#endif

// ============================================================================
// Value Types
// ============================================================================

using Value = std::variant<std::monostate, int64_t, double, std::string>;

enum class ValueType {
    Null,
    Int64,
    Float64,
    String
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

double valueToDouble(const Value& v) {
    if (std::holds_alternative<int64_t>(v)) {
        return static_cast<double>(std::get<int64_t>(v));
    }
    if (std::holds_alternative<double>(v)) {
        return std::get<double>(v);
    }
    return std::numeric_limits<double>::quiet_NaN();
}

bool valueIsNumeric(const Value& v) {
    return std::holds_alternative<int64_t>(v) || std::holds_alternative<double>(v);
}

bool valueIsNull(const Value& v) {
    return std::holds_alternative<std::monostate>(v);
}

// ============================================================================
// Token Types
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
    As,
    Select,
    From,
    Union,
    All,
    Where,
    Group,
    By,
    Having,
    Limit,
    Distinct,
    Greater,
    Less,
    GreaterEqual,
    LessEqual,
    Equal,
    NotEqual,
    And,
    Or,
    Not,
    Error
};

struct Token {
    TokenKind kind;
    std::string text;
    size_t pos;
};

// ============================================================================
// Lexer
// ============================================================================

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

        switch (c) {
            case '+': pos_++; return {TokenKind::Plus, "+", startPos};
            case '-': pos_++; return {TokenKind::Minus, "-", startPos};
            case '*': pos_++; return {TokenKind::Star, "*", startPos};
            case '/': pos_++; return {TokenKind::Slash, "/", startPos};
            case '%': pos_++; return {TokenKind::Percent, "%", startPos};
            case '(': pos_++; return {TokenKind::LParen, "(", startPos};
            case ')': pos_++; return {TokenKind::RParen, ")", startPos};
            case ',': pos_++; return {TokenKind::Comma, ",", startPos};
            case '>':
                pos_++;
                if (pos_ < len_ && input_[pos_] == '=') {
                    pos_++;
                    return {TokenKind::GreaterEqual, ">=", startPos};
                }
                return {TokenKind::Greater, ">", startPos};
            case '<':
                pos_++;
                if (pos_ < len_ && input_[pos_] == '=') {
                    pos_++;
                    return {TokenKind::LessEqual, "<=", startPos};
                }
                if (pos_ < len_ && input_[pos_] == '>') {
                    pos_++;
                    return {TokenKind::NotEqual, "<>", startPos};
                }
                return {TokenKind::Less, "<", startPos};
            case '=':
                pos_++;
                if (pos_ < len_ && input_[pos_] == '=') {
                    pos_++;
                }
                return {TokenKind::Equal, "=", startPos};
            case '!':
                pos_++;
                if (pos_ < len_ && input_[pos_] == '=') {
                    pos_++;
                    return {TokenKind::NotEqual, "!=", startPos};
                }
                return {TokenKind::Error, "!", startPos};
        }

        if (c == '\'' || c == '"') {
            return scanString(c);
        }

        if (isdigit(c) || c == '.') {
            return scanNumber();
        }

        if (isalpha(c) || c == '_') {
            return scanIdentifier();
        }

        pos_++;
        return {TokenKind::Error, std::string(1, c), startPos};
    }

    size_t getPos() const { return pos_; }
    void setPos(size_t pos) { pos_ = pos; }

    Token peek() {
        size_t savedPos = pos_;
        Token t = next();
        pos_ = savedPos;
        return t;
    }

private:
    void skipWhitespace() {
        while (pos_ < len_ && isspace(input_[pos_])) {
            pos_++;
        }
    }

    Token scanString(char quote) {
        size_t startPos = pos_;
        pos_++;
        std::string value;

        while (pos_ < len_) {
            char c = input_[pos_];
            if (c == quote) {
                if (pos_ + 1 < len_ && input_[pos_ + 1] == quote) {
                    value += quote;
                    pos_ += 2;
                } else {
                    pos_++;
                    return {TokenKind::String, value, startPos};
                }
            } else if (c == '\\' && pos_ + 1 < len_) {
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

        std::string upper = ident;
        for (char& c : upper) c = toupper(c);

        if (upper == "SELECT") return {TokenKind::Select, ident, startPos};
        if (upper == "AS") return {TokenKind::As, ident, startPos};
        if (upper == "FROM") return {TokenKind::From, ident, startPos};
        if (upper == "UNION") return {TokenKind::Union, ident, startPos};
        if (upper == "ALL") return {TokenKind::All, ident, startPos};
        if (upper == "WHERE") return {TokenKind::Where, ident, startPos};
        if (upper == "GROUP") return {TokenKind::Group, ident, startPos};
        if (upper == "BY") return {TokenKind::By, ident, startPos};
        if (upper == "HAVING") return {TokenKind::Having, ident, startPos};
        if (upper == "LIMIT") return {TokenKind::Limit, ident, startPos};
        if (upper == "DISTINCT") return {TokenKind::Distinct, ident, startPos};
        if (upper == "AND") return {TokenKind::And, ident, startPos};
        if (upper == "OR") return {TokenKind::Or, ident, startPos};
        if (upper == "NOT") return {TokenKind::Not, ident, startPos};
        if (upper == "NULL") return {TokenKind::Identifier, "NULL", startPos};

        return {TokenKind::Identifier, ident, startPos};
    }

    const char* input_;
    size_t len_;
    size_t pos_;
};

// ============================================================================
// AST Types
// ============================================================================

struct Expr;
using ExprPtr = std::shared_ptr<Expr>;

enum class ExprKind {
    Literal,
    BinaryOp,
    UnaryOp,
    ColumnRef,
    FunctionCall,
    Subquery
};

enum class AggregateType {
    None,
    Count,
    CountStar,
    CountDistinct,
    Uniq,
    UniqExact,
    Sum,
    Avg,
    Min,
    Max
};

struct SelectStmt;
using SelectStmtPtr = std::shared_ptr<SelectStmt>;

struct Expr {
    ExprKind kind;
    Value literalValue;
    char op;
    ExprPtr left;
    ExprPtr right;
    std::string name;
    std::vector<ExprPtr> args;
    AggregateType aggType;
    SelectStmtPtr subquery;

    Expr() : kind(ExprKind::Literal), op(0), aggType(AggregateType::None) {}

    static ExprPtr makeLiteral(Value v) {
        auto e = std::make_shared<Expr>();
        e->kind = ExprKind::Literal;
        e->literalValue = std::move(v);
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

    static ExprPtr makeUnaryOp(char op, ExprPtr operand) {
        auto e = std::make_shared<Expr>();
        e->kind = ExprKind::UnaryOp;
        e->op = op;
        e->right = std::move(operand);
        return e;
    }

    static ExprPtr makeColumnRef(const std::string& name) {
        auto e = std::make_shared<Expr>();
        e->kind = ExprKind::ColumnRef;
        e->name = name;
        return e;
    }

    static ExprPtr makeFunctionCall(const std::string& name, std::vector<ExprPtr> args, AggregateType aggType = AggregateType::None) {
        auto e = std::make_shared<Expr>();
        e->kind = ExprKind::FunctionCall;
        e->name = name;
        e->args = std::move(args);
        e->aggType = aggType;
        return e;
    }

    static ExprPtr makeSubquery(SelectStmtPtr stmt) {
        auto e = std::make_shared<Expr>();
        e->kind = ExprKind::Subquery;
        e->subquery = std::move(stmt);
        return e;
    }
};

struct SelectColumn {
    ExprPtr expr;
    std::string alias;
};

struct SelectStmt {
    std::vector<SelectColumn> columns;
    ExprPtr fromClause;
    ExprPtr whereClause;   // WHERE clause expression
    std::vector<SelectStmtPtr> unionStmts;
    std::vector<ExprPtr> groupByExprs;
    ExprPtr havingClause;  // HAVING clause expression
    int64_t limit;

    SelectStmt() : limit(-1) {}
};

using Row = std::vector<Value>;

struct Table {
    std::vector<std::string> columnNames;
    std::vector<Row> rows;

    size_t findColumn(const std::string& name) const {
        std::string upperName = name;
        for (char& c : upperName) c = toupper(c);

        for (size_t i = 0; i < columnNames.size(); i++) {
            std::string upperCol = columnNames[i];
            for (char& c : upperCol) c = toupper(c);
            if (upperCol == upperName) return i;
        }
        return SIZE_MAX;
    }
};

// ============================================================================
// Parser
// ============================================================================

class Parser {
public:
    Parser(Lexer& lexer) : lexer_(lexer), hasError_(false) {
        advance();
    }

    SelectStmtPtr parseSelect() {
        if (current_.kind != TokenKind::Select) {
            setError("Expected SELECT");
            return nullptr;
        }
        advance();

        auto stmt = std::make_shared<SelectStmt>();

        do {
            SelectColumn col;
            col.expr = parseExpr();
            if (!col.expr) return nullptr;

            if (current_.kind == TokenKind::As) {
                advance();
                if (current_.kind != TokenKind::Identifier) {
                    setError("Expected identifier after AS");
                    return nullptr;
                }
                col.alias = current_.text;
                advance();
            } else if (current_.kind == TokenKind::Identifier) {
                std::string upper = current_.text;
                for (char& c : upper) c = toupper(c);
                if (upper != "FROM" && upper != "UNION" && upper != "WHERE" && upper != "GROUP" && upper != "LIMIT") {
                    col.alias = current_.text;
                    advance();
                }
            }

            stmt->columns.push_back(std::move(col));
        } while (current_.kind == TokenKind::Comma && (advance(), true));

        if (current_.kind == TokenKind::From) {
            advance();
            if (current_.kind == TokenKind::LParen) {
                advance();
                auto subStmt = parseSelect();
                if (!subStmt) return nullptr;
                stmt->fromClause = Expr::makeSubquery(subStmt);
                if (current_.kind != TokenKind::RParen) {
                    setError("Expected ) after subquery");
                    return nullptr;
                }
                advance();
            } else if (current_.kind == TokenKind::Identifier) {
                std::string tableName = current_.text;
                advance();

                if (current_.kind == TokenKind::LParen) {
                    advance();
                    std::vector<ExprPtr> args;
                    if (current_.kind != TokenKind::RParen) {
                        do {
                            ExprPtr arg = parseExpr();
                            if (!arg) return nullptr;
                            args.push_back(arg);
                        } while (current_.kind == TokenKind::Comma && (advance(), true));
                    }
                    if (current_.kind != TokenKind::RParen) {
                        setError("Expected ) after function arguments");
                        return nullptr;
                    }
                    advance();
                    stmt->fromClause = Expr::makeFunctionCall(tableName, std::move(args));
                } else {
                    stmt->fromClause = Expr::makeColumnRef(tableName);
                }
            }
        }

        // Parse WHERE clause (after FROM, before GROUP BY)
        if (current_.kind == TokenKind::Where) {
            advance();
            stmt->whereClause = parseExpr();
            if (!stmt->whereClause) return nullptr;
        }

        if (current_.kind == TokenKind::Group) {
            advance();
            if (current_.kind != TokenKind::By) {
                setError("Expected BY after GROUP");
                return nullptr;
            }
            advance();

            do {
                ExprPtr groupExpr = parseExpr();
                if (!groupExpr) return nullptr;
                stmt->groupByExprs.push_back(groupExpr);
            } while (current_.kind == TokenKind::Comma && (advance(), true));
        }

        // Parse HAVING clause (after GROUP BY)
        if (current_.kind == TokenKind::Having) {
            advance();
            stmt->havingClause = parseComparison();
            if (!stmt->havingClause) return nullptr;
        }

        if (current_.kind == TokenKind::Limit) {
            advance();
            if (current_.kind != TokenKind::Number) {
                setError("Expected number after LIMIT");
                return nullptr;
            }
            stmt->limit = std::stoll(current_.text);
            advance();
        }

        while (current_.kind == TokenKind::Union) {
            advance();
            if (current_.kind == TokenKind::All) {
                advance();
            }
            auto unionStmt = parseSelect();
            if (!unionStmt) return nullptr;
            stmt->unionStmts.push_back(unionStmt);
        }

        return stmt;
    }

    bool hasError() const { return hasError_; }
    std::string getError() const { return error_; }

private:
    void advance() {
        current_ = lexer_.next();
    }

    void setError(const std::string& msg) {
        if (!hasError_) {
            hasError_ = true;
            error_ = msg;
        }
    }

    ExprPtr parseExpr() {
        return parseOr();
    }

    // OR has lowest precedence
    ExprPtr parseOr() {
        ExprPtr left = parseAnd();
        if (!left) return nullptr;

        while (current_.kind == TokenKind::Or) {
            advance();
            ExprPtr right = parseAnd();
            if (!right) return nullptr;
            left = Expr::makeBinaryOp('|', left, right);  // '|' for OR
        }
        return left;
    }

    // AND has higher precedence than OR
    ExprPtr parseAnd() {
        ExprPtr left = parseNot();
        if (!left) return nullptr;

        while (current_.kind == TokenKind::And) {
            advance();
            ExprPtr right = parseNot();
            if (!right) return nullptr;
            left = Expr::makeBinaryOp('&', left, right);  // '&' for AND
        }
        return left;
    }

    // NOT is a unary operator
    ExprPtr parseNot() {
        if (current_.kind == TokenKind::Not) {
            advance();
            ExprPtr operand = parseNot();
            if (!operand) return nullptr;
            return Expr::makeUnaryOp('!', operand);  // '!' for NOT
        }
        return parseComparison();
    }

    // Comparison operators: =, !=, <>, <, >, <=, >=
    ExprPtr parseComparison() {
        ExprPtr left = parseAddSub();
        if (!left) return nullptr;

        while (current_.kind == TokenKind::Equal ||
               current_.kind == TokenKind::NotEqual ||
               current_.kind == TokenKind::Less ||
               current_.kind == TokenKind::Greater ||
               current_.kind == TokenKind::LessEqual ||
               current_.kind == TokenKind::GreaterEqual) {
            char op;
            switch (current_.kind) {
                case TokenKind::Equal: op = '='; break;
                case TokenKind::NotEqual: op = 'N'; break;  // 'N' for != or <>
                case TokenKind::Less: op = '<'; break;
                case TokenKind::Greater: op = '>'; break;
                case TokenKind::LessEqual: op = 'L'; break;  // 'L' for <=
                case TokenKind::GreaterEqual: op = 'G'; break;  // 'G' for >=
                default: op = '?'; break;
            }
            advance();
            ExprPtr right = parseAddSub();
            if (!right) return nullptr;
            left = Expr::makeBinaryOp(op, left, right);
        }
        return left;
    }

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
        return parsePrimary();
    }

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

        if (current_.kind == TokenKind::Identifier) {
            std::string name = current_.text;
            std::string upper = name;
            for (char& c : upper) c = toupper(c);

            advance();

            if (upper == "NULL") {
                return Expr::makeLiteral(std::monostate{});
            }

            if (current_.kind == TokenKind::LParen) {
                advance();

                AggregateType aggType = AggregateType::None;
                if (upper == "COUNT") aggType = AggregateType::Count;
                else if (upper == "SUM") aggType = AggregateType::Sum;
                else if (upper == "AVG") aggType = AggregateType::Avg;
                else if (upper == "MIN") aggType = AggregateType::Min;
                else if (upper == "MAX") aggType = AggregateType::Max;
                else if (upper == "UNIQ") aggType = AggregateType::Uniq;
                else if (upper == "UNIQEXACT") aggType = AggregateType::UniqExact;

                if (aggType == AggregateType::Count && current_.kind == TokenKind::Star) {
                    advance();
                    if (current_.kind != TokenKind::RParen) {
                        setError("Expected ) after COUNT(*)");
                        return nullptr;
                    }
                    advance();
                    return Expr::makeFunctionCall("COUNT", {}, AggregateType::CountStar);
                }

                // Handle COUNT(DISTINCT expr) syntax
                if (aggType == AggregateType::Count && current_.kind == TokenKind::Distinct) {
                    advance(); // consume DISTINCT
                    std::vector<ExprPtr> args;
                    if (current_.kind != TokenKind::RParen) {
                        do {
                            ExprPtr arg = parseExpr();
                            if (!arg) return nullptr;
                            args.push_back(arg);
                        } while (current_.kind == TokenKind::Comma && (advance(), true));
                    }
                    if (current_.kind != TokenKind::RParen) {
                        setError("Expected ) after COUNT(DISTINCT ...)");
                        return nullptr;
                    }
                    advance();
                    return Expr::makeFunctionCall("COUNT", std::move(args), AggregateType::CountDistinct);
                }

                std::vector<ExprPtr> args;
                if (current_.kind != TokenKind::RParen) {
                    do {
                        ExprPtr arg = parseExpr();
                        if (!arg) return nullptr;
                        args.push_back(arg);
                    } while (current_.kind == TokenKind::Comma && (advance(), true));
                }

                if (current_.kind != TokenKind::RParen) {
                    setError("Expected ) after function arguments");
                    return nullptr;
                }
                advance();

                return Expr::makeFunctionCall(name, std::move(args), aggType);
            }

            return Expr::makeColumnRef(name);
        }

        if (current_.kind == TokenKind::LParen) {
            advance();

            if (current_.kind == TokenKind::Select) {
                auto subStmt = parseSelect();
                if (!subStmt) return nullptr;
                if (current_.kind != TokenKind::RParen) {
                    setError("Expected ) after subquery");
                    return nullptr;
                }
                advance();
                return Expr::makeSubquery(subStmt);
            }

            ExprPtr expr = parseExpr();
            if (!expr) return nullptr;
            if (current_.kind != TokenKind::RParen) {
                setError("Expected )");
                return nullptr;
            }
            advance();
            return expr;
        }

        setError("Unexpected token: " + current_.text);
        return nullptr;
    }

    Lexer& lexer_;
    Token current_;
    bool hasError_;
    std::string error_;
};

// ============================================================================
// Aggregate State
// ============================================================================

// Hash function for Value type to use in unordered_set
struct ValueHash {
    size_t operator()(const Value& v) const {
        if (std::holds_alternative<std::monostate>(v)) {
            return 0;
        }
        if (std::holds_alternative<int64_t>(v)) {
            return std::hash<int64_t>{}(std::get<int64_t>(v));
        }
        if (std::holds_alternative<double>(v)) {
            return std::hash<double>{}(std::get<double>(v));
        }
        return std::hash<std::string>{}(std::get<std::string>(v));
    }
};

// Equality function for Value type
struct ValueEqual {
    bool operator()(const Value& a, const Value& b) const {
        return a == b;
    }
};

struct AggregateState {
    AggregateType type;
    int64_t count;
    double sum;
    Value minVal;
    Value maxVal;
    bool hasValue;
    std::unordered_set<Value, ValueHash, ValueEqual> distinctValues;

    AggregateState() : type(AggregateType::None), count(0), sum(0.0), hasValue(false) {}

    void init(AggregateType t) {
        type = t;
        count = 0;
        sum = 0.0;
        minVal = std::monostate{};
        maxVal = std::monostate{};
        hasValue = false;
        distinctValues.clear();
    }

    void accumulate(const Value& v) {
        if (valueIsNull(v) && type != AggregateType::CountStar) {
            return;
        }

        switch (type) {
            case AggregateType::CountStar:
                count++;
                break;

            case AggregateType::Count:
                if (!valueIsNull(v)) {
                    count++;
                }
                break;

            case AggregateType::CountDistinct:
            case AggregateType::Uniq:
            case AggregateType::UniqExact:
                if (!valueIsNull(v)) {
                    distinctValues.insert(v);
                }
                break;

            case AggregateType::Sum:
            case AggregateType::Avg:
                if (valueIsNumeric(v)) {
                    sum += valueToDouble(v);
                    count++;
                }
                break;

            case AggregateType::Min:
                if (!hasValue || compareValues(v, minVal) < 0) {
                    minVal = v;
                    hasValue = true;
                }
                break;

            case AggregateType::Max:
                if (!hasValue || compareValues(v, maxVal) > 0) {
                    maxVal = v;
                    hasValue = true;
                }
                break;

            default:
                break;
        }
    }

    Value finalize() const {
        switch (type) {
            case AggregateType::CountStar:
            case AggregateType::Count:
                return count;

            case AggregateType::CountDistinct:
            case AggregateType::Uniq:
            case AggregateType::UniqExact:
                return static_cast<int64_t>(distinctValues.size());

            case AggregateType::Sum:
                if (count == 0) return std::monostate{};
                return sum;

            case AggregateType::Avg:
                if (count == 0) return std::monostate{};
                return sum / static_cast<double>(count);

            case AggregateType::Min:
                return hasValue ? minVal : Value{std::monostate{}};

            case AggregateType::Max:
                return hasValue ? maxVal : Value{std::monostate{}};

            default:
                return std::monostate{};
        }
    }

private:
    static int compareValues(const Value& a, const Value& b) {
        if (valueIsNull(a) && valueIsNull(b)) return 0;
        if (valueIsNull(a)) return 1;
        if (valueIsNull(b)) return -1;

        if (std::holds_alternative<int64_t>(a) && std::holds_alternative<int64_t>(b)) {
            int64_t va = std::get<int64_t>(a);
            int64_t vb = std::get<int64_t>(b);
            return (va < vb) ? -1 : (va > vb) ? 1 : 0;
        }

        if (std::holds_alternative<double>(a) || std::holds_alternative<double>(b)) {
            double va = valueToDouble(a);
            double vb = valueToDouble(b);
            return (va < vb) ? -1 : (va > vb) ? 1 : 0;
        }

        if (std::holds_alternative<std::string>(a) && std::holds_alternative<std::string>(b)) {
            return std::get<std::string>(a).compare(std::get<std::string>(b));
        }

        return valueToString(a).compare(valueToString(b));
    }
};

// ============================================================================
// Executor
// ============================================================================

class Executor {
public:
    Executor() {}

    Table executeSelect(const SelectStmtPtr& stmt) {
        Table result;

        if (!stmt) {
            setError("NULL statement");
            return result;
        }

        Table sourceData;
        if (stmt->fromClause) {
            if (stmt->fromClause->kind == ExprKind::Subquery) {
                sourceData = executeSelect(stmt->fromClause->subquery);
                if (hasError()) return result;
            } else if (stmt->fromClause->kind == ExprKind::FunctionCall) {
                sourceData = executeTableFunction(stmt->fromClause);
                if (hasError()) return result;
            }
        }

        if (!stmt->unionStmts.empty()) {
            Table baseResult = executeSingleSelect(stmt, sourceData);
            if (hasError()) return result;

            for (const auto& unionStmt : stmt->unionStmts) {
                Table unionResult = executeSelect(unionStmt);
                if (hasError()) return result;

                for (auto& row : unionResult.rows) {
                    baseResult.rows.push_back(std::move(row));
                }
            }

            if (stmt->limit >= 0 && static_cast<size_t>(stmt->limit) < baseResult.rows.size()) {
                baseResult.rows.resize(stmt->limit);
            }

            return baseResult;
        }

        result = executeSingleSelect(stmt, sourceData);

        if (stmt->limit >= 0 && static_cast<size_t>(stmt->limit) < result.rows.size()) {
            result.rows.resize(stmt->limit);
        }

        return result;
    }

    bool hasError() const { return !error_.empty(); }
    std::string getError() const { return error_; }

private:
    void setError(const std::string& msg) {
        if (error_.empty()) {
            error_ = msg;
        }
    }

    Table executeTableFunction(const ExprPtr& funcExpr) {
        Table result;

        std::string upper = funcExpr->name;
        for (char& c : upper) c = toupper(c);

        if (upper == "NUMBERS") {
            if (funcExpr->args.empty()) {
                setError("numbers() requires an argument");
                return result;
            }

            std::unordered_map<std::string, Value> emptyEnv;
            Value nVal = evaluate(funcExpr->args[0], emptyEnv, result);
            if (!std::holds_alternative<int64_t>(nVal)) {
                setError("numbers() argument must be an integer");
                return result;
            }

            int64_t n = std::get<int64_t>(nVal);
            if (n < 0) n = 0;

            result.columnNames.push_back("number");
            for (int64_t i = 0; i < n; i++) {
                result.rows.push_back({i});
            }
        } else {
            setError("Unknown table function: " + funcExpr->name);
        }

        return result;
    }

    Table executeSingleSelect(const SelectStmtPtr& stmt, const Table& sourceData) {
        // Apply WHERE clause filtering
        Table filteredData = sourceData;
        bool whereApplied = false;
        if (stmt->whereClause) {
            filteredData = applyWhereFilter(sourceData, stmt->whereClause);
            whereApplied = true;
        }

        bool hasAggregates = false;
        for (const auto& col : stmt->columns) {
            if (containsAggregate(col.expr)) {
                hasAggregates = true;
                break;
            }
        }

        bool hasGroupBy = !stmt->groupByExprs.empty();

        if (hasAggregates || hasGroupBy) {
            return executeAggregateSelect(stmt, filteredData);
        } else {
            return executeNonAggregateSelect(stmt, filteredData, whereApplied);
        }
    }

    // Apply WHERE clause filter to source data
    Table applyWhereFilter(const Table& sourceData, const ExprPtr& whereClause) {
        Table result;
        result.columnNames = sourceData.columnNames;

        // If no source rows (no FROM clause), evaluate WHERE against empty env
        if (sourceData.rows.empty()) {
            std::unordered_map<std::string, Value> emptyEnv;
            Value whereResult = evaluate(whereClause, emptyEnv, sourceData);
            if (isTruthy(whereResult)) {
                // Condition is true, return single empty row to produce result
                result.rows.push_back(Row{});
            }
            // If WHERE is false, result.rows stays empty -> no output
            return result;
        }

        // Filter rows based on WHERE predicate
        for (size_t rowIdx = 0; rowIdx < sourceData.rows.size(); rowIdx++) {
            std::unordered_map<std::string, Value> env;

            for (size_t i = 0; i < sourceData.columnNames.size(); i++) {
                if (i < sourceData.rows[rowIdx].size()) {
                    env[sourceData.columnNames[i]] = sourceData.rows[rowIdx][i];
                }
            }

            // Evaluate WHERE clause for this row
            Value whereResult = evaluate(whereClause, env, sourceData);
            if (isTruthy(whereResult)) {
                result.rows.push_back(sourceData.rows[rowIdx]);
            }
        }

        return result;
    }

    // Helper to check if a value is "truthy" (non-null, non-zero)
    bool isTruthy(const Value& v) const {
        if (std::holds_alternative<std::monostate>(v)) return false;
        if (std::holds_alternative<int64_t>(v)) return std::get<int64_t>(v) != 0;
        if (std::holds_alternative<double>(v)) return std::get<double>(v) != 0.0;
        if (std::holds_alternative<std::string>(v)) return !std::get<std::string>(v).empty();
        return false;
    }

    bool containsAggregate(const ExprPtr& expr) {
        if (!expr) return false;

        if (expr->kind == ExprKind::FunctionCall && expr->aggType != AggregateType::None) {
            return true;
        }

        if (expr->left && containsAggregate(expr->left)) return true;
        if (expr->right && containsAggregate(expr->right)) return true;

        for (const auto& arg : expr->args) {
            if (containsAggregate(arg)) return true;
        }

        return false;
    }

    Table executeNonAggregateSelect(const SelectStmtPtr& stmt, const Table& sourceData, bool whereApplied = false) {
        Table result;

        for (size_t i = 0; i < stmt->columns.size(); i++) {
            const auto& col = stmt->columns[i];
            if (!col.alias.empty()) {
                result.columnNames.push_back(col.alias);
            } else if (col.expr->kind == ExprKind::ColumnRef) {
                result.columnNames.push_back(col.expr->name);
            } else if (col.expr->kind == ExprKind::FunctionCall) {
                result.columnNames.push_back(col.expr->name + "(...)");
            } else {
                result.columnNames.push_back("column" + std::to_string(i));
            }
        }

        if (sourceData.rows.empty()) {
            // If WHERE was applied and filtered everything out, return empty result
            if (whereApplied) {
                return result;
            }
            // No FROM clause and no WHERE - generate one row with evaluated expressions
            Row row;
            std::unordered_map<std::string, Value> emptyEnv;
            for (const auto& col : stmt->columns) {
                row.push_back(evaluate(col.expr, emptyEnv, sourceData));
            }
            result.rows.push_back(std::move(row));
        } else {
            for (size_t rowIdx = 0; rowIdx < sourceData.rows.size(); rowIdx++) {
                Row row;
                std::unordered_map<std::string, Value> env;

                for (size_t i = 0; i < sourceData.columnNames.size(); i++) {
                    if (i < sourceData.rows[rowIdx].size()) {
                        env[sourceData.columnNames[i]] = sourceData.rows[rowIdx][i];
                    }
                }

                for (const auto& col : stmt->columns) {
                    row.push_back(evaluate(col.expr, env, sourceData));
                }
                result.rows.push_back(std::move(row));
            }
        }

        return result;
    }

    Table executeAggregateSelect(const SelectStmtPtr& stmt, const Table& sourceData) {
        Table result;

        if (!stmt->groupByExprs.empty()) {
            return executeGroupedAggregateSelect(stmt, sourceData);
        }

        std::vector<AggregateState> aggStates(stmt->columns.size());

        for (size_t i = 0; i < stmt->columns.size(); i++) {
            const auto& col = stmt->columns[i];
            if (!col.alias.empty()) {
                result.columnNames.push_back(col.alias);
            } else if (col.expr->kind == ExprKind::FunctionCall) {
                std::string upper = col.expr->name;
                for (char& c : upper) c = toupper(c);
                if (col.expr->aggType == AggregateType::CountStar) {
                    result.columnNames.push_back("count()");
                } else if (col.expr->args.size() == 1 && col.expr->args[0]->kind == ExprKind::ColumnRef) {
                    result.columnNames.push_back(upper + "(" + col.expr->args[0]->name + ")");
                } else {
                    result.columnNames.push_back(upper + "(...)");
                }
            } else {
                result.columnNames.push_back("column" + std::to_string(i));
            }

            if (col.expr->kind == ExprKind::FunctionCall && col.expr->aggType != AggregateType::None) {
                aggStates[i].init(col.expr->aggType);
            }
        }

        for (size_t rowIdx = 0; rowIdx < sourceData.rows.size(); rowIdx++) {
            std::unordered_map<std::string, Value> env;

            for (size_t i = 0; i < sourceData.columnNames.size(); i++) {
                if (i < sourceData.rows[rowIdx].size()) {
                    env[sourceData.columnNames[i]] = sourceData.rows[rowIdx][i];
                }
            }

            for (size_t i = 0; i < stmt->columns.size(); i++) {
                const auto& col = stmt->columns[i];
                if (col.expr->kind == ExprKind::FunctionCall && col.expr->aggType != AggregateType::None) {
                    if (col.expr->aggType == AggregateType::CountStar) {
                        aggStates[i].accumulate(Value{int64_t(1)});
                    } else if (!col.expr->args.empty()) {
                        Value argVal = evaluate(col.expr->args[0], env, sourceData);
                        aggStates[i].accumulate(argVal);
                    }
                }
            }
        }

        Row row;
        std::unordered_map<std::string, Value> emptyEnv;
        for (size_t i = 0; i < stmt->columns.size(); i++) {
            const auto& col = stmt->columns[i];
            if (col.expr->kind == ExprKind::FunctionCall && col.expr->aggType != AggregateType::None) {
                row.push_back(aggStates[i].finalize());
            } else {
                row.push_back(evaluate(col.expr, emptyEnv, sourceData));
            }
        }
        result.rows.push_back(std::move(row));

        return result;
    }

    Table executeGroupedAggregateSelect(const SelectStmtPtr& stmt, const Table& sourceData) {
        Table result;

        for (size_t i = 0; i < stmt->columns.size(); i++) {
            const auto& col = stmt->columns[i];
            if (!col.alias.empty()) {
                result.columnNames.push_back(col.alias);
            } else if (col.expr->kind == ExprKind::ColumnRef) {
                result.columnNames.push_back(col.expr->name);
            } else if (col.expr->kind == ExprKind::FunctionCall) {
                std::string upper = col.expr->name;
                for (char& c : upper) c = toupper(c);
                if (col.expr->aggType == AggregateType::CountStar) {
                    result.columnNames.push_back("count()");
                } else {
                    result.columnNames.push_back(upper + "(...)");
                }
            } else {
                result.columnNames.push_back("column" + std::to_string(i));
            }
        }

        // REFACTOR: Pre-compute resolved GROUP BY expressions (column-number and alias resolution)
        // This avoids repeated alias/column-number resolution for every row in the dataset
        std::vector<ExprPtr> resolvedGroupByExprs;
        resolvedGroupByExprs.reserve(stmt->groupByExprs.size());
        for (const auto& groupExpr : stmt->groupByExprs) {
            ExprPtr resolvedExpr = groupExpr;
            // Resolve GROUP BY column-number (e.g., GROUP BY 1, GROUP BY 2)
            if (groupExpr->kind == ExprKind::Literal &&
                std::holds_alternative<int64_t>(groupExpr->literalValue)) {
                int64_t colNum = std::get<int64_t>(groupExpr->literalValue);
                if (colNum >= 1 && static_cast<size_t>(colNum) <= stmt->columns.size()) {
                    resolvedExpr = stmt->columns[colNum - 1].expr;
                }
            }
            // Resolve GROUP BY alias (e.g., GROUP BY grp where grp is SELECT alias)
            else if (groupExpr->kind == ExprKind::ColumnRef) {
                std::string upperName = groupExpr->name;
                for (char& c : upperName) c = toupper(c);
                for (const auto& col : stmt->columns) {
                    std::string upperAlias = col.alias;
                    for (char& c : upperAlias) c = toupper(c);
                    if (!col.alias.empty() && upperAlias == upperName) {
                        resolvedExpr = col.expr;
                        break;
                    }
                }
            }
            resolvedGroupByExprs.push_back(resolvedExpr);
        }

        // Hash map for grouping: key is serialized group values, value is row indices
        std::unordered_map<std::string, std::vector<size_t>> groups;
        // Reserve space for expected number of groups (heuristic: sqrt of rows or 1000, whichever is smaller)
        groups.reserve(std::min(sourceData.rows.size() > 0 ? static_cast<size_t>(std::sqrt(sourceData.rows.size())) + 1 : 1, static_cast<size_t>(1000)));

        // Group rows by evaluating pre-resolved GROUP BY expressions
        for (size_t rowIdx = 0; rowIdx < sourceData.rows.size(); rowIdx++) {
            // Build environment for this row
            std::unordered_map<std::string, Value> env;
            env.reserve(sourceData.columnNames.size());
            for (size_t i = 0; i < sourceData.columnNames.size(); i++) {
                if (i < sourceData.rows[rowIdx].size()) {
                    env[sourceData.columnNames[i]] = sourceData.rows[rowIdx][i];
                }
            }

            // Build group key from pre-resolved expressions
            std::string groupKey;
            groupKey.reserve(resolvedGroupByExprs.size() * 16); // Pre-allocate for efficiency
            for (const auto& resolvedExpr : resolvedGroupByExprs) {
                Value groupVal = evaluate(resolvedExpr, env, sourceData);
                groupKey += valueToString(groupVal) + "\x00";
            }

            groups[groupKey].push_back(rowIdx);
        }

        for (const auto& [groupKey, rowIndices] : groups) {
            std::vector<AggregateState> aggStates(stmt->columns.size());
            for (size_t i = 0; i < stmt->columns.size(); i++) {
                const auto& col = stmt->columns[i];
                if (col.expr->kind == ExprKind::FunctionCall && col.expr->aggType != AggregateType::None) {
                    aggStates[i].init(col.expr->aggType);
                }
            }

            std::unordered_map<std::string, Value> firstEnv;
            if (!rowIndices.empty()) {
                for (size_t i = 0; i < sourceData.columnNames.size(); i++) {
                    if (i < sourceData.rows[rowIndices[0]].size()) {
                        firstEnv[sourceData.columnNames[i]] = sourceData.rows[rowIndices[0]][i];
                    }
                }
            }

            for (size_t rowIdx : rowIndices) {
                std::unordered_map<std::string, Value> env;
                for (size_t i = 0; i < sourceData.columnNames.size(); i++) {
                    if (i < sourceData.rows[rowIdx].size()) {
                        env[sourceData.columnNames[i]] = sourceData.rows[rowIdx][i];
                    }
                }

                for (size_t i = 0; i < stmt->columns.size(); i++) {
                    const auto& col = stmt->columns[i];
                    if (col.expr->kind == ExprKind::FunctionCall && col.expr->aggType != AggregateType::None) {
                        if (col.expr->aggType == AggregateType::CountStar) {
                            aggStates[i].accumulate(Value{int64_t(1)});
                        } else if (!col.expr->args.empty()) {
                            Value argVal = evaluate(col.expr->args[0], env, sourceData);
                            aggStates[i].accumulate(argVal);
                        }
                    }
                }
            }

            Row row;
            for (size_t i = 0; i < stmt->columns.size(); i++) {
                const auto& col = stmt->columns[i];
                if (col.expr->kind == ExprKind::FunctionCall && col.expr->aggType != AggregateType::None) {
                    row.push_back(aggStates[i].finalize());
                } else {
                    row.push_back(evaluate(col.expr, firstEnv, sourceData));
                }
            }

            // Apply HAVING clause filter
            if (stmt->havingClause) {
                std::unordered_map<std::string, Value> havingEnv = firstEnv;
                for (size_t i = 0; i < stmt->columns.size(); i++) {
                    const auto& col = stmt->columns[i];
                    if (!col.alias.empty()) {
                        havingEnv[col.alias] = row[i];
                    }
                    if (i < result.columnNames.size()) {
                        havingEnv[result.columnNames[i]] = row[i];
                    }
                }
                Value havingResult = evaluateHavingClause(stmt->havingClause, havingEnv, sourceData, aggStates, stmt);
                bool passes = false;
                if (std::holds_alternative<int64_t>(havingResult)) {
                    passes = std::get<int64_t>(havingResult) != 0;
                } else if (std::holds_alternative<double>(havingResult)) {
                    passes = std::get<double>(havingResult) != 0.0;
                }
                if (!passes) {
                    continue;
                }
            }

            result.rows.push_back(std::move(row));
        }

        return result;
    }

    // Evaluate HAVING clause with aggregate function support
    Value evaluateHavingClause(const ExprPtr& expr,
                               const std::unordered_map<std::string, Value>& env,
                               const Table& sourceData,
                               const std::vector<AggregateState>& aggStates,
                               const SelectStmtPtr& stmt) {
        if (!expr) return std::monostate{};
        if (expr->kind == ExprKind::FunctionCall && expr->aggType != AggregateType::None) {
            for (size_t i = 0; i < stmt->columns.size(); i++) {
                const auto& col = stmt->columns[i];
                if (col.expr->kind == ExprKind::FunctionCall && col.expr->aggType == expr->aggType) {
                    if (expr->aggType == AggregateType::CountStar) return aggStates[i].finalize();
                    bool argsMatch = (expr->args.size() == col.expr->args.size());
                    for (size_t j = 0; argsMatch && j < expr->args.size(); j++) {
                        if (expr->args[j]->kind == ExprKind::ColumnRef && col.expr->args[j]->kind == ExprKind::ColumnRef) {
                            std::string n1 = expr->args[j]->name, n2 = col.expr->args[j]->name;
                            for (char& c : n1) c = toupper(c);
                            for (char& c : n2) c = toupper(c);
                            if (n1 != n2) argsMatch = false;
                        }
                    }
                    if (argsMatch) return aggStates[i].finalize();
                }
            }
        }
        if (expr->kind == ExprKind::BinaryOp) {
            Value left = evaluateHavingClause(expr->left, env, sourceData, aggStates, stmt);
            Value right = evaluateHavingClause(expr->right, env, sourceData, aggStates, stmt);
            return evalBinaryOp(expr->op, left, right);
        }
        if (expr->kind == ExprKind::ColumnRef) {
            std::string upper = expr->name;
            for (char& c : upper) c = toupper(c);
            for (const auto& [key, val] : env) {
                std::string ku = key;
                for (char& c : ku) c = toupper(c);
                if (ku == upper) return val;
            }
        }
        return evaluate(expr, env, sourceData);
    }

    Value evaluate(const ExprPtr& expr, const std::unordered_map<std::string, Value>& env, const Table& sourceData) {
        if (!expr) return std::monostate{};

        switch (expr->kind) {
            case ExprKind::Literal:
                return expr->literalValue;

            case ExprKind::UnaryOp: {
                Value operand = evaluate(expr->right, env, sourceData);
                if (expr->op == '-') {
                    if (std::holds_alternative<int64_t>(operand)) {
                        return -std::get<int64_t>(operand);
                    }
                    if (std::holds_alternative<double>(operand)) {
                        return -std::get<double>(operand);
                    }
                }
                if (expr->op == '!') {  // NOT operator
                    return isTruthy(operand) ? int64_t(0) : int64_t(1);
                }
                return operand;
            }

            case ExprKind::BinaryOp: {
                Value left = evaluate(expr->left, env, sourceData);
                Value right = evaluate(expr->right, env, sourceData);
                return evalBinaryOp(expr->op, left, right);
            }

            case ExprKind::ColumnRef: {
                std::string upper = expr->name;
                for (char& c : upper) c = toupper(c);

                for (const auto& [key, val] : env) {
                    std::string keyUpper = key;
                    for (char& c : keyUpper) c = toupper(c);
                    if (keyUpper == upper) {
                        return val;
                    }
                }
                setError("Unknown column: " + expr->name);
                return std::monostate{};
            }

            case ExprKind::FunctionCall:
                return evaluateFunction(expr, env, sourceData);

            case ExprKind::Subquery: {
                Table subResult = const_cast<Executor*>(this)->executeSelect(expr->subquery);
                if (!subResult.rows.empty() && !subResult.rows[0].empty()) {
                    return subResult.rows[0][0];
                }
                return std::monostate{};
            }
        }

        return std::monostate{};
    }

    Value evaluateFunction(const ExprPtr& expr, const std::unordered_map<std::string, Value>& env, const Table& sourceData) {
        std::string upper = expr->name;
        for (char& c : upper) c = toupper(c);

        // System functions
        if (upper == "VERSION") {
            return std::string("24.1.1-chdb-wasm");
        }
        if (upper == "NOW" || upper == "NOW64") {
            return std::string("2024-01-15 12:00:00");
        }
        if (upper == "TODAY") {
            return std::string("2024-01-15");
        }
        if (upper == "CURRENTDATABASE") {
            return std::string("default");
        }
        if (upper == "TIMEZONE") {
            return std::string("UTC");
        }

        // String functions
        if (upper == "LENGTH" || upper == "CHAR_LENGTH") {
            if (!expr->args.empty()) {
                Value arg = evaluate(expr->args[0], env, sourceData);
                if (std::holds_alternative<std::string>(arg)) {
                    return static_cast<int64_t>(std::get<std::string>(arg).length());
                }
                return static_cast<int64_t>(valueToString(arg).length());
            }
            return int64_t(0);
        }

        if (upper == "UPPER" || upper == "UCASE") {
            if (!expr->args.empty()) {
                Value arg = evaluate(expr->args[0], env, sourceData);
                std::string s = valueToString(arg);
                for (char& c : s) c = toupper(static_cast<unsigned char>(c));
                return s;
            }
            return std::string("");
        }

        if (upper == "LOWER" || upper == "LCASE") {
            if (!expr->args.empty()) {
                Value arg = evaluate(expr->args[0], env, sourceData);
                std::string s = valueToString(arg);
                for (char& c : s) c = tolower(static_cast<unsigned char>(c));
                return s;
            }
            return std::string("");
        }

        if (upper == "TRIM") {
            if (!expr->args.empty()) {
                Value arg = evaluate(expr->args[0], env, sourceData);
                std::string s = valueToString(arg);
                size_t start = s.find_first_not_of(" \t\n\r\f\v");
                if (start == std::string::npos) return std::string("");
                size_t end = s.find_last_not_of(" \t\n\r\f\v");
                return s.substr(start, end - start + 1);
            }
            return std::string("");
        }

        if (upper == "LTRIM") {
            if (!expr->args.empty()) {
                Value arg = evaluate(expr->args[0], env, sourceData);
                std::string s = valueToString(arg);
                size_t start = s.find_first_not_of(" \t\n\r\f\v");
                if (start == std::string::npos) return std::string("");
                return s.substr(start);
            }
            return std::string("");
        }

        if (upper == "RTRIM") {
            if (!expr->args.empty()) {
                Value arg = evaluate(expr->args[0], env, sourceData);
                std::string s = valueToString(arg);
                size_t end = s.find_last_not_of(" \t\n\r\f\v");
                if (end == std::string::npos) return std::string("");
                return s.substr(0, end + 1);
            }
            return std::string("");
        }

        if (upper == "CONCAT") {
            std::string result;
            for (const auto& argExpr : expr->args) {
                Value arg = evaluate(argExpr, env, sourceData);
                result += valueToString(arg);
            }
            return result;
        }

        if (upper == "SUBSTRING" || upper == "SUBSTR") {
            if (expr->args.size() >= 2) {
                Value strArg = evaluate(expr->args[0], env, sourceData);
                Value offsetArg = evaluate(expr->args[1], env, sourceData);
                std::string s = valueToString(strArg);

                int64_t offset = 1;
                if (std::holds_alternative<int64_t>(offsetArg)) {
                    offset = std::get<int64_t>(offsetArg);
                } else if (std::holds_alternative<double>(offsetArg)) {
                    offset = static_cast<int64_t>(std::get<double>(offsetArg));
                }

                size_t startIdx = (offset > 0) ? static_cast<size_t>(offset - 1) : 0;
                if (startIdx >= s.length()) return std::string("");

                if (expr->args.size() >= 3) {
                    Value lengthArg = evaluate(expr->args[2], env, sourceData);
                    int64_t length = 0;
                    if (std::holds_alternative<int64_t>(lengthArg)) {
                        length = std::get<int64_t>(lengthArg);
                    } else if (std::holds_alternative<double>(lengthArg)) {
                        length = static_cast<int64_t>(std::get<double>(lengthArg));
                    }
                    if (length <= 0) return std::string("");
                    return s.substr(startIdx, static_cast<size_t>(length));
                }
                return s.substr(startIdx);
            }
            return std::monostate{};
        }

        if (upper == "REPLACE" || upper == "REPLACEALL") {
            if (expr->args.size() >= 3) {
                Value strArg = evaluate(expr->args[0], env, sourceData);
                Value fromArg = evaluate(expr->args[1], env, sourceData);
                Value toArg = evaluate(expr->args[2], env, sourceData);

                std::string s = valueToString(strArg);
                std::string from = valueToString(fromArg);
                std::string to = valueToString(toArg);

                if (from.empty()) return s;

                std::string result;
                size_t pos = 0;
                size_t prevPos = 0;
                while ((pos = s.find(from, prevPos)) != std::string::npos) {
                    result += s.substr(prevPos, pos - prevPos);
                    result += to;
                    prevPos = pos + from.length();
                }
                result += s.substr(prevPos);
                return result;
            }
            return std::monostate{};
        }

        if (upper == "REVERSE") {
            if (!expr->args.empty()) {
                Value arg = evaluate(expr->args[0], env, sourceData);
                std::string s = valueToString(arg);
                std::reverse(s.begin(), s.end());
                return s;
            }
            return std::string("");
        }

        if (upper == "LEFTPAD" || upper == "LPAD") {
            if (expr->args.size() >= 2) {
                Value strArg = evaluate(expr->args[0], env, sourceData);
                Value lenArg = evaluate(expr->args[1], env, sourceData);
                std::string s = valueToString(strArg);

                int64_t targetLen = 0;
                if (std::holds_alternative<int64_t>(lenArg)) {
                    targetLen = std::get<int64_t>(lenArg);
                } else if (std::holds_alternative<double>(lenArg)) {
                    targetLen = static_cast<int64_t>(std::get<double>(lenArg));
                }

                std::string padStr = " ";
                if (expr->args.size() >= 3) {
                    Value padArg = evaluate(expr->args[2], env, sourceData);
                    padStr = valueToString(padArg);
                }

                if (targetLen <= 0 || static_cast<int64_t>(s.length()) >= targetLen) return s;
                if (padStr.empty()) return s;

                size_t padNeeded = static_cast<size_t>(targetLen) - s.length();
                std::string result;
                while (result.length() < padNeeded) {
                    result += padStr;
                }
                return result.substr(0, padNeeded) + s;
            }
            return std::monostate{};
        }

        if (upper == "RIGHTPAD" || upper == "RPAD") {
            if (expr->args.size() >= 2) {
                Value strArg = evaluate(expr->args[0], env, sourceData);
                Value lenArg = evaluate(expr->args[1], env, sourceData);
                std::string s = valueToString(strArg);

                int64_t targetLen = 0;
                if (std::holds_alternative<int64_t>(lenArg)) {
                    targetLen = std::get<int64_t>(lenArg);
                } else if (std::holds_alternative<double>(lenArg)) {
                    targetLen = static_cast<int64_t>(std::get<double>(lenArg));
                }

                std::string padStr = " ";
                if (expr->args.size() >= 3) {
                    Value padArg = evaluate(expr->args[2], env, sourceData);
                    padStr = valueToString(padArg);
                }

                if (targetLen <= 0 || static_cast<int64_t>(s.length()) >= targetLen) return s;
                if (padStr.empty()) return s;

                size_t padNeeded = static_cast<size_t>(targetLen) - s.length();
                std::string padding;
                while (padding.length() < padNeeded) {
                    padding += padStr;
                }
                return s + padding.substr(0, padNeeded);
            }
            return std::monostate{};
        }

        if (upper == "REPEAT") {
            if (expr->args.size() >= 2) {
                Value strArg = evaluate(expr->args[0], env, sourceData);
                Value countArg = evaluate(expr->args[1], env, sourceData);
                std::string s = valueToString(strArg);

                int64_t count = 0;
                if (std::holds_alternative<int64_t>(countArg)) {
                    count = std::get<int64_t>(countArg);
                } else if (std::holds_alternative<double>(countArg)) {
                    count = static_cast<int64_t>(std::get<double>(countArg));
                }

                if (count <= 0) return std::string("");

                std::string result;
                result.reserve(s.length() * static_cast<size_t>(count));
                for (int64_t i = 0; i < count; i++) {
                    result += s;
                }
                return result;
            }
            return std::monostate{};
        }

        // Math functions
        if (upper == "ABS") {
            if (!expr->args.empty()) {
                Value arg = evaluate(expr->args[0], env, sourceData);
                if (std::holds_alternative<int64_t>(arg)) {
                    return std::abs(std::get<int64_t>(arg));
                }
                if (std::holds_alternative<double>(arg)) {
                    return std::abs(std::get<double>(arg));
                }
            }
            return std::monostate{};
        }

        if (upper == "SQRT") {
            if (!expr->args.empty()) {
                Value arg = evaluate(expr->args[0], env, sourceData);
                double val = valueToDouble(arg);
                return std::sqrt(val);
            }
            return std::monostate{};
        }

        if (upper == "ROUND") {
            if (!expr->args.empty()) {
                Value arg = evaluate(expr->args[0], env, sourceData);
                double val = valueToDouble(arg);
                if (expr->args.size() >= 2) {
                    Value precArg = evaluate(expr->args[1], env, sourceData);
                    int64_t precision = 0;
                    if (std::holds_alternative<int64_t>(precArg)) {
                        precision = std::get<int64_t>(precArg);
                    }
                    double factor = std::pow(10.0, static_cast<double>(precision));
                    return std::round(val * factor) / factor;
                }
                return std::round(val);
            }
            return std::monostate{};
        }

        if (upper == "FLOOR") {
            if (!expr->args.empty()) {
                Value arg = evaluate(expr->args[0], env, sourceData);
                double val = valueToDouble(arg);
                return std::floor(val);
            }
            return std::monostate{};
        }

        if (upper == "CEIL" || upper == "CEILING") {
            if (!expr->args.empty()) {
                Value arg = evaluate(expr->args[0], env, sourceData);
                double val = valueToDouble(arg);
                return std::ceil(val);
            }
            return std::monostate{};
        }

        if (upper == "POW" || upper == "POWER") {
            if (expr->args.size() >= 2) {
                Value baseArg = evaluate(expr->args[0], env, sourceData);
                Value expArg = evaluate(expr->args[1], env, sourceData);
                double base = valueToDouble(baseArg);
                double exp = valueToDouble(expArg);
                return std::pow(base, exp);
            }
            return std::monostate{};
        }

        if (upper == "LOG") {
            if (!expr->args.empty()) {
                Value arg = evaluate(expr->args[0], env, sourceData);
                double val = valueToDouble(arg);
                if (expr->args.size() >= 2) {
                    // log(base, x) = log(x) / log(base)
                    Value baseArg = arg;
                    Value xArg = evaluate(expr->args[1], env, sourceData);
                    double base = valueToDouble(baseArg);
                    double x = valueToDouble(xArg);
                    return std::log(x) / std::log(base);
                }
                return std::log(val);
            }
            return std::monostate{};
        }

        if (upper == "LOG10") {
            if (!expr->args.empty()) {
                Value arg = evaluate(expr->args[0], env, sourceData);
                double val = valueToDouble(arg);
                return std::log10(val);
            }
            return std::monostate{};
        }

        if (upper == "LOG2") {
            if (!expr->args.empty()) {
                Value arg = evaluate(expr->args[0], env, sourceData);
                double val = valueToDouble(arg);
                return std::log2(val);
            }
            return std::monostate{};
        }

        if (upper == "LN") {
            if (!expr->args.empty()) {
                Value arg = evaluate(expr->args[0], env, sourceData);
                double val = valueToDouble(arg);
                return std::log(val);
            }
            return std::monostate{};
        }

        if (upper == "EXP") {
            if (!expr->args.empty()) {
                Value arg = evaluate(expr->args[0], env, sourceData);
                double val = valueToDouble(arg);
                return std::exp(val);
            }
            return std::monostate{};
        }

        if (upper == "SIN") {
            if (!expr->args.empty()) {
                Value arg = evaluate(expr->args[0], env, sourceData);
                double val = valueToDouble(arg);
                return std::sin(val);
            }
            return std::monostate{};
        }

        if (upper == "COS") {
            if (!expr->args.empty()) {
                Value arg = evaluate(expr->args[0], env, sourceData);
                double val = valueToDouble(arg);
                return std::cos(val);
            }
            return std::monostate{};
        }

        if (upper == "TAN") {
            if (!expr->args.empty()) {
                Value arg = evaluate(expr->args[0], env, sourceData);
                double val = valueToDouble(arg);
                return std::tan(val);
            }
            return std::monostate{};
        }

        if (upper == "ASIN") {
            if (!expr->args.empty()) {
                Value arg = evaluate(expr->args[0], env, sourceData);
                double val = valueToDouble(arg);
                return std::asin(val);
            }
            return std::monostate{};
        }

        if (upper == "ACOS") {
            if (!expr->args.empty()) {
                Value arg = evaluate(expr->args[0], env, sourceData);
                double val = valueToDouble(arg);
                return std::acos(val);
            }
            return std::monostate{};
        }

        if (upper == "ATAN") {
            if (!expr->args.empty()) {
                Value arg = evaluate(expr->args[0], env, sourceData);
                double val = valueToDouble(arg);
                return std::atan(val);
            }
            return std::monostate{};
        }

        if (upper == "ATAN2") {
            if (expr->args.size() >= 2) {
                Value yArg = evaluate(expr->args[0], env, sourceData);
                Value xArg = evaluate(expr->args[1], env, sourceData);
                double y = valueToDouble(yArg);
                double x = valueToDouble(xArg);
                return std::atan2(y, x);
            }
            return std::monostate{};
        }

        if (upper == "SIGN") {
            if (!expr->args.empty()) {
                Value arg = evaluate(expr->args[0], env, sourceData);
                if (std::holds_alternative<int64_t>(arg)) {
                    int64_t val = std::get<int64_t>(arg);
                    return val > 0 ? int64_t(1) : (val < 0 ? int64_t(-1) : int64_t(0));
                }
                if (std::holds_alternative<double>(arg)) {
                    double val = std::get<double>(arg);
                    return val > 0 ? int64_t(1) : (val < 0 ? int64_t(-1) : int64_t(0));
                }
            }
            return int64_t(0);
        }

        if (upper == "TRUNC" || upper == "TRUNCATE") {
            if (!expr->args.empty()) {
                Value arg = evaluate(expr->args[0], env, sourceData);
                double val = valueToDouble(arg);
                return std::trunc(val);
            }
            return std::monostate{};
        }

        if (upper == "MOD" || upper == "MODULO") {
            if (expr->args.size() >= 2) {
                Value aArg = evaluate(expr->args[0], env, sourceData);
                Value bArg = evaluate(expr->args[1], env, sourceData);
                if (std::holds_alternative<int64_t>(aArg) && std::holds_alternative<int64_t>(bArg)) {
                    int64_t a = std::get<int64_t>(aArg);
                    int64_t b = std::get<int64_t>(bArg);
                    return b != 0 ? a % b : int64_t(0);
                }
                double a = valueToDouble(aArg);
                double b = valueToDouble(bArg);
                return b != 0.0 ? std::fmod(a, b) : 0.0;
            }
            return std::monostate{};
        }

        if (upper == "PI") {
            return 3.14159265358979323846;
        }

        if (upper == "E") {
            return 2.71828182845904523536;
        }

        if (upper == "GREATEST") {
            if (!expr->args.empty()) {
                double maxVal = valueToDouble(evaluate(expr->args[0], env, sourceData));
                for (size_t i = 1; i < expr->args.size(); i++) {
                    double val = valueToDouble(evaluate(expr->args[i], env, sourceData));
                    if (val > maxVal) maxVal = val;
                }
                return maxVal;
            }
            return std::monostate{};
        }

        if (upper == "LEAST") {
            if (!expr->args.empty()) {
                double minVal = valueToDouble(evaluate(expr->args[0], env, sourceData));
                for (size_t i = 1; i < expr->args.size(); i++) {
                    double val = valueToDouble(evaluate(expr->args[i], env, sourceData));
                    if (val < minVal) minVal = val;
                }
                return minVal;
            }
            return std::monostate{};
        }

        return std::monostate{};
    }

    Value evalBinaryOp(char op, const Value& left, const Value& right) {
        if (std::holds_alternative<std::monostate>(left) ||
            std::holds_alternative<std::monostate>(right)) {
            return std::monostate{};
        }

        if (op == '+' && (std::holds_alternative<std::string>(left) ||
                         std::holds_alternative<std::string>(right))) {
            return valueToString(left) + valueToString(right);
        }

        bool leftIsDouble = std::holds_alternative<double>(left);
        bool rightIsDouble = std::holds_alternative<double>(right);
        bool leftIsInt = std::holds_alternative<int64_t>(left);
        bool rightIsInt = std::holds_alternative<int64_t>(right);

        if ((leftIsDouble || leftIsInt) && (rightIsDouble || rightIsInt)) {
            if (leftIsDouble || rightIsDouble) {
                double l = leftIsDouble ? std::get<double>(left) : static_cast<double>(std::get<int64_t>(left));
                double r = rightIsDouble ? std::get<double>(right) : static_cast<double>(std::get<int64_t>(right));
                switch (op) {
                    case '+': return l + r;
                    case '-': return l - r;
                    case '*': return l * r;
                    case '/': return (r != 0) ? l / r : Value{std::monostate{}};
                    case '%': return (r != 0) ? std::fmod(l, r) : Value{std::monostate{}};
                    // Comparison operators return int64_t (0 or 1)
                    case '>': return static_cast<int64_t>(l > r);
                    case '<': return static_cast<int64_t>(l < r);
                    case 'G': return static_cast<int64_t>(l >= r);  // >=
                    case 'L': return static_cast<int64_t>(l <= r);  // <=
                    case '=': return static_cast<int64_t>(l == r);
                    case 'N': return static_cast<int64_t>(l != r);  // != or <>
                    // Logical operators
                    case '&': return static_cast<int64_t>(l != 0.0 && r != 0.0);  // AND
                    case '|': return static_cast<int64_t>(l != 0.0 || r != 0.0);  // OR
                }
            } else {
                int64_t l = std::get<int64_t>(left);
                int64_t r = std::get<int64_t>(right);
                switch (op) {
                    case '+': return l + r;
                    case '-': return l - r;
                    case '*': return l * r;
                    case '/': return (r != 0) ? l / r : Value{std::monostate{}};
                    case '%': return (r != 0) ? l % r : Value{std::monostate{}};
                    // Comparison operators
                    case '>': return static_cast<int64_t>(l > r);
                    case '<': return static_cast<int64_t>(l < r);
                    case 'G': return static_cast<int64_t>(l >= r);  // >=
                    case 'L': return static_cast<int64_t>(l <= r);  // <=
                    case '=': return static_cast<int64_t>(l == r);
                    case 'N': return static_cast<int64_t>(l != r);  // != or <>
                    // Logical operators
                    case '&': return static_cast<int64_t>(l != 0 && r != 0);  // AND
                    case '|': return static_cast<int64_t>(l != 0 || r != 0);  // OR
                }
            }
        }

        return std::monostate{};
    }

    std::string error_;
};

// ============================================================================
// Result Formatting
// ============================================================================

std::string formatTableCSV(const Table& table) {
    std::string result;

    for (size_t i = 0; i < table.columnNames.size(); i++) {
        if (i > 0) result += ",";
        result += "\"" + table.columnNames[i] + "\"";
    }
    result += "\n";

    for (const auto& row : table.rows) {
        for (size_t i = 0; i < row.size(); i++) {
            if (i > 0) result += ",";
            ValueType t = getValueType(row[i]);
            if (t == ValueType::String) {
                std::string s = std::get<std::string>(row[i]);
                result += "\"";
                for (char c : s) {
                    if (c == '"') result += "\"\"";
                    else result += c;
                }
                result += "\"";
            } else {
                result += valueToString(row[i]);
            }
        }
        result += "\n";
    }

    return result;
}

std::string formatTableTSV(const Table& table) {
    std::string result;

    for (size_t i = 0; i < table.columnNames.size(); i++) {
        if (i > 0) result += "\t";
        result += table.columnNames[i];
    }
    result += "\n";

    for (const auto& row : table.rows) {
        for (size_t i = 0; i < row.size(); i++) {
            if (i > 0) result += "\t";
            result += valueToString(row[i]);
        }
        result += "\n";
    }

    return result;
}

std::string formatTableJSON(const Table& table) {
    std::string result = "{\n";
    result += "  \"meta\": [\n";

    for (size_t i = 0; i < table.columnNames.size(); i++) {
        result += "    {\"name\": \"" + table.columnNames[i] + "\", \"type\": \"";
        if (!table.rows.empty() && i < table.rows[0].size()) {
            ValueType t = getValueType(table.rows[0][i]);
            switch (t) {
                case ValueType::Null: result += "Nullable(Nothing)"; break;
                case ValueType::Int64: result += "Int64"; break;
                case ValueType::Float64: result += "Float64"; break;
                case ValueType::String: result += "String"; break;
            }
        } else {
            result += "Unknown";
        }
        result += "\"}";
        if (i < table.columnNames.size() - 1) result += ",";
        result += "\n";
    }

    result += "  ],\n";
    result += "  \"data\": [\n";

    for (size_t rowIdx = 0; rowIdx < table.rows.size(); rowIdx++) {
        const auto& row = table.rows[rowIdx];
        result += "    {";

        for (size_t i = 0; i < row.size() && i < table.columnNames.size(); i++) {
            if (i > 0) result += ", ";
            result += "\"" + table.columnNames[i] + "\": ";

            ValueType t = getValueType(row[i]);
            if (t == ValueType::String) {
                result += "\"";
                for (char c : std::get<std::string>(row[i])) {
                    switch (c) {
                        case '"': result += "\\\""; break;
                        case '\\': result += "\\\\"; break;
                        case '\n': result += "\\n"; break;
                        case '\r': result += "\\r"; break;
                        case '\t': result += "\\t"; break;
                        default: result += c; break;
                    }
                }
                result += "\"";
            } else if (t == ValueType::Null) {
                result += "null";
            } else {
                result += valueToString(row[i]);
            }
        }

        result += "}";
        if (rowIdx < table.rows.size() - 1) result += ",";
        result += "\n";
    }

    result += "  ],\n";
    result += "  \"rows\": " + std::to_string(table.rows.size()) + ",\n";
    result += "  \"statistics\": {\"elapsed\": 0.001, \"rows_read\": " +
              std::to_string(table.rows.size()) + ", \"bytes_read\": 0}\n";
    result += "}\n";

    return result;
}

// ============================================================================
// Executor Context
// ============================================================================

struct ExecutorContext {
    char* lastResult;
    size_t lastResultLen;
    char* lastError;

    ExecutorContext() : lastResult(nullptr), lastResultLen(0), lastError(nullptr) {}

    ~ExecutorContext() {
        if (lastResult) free(lastResult);
        if (lastError) free(lastError);
    }

    void setResult(const std::string& result) {
        if (lastResult) free(lastResult);
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

EXPORT
void* executor_create() {
    return new ExecutorContext();
}

EXPORT
void executor_destroy(void* ctx) {
    if (ctx) {
        delete static_cast<ExecutorContext*>(ctx);
    }
}

EXPORT
int executor_query(void* ctx, const char* query, size_t query_len, const char* format) {
    if (!ctx || !query) return -1;

    ExecutorContext* exec = static_cast<ExecutorContext*>(ctx);

    Lexer lexer(query, query_len);
    Parser parser(lexer);

    SelectStmtPtr stmt = parser.parseSelect();
    if (!stmt || parser.hasError()) {
        exec->setError(parser.getError().empty() ? "Parse error" : parser.getError());
        return -1;
    }

    Executor executor;
    Table result = executor.executeSelect(stmt);

    if (executor.hasError()) {
        exec->setError(executor.getError());
        return -1;
    }

    std::string fmt = format ? format : "CSV";
    for (char& c : fmt) c = toupper(c);

    std::string output;
    if (fmt == "JSON" || fmt == "JSONEACHROW") {
        output = formatTableJSON(result);
    } else if (fmt == "TSV" || fmt == "TABSEPARATED") {
        output = formatTableTSV(result);
    } else {
        output = formatTableCSV(result);
    }

    exec->setResult(output);
    return 0;
}

EXPORT
const char* executor_get_result(void* ctx) {
    if (!ctx) return nullptr;
    return static_cast<ExecutorContext*>(ctx)->lastResult;
}

EXPORT
size_t executor_get_result_len(void* ctx) {
    if (!ctx) return 0;
    return static_cast<ExecutorContext*>(ctx)->lastResultLen;
}

EXPORT
const char* executor_get_error(void* ctx) {
    if (!ctx) return nullptr;
    return static_cast<ExecutorContext*>(ctx)->lastError;
}

EXPORT
int executor_test() {
    // Test 1: Simple integer
    {
        ExecutorContext ctx;
        if (executor_query(&ctx, "SELECT 42", 9, "CSV") != 0) return -1;
        if (!ctx.lastResult) return -2;
    }

    // Test 2: Addition
    {
        ExecutorContext ctx;
        if (executor_query(&ctx, "SELECT 1 + 2", 12, "CSV") != 0) return -3;
        if (!ctx.lastResult) return -4;
        if (strstr(ctx.lastResult, "3") == nullptr) return -5;
    }

    // Test 3: String
    {
        ExecutorContext ctx;
        if (executor_query(&ctx, "SELECT 'hello'", 14, "CSV") != 0) return -6;
        if (!ctx.lastResult) return -7;
        if (strstr(ctx.lastResult, "hello") == nullptr) return -8;
    }

    // Test 4: COUNT(*) with UNION ALL
    {
        ExecutorContext ctx;
        const char* sql = "SELECT COUNT(*) FROM (SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3)";
        if (executor_query(&ctx, sql, strlen(sql), "CSV") != 0) return -9;
        if (!ctx.lastResult) return -10;
        if (strstr(ctx.lastResult, "3") == nullptr) return -11;
    }

    // Test 5: SUM aggregate
    {
        ExecutorContext ctx;
        const char* sql = "SELECT SUM(x) FROM (SELECT 10 AS x UNION ALL SELECT 20 AS x UNION ALL SELECT 30 AS x)";
        if (executor_query(&ctx, sql, strlen(sql), "CSV") != 0) return -12;
        if (!ctx.lastResult) return -13;
        if (strstr(ctx.lastResult, "60") == nullptr) return -14;
    }

    // Test 6: numbers() table function with COUNT(*)
    {
        ExecutorContext ctx;
        const char* sql = "SELECT COUNT(*) FROM numbers(100)";
        if (executor_query(&ctx, sql, strlen(sql), "CSV") != 0) return -15;
        if (!ctx.lastResult) return -16;
        if (strstr(ctx.lastResult, "100") == nullptr) return -17;
    }

    // Test 7: AVG aggregate
    {
        ExecutorContext ctx;
        const char* sql = "SELECT AVG(x) FROM (SELECT 10 AS x UNION ALL SELECT 20 AS x UNION ALL SELECT 30 AS x)";
        if (executor_query(&ctx, sql, strlen(sql), "CSV") != 0) return -18;
        if (!ctx.lastResult) return -19;
        if (strstr(ctx.lastResult, "20") == nullptr) return -20;
    }

    // Test 8: MIN and MAX
    {
        ExecutorContext ctx;
        const char* sql = "SELECT MIN(x), MAX(x) FROM (SELECT 5 AS x UNION ALL SELECT 15 AS x UNION ALL SELECT 10 AS x)";
        if (executor_query(&ctx, sql, strlen(sql), "CSV") != 0) return -21;
        if (!ctx.lastResult) return -22;
        if (strstr(ctx.lastResult, "5") == nullptr) return -23;
        if (strstr(ctx.lastResult, "15") == nullptr) return -24;
    }

    return 0; // All tests passed
}

EXPORT
const char* executor_version() {
    return "chdb-executor 0.3.0 (WASM SQL executor with aggregates)";
}

} // extern "C"

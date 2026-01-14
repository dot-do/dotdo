/**
 * ClickHouse SQL Parser - AST Visitors
 *
 * Utilities for walking and transforming AST nodes.
 */

import type {
  ASTNode,
  StatementNode,
  ExpressionNode,
  SelectQueryNode,
  CreateTableNode,
  InsertNode,
  FunctionCallNode,
  BinaryOpNode,
  JSONPathNode,
  JSONCastNode,
  ArrayLiteralNode,
  AliasNode,
} from './ast'

// ============================================================================
// Visitor Types
// ============================================================================

export type VisitorCallback<T = void> = (node: ASTNode, parent?: ASTNode) => T

export interface ASTVisitor<T = void> {
  visitSelectQuery?: (node: SelectQueryNode, parent?: ASTNode) => T
  visitCreateTable?: (node: CreateTableNode, parent?: ASTNode) => T
  visitInsert?: (node: InsertNode, parent?: ASTNode) => T
  visitExpression?: (node: ExpressionNode, parent?: ASTNode) => T
  visitFunctionCall?: (node: FunctionCallNode, parent?: ASTNode) => T
  visitBinaryOp?: (node: BinaryOpNode, parent?: ASTNode) => T
  visitJSONPath?: (node: JSONPathNode, parent?: ASTNode) => T
  visitJSONCast?: (node: JSONCastNode, parent?: ASTNode) => T
  visitArrayLiteral?: (node: ArrayLiteralNode, parent?: ASTNode) => T
  visitAlias?: (node: AliasNode, parent?: ASTNode) => T
  visitDefault?: (node: ASTNode, parent?: ASTNode) => T
}

// ============================================================================
// Walk Functions
// ============================================================================

/**
 * Walk an AST node and all its children, calling the visitor for each node
 */
export function walkAST(node: ASTNode, visitor: ASTVisitor): void {
  walkNode(node, visitor)
}

function walkNode(node: ASTNode, visitor: ASTVisitor, parent?: ASTNode): void {
  switch (node.type) {
    case 'SelectQuery':
      visitor.visitSelectQuery?.(node, parent)
      for (const col of node.columns) {
        walkNode(col, visitor, node)
      }
      if (node.where) {
        walkNode(node.where, visitor, node)
      }
      if (node.orderBy) {
        for (const elem of node.orderBy) {
          walkNode(elem.expression, visitor, elem)
        }
      }
      break

    case 'CreateTable':
      visitor.visitCreateTable?.(node, parent)
      break

    case 'Insert':
      visitor.visitInsert?.(node, parent)
      for (const row of node.values) {
        for (const expr of row) {
          walkNode(expr, visitor, node)
        }
      }
      break

    case 'FunctionCall':
      visitor.visitFunctionCall?.(node, parent)
      visitor.visitExpression?.(node, parent)
      for (const arg of node.args) {
        walkNode(arg, visitor, node)
      }
      break

    case 'BinaryOp':
      visitor.visitBinaryOp?.(node, parent)
      visitor.visitExpression?.(node, parent)
      walkNode(node.left, visitor, node)
      walkNode(node.right, visitor, node)
      break

    case 'JSONPath':
      visitor.visitJSONPath?.(node, parent)
      visitor.visitExpression?.(node, parent)
      walkNode(node.object, visitor, node)
      break

    case 'JSONCast':
      visitor.visitJSONCast?.(node, parent)
      visitor.visitExpression?.(node, parent)
      walkNode(node.expression, visitor, node)
      break

    case 'ArrayLiteral':
      visitor.visitArrayLiteral?.(node, parent)
      visitor.visitExpression?.(node, parent)
      for (const elem of node.elements) {
        walkNode(elem, visitor, node)
      }
      break

    case 'Alias':
      visitor.visitAlias?.(node, parent)
      visitor.visitExpression?.(node, parent)
      walkNode(node.expression, visitor, node)
      break

    case 'Identifier':
    case 'Literal':
    case 'Star':
      visitor.visitExpression?.(node, parent)
      break

    default:
      visitor.visitDefault?.(node, parent)
  }
}

// ============================================================================
// AST Formatting
// ============================================================================

export function formatAST(node: ASTNode, indent: number = 0): string {
  const prefix = '  '.repeat(indent)

  switch (node.type) {
    case 'SelectQuery':
      let result = `${prefix}SELECT`
      if (node.distinct) {
        result += ' DISTINCT'
      }
      result += `\n${prefix}  columns:\n`
      for (const col of node.columns) {
        result += formatAST(col, indent + 2) + '\n'
      }
      if (node.from) {
        result += `${prefix}  FROM: ${node.from.database ? node.from.database + '.' : ''}${node.from.table}\n`
      }
      if (node.where) {
        result += `${prefix}  WHERE:\n${formatAST(node.where, indent + 2)}\n`
      }
      if (node.orderBy) {
        result += `${prefix}  ORDER BY:\n`
        for (const elem of node.orderBy) {
          result += `${prefix}    ${formatAST(elem.expression, 0).trim()} ${elem.direction}\n`
        }
      }
      if (node.limit) {
        result += `${prefix}  LIMIT: ${node.limit.value}\n`
      }
      return result

    case 'CreateTable':
      let createResult = `${prefix}CREATE TABLE`
      if (node.ifNotExists) {
        createResult += ' IF NOT EXISTS'
      }
      createResult += ` ${node.table.database ? node.table.database + '.' : ''}${node.table.table}\n`
      createResult += `${prefix}  columns:\n`
      for (const col of node.columns) {
        createResult += `${prefix}    ${col.name} ${col.dataType}\n`
      }
      if (node.engine) {
        createResult += `${prefix}  ENGINE = ${node.engine.name}`
        if (node.engine.args && node.engine.args.length > 0) {
          createResult += '(...)'
        }
        createResult += '()\n'
      }
      return createResult

    case 'Insert':
      let insertResult = `${prefix}INSERT INTO ${node.table.table}\n`
      if (node.columns) {
        insertResult += `${prefix}  columns: (${node.columns.join(', ')})\n`
      }
      insertResult += `${prefix}  values: ${node.values.length} row(s)\n`
      return insertResult

    case 'FunctionCall':
      return `${prefix}${node.name}(${node.args.map((a) => formatAST(a, 0).trim()).join(', ')})`

    case 'BinaryOp':
      return `${prefix}(${formatAST(node.left, 0).trim()} ${node.op} ${formatAST(node.right, 0).trim()})`

    case 'JSONPath':
      return `${prefix}${formatAST(node.object, 0).trim()}${node.extractText ? '->>' : '->'}'${node.path}'`

    case 'JSONCast':
      return `${prefix}${formatAST(node.expression, 0).trim()}::${node.targetType}`

    case 'Identifier':
      return `${prefix}${node.quoted ? `"${node.name}"` : node.name}`

    case 'Literal':
      if (node.dataType === 'string') {
        return `${prefix}'${node.value}'`
      }
      return `${prefix}${node.value}`

    case 'ArrayLiteral':
      return `${prefix}[${node.elements.map((e) => formatAST(e, 0).trim()).join(', ')}]`

    case 'Star':
      return `${prefix}*`

    case 'Alias':
      return `${prefix}${formatAST(node.expression, 0).trim()} AS ${node.alias}`

    default:
      return `${prefix}[Unknown node type]`
  }
}

// ============================================================================
// Validation for Things/Relationships patterns
// ============================================================================

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export function validateThingsQuery(ast: ASTNode): ValidationResult {
  const result: ValidationResult = { valid: true, errors: [], warnings: [] }

  if (ast.type !== 'SelectQuery') {
    result.valid = false
    result.errors.push('Expected SELECT query')
    return result
  }

  // Check for valid Things table access
  if (ast.from && ast.from.table.toLowerCase() !== 'things') {
    result.warnings.push(`Table '${ast.from.table}' is not 'things' - ensure this is intentional`)
  }

  // Check for JSON path access patterns
  for (const col of ast.columns) {
    validateExpressionForThings(col, result)
  }

  if (ast.where) {
    validateExpressionForThings(ast.where, result)
  }

  return result
}

function validateExpressionForThings(expr: ExpressionNode, result: ValidationResult): void {
  switch (expr.type) {
    case 'JSONPath':
      // Valid JSON path access
      if (!expr.path.startsWith("'$.")) {
        result.warnings.push(`JSON path '${expr.path}' does not start with '$.' - this may be incorrect`)
      }
      break

    case 'FunctionCall':
      // Check for known vector functions
      const vectorFunctions = [
        'cosineDistance',
        'L2Distance',
        'L1Distance',
        'dotProduct',
        'vectorSum',
        'vectorDifference',
      ]
      if (vectorFunctions.includes(expr.name)) {
        // Valid vector function
        if (expr.args.length < 2) {
          result.errors.push(`Vector function '${expr.name}' requires at least 2 arguments`)
          result.valid = false
        }
      }

      // Check for full-text search functions
      const ftsFunction = ['hasToken', 'multiSearchAny', 'match', 'like', 'ilike']
      if (ftsFunction.includes(expr.name)) {
        // Valid FTS function - no special validation needed
      }

      // Recursively validate args
      for (const arg of expr.args) {
        validateExpressionForThings(arg, result)
      }
      break

    case 'BinaryOp':
      validateExpressionForThings(expr.left, result)
      validateExpressionForThings(expr.right, result)
      break

    case 'Alias':
      validateExpressionForThings(expr.expression, result)
      break

    case 'JSONCast':
      validateExpressionForThings(expr.expression, result)
      break

    case 'ArrayLiteral':
      for (const elem of expr.elements) {
        validateExpressionForThings(elem, result)
      }
      break

    default:
      // Other types are fine
      break
  }
}

// ============================================================================
// Helper functions for extracting specific node types
// ============================================================================

/**
 * Find all function calls in an AST
 */
export function findFunctionCalls(ast: ASTNode): FunctionCallNode[] {
  const calls: FunctionCallNode[] = []
  walkAST(ast, {
    visitFunctionCall: (node) => {
      calls.push(node)
    },
  })
  return calls
}

/**
 * Find all JSON path accesses in an AST
 */
export function findJSONPaths(ast: ASTNode): JSONPathNode[] {
  const paths: JSONPathNode[] = []
  walkAST(ast, {
    visitJSONPath: (node) => {
      paths.push(node)
    },
  })
  return paths
}

/**
 * Check if an AST contains vector functions
 */
export function hasVectorFunctions(ast: ASTNode): boolean {
  const vectorFunctions = new Set([
    'cosineDistance',
    'L2Distance',
    'L1Distance',
    'dotProduct',
    'vectorSum',
    'vectorDifference',
  ])

  let found = false
  walkAST(ast, {
    visitFunctionCall: (node) => {
      if (vectorFunctions.has(node.name)) {
        found = true
      }
    },
  })
  return found
}

/**
 * Check if an AST contains full-text search functions
 */
export function hasFullTextSearch(ast: ASTNode): boolean {
  const ftsFunction = new Set(['hasToken', 'multiSearchAny', 'match', 'like', 'ilike'])

  let found = false
  walkAST(ast, {
    visitFunctionCall: (node) => {
      if (ftsFunction.has(node.name)) {
        found = true
      }
    },
  })
  return found
}

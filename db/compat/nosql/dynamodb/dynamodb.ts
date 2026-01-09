/**
 * @dotdo/dynamodb - AWS DynamoDB SDK compat
 *
 * Drop-in replacement for @aws-sdk/client-dynamodb backed by DO SQLite with JSON storage.
 * This in-memory implementation matches the AWS SDK v3 API.
 * Production version routes to Durable Objects based on config.
 *
 * @see https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-dynamodb/
 */
import type {
  DynamoDBClient as IDynamoDBClient,
  DynamoDBClientConfig,
  ExtendedDynamoDBClientConfig,
  Command,
  ResponseMetadata,
  TableDescription,
  KeySchemaElement,
  AttributeDefinition,
  Item,
  Key,
  AttributeValue,
  CreateTableCommandInput,
  CreateTableCommandOutput,
  DeleteTableCommandInput,
  DeleteTableCommandOutput,
  DescribeTableCommandInput,
  DescribeTableCommandOutput,
  ListTablesCommandInput,
  ListTablesCommandOutput,
  PutItemCommandInput,
  PutItemCommandOutput,
  GetItemCommandInput,
  GetItemCommandOutput,
  UpdateItemCommandInput,
  UpdateItemCommandOutput,
  DeleteItemCommandInput,
  DeleteItemCommandOutput,
  QueryCommandInput,
  QueryCommandOutput,
  ScanCommandInput,
  ScanCommandOutput,
  BatchWriteItemCommandInput,
  BatchWriteItemCommandOutput,
  BatchGetItemCommandInput,
  BatchGetItemCommandOutput,
  TransactGetItemsCommandInput,
  TransactGetItemsCommandOutput,
  TransactWriteItemsCommandInput,
  TransactWriteItemsCommandOutput,
  GlobalSecondaryIndexDescription,
  LocalSecondaryIndexDescription,
} from './types'

import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  ListTablesCommand,
  PutItemCommand,
  GetItemCommand,
  UpdateItemCommand,
  DeleteItemCommand,
  QueryCommand,
  ScanCommand,
  BatchWriteItemCommand,
  BatchGetItemCommand,
  TransactGetItemsCommand,
  TransactWriteItemsCommand,
  ResourceNotFoundException,
  ResourceInUseException,
  ConditionalCheckFailedException,
  TransactionCanceledException,
  ValidationException,
} from './types'

// Re-export types and classes
export {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  ListTablesCommand,
  PutItemCommand,
  GetItemCommand,
  UpdateItemCommand,
  DeleteItemCommand,
  QueryCommand,
  ScanCommand,
  BatchWriteItemCommand,
  BatchGetItemCommand,
  TransactGetItemsCommand,
  TransactWriteItemsCommand,
} from './types'

export {
  DynamoDBServiceException,
  ResourceNotFoundException,
  ResourceInUseException,
  ConditionalCheckFailedException,
  TransactionCanceledException,
  ValidationException,
  ProvisionedThroughputExceededException,
  ItemCollectionSizeLimitExceededException,
} from './types'

export { marshall, marshallItem, unmarshall, unmarshallItem } from './types'

// ============================================================================
// IN-MEMORY STORAGE
// ============================================================================

/**
 * Table metadata
 */
interface TableMeta {
  name: string
  keySchema: KeySchemaElement[]
  attributeDefinitions: AttributeDefinition[]
  status: 'ACTIVE' | 'CREATING' | 'UPDATING' | 'DELETING'
  createdAt: Date
  items: Map<string, Item>
  gsi: GlobalSecondaryIndexDescription[]
  lsi: LocalSecondaryIndexDescription[]
}

/**
 * Global storage for all tables
 */
const globalTables = new Map<string, TableMeta>()

/**
 * Generate a key string from a DynamoDB key
 */
function keyToString(key: Key): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(key)) {
    parts.push(`${k}:${attributeValueToString(v)}`)
  }
  return parts.sort().join('|')
}

/**
 * Convert attribute value to string for key generation
 */
function attributeValueToString(av: AttributeValue): string {
  if (av.S !== undefined) return `S:${av.S}`
  if (av.N !== undefined) return `N:${av.N}`
  if (av.B !== undefined) return `B:${btoa(String.fromCharCode(...av.B))}`
  throw new ValidationException('Invalid key attribute type')
}

/**
 * Extract key from item based on key schema
 */
function extractKey(item: Item, keySchema: KeySchemaElement[]): Key {
  const key: Key = {}
  for (const ks of keySchema) {
    if (item[ks.AttributeName] === undefined) {
      throw new ValidationException(`Missing key attribute: ${ks.AttributeName}`)
    }
    key[ks.AttributeName] = item[ks.AttributeName]
  }
  return key
}

/**
 * Compare two attribute values
 */
function compareAttributeValues(a: AttributeValue, b: AttributeValue): number {
  if (a.S !== undefined && b.S !== undefined) {
    return a.S.localeCompare(b.S)
  }
  if (a.N !== undefined && b.N !== undefined) {
    return Number(a.N) - Number(b.N)
  }
  if (a.B !== undefined && b.B !== undefined) {
    const strA = String.fromCharCode(...a.B)
    const strB = String.fromCharCode(...b.B)
    return strA.localeCompare(strB)
  }
  return 0
}

/**
 * Check if two attribute values are equal
 */
function attributeValuesEqual(a: AttributeValue, b: AttributeValue): boolean {
  if (a.S !== undefined && b.S !== undefined) return a.S === b.S
  if (a.N !== undefined && b.N !== undefined) return a.N === b.N
  if (a.BOOL !== undefined && b.BOOL !== undefined) return a.BOOL === b.BOOL
  if (a.NULL !== undefined && b.NULL !== undefined) return true
  if (a.B !== undefined && b.B !== undefined) {
    if (a.B.length !== b.B.length) return false
    return a.B.every((v, i) => v === b.B![i])
  }
  if (a.L !== undefined && b.L !== undefined) {
    if (a.L.length !== b.L.length) return false
    return a.L.every((v, i) => attributeValuesEqual(v, b.L![i]))
  }
  if (a.M !== undefined && b.M !== undefined) {
    const keysA = Object.keys(a.M)
    const keysB = Object.keys(b.M)
    if (keysA.length !== keysB.length) return false
    return keysA.every((k) => b.M![k] && attributeValuesEqual(a.M![k], b.M![k]))
  }
  return false
}

/**
 * Get nested attribute value using path (e.g., 'a.b.c')
 */
function getNestedValue(item: Item, path: string): AttributeValue | undefined {
  const parts = path.split('.')
  let current: AttributeValue | undefined = item[parts[0]]

  for (let i = 1; i < parts.length && current; i++) {
    if (current.M) {
      current = current.M[parts[i]]
    } else if (current.L && /^\d+$/.test(parts[i])) {
      current = current.L[parseInt(parts[i], 10)]
    } else {
      return undefined
    }
  }

  return current
}

/**
 * Set nested attribute value using path
 */
function setNestedValue(item: Item, path: string, value: AttributeValue): void {
  const parts = path.split('.')
  let current: Item | Record<string, AttributeValue> = item

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (!current[part] || !current[part].M) {
      current[part] = { M: {} }
    }
    current = current[part].M!
  }

  current[parts[parts.length - 1]] = value
}

/**
 * Remove nested attribute value using path
 */
function removeNestedValue(item: Item, path: string): void {
  const parts = path.split('.')
  let current: Item | Record<string, AttributeValue> = item

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (!current[part] || !current[part].M) {
      return
    }
    current = current[part].M!
  }

  delete current[parts[parts.length - 1]]
}

// ============================================================================
// EXPRESSION PARSING
// ============================================================================

/**
 * Resolve expression attribute names
 */
function resolveNames(
  expr: string,
  names: Record<string, string> | undefined
): string {
  if (!names) return expr
  let result = expr
  for (const [placeholder, name] of Object.entries(names)) {
    result = result.replace(new RegExp(placeholder.replace('#', '\\#'), 'g'), name)
  }
  return result
}

/**
 * Parse key condition expression
 */
function parseKeyCondition(
  expr: string,
  names: Record<string, string> | undefined,
  values: Record<string, AttributeValue> | undefined
): { partitionKey: string; partitionValue: AttributeValue; sortKey?: string; sortOp?: string; sortValue?: AttributeValue; sortValue2?: AttributeValue } {
  const resolved = resolveNames(expr, names)

  // Simple partition key: pk = :pk
  const simpleMatch = resolved.match(/^(\w+)\s*=\s*:(\w+)$/)
  if (simpleMatch) {
    const [, pk, pkValue] = simpleMatch
    return {
      partitionKey: pk,
      partitionValue: values?.[`:${pkValue}`]!,
    }
  }

  // Partition + begins_with function: pk = :pk AND begins_with(sk, :prefix)
  const beginsWithMatch = resolved.match(
    /^(\w+)\s*=\s*:(\w+)\s+AND\s+begins_with\s*\(\s*(\w+)\s*,\s*:(\w+)\s*\)$/i
  )
  if (beginsWithMatch) {
    const [, pk, pkValue, sk, prefixValue] = beginsWithMatch
    return {
      partitionKey: pk,
      partitionValue: values?.[`:${pkValue}`]!,
      sortKey: sk,
      sortOp: 'BEGINS_WITH',
      sortValue: values?.[`:${prefixValue}`],
    }
  }

  // Partition + sort key with BETWEEN: pk = :pk AND sk BETWEEN :start AND :end
  const betweenMatch = resolved.match(
    /^(\w+)\s*=\s*:(\w+)\s+AND\s+(\w+)\s+BETWEEN\s+:(\w+)\s+AND\s+:(\w+)$/i
  )
  if (betweenMatch) {
    const [, pk, pkValue, sk, startValue, endValue] = betweenMatch
    return {
      partitionKey: pk,
      partitionValue: values?.[`:${pkValue}`]!,
      sortKey: sk,
      sortOp: 'BETWEEN',
      sortValue: values?.[`:${startValue}`],
      sortValue2: values?.[`:${endValue}`],
    }
  }

  // Partition + sort key with comparison operators: pk = :pk AND sk op :sk
  const compoundMatch = resolved.match(
    /^(\w+)\s*=\s*:(\w+)\s+AND\s+(\w+)\s*(=|<|>|<=|>=)\s*:(\w+)$/i
  )
  if (compoundMatch) {
    const [, pk, pkValue, sk, op, skValue] = compoundMatch
    return {
      partitionKey: pk,
      partitionValue: values?.[`:${pkValue}`]!,
      sortKey: sk,
      sortOp: op,
      sortValue: values?.[`:${skValue}`],
    }
  }

  throw new ValidationException(`Invalid KeyConditionExpression: ${expr}`)
}

/**
 * Evaluate filter expression
 */
function evaluateFilter(
  item: Item,
  expr: string,
  names: Record<string, string> | undefined,
  values: Record<string, AttributeValue> | undefined
): boolean {
  if (!expr) return true

  const resolved = resolveNames(expr, names)

  // Handle AND/OR combinations
  if (/\s+AND\s+/i.test(resolved)) {
    const parts = resolved.split(/\s+AND\s+/i)
    return parts.every((p) => evaluateFilter(item, p.trim(), names, values))
  }

  if (/\s+OR\s+/i.test(resolved)) {
    const parts = resolved.split(/\s+OR\s+/i)
    return parts.some((p) => evaluateFilter(item, p.trim(), names, values))
  }

  // Handle NOT
  const notMatch = resolved.match(/^NOT\s+(.+)$/i)
  if (notMatch) {
    return !evaluateFilter(item, notMatch[1], names, values)
  }

  // Handle attribute_exists
  const existsMatch = resolved.match(/^attribute_exists\s*\(\s*(\w+)\s*\)$/i)
  if (existsMatch) {
    return item[existsMatch[1]] !== undefined
  }

  // Handle attribute_not_exists
  const notExistsMatch = resolved.match(/^attribute_not_exists\s*\(\s*(\w+)\s*\)$/i)
  if (notExistsMatch) {
    return item[notExistsMatch[1]] === undefined
  }

  // Handle begins_with
  const beginsWithMatch = resolved.match(/^begins_with\s*\(\s*(\w+)\s*,\s*:(\w+)\s*\)$/i)
  if (beginsWithMatch) {
    const attrValue = item[beginsWithMatch[1]]
    const prefixValue = values?.[`:${beginsWithMatch[2]}`]
    if (attrValue?.S !== undefined && prefixValue?.S !== undefined) {
      return attrValue.S.startsWith(prefixValue.S)
    }
    return false
  }

  // Handle contains
  const containsMatch = resolved.match(/^contains\s*\(\s*(\w+)\s*,\s*:(\w+)\s*\)$/i)
  if (containsMatch) {
    const attrValue = item[containsMatch[1]]
    const searchValue = values?.[`:${containsMatch[2]}`]
    if (attrValue?.S && searchValue?.S) {
      return attrValue.S.includes(searchValue.S)
    }
    if (attrValue?.L && searchValue) {
      return attrValue.L.some((v) => attributeValuesEqual(v, searchValue))
    }
    if (attrValue?.SS && searchValue?.S) {
      return attrValue.SS.includes(searchValue.S)
    }
    return false
  }

  // Handle size
  const sizeMatch = resolved.match(/^size\s*\(\s*(\w+)\s*\)\s*(=|<>|<|>|<=|>=)\s*:(\w+)$/i)
  if (sizeMatch) {
    const attrValue = item[sizeMatch[1]]
    const op = sizeMatch[2]
    const compareValue = values?.[`:${sizeMatch[3]}`]
    let size = 0
    if (attrValue?.S) size = attrValue.S.length
    else if (attrValue?.B) size = attrValue.B.length
    else if (attrValue?.L) size = attrValue.L.length
    else if (attrValue?.M) size = Object.keys(attrValue.M).length
    else if (attrValue?.SS) size = attrValue.SS.length
    else if (attrValue?.NS) size = attrValue.NS.length
    else if (attrValue?.BS) size = attrValue.BS.length

    const compareNum = compareValue?.N ? Number(compareValue.N) : 0
    return evaluateComparison(size, op, compareNum)
  }

  // Handle IN
  const inMatch = resolved.match(/^(\w+)\s+IN\s*\(([^)]+)\)$/i)
  if (inMatch) {
    const attrValue = item[inMatch[1]]
    const valueList = inMatch[2].split(',').map((v) => v.trim())
    for (const v of valueList) {
      const val = values?.[v]
      if (val && attrValue && attributeValuesEqual(attrValue, val)) {
        return true
      }
    }
    return false
  }

  // Handle BETWEEN
  const betweenMatch = resolved.match(/^(\w+)\s+BETWEEN\s+:(\w+)\s+AND\s+:(\w+)$/i)
  if (betweenMatch) {
    const attrValue = item[betweenMatch[1]]
    const lowValue = values?.[`:${betweenMatch[2]}`]
    const highValue = values?.[`:${betweenMatch[3]}`]
    if (attrValue && lowValue && highValue) {
      const cmpLow = compareAttributeValues(attrValue, lowValue)
      const cmpHigh = compareAttributeValues(attrValue, highValue)
      return cmpLow >= 0 && cmpHigh <= 0
    }
    return false
  }

  // Handle comparison operators
  const comparisonMatch = resolved.match(/^(\w+)\s*(=|<>|<|>|<=|>=)\s*:(\w+)$/)
  if (comparisonMatch) {
    const attrValue = item[comparisonMatch[1]]
    const op = comparisonMatch[2]
    const compareValue = values?.[`:${comparisonMatch[3]}`]

    if (!attrValue || !compareValue) {
      return op === '<>' // undefined <> value is true
    }

    return evaluateAttributeComparison(attrValue, op, compareValue)
  }

  // Default: cannot evaluate
  return true
}

/**
 * Evaluate comparison
 */
function evaluateComparison(a: number, op: string, b: number): boolean {
  switch (op) {
    case '=':
      return a === b
    case '<>':
      return a !== b
    case '<':
      return a < b
    case '>':
      return a > b
    case '<=':
      return a <= b
    case '>=':
      return a >= b
    default:
      return false
  }
}

/**
 * Evaluate attribute comparison
 */
function evaluateAttributeComparison(
  a: AttributeValue,
  op: string,
  b: AttributeValue
): boolean {
  if (op === '=') {
    return attributeValuesEqual(a, b)
  }
  if (op === '<>') {
    return !attributeValuesEqual(a, b)
  }

  const cmp = compareAttributeValues(a, b)
  switch (op) {
    case '<':
      return cmp < 0
    case '>':
      return cmp > 0
    case '<=':
      return cmp <= 0
    case '>=':
      return cmp >= 0
    default:
      return false
  }
}

/**
 * Split SET assignments respecting parentheses in function calls
 */
function splitSetAssignments(expr: string): string[] {
  const assignments: string[] = []
  let current = ''
  let depth = 0

  for (let i = 0; i < expr.length; i++) {
    const char = expr[i]
    if (char === '(') {
      depth++
      current += char
    } else if (char === ')') {
      depth--
      current += char
    } else if (char === ',' && depth === 0) {
      assignments.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }

  if (current.trim()) {
    assignments.push(current.trim())
  }

  return assignments
}

/**
 * Evaluate if_not_exists function
 */
function evaluateIfNotExists(
  item: Item,
  attrPath: string,
  defaultValue: AttributeValue
): AttributeValue {
  const existing = getNestedValue(item, attrPath)
  return existing ?? defaultValue
}

/**
 * Evaluate a list_append argument (can be attribute path, value reference, or if_not_exists)
 */
function evaluateListAppendArg(
  arg: string,
  item: Item,
  values: Record<string, AttributeValue> | undefined
): AttributeValue | undefined {
  const trimmed = arg.trim()

  // Check for if_not_exists(attr, :value)
  const ifNotExistsMatch = trimmed.match(/^if_not_exists\s*\(\s*([\w.]+)\s*,\s*:(\w+)\s*\)$/i)
  if (ifNotExistsMatch) {
    const attrPath = ifNotExistsMatch[1]
    const defaultValue = values?.[`:${ifNotExistsMatch[2]}`]
    if (defaultValue) {
      return evaluateIfNotExists(item, attrPath, defaultValue)
    }
    return undefined
  }

  // Check for value reference (:value)
  if (trimmed.startsWith(':')) {
    return values?.[trimmed]
  }

  // Attribute path
  return getNestedValue(item, trimmed)
}

/**
 * Parse and apply update expression
 */
function applyUpdateExpression(
  item: Item,
  expr: string,
  names: Record<string, string> | undefined,
  values: Record<string, AttributeValue> | undefined
): Item {
  const resolved = resolveNames(expr, names)
  const result = { ...item }

  // Handle SET
  const setMatch = resolved.match(/SET\s+(.+?)(?=\s*(?:REMOVE|ADD|DELETE|$))/i)
  if (setMatch) {
    const assignments = splitSetAssignments(setMatch[1])
    for (const assignment of assignments) {
      // Simple assignment: attr = :value
      const simpleMatch = assignment.match(/^([\w.]+)\s*=\s*:(\w+)$/)
      if (simpleMatch) {
        const value = values?.[`:${simpleMatch[2]}`]
        if (value) {
          setNestedValue(result, simpleMatch[1], value)
        }
        continue
      }

      // if_not_exists: attr = if_not_exists(attr, :value)
      const ifNotExistsMatch = assignment.match(
        /^([\w.]+)\s*=\s*if_not_exists\s*\(\s*([\w.]+)\s*,\s*:(\w+)\s*\)$/i
      )
      if (ifNotExistsMatch) {
        const existingValue = getNestedValue(result, ifNotExistsMatch[2])
        if (!existingValue) {
          const value = values?.[`:${ifNotExistsMatch[3]}`]
          if (value) {
            setNestedValue(result, ifNotExistsMatch[1], value)
          }
        }
        continue
      }

      // list_append with nested if_not_exists:
      // attr = list_append(if_not_exists(attr, :empty), :value)
      const listAppendWithIfNotExistsMatch = assignment.match(
        /^([\w.]+)\s*=\s*list_append\s*\(\s*(if_not_exists\s*\([^)]+\)|[\w.:]+)\s*,\s*(if_not_exists\s*\([^)]+\)|[\w.:]+)\s*\)$/i
      )
      if (listAppendWithIfNotExistsMatch) {
        const targetPath = listAppendWithIfNotExistsMatch[1]
        const firstArg = listAppendWithIfNotExistsMatch[2]
        const secondArg = listAppendWithIfNotExistsMatch[3]

        const first = evaluateListAppendArg(firstArg, result, values)
        const second = evaluateListAppendArg(secondArg, result, values)

        const list1 = first?.L ?? []
        const list2 = second?.L ?? []
        setNestedValue(result, targetPath, { L: [...list1, ...list2] })
        continue
      }

      // if_not_exists with arithmetic: attr = if_not_exists(attr, :zero) + :inc
      const ifNotExistsArithmeticMatch = assignment.match(
        /^([\w.]+)\s*=\s*if_not_exists\s*\(\s*([\w.]+)\s*,\s*:(\w+)\s*\)\s*([+-])\s*:(\w+)$/i
      )
      if (ifNotExistsArithmeticMatch) {
        const targetPath = ifNotExistsArithmeticMatch[1]
        const checkPath = ifNotExistsArithmeticMatch[2]
        const defaultValueKey = `:${ifNotExistsArithmeticMatch[3]}`
        const operator = ifNotExistsArithmeticMatch[4]
        const operandKey = `:${ifNotExistsArithmeticMatch[5]}`

        const existingValue = getNestedValue(result, checkPath)
        const defaultValue = values?.[defaultValueKey]
        const operandValue = values?.[operandKey]

        // Use existing value if it exists, otherwise use default
        const baseValue = existingValue ?? defaultValue
        const base = baseValue?.N ? Number(baseValue.N) : 0
        const operand = operandValue?.N ? Number(operandValue.N) : 0

        const newValue = operator === '+' ? base + operand : base - operand
        setNestedValue(result, targetPath, { N: String(newValue) })
        continue
      }

      // Arithmetic: attr = attr + :value or attr = attr - :value
      const arithmeticMatch = assignment.match(
        /^([\w.]+)\s*=\s*([\w.]+)\s*([+-])\s*:(\w+)$/
      )
      if (arithmeticMatch) {
        const currentValue = getNestedValue(result, arithmeticMatch[2])
        const deltaValue = values?.[`:${arithmeticMatch[4]}`]
        const current = currentValue?.N ? Number(currentValue.N) : 0
        const delta = deltaValue?.N ? Number(deltaValue.N) : 0
        const newValue = arithmeticMatch[3] === '+' ? current + delta : current - delta
        setNestedValue(result, arithmeticMatch[1], { N: String(newValue) })
        continue
      }
    }
  }

  // Handle REMOVE
  const removeMatch = resolved.match(/REMOVE\s+(.+?)(?=\s*(?:SET|ADD|DELETE|$))/i)
  if (removeMatch) {
    const paths = removeMatch[1].split(',').map((p) => p.trim())
    for (const path of paths) {
      // Handle list index removal: attr[0]
      const indexMatch = path.match(/^([\w.]+)\[(\d+)\]$/)
      if (indexMatch) {
        const listValue = getNestedValue(result, indexMatch[1])
        if (listValue?.L) {
          const idx = parseInt(indexMatch[2], 10)
          const newList = [...listValue.L]
          newList.splice(idx, 1)
          setNestedValue(result, indexMatch[1], { L: newList })
        }
        continue
      }

      removeNestedValue(result, path)
    }
  }

  // Handle ADD
  const addMatch = resolved.match(/ADD\s+(.+?)(?=\s*(?:SET|REMOVE|DELETE|$))/i)
  if (addMatch) {
    const additions = addMatch[1].split(',').map((a) => a.trim())
    for (const addition of additions) {
      const match = addition.match(/^([\w.]+)\s+:(\w+)$/)
      if (match) {
        const currentValue = getNestedValue(result, match[1])
        const addValue = values?.[`:${match[2]}`]

        if (addValue?.N) {
          // Numeric add
          const current = currentValue?.N ? Number(currentValue.N) : 0
          const add = Number(addValue.N)
          setNestedValue(result, match[1], { N: String(current + add) })
        } else if (addValue?.SS) {
          // String set add
          const current = currentValue?.SS ?? []
          const newSet = new Set([...current, ...addValue.SS])
          setNestedValue(result, match[1], { SS: Array.from(newSet) })
        } else if (addValue?.NS) {
          // Number set add
          const current = currentValue?.NS ?? []
          const newSet = new Set([...current, ...addValue.NS])
          setNestedValue(result, match[1], { NS: Array.from(newSet) })
        }
      }
    }
  }

  // Handle DELETE
  const deleteMatch = resolved.match(/DELETE\s+(.+?)(?=\s*(?:SET|REMOVE|ADD|$))/i)
  if (deleteMatch) {
    const deletions = deleteMatch[1].split(',').map((d) => d.trim())
    for (const deletion of deletions) {
      const match = deletion.match(/^([\w.]+)\s+:(\w+)$/)
      if (match) {
        const currentValue = getNestedValue(result, match[1])
        const deleteValue = values?.[`:${match[2]}`]

        if (currentValue?.SS && deleteValue?.SS) {
          const deleteSet = new Set(deleteValue.SS)
          const newSet = currentValue.SS.filter((v) => !deleteSet.has(v))
          setNestedValue(result, match[1], { SS: newSet })
        } else if (currentValue?.NS && deleteValue?.NS) {
          const deleteSet = new Set(deleteValue.NS)
          const newSet = currentValue.NS.filter((v) => !deleteSet.has(v))
          setNestedValue(result, match[1], { NS: newSet })
        }
      }
    }
  }

  return result
}

/**
 * Apply projection expression
 */
function applyProjection(
  item: Item,
  expr: string,
  names: Record<string, string> | undefined
): Item {
  const resolved = resolveNames(expr, names)
  const paths = resolved.split(',').map((p) => p.trim())
  const result: Item = {}

  for (const path of paths) {
    const value = getNestedValue(item, path)
    if (value !== undefined) {
      setNestedValue(result, path, value)
    }
  }

  return result
}

// ============================================================================
// RESPONSE METADATA
// ============================================================================

function createMetadata(): ResponseMetadata {
  return {
    httpStatusCode: 200,
    requestId: crypto.randomUUID(),
    attempts: 1,
    totalRetryDelay: 0,
  }
}

// ============================================================================
// COMMAND HANDLERS
// ============================================================================

async function handleCreateTable(
  input: CreateTableCommandInput
): Promise<CreateTableCommandOutput> {
  if (globalTables.has(input.TableName)) {
    throw new ResourceInUseException(`Table ${input.TableName} already exists`)
  }

  const tableMeta: TableMeta = {
    name: input.TableName,
    keySchema: input.KeySchema,
    attributeDefinitions: input.AttributeDefinitions,
    status: 'ACTIVE',
    createdAt: new Date(),
    items: new Map(),
    gsi: (input.GlobalSecondaryIndexes ?? []).map((gsi) => ({
      IndexName: gsi.IndexName,
      KeySchema: gsi.KeySchema,
      Projection: gsi.Projection,
      IndexStatus: 'ACTIVE',
      ProvisionedThroughput: gsi.ProvisionedThroughput
        ? {
            ReadCapacityUnits: gsi.ProvisionedThroughput.ReadCapacityUnits,
            WriteCapacityUnits: gsi.ProvisionedThroughput.WriteCapacityUnits,
          }
        : undefined,
      IndexSizeBytes: 0,
      ItemCount: 0,
    })),
    lsi: (input.LocalSecondaryIndexes ?? []).map((lsi) => ({
      IndexName: lsi.IndexName,
      KeySchema: lsi.KeySchema,
      Projection: lsi.Projection,
      IndexSizeBytes: 0,
      ItemCount: 0,
    })),
  }

  globalTables.set(input.TableName, tableMeta)

  return {
    TableDescription: {
      TableName: input.TableName,
      TableStatus: 'ACTIVE',
      CreationDateTime: tableMeta.createdAt,
      KeySchema: input.KeySchema,
      AttributeDefinitions: input.AttributeDefinitions,
      ProvisionedThroughput: input.ProvisionedThroughput
        ? {
            ReadCapacityUnits: input.ProvisionedThroughput.ReadCapacityUnits,
            WriteCapacityUnits: input.ProvisionedThroughput.WriteCapacityUnits,
          }
        : undefined,
      TableSizeBytes: 0,
      ItemCount: 0,
      GlobalSecondaryIndexes: tableMeta.gsi,
      LocalSecondaryIndexes: tableMeta.lsi,
    },
    $metadata: createMetadata(),
  }
}

async function handleDeleteTable(
  input: DeleteTableCommandInput
): Promise<DeleteTableCommandOutput> {
  const table = globalTables.get(input.TableName)
  if (!table) {
    throw new ResourceNotFoundException(`Table ${input.TableName} not found`)
  }

  globalTables.delete(input.TableName)

  return {
    TableDescription: {
      TableName: input.TableName,
      TableStatus: 'DELETING',
    },
    $metadata: createMetadata(),
  }
}

async function handleDescribeTable(
  input: DescribeTableCommandInput
): Promise<DescribeTableCommandOutput> {
  const table = globalTables.get(input.TableName)
  if (!table) {
    throw new ResourceNotFoundException(`Table ${input.TableName} not found`)
  }

  return {
    Table: {
      TableName: table.name,
      TableStatus: table.status,
      CreationDateTime: table.createdAt,
      KeySchema: table.keySchema,
      AttributeDefinitions: table.attributeDefinitions,
      TableSizeBytes: JSON.stringify(Array.from(table.items.values())).length,
      ItemCount: table.items.size,
      GlobalSecondaryIndexes: table.gsi,
      LocalSecondaryIndexes: table.lsi,
    },
    $metadata: createMetadata(),
  }
}

async function handleListTables(
  input: ListTablesCommandInput
): Promise<ListTablesCommandOutput> {
  let tableNames = Array.from(globalTables.keys()).sort()

  if (input.ExclusiveStartTableName) {
    const idx = tableNames.indexOf(input.ExclusiveStartTableName)
    if (idx >= 0) {
      tableNames = tableNames.slice(idx + 1)
    }
  }

  const limit = input.Limit ?? 100
  const hasMore = tableNames.length > limit
  tableNames = tableNames.slice(0, limit)

  return {
    TableNames: tableNames,
    LastEvaluatedTableName: hasMore ? tableNames[tableNames.length - 1] : undefined,
    $metadata: createMetadata(),
  }
}

async function handlePutItem(
  input: PutItemCommandInput
): Promise<PutItemCommandOutput> {
  const table = globalTables.get(input.TableName)
  if (!table) {
    throw new ResourceNotFoundException(`Table ${input.TableName} not found`)
  }

  const key = extractKey(input.Item, table.keySchema)
  const keyStr = keyToString(key)
  const existingItem = table.items.get(keyStr)

  // Evaluate condition expression
  if (input.ConditionExpression) {
    const conditionMet = existingItem
      ? evaluateFilter(
          existingItem,
          input.ConditionExpression,
          input.ExpressionAttributeNames,
          input.ExpressionAttributeValues
        )
      : evaluateFilter(
          {},
          input.ConditionExpression,
          input.ExpressionAttributeNames,
          input.ExpressionAttributeValues
        )
    if (!conditionMet) {
      throw new ConditionalCheckFailedException(
        'The conditional request failed',
        existingItem
      )
    }
  }

  table.items.set(keyStr, { ...input.Item })

  return {
    Attributes:
      input.ReturnValues === 'ALL_OLD' && existingItem ? existingItem : undefined,
    $metadata: createMetadata(),
  }
}

async function handleGetItem(
  input: GetItemCommandInput
): Promise<GetItemCommandOutput> {
  const table = globalTables.get(input.TableName)
  if (!table) {
    throw new ResourceNotFoundException(`Table ${input.TableName} not found`)
  }

  const keyStr = keyToString(input.Key)
  let item = table.items.get(keyStr)

  if (item && input.ProjectionExpression) {
    item = applyProjection(item, input.ProjectionExpression, input.ExpressionAttributeNames)
  }

  return {
    Item: item,
    $metadata: createMetadata(),
  }
}

async function handleUpdateItem(
  input: UpdateItemCommandInput
): Promise<UpdateItemCommandOutput> {
  const table = globalTables.get(input.TableName)
  if (!table) {
    throw new ResourceNotFoundException(`Table ${input.TableName} not found`)
  }

  const keyStr = keyToString(input.Key)
  let item = table.items.get(keyStr)
  const existingItem = item ? { ...item } : undefined

  // Evaluate condition expression
  if (input.ConditionExpression) {
    const conditionMet = item
      ? evaluateFilter(
          item,
          input.ConditionExpression,
          input.ExpressionAttributeNames,
          input.ExpressionAttributeValues
        )
      : evaluateFilter(
          input.Key,
          input.ConditionExpression,
          input.ExpressionAttributeNames,
          input.ExpressionAttributeValues
        )
    if (!conditionMet) {
      throw new ConditionalCheckFailedException(
        'The conditional request failed',
        item
      )
    }
  }

  // Create item if it doesn't exist
  if (!item) {
    item = { ...input.Key }
  }

  // Apply update expression
  if (input.UpdateExpression) {
    item = applyUpdateExpression(
      item,
      input.UpdateExpression,
      input.ExpressionAttributeNames,
      input.ExpressionAttributeValues
    )
  }

  table.items.set(keyStr, item)

  let returnedAttrs: Item | undefined
  switch (input.ReturnValues) {
    case 'ALL_OLD':
      returnedAttrs = existingItem
      break
    case 'ALL_NEW':
      returnedAttrs = item
      break
    case 'UPDATED_OLD':
    case 'UPDATED_NEW':
      // Simplified: return full item
      returnedAttrs = input.ReturnValues === 'UPDATED_OLD' ? existingItem : item
      break
  }

  return {
    Attributes: returnedAttrs,
    $metadata: createMetadata(),
  }
}

async function handleDeleteItem(
  input: DeleteItemCommandInput
): Promise<DeleteItemCommandOutput> {
  const table = globalTables.get(input.TableName)
  if (!table) {
    throw new ResourceNotFoundException(`Table ${input.TableName} not found`)
  }

  const keyStr = keyToString(input.Key)
  const existingItem = table.items.get(keyStr)

  // Evaluate condition expression
  if (input.ConditionExpression && existingItem) {
    const conditionMet = evaluateFilter(
      existingItem,
      input.ConditionExpression,
      input.ExpressionAttributeNames,
      input.ExpressionAttributeValues
    )
    if (!conditionMet) {
      throw new ConditionalCheckFailedException(
        'The conditional request failed',
        existingItem
      )
    }
  }

  table.items.delete(keyStr)

  return {
    Attributes:
      input.ReturnValues === 'ALL_OLD' && existingItem ? existingItem : undefined,
    $metadata: createMetadata(),
  }
}

async function handleQuery(input: QueryCommandInput): Promise<QueryCommandOutput> {
  const table = globalTables.get(input.TableName)
  if (!table) {
    throw new ResourceNotFoundException(`Table ${input.TableName} not found`)
  }

  if (!input.KeyConditionExpression) {
    throw new ValidationException('KeyConditionExpression is required')
  }

  const keyCondition = parseKeyCondition(
    input.KeyConditionExpression,
    input.ExpressionAttributeNames,
    input.ExpressionAttributeValues
  )

  let keySchema = table.keySchema
  let items = Array.from(table.items.values())

  // Use index if specified
  if (input.IndexName) {
    const gsi = table.gsi.find((g) => g.IndexName === input.IndexName)
    const lsi = table.lsi.find((l) => l.IndexName === input.IndexName)
    if (!gsi && !lsi) {
      throw new ResourceNotFoundException(`Index ${input.IndexName} not found`)
    }
    keySchema = (gsi?.KeySchema ?? lsi?.KeySchema)!
  }

  // Filter by partition key
  items = items.filter((item) => {
    const pk = item[keyCondition.partitionKey]
    return pk && attributeValuesEqual(pk, keyCondition.partitionValue)
  })

  // Filter by sort key if present
  if (keyCondition.sortKey && keyCondition.sortOp) {
    items = items.filter((item) => {
      const sk = item[keyCondition.sortKey!]
      if (!sk) return false

      switch (keyCondition.sortOp) {
        case '=':
          return attributeValuesEqual(sk, keyCondition.sortValue!)
        case '<':
          return compareAttributeValues(sk, keyCondition.sortValue!) < 0
        case '>':
          return compareAttributeValues(sk, keyCondition.sortValue!) > 0
        case '<=':
          return compareAttributeValues(sk, keyCondition.sortValue!) <= 0
        case '>=':
          return compareAttributeValues(sk, keyCondition.sortValue!) >= 0
        case 'BETWEEN':
          const cmpLow = compareAttributeValues(sk, keyCondition.sortValue!)
          const cmpHigh = compareAttributeValues(sk, keyCondition.sortValue2!)
          return cmpLow >= 0 && cmpHigh <= 0
        case 'BEGINS_WITH':
          if (sk.S !== undefined && keyCondition.sortValue?.S !== undefined) {
            return sk.S.startsWith(keyCondition.sortValue.S)
          }
          return false
        default:
          return true
      }
    })
  }

  // Sort by sort key (before pagination)
  const sortKeyName = keySchema.find((k) => k.KeyType === 'RANGE')?.AttributeName
  const partitionKeyName = keySchema.find((k) => k.KeyType === 'HASH')?.AttributeName
  const direction = input.ScanIndexForward !== false ? 1 : -1

  if (sortKeyName) {
    items.sort((a, b) => {
      const aVal = a[sortKeyName]
      const bVal = b[sortKeyName]
      if (!aVal || !bVal) return 0
      return compareAttributeValues(aVal, bVal) * direction
    })
  }

  // Handle ExclusiveStartKey - skip items until past that key
  if (input.ExclusiveStartKey) {
    const startKey = input.ExclusiveStartKey
    let foundStartKey = false
    items = items.filter((item) => {
      if (foundStartKey) return true

      // Check if this item's key matches the start key
      let keysMatch = true
      if (partitionKeyName) {
        const itemPk = item[partitionKeyName]
        const startPk = startKey[partitionKeyName]
        if (!itemPk || !startPk || !attributeValuesEqual(itemPk, startPk)) {
          keysMatch = false
        }
      }
      if (keysMatch && sortKeyName) {
        const itemSk = item[sortKeyName]
        const startSk = startKey[sortKeyName]
        if (!itemSk || !startSk || !attributeValuesEqual(itemSk, startSk)) {
          keysMatch = false
        }
      }

      if (keysMatch) {
        foundStartKey = true
        return false // Skip the start key item itself
      }
      return false // Skip items before the start key
    })
  }

  let lastEvaluatedKey: Key | undefined

  // AWS DynamoDB: Limit is applied BEFORE FilterExpression
  // This means we scan up to Limit items, then filter, returning what matches
  if (input.Limit && items.length > input.Limit) {
    items = items.slice(0, input.Limit)
    // Set LastEvaluatedKey to the last item's key (before filtering)
    const lastItem = items[items.length - 1]
    lastEvaluatedKey = extractKey(lastItem, keySchema)
  }

  // ScannedCount is the number of items examined BEFORE FilterExpression
  const scannedCount = items.length

  // Apply filter expression AFTER Limit (AWS DynamoDB behavior)
  if (input.FilterExpression) {
    items = items.filter((item) =>
      evaluateFilter(
        item,
        input.FilterExpression!,
        input.ExpressionAttributeNames,
        input.ExpressionAttributeValues
      )
    )
  }

  // Apply projection (after extracting keys for pagination)
  if (input.ProjectionExpression) {
    items = items.map((item) =>
      applyProjection(item, input.ProjectionExpression!, input.ExpressionAttributeNames)
    )
  }

  // Handle SELECT COUNT
  if (input.Select === 'COUNT') {
    return {
      Count: items.length,
      ScannedCount: scannedCount,
      LastEvaluatedKey: lastEvaluatedKey,
      $metadata: createMetadata(),
    }
  }

  return {
    Items: items,
    Count: items.length,
    ScannedCount: scannedCount,
    LastEvaluatedKey: lastEvaluatedKey,
    $metadata: createMetadata(),
  }
}

async function handleScan(input: ScanCommandInput): Promise<ScanCommandOutput> {
  const table = globalTables.get(input.TableName)
  if (!table) {
    throw new ResourceNotFoundException(`Table ${input.TableName} not found`)
  }

  const keySchema = table.keySchema
  let items = Array.from(table.items.values())

  // Sort items by key for consistent pagination
  const partitionKeyName = keySchema.find((k) => k.KeyType === 'HASH')?.AttributeName
  const sortKeyName = keySchema.find((k) => k.KeyType === 'RANGE')?.AttributeName

  items.sort((a, b) => {
    if (partitionKeyName) {
      const aVal = a[partitionKeyName]
      const bVal = b[partitionKeyName]
      if (aVal && bVal) {
        const cmp = compareAttributeValues(aVal, bVal)
        if (cmp !== 0) return cmp
      }
    }
    if (sortKeyName) {
      const aVal = a[sortKeyName]
      const bVal = b[sortKeyName]
      if (aVal && bVal) {
        return compareAttributeValues(aVal, bVal)
      }
    }
    return 0
  })

  // Handle ExclusiveStartKey - skip items until past that key
  if (input.ExclusiveStartKey) {
    const startKey = input.ExclusiveStartKey
    let foundStartKey = false
    items = items.filter((item) => {
      if (foundStartKey) return true

      // Check if this item's key matches the start key
      let keysMatch = true
      if (partitionKeyName) {
        const itemPk = item[partitionKeyName]
        const startPk = startKey[partitionKeyName]
        if (!itemPk || !startPk || !attributeValuesEqual(itemPk, startPk)) {
          keysMatch = false
        }
      }
      if (keysMatch && sortKeyName) {
        const itemSk = item[sortKeyName]
        const startSk = startKey[sortKeyName]
        if (!itemSk || !startSk || !attributeValuesEqual(itemSk, startSk)) {
          keysMatch = false
        }
      }

      if (keysMatch) {
        foundStartKey = true
        return false // Skip the start key item itself
      }
      return false // Skip items before the start key
    })
  }

  let lastEvaluatedKey: Key | undefined

  // AWS DynamoDB: Limit is applied BEFORE FilterExpression
  // This means we scan up to Limit items, then filter, returning what matches
  if (input.Limit && items.length > input.Limit) {
    items = items.slice(0, input.Limit)
    // Set LastEvaluatedKey to the last item's key (before filtering)
    const lastItem = items[items.length - 1]
    lastEvaluatedKey = extractKey(lastItem, keySchema)
  }

  // ScannedCount is the number of items examined BEFORE FilterExpression
  const scannedCount = items.length

  // Apply filter expression AFTER Limit (AWS DynamoDB behavior)
  if (input.FilterExpression) {
    items = items.filter((item) =>
      evaluateFilter(
        item,
        input.FilterExpression!,
        input.ExpressionAttributeNames,
        input.ExpressionAttributeValues
      )
    )
  }

  // Apply projection (after extracting keys for pagination)
  if (input.ProjectionExpression) {
    items = items.map((item) =>
      applyProjection(item, input.ProjectionExpression!, input.ExpressionAttributeNames)
    )
  }

  // Handle SELECT COUNT
  if (input.Select === 'COUNT') {
    return {
      Count: items.length,
      ScannedCount: scannedCount,
      LastEvaluatedKey: lastEvaluatedKey,
      $metadata: createMetadata(),
    }
  }

  return {
    Items: items,
    Count: items.length,
    ScannedCount: scannedCount,
    LastEvaluatedKey: lastEvaluatedKey,
    $metadata: createMetadata(),
  }
}

async function handleBatchWriteItem(
  input: BatchWriteItemCommandInput
): Promise<BatchWriteItemCommandOutput> {
  const unprocessed: Record<string, typeof input.RequestItems[string]> = {}

  for (const [tableName, requests] of Object.entries(input.RequestItems)) {
    const table = globalTables.get(tableName)
    if (!table) {
      throw new ResourceNotFoundException(`Table ${tableName} not found`)
    }

    for (const request of requests) {
      if (request.PutRequest) {
        const key = extractKey(request.PutRequest.Item, table.keySchema)
        const keyStr = keyToString(key)
        table.items.set(keyStr, { ...request.PutRequest.Item })
      } else if (request.DeleteRequest) {
        const keyStr = keyToString(request.DeleteRequest.Key)
        table.items.delete(keyStr)
      }
    }
  }

  return {
    UnprocessedItems: Object.keys(unprocessed).length > 0 ? unprocessed : undefined,
    $metadata: createMetadata(),
  }
}

async function handleBatchGetItem(
  input: BatchGetItemCommandInput
): Promise<BatchGetItemCommandOutput> {
  const responses: Record<string, Item[]> = {}
  const unprocessed: Record<string, typeof input.RequestItems[string]> = {}

  for (const [tableName, keysAndAttrs] of Object.entries(input.RequestItems)) {
    const table = globalTables.get(tableName)
    if (!table) {
      throw new ResourceNotFoundException(`Table ${tableName} not found`)
    }

    responses[tableName] = []

    for (const key of keysAndAttrs.Keys) {
      const keyStr = keyToString(key)
      let item = table.items.get(keyStr)

      if (item) {
        if (keysAndAttrs.ProjectionExpression) {
          item = applyProjection(
            item,
            keysAndAttrs.ProjectionExpression,
            keysAndAttrs.ExpressionAttributeNames
          )
        }
        responses[tableName].push(item)
      }
    }
  }

  return {
    Responses: responses,
    UnprocessedKeys: Object.keys(unprocessed).length > 0 ? unprocessed : undefined,
    $metadata: createMetadata(),
  }
}

async function handleTransactGetItems(
  input: TransactGetItemsCommandInput
): Promise<TransactGetItemsCommandOutput> {
  const responses = input.TransactItems.map((ti) => {
    const table = globalTables.get(ti.Get.TableName)
    if (!table) {
      throw new ResourceNotFoundException(`Table ${ti.Get.TableName} not found`)
    }

    const keyStr = keyToString(ti.Get.Key)
    let item = table.items.get(keyStr)

    if (item && ti.Get.ProjectionExpression) {
      item = applyProjection(
        item,
        ti.Get.ProjectionExpression,
        ti.Get.ExpressionAttributeNames
      )
    }

    return { Item: item }
  })

  return {
    Responses: responses,
    $metadata: createMetadata(),
  }
}

async function handleTransactWriteItems(
  input: TransactWriteItemsCommandInput
): Promise<TransactWriteItemsCommandOutput> {
  // First, validate all condition checks
  for (const ti of input.TransactItems) {
    if (ti.ConditionCheck) {
      const table = globalTables.get(ti.ConditionCheck.TableName)
      if (!table) {
        throw new ResourceNotFoundException(
          `Table ${ti.ConditionCheck.TableName} not found`
        )
      }

      const keyStr = keyToString(ti.ConditionCheck.Key)
      const item = table.items.get(keyStr)

      const conditionMet = item
        ? evaluateFilter(
            item,
            ti.ConditionCheck.ConditionExpression,
            ti.ConditionCheck.ExpressionAttributeNames,
            ti.ConditionCheck.ExpressionAttributeValues
          )
        : false

      if (!conditionMet) {
        throw new TransactionCanceledException('Transaction cancelled', [
          { Code: 'ConditionalCheckFailed', Message: 'Condition check failed' },
        ])
      }
    }

    if (ti.Put?.ConditionExpression) {
      const table = globalTables.get(ti.Put.TableName)
      if (!table) {
        throw new ResourceNotFoundException(`Table ${ti.Put.TableName} not found`)
      }

      const key = extractKey(ti.Put.Item, table.keySchema)
      const keyStr = keyToString(key)
      const item = table.items.get(keyStr)

      const conditionMet = evaluateFilter(
        item ?? {},
        ti.Put.ConditionExpression,
        ti.Put.ExpressionAttributeNames,
        ti.Put.ExpressionAttributeValues
      )

      if (!conditionMet) {
        throw new TransactionCanceledException('Transaction cancelled', [
          { Code: 'ConditionalCheckFailed', Message: 'Condition check failed' },
        ])
      }
    }

    if (ti.Update?.ConditionExpression) {
      const table = globalTables.get(ti.Update.TableName)
      if (!table) {
        throw new ResourceNotFoundException(`Table ${ti.Update.TableName} not found`)
      }

      const keyStr = keyToString(ti.Update.Key)
      const item = table.items.get(keyStr)

      const conditionMet = evaluateFilter(
        item ?? ti.Update.Key,
        ti.Update.ConditionExpression,
        ti.Update.ExpressionAttributeNames,
        ti.Update.ExpressionAttributeValues
      )

      if (!conditionMet) {
        throw new TransactionCanceledException('Transaction cancelled', [
          { Code: 'ConditionalCheckFailed', Message: 'Condition check failed' },
        ])
      }
    }

    if (ti.Delete?.ConditionExpression) {
      const table = globalTables.get(ti.Delete.TableName)
      if (!table) {
        throw new ResourceNotFoundException(`Table ${ti.Delete.TableName} not found`)
      }

      const keyStr = keyToString(ti.Delete.Key)
      const item = table.items.get(keyStr)

      const conditionMet = item
        ? evaluateFilter(
            item,
            ti.Delete.ConditionExpression,
            ti.Delete.ExpressionAttributeNames,
            ti.Delete.ExpressionAttributeValues
          )
        : true

      if (!conditionMet) {
        throw new TransactionCanceledException('Transaction cancelled', [
          { Code: 'ConditionalCheckFailed', Message: 'Condition check failed' },
        ])
      }
    }
  }

  // Execute all writes
  for (const ti of input.TransactItems) {
    if (ti.Put) {
      const table = globalTables.get(ti.Put.TableName)!
      const key = extractKey(ti.Put.Item, table.keySchema)
      const keyStr = keyToString(key)
      table.items.set(keyStr, { ...ti.Put.Item })
    }

    if (ti.Update) {
      const table = globalTables.get(ti.Update.TableName)!
      const keyStr = keyToString(ti.Update.Key)
      let item = table.items.get(keyStr) ?? { ...ti.Update.Key }

      item = applyUpdateExpression(
        item,
        ti.Update.UpdateExpression,
        ti.Update.ExpressionAttributeNames,
        ti.Update.ExpressionAttributeValues
      )

      table.items.set(keyStr, item)
    }

    if (ti.Delete) {
      const table = globalTables.get(ti.Delete.TableName)!
      const keyStr = keyToString(ti.Delete.Key)
      table.items.delete(keyStr)
    }
  }

  return {
    $metadata: createMetadata(),
  }
}

// ============================================================================
// DYNAMODB CLIENT IMPLEMENTATION
// ============================================================================

class DynamoDBClientImpl implements IDynamoDBClient {
  readonly config: DynamoDBClientConfig

  constructor(config?: DynamoDBClientConfig | ExtendedDynamoDBClientConfig) {
    this.config = config ?? {}
  }

  async send<Input, Output>(command: Command<Input, Output>): Promise<Output> {
    if (command instanceof CreateTableCommand) {
      return handleCreateTable(command.input) as Promise<Output>
    }
    if (command instanceof DeleteTableCommand) {
      return handleDeleteTable(command.input) as Promise<Output>
    }
    if (command instanceof DescribeTableCommand) {
      return handleDescribeTable(command.input) as Promise<Output>
    }
    if (command instanceof ListTablesCommand) {
      return handleListTables(command.input) as Promise<Output>
    }
    if (command instanceof PutItemCommand) {
      return handlePutItem(command.input) as Promise<Output>
    }
    if (command instanceof GetItemCommand) {
      return handleGetItem(command.input) as Promise<Output>
    }
    if (command instanceof UpdateItemCommand) {
      return handleUpdateItem(command.input) as Promise<Output>
    }
    if (command instanceof DeleteItemCommand) {
      return handleDeleteItem(command.input) as Promise<Output>
    }
    if (command instanceof QueryCommand) {
      return handleQuery(command.input) as Promise<Output>
    }
    if (command instanceof ScanCommand) {
      return handleScan(command.input) as Promise<Output>
    }
    if (command instanceof BatchWriteItemCommand) {
      return handleBatchWriteItem(command.input) as Promise<Output>
    }
    if (command instanceof BatchGetItemCommand) {
      return handleBatchGetItem(command.input) as Promise<Output>
    }
    if (command instanceof TransactGetItemsCommand) {
      return handleTransactGetItems(command.input) as Promise<Output>
    }
    if (command instanceof TransactWriteItemsCommand) {
      return handleTransactWriteItems(command.input) as Promise<Output>
    }

    throw new Error(`Unknown command: ${command.constructor.name}`)
  }

  destroy(): void {
    // No-op for in-memory implementation
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new DynamoDB client
 */
export function createClient(
  config?: DynamoDBClientConfig | ExtendedDynamoDBClientConfig
): IDynamoDBClient {
  return new DynamoDBClientImpl(config)
}

/**
 * DynamoDB Client class (for direct instantiation)
 */
export class DynamoDBClient extends DynamoDBClientImpl {
  constructor(config?: DynamoDBClientConfig | ExtendedDynamoDBClientConfig) {
    super(config)
  }
}

/**
 * Clear all tables (for testing)
 */
export function clearAllTables(): void {
  globalTables.clear()
}

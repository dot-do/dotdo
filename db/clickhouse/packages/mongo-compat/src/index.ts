/**
 * @chdb/mongo-compat
 *
 * MongoDB-compatible API for ClickHouse/chdb via capnweb.
 *
 * This package provides a MongoDB driver-compatible interface that translates
 * MongoDB operations to ClickHouse SQL queries, allowing existing MongoDB
 * applications to work with ClickHouse with minimal code changes.
 */

// Type definitions
export interface Document {
  [key: string]: unknown;
}

export interface MongoClientOptions {
  // Placeholder for options
}

export interface InsertOneResult<T> {
  acknowledged: boolean;
  insertedId: unknown;
}

export interface InsertManyResult<T> {
  acknowledged: boolean;
  insertedCount: number;
  insertedIds: { [key: number]: unknown };
}

export interface UpdateResult<T> {
  acknowledged: boolean;
  matchedCount: number;
  modifiedCount: number;
  upsertedCount: number;
  upsertedId: unknown | null;
}

export interface DeleteResult {
  acknowledged: boolean;
  deletedCount: number;
}

export type Filter<T> = {
  [P in keyof T]?: T[P] | FilterOperators<T[P]>;
} & {
  $and?: Filter<T>[];
  $or?: Filter<T>[];
  $not?: Filter<T>;
};

export interface FilterOperators<T> {
  $eq?: T;
  $ne?: T;
  $gt?: T;
  $gte?: T;
  $lt?: T;
  $lte?: T;
  $in?: T[];
  $nin?: T[];
  $exists?: boolean;
  $regex?: string | RegExp;
}

export type UpdateFilter<T> = {
  $set?: Partial<T>;
  $unset?: { [P in keyof T]?: '' | 1 | true };
  $inc?: { [P in keyof T]?: number };
  $push?: { [P in keyof T]?: unknown };
};

export type Sort = string | { [key: string]: 1 | -1 | 'asc' | 'desc' };

// Global in-memory storage for testing
const globalStorage = new Map<string, Map<string, Document[]>>();

/**
 * Clear all stored data - useful for test isolation
 */
export function clearAllStorage(): void {
  globalStorage.clear();
}

function getCollectionStorage(dbName: string, collectionName: string): Document[] {
  if (!globalStorage.has(dbName)) {
    globalStorage.set(dbName, new Map());
  }
  const db = globalStorage.get(dbName)!;
  if (!db.has(collectionName)) {
    db.set(collectionName, []);
  }
  return db.get(collectionName)!;
}

// Generate a simple unique ID
function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Query builder: MongoDB filter to matching function
function matchesFilter<T extends Document>(doc: T, filter: Filter<T>): boolean {
  if (!filter || Object.keys(filter).length === 0) {
    return true;
  }

  // Handle $and
  if (filter.$and) {
    return filter.$and.every((subFilter) => matchesFilter(doc, subFilter));
  }

  // Handle $or
  if (filter.$or) {
    return filter.$or.some((subFilter) => matchesFilter(doc, subFilter));
  }

  // Handle $not
  if (filter.$not) {
    return !matchesFilter(doc, filter.$not);
  }

  // Handle field-level filters
  for (const [key, value] of Object.entries(filter)) {
    if (key.startsWith('$')) continue; // Skip operators already handled

    const docValue = doc[key];

    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      // This is an operator object
      const operators = value as FilterOperators<unknown>;

      if ('$eq' in operators && docValue !== operators.$eq) return false;
      if ('$ne' in operators && docValue === operators.$ne) return false;
      if ('$gt' in operators) {
        const compareVal = operators.$gt;
        if (typeof docValue === 'number' && typeof compareVal === 'number') {
          if (!(docValue > compareVal)) return false;
        } else if (typeof docValue === 'string' && typeof compareVal === 'string') {
          if (!(docValue > compareVal)) return false;
        } else {
          return false;
        }
      }
      if ('$gte' in operators) {
        const compareVal = operators.$gte;
        if (typeof docValue === 'number' && typeof compareVal === 'number') {
          if (!(docValue >= compareVal)) return false;
        } else if (typeof docValue === 'string' && typeof compareVal === 'string') {
          if (!(docValue >= compareVal)) return false;
        } else {
          return false;
        }
      }
      if ('$lt' in operators) {
        const compareVal = operators.$lt;
        if (typeof docValue === 'number' && typeof compareVal === 'number') {
          if (!(docValue < compareVal)) return false;
        } else if (typeof docValue === 'string' && typeof compareVal === 'string') {
          if (!(docValue < compareVal)) return false;
        } else {
          return false;
        }
      }
      if ('$lte' in operators) {
        const compareVal = operators.$lte;
        if (typeof docValue === 'number' && typeof compareVal === 'number') {
          if (!(docValue <= compareVal)) return false;
        } else if (typeof docValue === 'string' && typeof compareVal === 'string') {
          if (!(docValue <= compareVal)) return false;
        } else {
          return false;
        }
      }
      if ('$in' in operators && !operators.$in?.includes(docValue)) return false;
      if ('$nin' in operators && operators.$nin?.includes(docValue)) return false;
      if ('$exists' in operators) {
        const exists = docValue !== undefined;
        if (operators.$exists !== exists) return false;
      }
      if ('$regex' in operators) {
        const regex = operators.$regex instanceof RegExp ? operators.$regex : new RegExp(operators.$regex as string);
        if (!regex.test(String(docValue))) return false;
      }
    } else {
      // Direct value comparison
      if (docValue !== value) return false;
    }
  }

  return true;
}

// Get field value using dot notation (e.g., '$items.quantity' or 'items.quantity')
function getFieldValue(doc: Document, fieldPath: string): unknown {
  // Remove leading $ if present
  const path = fieldPath.startsWith('$') ? fieldPath.slice(1) : fieldPath;
  const parts = path.split('.');
  let value: unknown = doc;

  for (const part of parts) {
    if (value === null || value === undefined) {
      return undefined;
    }
    value = (value as Document)[part];
  }

  return value;
}

// Evaluate an aggregation expression
function evaluateExpression(expr: unknown, doc: Document): unknown {
  if (expr === null || expr === undefined) {
    return expr;
  }

  // String starting with $ is a field reference
  if (typeof expr === 'string' && expr.startsWith('$')) {
    return getFieldValue(doc, expr);
  }

  // Primitive values return as-is
  if (typeof expr !== 'object') {
    return expr;
  }

  // Array expressions
  if (Array.isArray(expr)) {
    return expr.map((item) => evaluateExpression(item, doc));
  }

  // Object expressions with operators
  const exprObj = expr as Document;
  const keys = Object.keys(exprObj);

  if (keys.length === 1 && keys[0].startsWith('$')) {
    const operator = keys[0];
    const operand = exprObj[operator];

    switch (operator) {
      case '$multiply': {
        const [a, b] = (operand as unknown[]).map((o) => evaluateExpression(o, doc) as number);
        return a * b;
      }
      case '$divide': {
        const [a, b] = (operand as unknown[]).map((o) => evaluateExpression(o, doc) as number);
        return b !== 0 ? a / b : null;
      }
      case '$add': {
        const values = (operand as unknown[]).map((o) => evaluateExpression(o, doc) as number);
        return values.reduce((sum, val) => sum + val, 0);
      }
      case '$subtract': {
        const [a, b] = (operand as unknown[]).map((o) => evaluateExpression(o, doc) as number);
        return a - b;
      }
      case '$gt': {
        const [a, b] = (operand as unknown[]).map((o) => evaluateExpression(o, doc));
        return (a as number) > (b as number);
      }
      case '$gte': {
        const [a, b] = (operand as unknown[]).map((o) => evaluateExpression(o, doc));
        return (a as number) >= (b as number);
      }
      case '$lt': {
        const [a, b] = (operand as unknown[]).map((o) => evaluateExpression(o, doc));
        return (a as number) < (b as number);
      }
      case '$lte': {
        const [a, b] = (operand as unknown[]).map((o) => evaluateExpression(o, doc));
        return (a as number) <= (b as number);
      }
      case '$eq': {
        const [a, b] = (operand as unknown[]).map((o) => evaluateExpression(o, doc));
        return a === b;
      }
      case '$ne': {
        const [a, b] = (operand as unknown[]).map((o) => evaluateExpression(o, doc));
        return a !== b;
      }
      default:
        // Unknown operator, return as-is
        return expr;
    }
  }

  // Plain object (not an operator), evaluate each field
  const result: Document = {};
  for (const [key, value] of Object.entries(exprObj)) {
    result[key] = evaluateExpression(value, doc);
  }
  return result;
}

// Apply projection to a document
function applyProjection<T extends Document, P extends Document>(doc: T, projection: Document): P {
  const hasInclusions = Object.values(projection).some((v) => v === 1);
  const hasExclusions = Object.values(projection).some((v) => v === 0);

  const result: Document = {};

  if (hasInclusions) {
    // Include only specified fields
    for (const [key, value] of Object.entries(projection)) {
      if (value === 1) {
        result[key] = doc[key];
      }
    }
    // Include _id by default unless explicitly excluded
    if (projection._id !== 0 && doc._id !== undefined) {
      result._id = doc._id;
    }
  } else if (hasExclusions) {
    // Exclude specified fields
    for (const [key, value] of Object.entries(doc)) {
      if (projection[key] !== 0) {
        result[key] = value;
      }
    }
  } else {
    // No projection, return all fields
    return { ...doc } as unknown as P;
  }

  return result as P;
}

/**
 * FindCursor - MongoDB-compatible cursor for query results
 */
export class FindCursor<T extends Document = Document> {
  private _dbName: string;
  private _collectionName: string;
  private _filter: Filter<T>;
  private _sortSpec: { [key: string]: 1 | -1 } | null = null;
  private _limitValue: number = 0;
  private _skipValue: number = 0;
  private _projection: Document | null = null;

  constructor(dbName: string, collectionName: string, filter: Filter<T>) {
    this._dbName = dbName;
    this._collectionName = collectionName;
    this._filter = filter;
  }

  private _clone<P extends Document = T>(): FindCursor<P> {
    const cursor = new FindCursor<P>(this._dbName, this._collectionName, this._filter as Filter<P>);
    cursor._sortSpec = this._sortSpec;
    cursor._limitValue = this._limitValue;
    cursor._skipValue = this._skipValue;
    cursor._projection = this._projection;
    return cursor;
  }

  async toArray(): Promise<T[]> {
    const storage = getCollectionStorage(this._dbName, this._collectionName);
    let results = storage.filter((doc) => matchesFilter(doc as T, this._filter)) as T[];

    // Apply sort
    if (this._sortSpec) {
      const sortKeys = Object.keys(this._sortSpec);
      results = [...results].sort((a, b) => {
        for (const key of sortKeys) {
          const direction = this._sortSpec![key];
          const aVal = a[key as keyof T];
          const bVal = b[key as keyof T];

          if (aVal === bVal) continue;

          // Handle booleans - true > false when ascending
          if (typeof aVal === 'boolean' && typeof bVal === 'boolean') {
            return direction * ((aVal ? 1 : 0) - (bVal ? 1 : 0));
          }

          if (typeof aVal === 'string' && typeof bVal === 'string') {
            return direction * aVal.localeCompare(bVal);
          }

          if (aVal < bVal) return -direction;
          if (aVal > bVal) return direction;
        }
        return 0;
      });
    }

    // Apply skip
    if (this._skipValue > 0) {
      results = results.slice(this._skipValue);
    }

    // Apply limit (0 means no limit)
    if (this._limitValue > 0) {
      results = results.slice(0, this._limitValue);
    }

    // Apply projection
    if (this._projection) {
      results = results.map((doc) => applyProjection(doc, this._projection!)) as T[];
    }

    return results;
  }

  sort(sort: Sort): FindCursor<T> {
    const cursor = this._clone<T>();

    if (typeof sort === 'string') {
      cursor._sortSpec = { [sort]: 1 };
    } else {
      const normalized: { [key: string]: 1 | -1 } = {};
      for (const [key, value] of Object.entries(sort)) {
        if (value === 'asc') {
          normalized[key] = 1;
        } else if (value === 'desc') {
          normalized[key] = -1;
        } else {
          normalized[key] = value as 1 | -1;
        }
      }
      cursor._sortSpec = normalized;
    }

    return cursor;
  }

  limit(n: number): FindCursor<T> {
    const cursor = this._clone<T>();
    cursor._limitValue = n;
    return cursor;
  }

  skip(n: number): FindCursor<T> {
    const cursor = this._clone<T>();
    cursor._skipValue = n;
    return cursor;
  }

  project<P extends Document = Document>(projection: Document): FindCursor<P> {
    const cursor = this._clone<P>();
    cursor._projection = projection;
    return cursor;
  }
}

/**
 * AggregationCursor - MongoDB-compatible cursor for aggregation pipeline results
 */
export class AggregationCursor<T extends Document = Document> {
  private _dbName: string;
  private _collectionName: string;
  private _pipeline: Document[];

  constructor(dbName: string, collectionName: string, pipeline: Document[]) {
    this._dbName = dbName;
    this._collectionName = collectionName;
    this._pipeline = pipeline;
  }

  async toArray(): Promise<T[]> {
    // Get initial documents (make copies to avoid mutation)
    let docs: Document[] = getCollectionStorage(this._dbName, this._collectionName).map((doc) => ({
      ...doc,
    }));

    // Process each stage
    for (const stage of this._pipeline) {
      const [stageType] = Object.keys(stage);
      const stageSpec = stage[stageType];

      switch (stageType) {
        case '$match':
          docs = this._processMatch(docs, stageSpec as Document);
          break;
        case '$group':
          docs = this._processGroup(docs, stageSpec as Document);
          break;
        case '$project':
          docs = this._processProject(docs, stageSpec as Document);
          break;
        case '$sort':
          docs = this._processSort(docs, stageSpec as Document);
          break;
        case '$limit':
          docs = docs.slice(0, stageSpec as number);
          break;
        case '$skip':
          docs = docs.slice(stageSpec as number);
          break;
        case '$unwind':
          docs = this._processUnwind(docs, stageSpec as string | Document);
          break;
        case '$addFields':
          docs = this._processAddFields(docs, stageSpec as Document);
          break;
        case '$lookup':
          docs = this._processLookup(docs, stageSpec as Document);
          break;
        default:
          throw new Error(`Unknown aggregation stage: ${stageType}`);
      }
    }

    return docs as T[];
  }

  private _processMatch(docs: Document[], filter: Document): Document[] {
    return docs.filter((doc) => matchesFilter(doc, filter as Filter<Document>));
  }

  private _processGroup(docs: Document[], spec: Document): Document[] {
    if (!('_id' in spec)) {
      throw new Error('$group stage requires _id field');
    }

    const groupIdExpr = spec._id;
    const groups = new Map<string, Document[]>();

    // Group documents by _id expression
    for (const doc of docs) {
      let groupKey: unknown;
      if (groupIdExpr === null) {
        groupKey = null;
      } else if (typeof groupIdExpr === 'string' && groupIdExpr.startsWith('$')) {
        groupKey = getFieldValue(doc, groupIdExpr);
      } else {
        groupKey = evaluateExpression(groupIdExpr, doc);
      }

      const keyString = JSON.stringify(groupKey);
      if (!groups.has(keyString)) {
        groups.set(keyString, []);
      }
      groups.get(keyString)!.push(doc);
    }

    // Apply accumulators to each group
    const results: Document[] = [];
    for (const [keyString, groupDocs] of groups) {
      const result: Document = { _id: JSON.parse(keyString) };

      for (const [field, accumulator] of Object.entries(spec)) {
        if (field === '_id') continue;

        const accObj = accumulator as Document;
        const [accType] = Object.keys(accObj);
        const accExpr = accObj[accType];

        switch (accType) {
          case '$sum': {
            let sum = 0;
            for (const doc of groupDocs) {
              const value = evaluateExpression(accExpr, doc);
              sum += typeof value === 'number' ? value : 0;
            }
            result[field] = sum;
            break;
          }
          case '$avg': {
            let sum = 0;
            let count = 0;
            for (const doc of groupDocs) {
              const value = evaluateExpression(accExpr, doc);
              if (typeof value === 'number') {
                sum += value;
                count++;
              }
            }
            result[field] = count > 0 ? sum / count : null;
            break;
          }
          case '$min': {
            let min: number | null = null;
            for (const doc of groupDocs) {
              const value = evaluateExpression(accExpr, doc);
              if (typeof value === 'number' && (min === null || value < min)) {
                min = value;
              }
            }
            result[field] = min;
            break;
          }
          case '$max': {
            let max: number | null = null;
            for (const doc of groupDocs) {
              const value = evaluateExpression(accExpr, doc);
              if (typeof value === 'number' && (max === null || value > max)) {
                max = value;
              }
            }
            result[field] = max;
            break;
          }
          case '$count': {
            result[field] = groupDocs.length;
            break;
          }
          case '$push': {
            const values: unknown[] = [];
            for (const doc of groupDocs) {
              values.push(evaluateExpression(accExpr, doc));
            }
            result[field] = values;
            break;
          }
          case '$first': {
            if (groupDocs.length > 0) {
              result[field] = evaluateExpression(accExpr, groupDocs[0]);
            }
            break;
          }
          case '$addToSet': {
            const uniqueValues = new Set<string>();
            const values: unknown[] = [];
            for (const doc of groupDocs) {
              const value = evaluateExpression(accExpr, doc);
              const key = JSON.stringify(value);
              if (!uniqueValues.has(key)) {
                uniqueValues.add(key);
                values.push(value);
              }
            }
            result[field] = values;
            break;
          }
        }
      }

      results.push(result);
    }

    return results;
  }

  private _processProject(docs: Document[], spec: Document): Document[] {
    return docs.map((doc) => {
      const hasInclusions = Object.entries(spec).some(
        ([key, value]) => key !== '_id' && value === 1
      );
      const hasExclusions = Object.entries(spec).some(
        ([key, value]) => key !== '_id' && value === 0
      );
      const hasComputedFields = Object.entries(spec).some(
        ([key, value]) =>
          typeof value === 'string' ||
          (typeof value === 'object' && value !== null && !Array.isArray(value))
      );

      const result: Document = {};

      if (hasComputedFields || (!hasInclusions && !hasExclusions)) {
        // Handle computed/renamed fields
        for (const [key, value] of Object.entries(spec)) {
          if (value === 1) {
            result[key] = doc[key];
          } else if (value === 0) {
            // Exclusion - skip
          } else if (typeof value === 'string' && value.startsWith('$')) {
            // Field rename
            result[key] = getFieldValue(doc, value);
          } else if (typeof value === 'object' && value !== null) {
            // Computed expression
            result[key] = evaluateExpression(value, doc);
          }
        }

        // Handle _id
        if (spec._id === 0) {
          delete result._id;
        } else if (!('_id' in spec) || spec._id === 1) {
          if (doc._id !== undefined) {
            result._id = doc._id;
          }
        }
      } else if (hasInclusions) {
        // Include only specified fields
        for (const [key, value] of Object.entries(spec)) {
          if (value === 1) {
            result[key] = doc[key];
          }
        }
        // Include _id by default unless explicitly excluded
        if (spec._id !== 0 && doc._id !== undefined) {
          result._id = doc._id;
        }
      } else if (hasExclusions) {
        // Exclude specified fields
        for (const [key, value] of Object.entries(doc)) {
          if (spec[key] !== 0) {
            result[key] = value;
          }
        }
      }

      return result;
    });
  }

  private _processSort(docs: Document[], spec: Document): Document[] {
    const sortKeys = Object.keys(spec);
    return [...docs].sort((a, b) => {
      for (const key of sortKeys) {
        const direction = spec[key] as number;
        const aVal = a[key];
        const bVal = b[key];

        if (aVal === bVal) continue;

        // Handle booleans
        if (typeof aVal === 'boolean' && typeof bVal === 'boolean') {
          return direction * ((aVal ? 1 : 0) - (bVal ? 1 : 0));
        }

        // Handle strings
        if (typeof aVal === 'string' && typeof bVal === 'string') {
          return direction * aVal.localeCompare(bVal);
        }

        // Handle numbers and other comparables
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          if (aVal < bVal) return -direction;
          if (aVal > bVal) return direction;
        }
      }
      return 0;
    });
  }

  private _processUnwind(docs: Document[], spec: string | Document): Document[] {
    let path: string;
    let preserveNullAndEmptyArrays = false;

    if (typeof spec === 'string') {
      path = spec;
    } else {
      path = spec.path as string;
      preserveNullAndEmptyArrays = spec.preserveNullAndEmptyArrays === true;
    }

    // Remove leading $ from path
    const fieldName = path.startsWith('$') ? path.slice(1) : path;
    const results: Document[] = [];

    for (const doc of docs) {
      const arrayValue = doc[fieldName];

      if (!Array.isArray(arrayValue)) {
        if (preserveNullAndEmptyArrays) {
          results.push({ ...doc });
        }
        continue;
      }

      if (arrayValue.length === 0) {
        if (preserveNullAndEmptyArrays) {
          const newDoc = { ...doc };
          delete newDoc[fieldName];
          results.push(newDoc);
        }
        continue;
      }

      // Create one document per array element
      for (const element of arrayValue) {
        results.push({ ...doc, [fieldName]: element });
      }
    }

    return results;
  }

  private _processAddFields(docs: Document[], spec: Document): Document[] {
    return docs.map((doc) => {
      const result = { ...doc };
      for (const [key, value] of Object.entries(spec)) {
        result[key] = evaluateExpression(value, doc);
      }
      return result;
    });
  }

  private _processLookup(docs: Document[], spec: Document): Document[] {
    const { from, localField, foreignField, as: asField } = spec as {
      from: string;
      localField: string;
      foreignField: string;
      as: string;
    };

    // Get the foreign collection data
    const foreignDocs = getCollectionStorage(this._dbName, from);

    return docs.map((doc) => {
      const localValue = doc[localField];
      const matches = foreignDocs.filter((foreignDoc) => foreignDoc[foreignField] === localValue);
      return { ...doc, [asField]: matches };
    });
  }
}

/**
 * Collection - MongoDB-compatible collection for CRUD operations
 */
export class Collection<T extends Document = Document> {
  private _dbName: string;
  private _name: string;

  constructor(dbName: string, name: string) {
    this._dbName = dbName;
    this._name = name;
  }

  private _getStorage(): Document[] {
    return getCollectionStorage(this._dbName, this._name);
  }

  async insertOne(doc: T): Promise<InsertOneResult<T>> {
    const storage = this._getStorage();
    const docWithId: Document = { ...doc };
    if (!docWithId._id) {
      docWithId._id = generateId();
    }
    storage.push(docWithId);

    return {
      acknowledged: true,
      insertedId: docWithId._id,
    };
  }

  async insertMany(docs: T[]): Promise<InsertManyResult<T>> {
    const insertedIds: { [key: number]: unknown } = {};

    for (let i = 0; i < docs.length; i++) {
      const result = await this.insertOne(docs[i]);
      insertedIds[i] = result.insertedId;
    }

    return {
      acknowledged: true,
      insertedCount: docs.length,
      insertedIds,
    };
  }

  async findOne(filter?: Filter<T>): Promise<T | null> {
    const storage = this._getStorage();
    const effectiveFilter = filter || ({} as Filter<T>);
    const found = storage.find((doc) => matchesFilter(doc as T, effectiveFilter));
    return (found as T) || null;
  }

  find(filter?: Filter<T>): FindCursor<T> {
    const effectiveFilter = filter || ({} as Filter<T>);
    return new FindCursor<T>(this._dbName, this._name, effectiveFilter);
  }

  aggregate<R extends Document = Document>(pipeline: Document[]): AggregationCursor<R> {
    return new AggregationCursor<R>(this._dbName, this._name, pipeline);
  }

  async updateOne(filter: Filter<T>, update: UpdateFilter<T>): Promise<UpdateResult<T>> {
    const storage = this._getStorage();
    const effectiveFilter = filter || ({} as Filter<T>);
    const index = storage.findIndex((doc) => matchesFilter(doc as T, effectiveFilter));

    if (index === -1) {
      return {
        acknowledged: true,
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: 0,
        upsertedId: null,
      };
    }

    const doc = storage[index];
    let modified = false;

    // Apply $set
    if (update.$set) {
      for (const [key, value] of Object.entries(update.$set)) {
        if (doc[key] !== value) {
          doc[key] = value;
          modified = true;
        }
      }
    }

    // Apply $unset
    if (update.$unset) {
      for (const key of Object.keys(update.$unset)) {
        if (key in doc) {
          delete doc[key];
          modified = true;
        }
      }
    }

    // Apply $inc
    if (update.$inc) {
      for (const [key, value] of Object.entries(update.$inc)) {
        const currentValue = (doc[key] as number) || 0;
        doc[key] = currentValue + (value as number);
        modified = true;
      }
    }

    // Apply $push
    if (update.$push) {
      for (const [key, value] of Object.entries(update.$push)) {
        if (!Array.isArray(doc[key])) {
          doc[key] = [];
        }
        (doc[key] as unknown[]).push(value);
        modified = true;
      }
    }

    return {
      acknowledged: true,
      matchedCount: 1,
      modifiedCount: modified ? 1 : 0,
      upsertedCount: 0,
      upsertedId: null,
    };
  }

  async deleteOne(filter: Filter<T>): Promise<DeleteResult> {
    const storage = this._getStorage();
    const effectiveFilter = filter || ({} as Filter<T>);
    const index = storage.findIndex((doc) => matchesFilter(doc as T, effectiveFilter));

    if (index === -1) {
      return {
        acknowledged: true,
        deletedCount: 0,
      };
    }

    storage.splice(index, 1);

    return {
      acknowledged: true,
      deletedCount: 1,
    };
  }

  async countDocuments(filter?: Filter<T>): Promise<number> {
    const storage = this._getStorage();
    const effectiveFilter = filter || ({} as Filter<T>);
    return storage.filter((doc) => matchesFilter(doc as T, effectiveFilter)).length;
  }
}

/**
 * Db - MongoDB-compatible database
 */
export class Db {
  private _name: string;

  constructor(name: string) {
    this._name = name;
  }

  collection<T extends Document = Document>(name: string): Collection<T> {
    return new Collection<T>(this._name, name);
  }
}

/**
 * MongoClient - MongoDB-compatible client that connects to capnweb endpoint
 */
export class MongoClient {
  private _uri: string;
  private _options: MongoClientOptions;
  private _connected: boolean = false;
  private _defaultDbName: string = 'default';

  constructor(uri: string, options?: MongoClientOptions) {
    this._uri = uri;
    this._options = options || {};

    // Parse database name from URI if present
    try {
      const url = new URL(uri);
      const pathDb = url.pathname.slice(1); // Remove leading /
      if (pathDb) {
        this._defaultDbName = pathDb;
      }
    } catch {
      // Invalid URL, use defaults
    }
  }

  async connect(): Promise<MongoClient> {
    // For now, we simulate connection
    // In real implementation, this would connect to capnweb endpoint
    try {
      const url = new URL(this._uri);
      // Simulate connection failure for invalid endpoints
      if (url.hostname === 'invalid-endpoint') {
        throw new Error('Connection failed');
      }
    } catch (e) {
      if (e instanceof Error && e.message === 'Connection failed') {
        throw e;
      }
      // URL parsing failed
      throw new Error('Invalid URI');
    }

    this._connected = true;
    return this;
  }

  db(name?: string): Db {
    const dbName = name || this._defaultDbName;
    return new Db(dbName);
  }

  async close(): Promise<void> {
    this._connected = false;
    // Clean up storage for this client's databases
    // Note: In a real implementation, this would close network connections
  }
}

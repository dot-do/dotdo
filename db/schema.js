// Schema validation layer for @dotdo/db
// Lightweight Zod-like patterns for entity type safety
// See do-qz6x
// ============================================================================
// Format Validators
// ============================================================================
const FORMAT_VALIDATORS = {
    email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
    url: (v) => {
        try {
            new URL(v);
            return true;
        }
        catch {
            return false;
        }
    },
    uuid: (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v),
    date: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)),
    datetime: (v) => !isNaN(Date.parse(v)),
    phone: (v) => /^\+?[\d\s-()]{7,}$/.test(v)
};
// ============================================================================
// Field Validation
// ============================================================================
/**
 * Validate a single field value against its definition
 */
function validateField(fieldName, value, def) {
    const errors = [];
    // Handle null/undefined
    if (value === null || value === undefined) {
        if (def.required) {
            errors.push({
                field: fieldName,
                message: `Field is required`,
                value: value
            });
        }
        return errors;
    }
    // Type validation
    switch (def.type) {
        case 'string':
            if (typeof value !== 'string') {
                errors.push({
                    field: fieldName,
                    message: `Expected string, got ${typeof value}`,
                    value: value
                });
                return errors;
            }
            // String-specific validations
            if (def.minLength !== undefined && value.length < def.minLength) {
                errors.push({
                    field: fieldName,
                    message: `String must be at least ${def.minLength} characters`,
                    value
                });
            }
            if (def.maxLength !== undefined && value.length > def.maxLength) {
                errors.push({
                    field: fieldName,
                    message: `String must be at most ${def.maxLength} characters`,
                    value
                });
            }
            if (def.pattern !== undefined) {
                const regex = new RegExp(def.pattern);
                if (!regex.test(value)) {
                    errors.push({
                        field: fieldName,
                        message: `String does not match pattern ${def.pattern}`,
                        value
                    });
                }
            }
            if (def.format !== undefined) {
                const validator = FORMAT_VALIDATORS[def.format];
                if (validator && !validator(value)) {
                    errors.push({
                        field: fieldName,
                        message: `Invalid ${def.format} format`,
                        value
                    });
                }
            }
            if (def.enum !== undefined && !def.enum.includes(value)) {
                errors.push({
                    field: fieldName,
                    message: `Value must be one of: ${def.enum.join(', ')}`,
                    value
                });
            }
            break;
        case 'number':
            if (typeof value !== 'number' || isNaN(value)) {
                errors.push({
                    field: fieldName,
                    message: `Expected number, got ${typeof value}`,
                    value: value
                });
                return errors;
            }
            // Number-specific validations
            if (def.min !== undefined && value < def.min) {
                errors.push({
                    field: fieldName,
                    message: `Number must be at least ${def.min}`,
                    value
                });
            }
            if (def.max !== undefined && value > def.max) {
                errors.push({
                    field: fieldName,
                    message: `Number must be at most ${def.max}`,
                    value
                });
            }
            if (def.integer && !Number.isInteger(value)) {
                errors.push({
                    field: fieldName,
                    message: `Number must be an integer`,
                    value
                });
            }
            break;
        case 'boolean':
            if (typeof value !== 'boolean') {
                errors.push({
                    field: fieldName,
                    message: `Expected boolean, got ${typeof value}`,
                    value: value
                });
            }
            break;
        case 'array':
            if (!Array.isArray(value)) {
                errors.push({
                    field: fieldName,
                    message: `Expected array, got ${typeof value}`,
                    value: value
                });
                return errors;
            }
            // Array-specific validations
            if (def.minItems !== undefined && value.length < def.minItems) {
                errors.push({
                    field: fieldName,
                    message: `Array must have at least ${def.minItems} items`,
                    value: value
                });
            }
            if (def.maxItems !== undefined && value.length > def.maxItems) {
                errors.push({
                    field: fieldName,
                    message: `Array must have at most ${def.maxItems} items`,
                    value: value
                });
            }
            // Validate items if schema is defined
            if (def.items) {
                for (let i = 0; i < value.length; i++) {
                    const itemErrors = validateField(`${fieldName}[${i}]`, value[i], def.items);
                    errors.push(...itemErrors);
                }
            }
            break;
        case 'object':
            if (typeof value !== 'object' || value === null || Array.isArray(value)) {
                errors.push({
                    field: fieldName,
                    message: `Expected object, got ${Array.isArray(value) ? 'array' : typeof value}`,
                    value: value
                });
                return errors;
            }
            // Validate nested properties if defined
            if (def.properties) {
                for (const [propName, propDef] of Object.entries(def.properties)) {
                    const propErrors = validateField(`${fieldName}.${propName}`, value[propName], propDef);
                    errors.push(...propErrors);
                }
            }
            break;
    }
    return errors;
}
// ============================================================================
// Schema Factory
// ============================================================================
/**
 * Define a schema for an entity type
 *
 * @example
 * ```typescript
 * const CustomerSchema = defineSchema({
 *   $type: 'Customer',
 *   fields: {
 *     name: { type: 'string', required: true },
 *     email: { type: 'string', format: 'email' },
 *     age: { type: 'number', min: 0 }
 *   }
 * })
 *
 * // Type inference
 * type Customer = InferSchema<typeof CustomerSchema>
 * // { name: string; email?: string; age?: number }
 * ```
 */
export function defineSchema(def) {
    const { $type, fields, strict = false } = def;
    return {
        $type,
        fields,
        strict,
        validate(data) {
            const errors = [];
            // Validate each defined field
            for (const [fieldName, fieldDef] of Object.entries(fields)) {
                const fieldErrors = validateField(fieldName, data[fieldName], fieldDef);
                errors.push(...fieldErrors);
            }
            // Check for unknown fields in strict mode
            if (strict) {
                for (const key of Object.keys(data)) {
                    // Skip system fields
                    if (key.startsWith('$'))
                        continue;
                    if (!(key in fields)) {
                        errors.push({
                            field: key,
                            message: `Unknown field (strict mode)`,
                            value: data[key]
                        });
                    }
                }
            }
            return {
                valid: errors.length === 0,
                errors
            };
        },
        parse(data) {
            const result = this.validate(data);
            if (!result.valid) {
                const messages = result.errors.map(e => `${e.field}: ${e.message}`).join('; ');
                throw new SchemaValidationError(`Validation failed: ${messages}`, result.errors);
            }
            return data;
        },
        safeParse(data) {
            const result = this.validate(data);
            if (result.valid) {
                return { success: true, data: data };
            }
            return { success: false, errors: result.errors };
        }
    };
}
// ============================================================================
// Error Classes
// ============================================================================
/**
 * Error thrown when schema validation fails
 */
export class SchemaValidationError extends Error {
    errors;
    constructor(message, errors) {
        super(message);
        this.errors = errors;
        this.name = 'SchemaValidationError';
    }
}
// ============================================================================
// Schema Registry
// ============================================================================
/**
 * Registry for managing multiple schemas
 */
export class SchemaRegistry {
    schemas = new Map();
    /**
     * Register a schema for a type
     */
    register(schema) {
        this.schemas.set(schema.$type, schema);
    }
    /**
     * Get a schema by type name
     */
    get(type) {
        return this.schemas.get(type);
    }
    /**
     * Check if a schema exists for a type
     */
    has(type) {
        return this.schemas.has(type);
    }
    /**
     * Remove a schema
     */
    unregister(type) {
        return this.schemas.delete(type);
    }
    /**
     * Get all registered type names
     */
    types() {
        return Array.from(this.schemas.keys());
    }
    /**
     * Validate data against its registered schema
     * Returns undefined if no schema is registered for the type
     */
    validate(data) {
        const schema = this.schemas.get(data.$type);
        if (!schema)
            return undefined;
        return schema.validate(data);
    }
    /**
     * Clear all registered schemas
     */
    clear() {
        this.schemas.clear();
    }
}
/**
 * Create a new schema registry
 */
export function createSchemaRegistry() {
    return new SchemaRegistry();
}
/**
 * Wrap a ThingsStore with schema validation
 * Validates data on create and update operations
 */
export function createValidatedStore(store, registry, options = {}) {
    const { allowUnregistered = true } = options;
    function validateOrThrow(type, data) {
        const schema = registry.get(type);
        if (!schema) {
            if (!allowUnregistered) {
                throw new Error(`No schema registered for type: ${type}`);
            }
            return; // Skip validation for unregistered types
        }
        const result = schema.validate(data);
        if (!result.valid) {
            const messages = result.errors.map(e => `${e.field}: ${e.message}`).join('; ');
            throw new SchemaValidationError(`Validation failed for ${type}: ${messages}`, result.errors);
        }
    }
    return {
        async create(data) {
            validateOrThrow(data.$type, data);
            return store.create(data);
        },
        async get(id) {
            return store.get(id);
        },
        async update(id, data) {
            // Get existing thing to know its type and merge data for validation
            const existing = await store.get(id);
            if (!existing) {
                throw new Error(`Thing not found: ${id}`);
            }
            // Merge existing data with updates for validation
            const merged = { ...existing, ...data };
            validateOrThrow(existing.$type, merged);
            return store.update(id, data);
        },
        async delete(id) {
            return store.delete(id);
        },
        async list(options) {
            return store.list(options);
        },
        async bulkCreate(items) {
            // Validate all items before creating any
            for (const data of items) {
                validateOrThrow(data.$type, data);
            }
            return store.bulkCreate(items);
        },
        async bulkUpdate(items) {
            // Get all existing things first
            const existingThings = await Promise.all(items.map(async ({ id }) => {
                const thing = await store.get(id);
                if (!thing) {
                    throw new Error(`Thing not found: ${id}`);
                }
                return thing;
            }));
            // Validate all updates
            for (let i = 0; i < items.length; i++) {
                const existing = existingThings[i];
                const item = items[i];
                const merged = { ...existing, ...item.data };
                validateOrThrow(existing.$type, merged);
            }
            return store.bulkUpdate(items);
        },
        async bulkDelete(ids) {
            return store.bulkDelete(ids);
        }
    };
}
//# sourceMappingURL=schema.js.map
// RPC Input Validation - validates method arguments against schemas
// Provides type-safe validation for RPC method parameters
import { ValidationError } from './errors';
/**
 * Localhost patterns that are always allowed with HTTP
 */
const LOCALHOST_PATTERNS = [
    'localhost',
    '127.0.0.1',
    '[::1]',
];
/**
 * Validates an RPC endpoint URL.
 *
 * A valid RPC URL:
 * - Must be a string
 * - Must be a valid URL format
 * - Must use http: or https: protocol
 * - In strict mode, must use https: unless connecting to localhost
 * - Must not contain path traversal sequences
 *
 * @param url - The URL to validate
 * @param options - Validation options
 * @returns True if the URL is valid for RPC communication
 *
 * @example
 * ```typescript
 * isValidRPCUrl('https://api.example.com')           // true
 * isValidRPCUrl('http://api.example.com')            // true (default)
 * isValidRPCUrl('http://api.example.com', { strict: true }) // false
 * isValidRPCUrl('http://localhost:8787', { strict: true })  // true (localhost allowed)
 * isValidRPCUrl('ftp://example.com')                 // false
 * ```
 */
export function isValidRPCUrl(url, options = {}) {
    // Must be a non-empty string
    if (typeof url !== 'string' || url.length === 0) {
        return false;
    }
    let parsedUrl;
    try {
        parsedUrl = new URL(url);
    }
    catch {
        return false;
    }
    // Only allow http: and https: protocols
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return false;
    }
    // Check for path traversal attempts
    // Check the original URL string before parsing, as URL normalization may remove '..'
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes('..') ||
        lowerUrl.includes('%2e%2e') ||
        lowerUrl.includes('%2e.') ||
        lowerUrl.includes('.%2e')) {
        return false;
    }
    // In strict mode, require HTTPS unless connecting to localhost
    if (options.strict && parsedUrl.protocol === 'http:') {
        const hostname = parsedUrl.hostname;
        // Check if it's a localhost pattern
        const isLocalhost = LOCALHOST_PATTERNS.some(pattern => hostname === pattern || hostname.startsWith(`${pattern}:`));
        // Check if it's in the allowed hosts list
        const allowedHosts = options.allowedHosts ?? [];
        const isAllowedHost = allowedHosts.includes(hostname);
        if (!isLocalhost && !isAllowedHost) {
            return false;
        }
    }
    return true;
}
// ============================================================================
// Circular Reference Detection
// ============================================================================
/**
 * Checks for circular references in an object graph.
 * Throws an error if a circular reference is detected.
 *
 * This is important for RPC args validation because circular references
 * will cause JSON.stringify to throw an error.
 *
 * @param value - The value to check for circular references
 * @throws Error with 'circular' in the message if a circular reference is found
 *
 * @example
 * ```typescript
 * const obj = { a: 1 }
 * checkCircularReferences(obj) // OK
 *
 * const circular = { a: 1 }
 * circular.self = circular
 * checkCircularReferences(circular) // throws "Detected circular reference"
 * ```
 */
export function checkCircularReferences(value) {
    const seen = new Set();
    function check(current) {
        // Primitives cannot have circular references
        if (current === null || typeof current !== 'object') {
            return;
        }
        // If we've seen this object before, it's a circular reference
        if (seen.has(current)) {
            throw new Error('Detected circular reference in RPC arguments');
        }
        // Mark as seen and recurse into children
        seen.add(current);
        if (Array.isArray(current)) {
            for (const item of current) {
                check(item);
            }
        }
        else {
            for (const key in current) {
                if (Object.prototype.hasOwnProperty.call(current, key)) {
                    check(current[key]);
                }
            }
        }
        // Note: We do NOT remove from 'seen' after recursion
        // This ensures we detect multiple references to the same object,
        // which while not strictly circular, still breaks JSON.stringify
    }
    check(value);
}
// ============================================================================
// RPC Message Validation
// ============================================================================
/**
 * Validates a complete RPC message before sending.
 *
 * Performs the following validations:
 * 1. Method name is valid (no path traversal, injection, etc.)
 * 2. Args array doesn't contain circular references
 *
 * @param message - The RPC message to validate
 * @throws ValidationError if the message is invalid
 *
 * @example
 * ```typescript
 * validateRPCMessage({ method: 'users.create', args: [{ name: 'Alice' }] }) // OK
 * validateRPCMessage({ method: '../etc/passwd', args: [] }) // throws
 * ```
 */
export function validateRPCMessage(message) {
    // Validate method name
    if (!isValidRPCMethod(message.method)) {
        throw ValidationError.forField('method', 'must start with a letter and contain only alphanumeric characters and dots', message.method);
    }
    // Validate args don't have circular references
    for (let i = 0; i < message.args.length; i++) {
        try {
            checkCircularReferences(message.args[i]);
        }
        catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            // Rethrow with 'circular' in the message for consistent error handling
            throw new Error(`Detected circular reference at args[${i}]: ${errorMessage}`);
        }
    }
}
// ============================================================================
// RPC Method Validation
// ============================================================================
/**
 * Type guard that validates an RPC method name.
 *
 * A valid RPC method name:
 * - Must be a string
 * - Must be non-empty
 * - Must start with a letter (a-z, A-Z)
 * - Can only contain alphanumeric characters and dots (for namespacing)
 * - Must not start with underscore (private method convention)
 *
 * @param method - The value to check
 * @returns True if method is a valid RPC method name string
 *
 * @example
 * ```typescript
 * isValidRPCMethod('users.create')  // true
 * isValidRPCMethod('getProfile')    // true
 * isValidRPCMethod('v2.api.list')   // true
 *
 * isValidRPCMethod('')              // false - empty
 * isValidRPCMethod('_private')      // false - starts with underscore
 * isValidRPCMethod('123method')     // false - starts with number
 * isValidRPCMethod('has space')     // false - contains space
 * isValidRPCMethod(null)            // false - not a string
 * ```
 */
export function isValidRPCMethod(method) {
    return typeof method === 'string' &&
        method.length > 0 &&
        !method.startsWith('_') &&
        /^[a-zA-Z][a-zA-Z0-9.]*$/.test(method);
}
/**
 * Get the runtime type of a value
 */
function getType(value) {
    if (value === null)
        return 'null';
    if (Array.isArray(value))
        return 'array';
    const t = typeof value;
    if (t === 'string' || t === 'number' || t === 'boolean' || t === 'object') {
        return t;
    }
    return 'any';
}
/**
 * Check if a value matches the expected type(s)
 */
function matchesType(value, expectedType) {
    const types = Array.isArray(expectedType) ? expectedType : [expectedType];
    const actualType = getType(value);
    return types.some(t => t === 'any' || t === actualType);
}
/**
 * Validate a single argument against its schema
 */
function validateArg(value, schema, index) {
    const { name, type, required = true, min, max, minLength, maxLength, pattern, validate } = schema;
    // Check required
    if (value === undefined) {
        if (required) {
            return { arg: name, index, message: `is required` };
        }
        return null; // Optional and not provided - skip other validations
    }
    // Check type
    if (!matchesType(value, type)) {
        const expectedTypes = Array.isArray(type) ? type.join(' | ') : type;
        return { arg: name, index, message: `expected ${expectedTypes}, got ${getType(value)}`, received: value };
    }
    // Number validations
    if (typeof value === 'number') {
        if (min !== undefined && value < min) {
            return { arg: name, index, message: `must be at least ${min}`, received: value };
        }
        if (max !== undefined && value > max) {
            return { arg: name, index, message: `must be at most ${max}`, received: value };
        }
        if (!Number.isFinite(value)) {
            return { arg: name, index, message: `must be a finite number`, received: value };
        }
    }
    // String validations
    if (typeof value === 'string') {
        if (minLength !== undefined && value.length < minLength) {
            return { arg: name, index, message: `must be at least ${minLength} characters`, received: value };
        }
        if (maxLength !== undefined && value.length > maxLength) {
            return { arg: name, index, message: `must be at most ${maxLength} characters`, received: value };
        }
        if (pattern !== undefined && !pattern.test(value)) {
            return { arg: name, index, message: `does not match required pattern`, received: value };
        }
    }
    // Array validations
    if (Array.isArray(value)) {
        if (minLength !== undefined && value.length < minLength) {
            return { arg: name, index, message: `must have at least ${minLength} items`, received: value };
        }
        if (maxLength !== undefined && value.length > maxLength) {
            return { arg: name, index, message: `must have at most ${maxLength} items`, received: value };
        }
    }
    // Custom validation
    if (validate) {
        const result = validate(value);
        if (result !== true) {
            const message = typeof result === 'string' ? result : 'failed custom validation';
            return { arg: name, index, message, received: value };
        }
    }
    return null;
}
/**
 * Validate RPC method arguments against a schema
 *
 * @param args - The arguments array to validate
 * @param schema - The method schema with argument definitions
 * @throws ValidationError if validation fails
 *
 * @example
 * ```typescript
 * const schema: MethodSchema = {
 *   args: [
 *     { name: 'email', type: 'string', pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
 *     { name: 'age', type: 'number', min: 0, max: 150 },
 *     { name: 'tags', type: 'array', required: false }
 *   ]
 * }
 *
 * validateArgs(['user@example.com', 25], schema) // OK
 * validateArgs(['invalid-email', -5], schema) // Throws ValidationError
 * ```
 */
export function validateArgs(args, schema) {
    const errors = [];
    // Validate each defined argument
    for (let i = 0; i < schema.args.length; i++) {
        const argSchema = schema.args[i];
        // This should never be undefined since we're iterating within bounds,
        // but TypeScript needs the assertion for strict mode
        if (!argSchema)
            continue;
        const value = args[i];
        const error = validateArg(value, argSchema, i);
        if (error) {
            errors.push(error);
        }
    }
    // If there are errors, throw a ValidationError with all of them
    if (errors.length > 0) {
        const fieldErrors = errors.map(e => ({
            field: `args[${e.index}] (${e.arg})`,
            message: e.message
        }));
        throw ValidationError.withErrors(fieldErrors);
    }
}
/**
 * Create a method schema from a simple definition
 *
 * @example
 * ```typescript
 * const schema = defineMethodSchema([
 *   { name: 'id', type: 'string' },
 *   { name: 'data', type: 'object' }
 * ])
 * ```
 */
export function defineMethodSchema(args) {
    return { args };
}
/**
 * Create a complete schema registry for an RPC target
 *
 * @example
 * ```typescript
 * const schemas = createSchemaRegistry({
 *   'users.create': {
 *     args: [
 *       { name: 'data', type: 'object' }
 *     ]
 *   },
 *   'users.get': {
 *     args: [
 *       { name: 'id', type: 'string', minLength: 1 }
 *     ]
 *   }
 * })
 * ```
 */
export function createSchemaRegistry(schemas) {
    return schemas;
}
/**
 * Lookup a method schema from a registry, supporting nested paths
 *
 * @param registry - The schema registry
 * @param methodPath - The method path (e.g., 'users.create')
 * @returns The method schema or undefined if not found
 */
export function getMethodSchema(registry, methodPath) {
    return registry[methodPath];
}
/**
 * Helper to create common argument schemas
 */
export const ArgSchemas = {
    /** Required string argument */
    string(name, options = {}) {
        return { name, type: 'string', required: true, ...options };
    },
    /** Required number argument */
    number(name, options = {}) {
        return { name, type: 'number', required: true, ...options };
    },
    /** Required boolean argument */
    boolean(name, options = {}) {
        return { name, type: 'boolean', required: true, ...options };
    },
    /** Required object argument */
    object(name, options = {}) {
        return { name, type: 'object', required: true, ...options };
    },
    /** Required array argument */
    array(name, options = {}) {
        return { name, type: 'array', required: true, ...options };
    },
    /** Optional string argument */
    optionalString(name, options = {}) {
        return { name, type: 'string', required: false, ...options };
    },
    /** Optional number argument */
    optionalNumber(name, options = {}) {
        return { name, type: 'number', required: false, ...options };
    },
    /** ID argument (non-empty string) */
    id(name = 'id') {
        return { name, type: 'string', required: true, minLength: 1 };
    },
    /** Email argument with pattern validation */
    email(name = 'email') {
        return {
            name,
            type: 'string',
            required: true,
            pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        };
    },
    /** Positive number argument */
    positiveNumber(name) {
        return { name, type: 'number', required: true, min: 0 };
    },
    /** Integer argument */
    integer(name, options = {}) {
        return {
            name,
            type: 'number',
            required: true,
            ...options,
            validate: (value) => Number.isInteger(value) || 'must be an integer'
        };
    }
};
/**
 * Check if a schema is a Zod method schema
 */
export function isZodMethodSchema(schema) {
    return (typeof schema === 'object' &&
        schema !== null &&
        '__zodSchema' in schema &&
        schema.__zodSchema === true);
}
/**
 * Get a Zod method schema from a registry
 */
export function getZodMethodSchema(registry, methodPath) {
    return registry[methodPath];
}
/**
 * Validate arguments against a Zod method schema
 * Requires zod to be installed and schemas to be actual Zod schemas
 */
export function validateZodArgs(args, schema) {
    if (!schema.args || !Array.isArray(schema.args)) {
        throw new ValidationError('Invalid Zod schema: missing args array');
    }
    const allErrors = [];
    for (let i = 0; i < schema.args.length; i++) {
        const argDef = schema.args[i];
        const argValue = args[i];
        if (!argDef)
            continue;
        // Support both raw Zod schemas and ZodArgSchema objects
        const zodSchema = 'schema' in argDef ? argDef.schema : argDef;
        const argName = 'name' in argDef ? argDef.name : `arg${i}`;
        // If the schema has a safeParse method, it's a Zod schema
        if (zodSchema && typeof zodSchema === 'object' && 'safeParse' in zodSchema) {
            const schema = zodSchema;
            const result = schema.safeParse(argValue);
            if (!result.success && result.error) {
                const errors = formatZodErrors(result.error, argName, i);
                allErrors.push(...errors);
            }
        }
    }
    if (allErrors.length > 0) {
        throw ValidationError.withErrors(allErrors);
    }
}
/**
 * Define a Zod method schema from an array of Zod schemas
 */
export function defineZodMethodSchema(args) {
    return {
        __zodSchema: true,
        args,
    };
}
/**
 * Format Zod errors into a consistent structure
 */
export function formatZodErrors(error, argName, argIndex) {
    if (!error.errors || !Array.isArray(error.errors)) {
        return [{ field: `args[${argIndex}] (${argName})`, message: 'Validation failed' }];
    }
    return error.errors.map((e) => {
        const pathStr = e.path.length > 0 ? `.${e.path.join('.')}` : '';
        return {
            field: `args[${argIndex}] (${argName}${pathStr})`,
            message: e.message,
        };
    });
}
/**
 * Validate a single Zod argument and return errors
 */
export function validateZodArg(value, zodSchema, argName, argIndex) {
    if (!zodSchema || typeof zodSchema !== 'object') {
        return [];
    }
    // Check if it's a Zod schema (has safeParse method)
    if (!('safeParse' in zodSchema)) {
        return [];
    }
    const schema = zodSchema;
    const result = schema.safeParse(value);
    if (result.success) {
        return [];
    }
    return formatZodErrors(result.error || { errors: [] }, argName, argIndex);
}
/**
 * Create a Zod schema registry for an RPC target
 */
export function createZodSchemaRegistry(schemas) {
    const registry = {};
    for (const [method, config] of Object.entries(schemas)) {
        registry[method] = {
            __zodSchema: true,
            args: config.args,
        };
    }
    return registry;
}
/**
 * Helper to create common Zod argument schemas
 * These work with the zod library when imported by the consumer
 */
export const ZodArgSchemas = {
    /** Required string argument */
    string(name) {
        // Dynamic import of zod to get z.string()
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { z } = require('zod');
        return { name, schema: z.string() };
    },
    /** Non-empty string argument */
    nonEmptyString(name) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { z } = require('zod');
        return { name, schema: z.string().min(1) };
    },
    /** Required number argument */
    number(name) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { z } = require('zod');
        return { name, schema: z.number() };
    },
    /** Finite number argument */
    finiteNumber(name) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { z } = require('zod');
        return { name, schema: z.number().finite() };
    },
    /** Integer argument */
    integer(name) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { z } = require('zod');
        return { name, schema: z.number().int() };
    },
    /** Positive integer argument */
    positiveInt(name) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { z } = require('zod');
        return { name, schema: z.number().int().positive() };
    },
    /** Non-negative integer argument */
    nonNegativeInt(name) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { z } = require('zod');
        return { name, schema: z.number().int().nonnegative() };
    },
    /** Required boolean argument */
    boolean(name) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { z } = require('zod');
        return { name, schema: z.boolean() };
    },
    /** Required object argument */
    object(name) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { z } = require('zod');
        return { name, schema: z.record(z.unknown()) };
    },
    /** Required array argument */
    array(name) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { z } = require('zod');
        return { name, schema: z.array(z.unknown()) };
    },
    /** Optional string argument */
    optionalString(name) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { z } = require('zod');
        return { name, schema: z.string().optional() };
    },
    /** Optional number argument */
    optionalNumber(name) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { z } = require('zod');
        return { name, schema: z.number().optional() };
    },
    /** ID argument (non-empty string) */
    id(name = 'id') {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { z } = require('zod');
        return { name, schema: z.string().min(1) };
    },
    /** Email argument with format validation */
    email(name = 'email') {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { z } = require('zod');
        return { name, schema: z.string().email() };
    },
    /** URL argument with format validation */
    url(name = 'url') {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { z } = require('zod');
        return { name, schema: z.string().url() };
    },
    /** UUID argument with format validation */
    uuid(name = 'uuid') {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { z } = require('zod');
        return { name, schema: z.string().uuid() };
    },
    /** Custom schema argument */
    custom(name, schema) {
        return { name, schema };
    },
    /** Nullable schema argument */
    nullable(name, innerSchema) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { z } = require('zod');
        const inner = innerSchema;
        if (typeof inner.nullable === 'function') {
            return { name, schema: inner.nullable() };
        }
        // Fallback: wrap with z.union
        return { name, schema: z.union([innerSchema, z.null()]) };
    },
};
//# sourceMappingURL=validation.js.map
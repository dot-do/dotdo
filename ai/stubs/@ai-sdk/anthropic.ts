/**
 * Stub for @ai-sdk/anthropic module during testing.
 * Throws MODULE_NOT_FOUND error to trigger mock fallback.
 */
const error = new Error('Cannot find package \'@ai-sdk/anthropic\' - this is a test stub');
(error as Error & { code: string }).code = 'ERR_MODULE_NOT_FOUND';
throw error;

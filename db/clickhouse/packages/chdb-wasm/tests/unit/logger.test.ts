/**
 * Logger Utility Tests
 *
 * Tests for the structured logging infrastructure.
 * Verifies:
 * - Log levels work correctly
 * - Environment configuration (DEBUG flag)
 * - Sensitive data filtering
 * - Child loggers and namespaces
 * - Production safety (no debug output by default)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createLogger,
  configureLogging,
  setDebugEnabled,
  isDebugEnabled,
  setLogLevel,
  getLogLevel,
  LogLevel,
  defaultLogger,
  debug,
  info,
  warn,
  error,
} from '../../src/utils/logger';

describe('Logger Utility', () => {
  // Store original console methods
  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  // Capture log output
  let logOutput: { level: string; message: string }[] = [];

  beforeEach(() => {
    // Reset log output
    logOutput = [];

    // Reset logger state
    setDebugEnabled(false);

    // Mock console methods to capture output
    console.log = vi.fn((...args) => {
      logOutput.push({ level: 'log', message: args.join(' ') });
    });
    console.info = vi.fn((...args) => {
      logOutput.push({ level: 'info', message: args.join(' ') });
    });
    console.warn = vi.fn((...args) => {
      logOutput.push({ level: 'warn', message: args.join(' ') });
    });
    console.error = vi.fn((...args) => {
      logOutput.push({ level: 'error', message: args.join(' ') });
    });
  });

  afterEach(() => {
    // Restore console methods
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;

    // Reset logger state
    setDebugEnabled(false);
  });

  describe('createLogger', () => {
    it('should create a logger with a namespace', () => {
      const log = createLogger('test-namespace');
      expect(log).toBeDefined();
      expect(typeof log.debug).toBe('function');
      expect(typeof log.info).toBe('function');
      expect(typeof log.warn).toBe('function');
      expect(typeof log.error).toBe('function');
    });

    it('should include namespace in log output', () => {
      const log = createLogger('my-component');
      log.info('Test message');

      expect(logOutput.length).toBe(1);
      const parsed = JSON.parse(logOutput[0].message);
      expect(parsed.namespace).toBe('my-component');
      expect(parsed.message).toBe('Test message');
    });

    it('should include timestamp in log output', () => {
      const log = createLogger('test');
      log.info('Test message');

      const parsed = JSON.parse(logOutput[0].message);
      expect(parsed.timestamp).toBeDefined();
      // Verify it's a valid ISO timestamp
      expect(() => new Date(parsed.timestamp)).not.toThrow();
    });

    it('should include context data in log output', () => {
      const log = createLogger('test');
      log.info('Query executed', { rows: 100, elapsed: 50 });

      const parsed = JSON.parse(logOutput[0].message);
      expect(parsed.context).toBeDefined();
      expect(parsed.context.rows).toBe(100);
      expect(parsed.context.elapsed).toBe(50);
    });
  });

  describe('Log Levels', () => {
    it('should log error messages at default level', () => {
      const log = createLogger('test');
      log.error('Error occurred');

      expect(logOutput.length).toBe(1);
      expect(logOutput[0].level).toBe('error');
    });

    it('should log warn messages at default level', () => {
      const log = createLogger('test');
      log.warn('Warning message');

      expect(logOutput.length).toBe(1);
      expect(logOutput[0].level).toBe('warn');
    });

    it('should log info messages at default level', () => {
      const log = createLogger('test');
      log.info('Info message');

      expect(logOutput.length).toBe(1);
      expect(logOutput[0].level).toBe('info');
    });

    it('should NOT log debug messages when debug is disabled', () => {
      setDebugEnabled(false);
      const log = createLogger('test');
      log.debug('Debug message');

      expect(logOutput.length).toBe(0);
    });

    it('should log debug messages when debug is enabled', () => {
      setDebugEnabled(true);
      const log = createLogger('test');
      log.debug('Debug message');

      expect(logOutput.length).toBe(1);
      const parsed = JSON.parse(logOutput[0].message);
      expect(parsed.level).toBe('DEBUG');
    });
  });

  describe('configureLogging', () => {
    it('should enable debug when DEBUG env var is "true"', () => {
      configureLogging({ DEBUG: 'true' });
      expect(isDebugEnabled()).toBe(true);
    });

    it('should enable debug when DEBUG env var is "1"', () => {
      configureLogging({ DEBUG: '1' });
      expect(isDebugEnabled()).toBe(true);
    });

    it('should disable debug when DEBUG env var is undefined', () => {
      configureLogging({});
      expect(isDebugEnabled()).toBe(false);
    });

    it('should disable debug when DEBUG env var is "false"', () => {
      configureLogging({ DEBUG: 'false' });
      expect(isDebugEnabled()).toBe(false);
    });
  });

  describe('setLogLevel', () => {
    it('should change minimum log level', () => {
      setLogLevel(LogLevel.WARN);
      const log = createLogger('test');

      log.info('Info message');
      log.warn('Warn message');

      // Only warn should be logged (info is below WARN level)
      expect(logOutput.length).toBe(1);
      const parsed = JSON.parse(logOutput[0].message);
      expect(parsed.level).toBe('WARN');
    });

    it('should enable debug mode when set to DEBUG level', () => {
      setLogLevel(LogLevel.DEBUG);
      expect(isDebugEnabled()).toBe(true);
    });

    it('should get current log level', () => {
      setLogLevel(LogLevel.ERROR);
      expect(getLogLevel()).toBe(LogLevel.ERROR);
    });
  });

  describe('Sensitive Data Filtering', () => {
    it('should redact password in context', () => {
      const log = createLogger('test');
      log.info('User login', { username: 'john', password: 'secret123' });

      const parsed = JSON.parse(logOutput[0].message);
      expect(parsed.context.username).toBe('john');
      expect(parsed.context.password).toBe('[REDACTED]');
    });

    it('should redact api_key in context', () => {
      const log = createLogger('test');
      log.info('API call', { endpoint: '/users', api_key: 'sk-12345' });

      const parsed = JSON.parse(logOutput[0].message);
      expect(parsed.context.endpoint).toBe('/users');
      expect(parsed.context.api_key).toBe('[REDACTED]');
    });

    it('should redact authorization header', () => {
      const log = createLogger('test');
      log.info('Request', { authorization: 'Bearer token123' });

      const parsed = JSON.parse(logOutput[0].message);
      expect(parsed.context.authorization).toBe('[REDACTED]');
    });

    it('should redact nested sensitive data', () => {
      const log = createLogger('test');
      // Test deeply nested password inside a non-sensitive container
      log.info('Config', {
        database: { host: 'localhost', connection: { password: 'secret' } },
      });

      const parsed = JSON.parse(logOutput[0].message);
      expect(parsed.context.database.host).toBe('localhost');
      // password is nested inside 'connection' (not sensitive), so we can access it
      expect(parsed.context.database.connection.password).toBe('[REDACTED]');
    });

    it('should redact entire value when key is sensitive', () => {
      const log = createLogger('test');
      // "credentials" itself is a sensitive key, so the entire object is redacted
      log.info('Config', {
        database: { host: 'localhost', credentials: { user: 'admin', pass: 'secret' } },
      });

      const parsed = JSON.parse(logOutput[0].message);
      expect(parsed.context.database.host).toBe('localhost');
      // credentials key is sensitive, so entire value is redacted
      expect(parsed.context.database.credentials).toBe('[REDACTED]');
    });

    it('should handle various sensitive key formats', () => {
      const log = createLogger('test');
      log.info('Test', {
        TOKEN: 'abc',
        apiKey: 'def',
        'x-api-key': 'ghi',
        access_token: 'jkl',
      });

      const parsed = JSON.parse(logOutput[0].message);
      expect(parsed.context.TOKEN).toBe('[REDACTED]');
      expect(parsed.context.apiKey).toBe('[REDACTED]');
      expect(parsed.context['x-api-key']).toBe('[REDACTED]');
      expect(parsed.context.access_token).toBe('[REDACTED]');
    });
  });

  describe('Child Loggers', () => {
    it('should create child logger with extended namespace', () => {
      const parentLog = createLogger('http');
      const childLog = parentLog.child('query');

      childLog.info('Query received');

      const parsed = JSON.parse(logOutput[0].message);
      expect(parsed.namespace).toBe('http:query');
    });

    it('should support multiple nesting levels', () => {
      const log = createLogger('worker')
        .child('handler')
        .child('query');

      log.info('Processing');

      const parsed = JSON.parse(logOutput[0].message);
      expect(parsed.namespace).toBe('worker:handler:query');
    });
  });

  describe('Default Logger', () => {
    it('should have a default logger available', () => {
      expect(defaultLogger).toBeDefined();
      expect(typeof defaultLogger.info).toBe('function');
    });

    it('should use "chdb" as default namespace', () => {
      defaultLogger.info('Test');

      const parsed = JSON.parse(logOutput[0].message);
      expect(parsed.namespace).toBe('chdb');
    });
  });

  describe('Convenience Functions', () => {
    it('should provide debug function', () => {
      setDebugEnabled(true);
      debug('Debug message');

      expect(logOutput.length).toBe(1);
    });

    it('should provide info function', () => {
      info('Info message');

      expect(logOutput.length).toBe(1);
    });

    it('should provide warn function', () => {
      warn('Warning message');

      expect(logOutput.length).toBe(1);
    });

    it('should provide error function', () => {
      error('Error message');

      expect(logOutput.length).toBe(1);
    });
  });

  describe('isDebugEnabled', () => {
    it('should return current debug state', () => {
      setDebugEnabled(true);
      expect(isDebugEnabled()).toBe(true);

      setDebugEnabled(false);
      expect(isDebugEnabled()).toBe(false);
    });

    it('should be accessible via logger instance', () => {
      const log = createLogger('test');

      setDebugEnabled(false);
      expect(log.isDebugEnabled()).toBe(false);

      setDebugEnabled(true);
      expect(log.isDebugEnabled()).toBe(true);
    });
  });

  describe('Production Safety', () => {
    it('should not log debug messages by default', () => {
      // Reset to default state
      setDebugEnabled(false);

      const log = createLogger('production-test');
      log.debug('This should not appear');

      expect(logOutput.length).toBe(0);
    });

    it('should log errors even when debug is disabled', () => {
      setDebugEnabled(false);

      const log = createLogger('production-test');
      log.error('Critical error');

      expect(logOutput.length).toBe(1);
    });

    it('should handle empty context gracefully', () => {
      const log = createLogger('test');
      log.info('No context');

      const parsed = JSON.parse(logOutput[0].message);
      expect(parsed.context).toBeUndefined();
    });

    it('should handle null/undefined values in context', () => {
      const log = createLogger('test');
      log.info('Test', { nullValue: null, undefinedValue: undefined });

      const parsed = JSON.parse(logOutput[0].message);
      expect(parsed.context.nullValue).toBe(null);
    });
  });
});

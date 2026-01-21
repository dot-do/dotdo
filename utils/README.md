# @dotdo/utils

Shared utility functions for dotdo packages - logging, helpers, and common utilities.

## Installation

```bash
npm install @dotdo/utils
```

## Features

- **Structured Logging** - Simple structured logger for consistent log output
- **Type-Safe** - Full TypeScript support
- **Zero Dependencies** - Lightweight utility library

## Quick Start

### Logging

```typescript
import { createLogger, LogLevel } from '@dotdo/utils'

const logger = createLogger({
  name: 'my-service',
  level: LogLevel.INFO
})

logger.info('Server started', { port: 3000 })
logger.error('Connection failed', { error: 'ECONNREFUSED' })
logger.debug('Processing request', { requestId: 'req_123' })
```

## API Reference

### `createLogger(options)`

Create a structured logger instance.

**Options:**
- `name` (string) - Logger name (usually service or module name)
- `level` (LogLevel) - Minimum log level to output

**Example:**
```typescript
const logger = createLogger({
  name: 'api-service',
  level: LogLevel.INFO
})
```

### `LogLevel`

Enum for log levels:

```typescript
enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}
```

### Logger Methods

#### `logger.debug(message, context?)`

Log a debug message.

```typescript
logger.debug('Cache hit', { key: 'user:123' })
```

#### `logger.info(message, context?)`

Log an info message.

```typescript
logger.info('Request processed', { duration: 45 })
```

#### `logger.warn(message, context?)`

Log a warning message.

```typescript
logger.warn('Rate limit approaching', { current: 950, limit: 1000 })
```

#### `logger.error(message, context?)`

Log an error message.

```typescript
logger.error('Database connection failed', {
  error: error.message,
  host: 'db.example.com'
})
```

## Output Format

Logs are output as JSON for easy parsing:

```json
{
  "level": "info",
  "name": "my-service",
  "message": "Server started",
  "port": 3000,
  "timestamp": "2026-01-21T10:30:00.000Z"
}
```

## Related Packages

- [@dotdo/observability](/observability) - Full observability with tracing and metrics
- [@dotdo/do](/do) - Durable Object base class

## License

MIT

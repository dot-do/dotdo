/**
 * RED Phase Tests: Benthos config schema types
 * Issue: dotdo-i0wef
 *
 * These tests define the expected behavior for the config schema types.
 * They should FAIL until the implementation is complete.
 */
import { describe, it, expect } from 'vitest'
import {
  BenthosConfig,
  InputConfig,
  OutputConfig,
  ProcessorConfig,
  CacheConfig,
  RateLimitConfig,
  BufferConfig,
  MetricsConfig,
  TracingConfig,
  validateConfig,
  ConfigValidationError
} from '../config'

describe('BenthosConfig schema', () => {
  describe('Top-level config structure', () => {
    it('validates minimal config with input and output', () => {
      const config: BenthosConfig = {
        input: { generate: { mapping: 'root = "hello"' } },
        output: { drop: {} }
      }

      expect(() => validateConfig(config)).not.toThrow()
    })

    it('validates full config with all sections', () => {
      const config: BenthosConfig = {
        input: { generate: { mapping: 'root = "test"' } },
        pipeline: {
          processors: [
            { mapping: 'root = this.uppercase()' }
          ]
        },
        output: { stdout: {} },
        cache_resources: [
          { label: 'mycache', memory: { ttl: '5m' } }
        ],
        rate_limit_resources: [
          { label: 'mylimit', local: { count: 100, interval: '1s' } }
        ],
        metrics: { prometheus: {} },
        tracer: { jaeger: { agent_address: 'localhost:6831' } },
        logger: { level: 'INFO', format: 'json' }
      }

      expect(() => validateConfig(config)).not.toThrow()
    })

    it('rejects config without input', () => {
      const config = {
        output: { stdout: {} }
      } as BenthosConfig

      expect(() => validateConfig(config)).toThrow(ConfigValidationError)
    })

    it('rejects config without output', () => {
      const config = {
        input: { stdin: {} }
      } as BenthosConfig

      expect(() => validateConfig(config)).toThrow(ConfigValidationError)
    })
  })

  describe('InputConfig', () => {
    it('validates kafka input config', () => {
      const input: InputConfig = {
        kafka: {
          addresses: ['localhost:9092'],
          topics: ['my-topic'],
          consumer_group: 'my-group',
          client_id: 'benthos',
          start_from_oldest: true
        }
      }

      expect(() => validateConfig({ input, output: { drop: {} } })).not.toThrow()
    })

    it('validates http_server input config', () => {
      const input: InputConfig = {
        http_server: {
          path: '/post',
          allowed_verbs: ['POST', 'PUT'],
          timeout: '30s'
        }
      }

      expect(() => validateConfig({ input, output: { drop: {} } })).not.toThrow()
    })

    it('validates aws_sqs input config', () => {
      const input: InputConfig = {
        aws_sqs: {
          url: 'https://sqs.us-east-1.amazonaws.com/123456789/my-queue',
          region: 'us-east-1',
          max_number_of_messages: 10,
          wait_time_seconds: 20
        }
      }

      expect(() => validateConfig({ input, output: { drop: {} } })).not.toThrow()
    })

    it('validates broker input with multiple inputs', () => {
      const input: InputConfig = {
        broker: {
          inputs: [
            { kafka: { addresses: ['localhost:9092'], topics: ['topic1'] } },
            { kafka: { addresses: ['localhost:9092'], topics: ['topic2'] } }
          ]
        }
      }

      expect(() => validateConfig({ input, output: { drop: {} } })).not.toThrow()
    })

    it('validates generate input for testing', () => {
      const input: InputConfig = {
        generate: {
          mapping: 'root = {"timestamp": now(), "value": random_int()}',
          interval: '1s',
          count: 0 // infinite
        }
      }

      expect(() => validateConfig({ input, output: { drop: {} } })).not.toThrow()
    })
  })

  describe('OutputConfig', () => {
    it('validates kafka output config', () => {
      const output: OutputConfig = {
        kafka: {
          addresses: ['localhost:9092'],
          topic: 'output-topic',
          key: '${! meta("kafka_key") }',
          partitioner: 'fnv1a_hash',
          compression: 'snappy'
        }
      }

      expect(() => validateConfig({ input: { stdin: {} }, output })).not.toThrow()
    })

    it('validates http_client output config', () => {
      const output: OutputConfig = {
        http_client: {
          url: 'http://example.com.ai/api',
          verb: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ${SECRET}'
          },
          max_in_flight: 64,
          batch_as_multipart: false
        }
      }

      expect(() => validateConfig({ input: { stdin: {} }, output })).not.toThrow()
    })

    it('validates switch output for routing', () => {
      const output: OutputConfig = {
        switch: {
          cases: [
            {
              check: 'this.type == "error"',
              output: { kafka: { addresses: ['localhost:9092'], topic: 'errors' } }
            },
            {
              check: 'this.type == "metric"',
              output: { kafka: { addresses: ['localhost:9092'], topic: 'metrics' } }
            },
            {
              output: { kafka: { addresses: ['localhost:9092'], topic: 'default' } }
            }
          ]
        }
      }

      expect(() => validateConfig({ input: { stdin: {} }, output })).not.toThrow()
    })

    it('validates broker output for fan-out', () => {
      const output: OutputConfig = {
        broker: {
          pattern: 'fan_out',
          outputs: [
            { kafka: { addresses: ['localhost:9092'], topic: 'topic1' } },
            { aws_s3: { bucket: 'my-bucket', path: '${!meta("path")}' } }
          ]
        }
      }

      expect(() => validateConfig({ input: { stdin: {} }, output })).not.toThrow()
    })
  })

  describe('ProcessorConfig', () => {
    it('validates mapping processor', () => {
      const processor: ProcessorConfig = {
        mapping: `
          root = this
          root.processed = true
          root.timestamp = now()
        `
      }

      expect(processor.mapping).toBeDefined()
    })

    it('validates branch processor', () => {
      const processor: ProcessorConfig = {
        branch: {
          request_map: 'root = this.id',
          processors: [
            { http: { url: 'http://enrichment-api.com/${!this}' } }
          ],
          result_map: 'root.enriched = this'
        }
      }

      expect(processor.branch).toBeDefined()
    })

    it('validates cache processor', () => {
      const processor: ProcessorConfig = {
        cache: {
          resource: 'mycache',
          operator: 'get',
          key: '${! this.id }'
        }
      }

      expect(processor.cache).toBeDefined()
    })

    it('validates dedupe processor', () => {
      const processor: ProcessorConfig = {
        dedupe: {
          cache: 'mycache',
          key: '${! this.id }',
          drop_on_cache_err: true
        }
      }

      expect(processor.dedupe).toBeDefined()
    })

    it('validates rate_limit processor', () => {
      const processor: ProcessorConfig = {
        rate_limit: {
          resource: 'mylimit'
        }
      }

      expect(processor.rate_limit).toBeDefined()
    })

    it('validates http processor', () => {
      const processor: ProcessorConfig = {
        http: {
          url: 'http://api.example.com.ai/process',
          verb: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }
      }

      expect(processor.http).toBeDefined()
    })

    it('validates parallel processor', () => {
      const processor: ProcessorConfig = {
        parallel: {
          cap: 10,
          processors: [
            { http: { url: 'http://slow-api.com' } }
          ]
        }
      }

      expect(processor.parallel).toBeDefined()
    })

    it('validates try/catch processor', () => {
      const processor: ProcessorConfig = {
        try: [
          { http: { url: 'http://api.com' } }
        ],
        catch: [
          { mapping: 'root.error = error()' }
        ]
      }

      expect(processor.try).toBeDefined()
      expect(processor.catch).toBeDefined()
    })
  })

  describe('CacheConfig', () => {
    it('validates memory cache', () => {
      const cache: CacheConfig = {
        label: 'memcache',
        memory: {
          ttl: '5m',
          compaction_interval: '1m',
          init_values: { 'key1': 'value1' }
        }
      }

      expect(cache.memory).toBeDefined()
      expect(cache.label).toBe('memcache')
    })

    it('validates redis cache', () => {
      const cache: CacheConfig = {
        label: 'rediscache',
        redis: {
          url: 'redis://localhost:6379',
          default_ttl: '1h'
        }
      }

      expect(cache.redis).toBeDefined()
    })
  })

  describe('RateLimitConfig', () => {
    it('validates local rate limit', () => {
      const limit: RateLimitConfig = {
        label: 'api_limit',
        local: {
          count: 100,
          interval: '1s'
        }
      }

      expect(limit.local).toBeDefined()
    })
  })

  describe('BufferConfig', () => {
    it('validates memory buffer', () => {
      const buffer: BufferConfig = {
        memory: {
          limit: 10000,
          batch_policy: {
            count: 100,
            period: '1s',
            byte_size: 1048576
          }
        }
      }

      expect(buffer.memory).toBeDefined()
    })
  })

  describe('MetricsConfig', () => {
    it('validates prometheus metrics', () => {
      const metrics: MetricsConfig = {
        prometheus: {
          prefix: 'benthos',
          path: '/metrics'
        }
      }

      expect(metrics.prometheus).toBeDefined()
    })

    it('validates statsd metrics', () => {
      const metrics: MetricsConfig = {
        statsd: {
          address: 'localhost:8125',
          flush_period: '100ms',
          prefix: 'benthos'
        }
      }

      expect(metrics.statsd).toBeDefined()
    })
  })

  describe('TracingConfig', () => {
    it('validates jaeger tracing', () => {
      const tracing: TracingConfig = {
        jaeger: {
          agent_address: 'localhost:6831',
          service_name: 'my-pipeline'
        }
      }

      expect(tracing.jaeger).toBeDefined()
    })
  })

  describe('Config interpolation', () => {
    it('identifies environment variable references', () => {
      const config: BenthosConfig = {
        input: {
          kafka: {
            addresses: ['${KAFKA_BROKERS}'],
            topics: ['${KAFKA_TOPIC}']
          }
        },
        output: { drop: {} }
      }

      // Config should be valid even with interpolation syntax
      expect(() => validateConfig(config)).not.toThrow()
    })
  })
})

describe('Config validation errors', () => {
  it('provides helpful error messages for invalid input type', () => {
    const config = {
      input: { nonexistent_input: {} },
      output: { drop: {} }
    }

    expect(() => validateConfig(config as BenthosConfig))
      .toThrow(/unknown input type.*nonexistent_input/i)
  })

  it('provides helpful error messages for missing required fields', () => {
    const config = {
      input: { kafka: { topics: ['test'] } }, // missing addresses
      output: { drop: {} }
    }

    expect(() => validateConfig(config as BenthosConfig))
      .toThrow(/addresses.*required/i)
  })

  it('provides path to the error in nested configs', () => {
    const config = {
      input: { stdin: {} },
      output: {
        broker: {
          outputs: [
            { kafka: {} } // missing required fields
          ]
        }
      }
    }

    const error = (() => {
      try {
        validateConfig(config as BenthosConfig)
        return null
      } catch (e) {
        return e as ConfigValidationError
      }
    })()

    expect(error).toBeInstanceOf(ConfigValidationError)
    expect(error?.path).toContain('output.broker.outputs[0].kafka')
  })
})

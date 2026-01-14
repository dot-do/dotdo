/**
 * Tests for Workers tail event transformer
 *
 * Transforms Cloudflare Workers tail events to the unified event schema.
 */

import { describe, it, expect } from 'vitest'
import { transformTailEvent } from '../tail'
import type { TailEvent } from './fixtures/tail'
import {
  httpRequestOk,
  httpRequestException,
  cpuExceeded,
  memoryExceeded,
  canceledRequest,
  unknownOutcome,
  cronEvent,
  queueEvent,
  alarmEvent,
  minimalEvent,
  fullGeoEvent,
  multiLogEvent,
  multiExceptionEvent,
} from './fixtures/tail'

describe('transformTailEvent', () => {
  // ===========================================================================
  // Core Identity
  // ===========================================================================

  describe('CoreIdentity mapping', () => {
    it('generates a valid id', () => {
      const result = transformTailEvent(httpRequestOk)
      expect(result.id).toBeDefined()
      expect(typeof result.id).toBe('string')
      expect(result.id.length).toBeGreaterThan(0)
    })

    it('sets event_type to "tail"', () => {
      const result = transformTailEvent(httpRequestOk)
      expect(result.event_type).toBe('tail')
    })

    it('derives event_name from event type (fetch)', () => {
      const result = transformTailEvent(httpRequestOk)
      expect(result.event_name).toBe('workers.fetch')
    })

    it('derives event_name from event type (scheduled)', () => {
      const result = transformTailEvent(cronEvent)
      expect(result.event_name).toBe('workers.scheduled')
    })

    it('derives event_name from event type (queue)', () => {
      const result = transformTailEvent(queueEvent)
      expect(result.event_name).toBe('workers.queue')
    })

    it('derives event_name from event type (alarm)', () => {
      const result = transformTailEvent(alarmEvent)
      expect(result.event_name).toBe('workers.alarm')
    })

    it('uses "workers.invocation" for unknown event types', () => {
      const result = transformTailEvent(minimalEvent)
      expect(result.event_name).toBe('workers.invocation')
    })

    it('sets ns from scriptName', () => {
      const result = transformTailEvent(httpRequestOk)
      expect(result.ns).toBe('workers://my-worker')
    })
  })

  // ===========================================================================
  // Service Infrastructure
  // ===========================================================================

  describe('ServiceInfra mapping', () => {
    it('maps scriptName to service_name', () => {
      const result = transformTailEvent(httpRequestOk)
      expect(result.service_name).toBe('my-worker')
    })

    it('maps scriptVersion to service_version', () => {
      const result = transformTailEvent(httpRequestOk)
      expect(result.service_version).toBe('1.0.0')
    })

    it('handles missing scriptVersion', () => {
      const result = transformTailEvent(minimalEvent)
      expect(result.service_version).toBeNull()
    })

    it('sets cloud_provider to "cloudflare"', () => {
      const result = transformTailEvent(httpRequestOk)
      expect(result.cloud_provider).toBe('cloudflare')
    })
  })

  // ===========================================================================
  // Outcome Mapping
  // ===========================================================================

  describe('Outcome mapping', () => {
    it('maps outcome "ok" to "success"', () => {
      const result = transformTailEvent(httpRequestOk)
      expect(result.outcome).toBe('success')
    })

    it('maps outcome "exception" to "error"', () => {
      const result = transformTailEvent(httpRequestException)
      expect(result.outcome).toBe('error')
    })

    it('maps outcome "exceededCpu" to "exceeded_cpu"', () => {
      const result = transformTailEvent(cpuExceeded)
      expect(result.outcome).toBe('exceeded_cpu')
    })

    it('maps outcome "exceededMemory" to "exceeded_memory"', () => {
      const result = transformTailEvent(memoryExceeded)
      expect(result.outcome).toBe('exceeded_memory')
    })

    it('maps outcome "canceled" to "canceled"', () => {
      const result = transformTailEvent(canceledRequest)
      expect(result.outcome).toBe('canceled')
    })

    it('maps outcome "unknown" to "unknown"', () => {
      const result = transformTailEvent(unknownOutcome)
      expect(result.outcome).toBe('unknown')
    })
  })

  // ===========================================================================
  // Geo Location from CF Properties
  // ===========================================================================

  describe('GeoLocation mapping', () => {
    it('extracts geo_colo from cf.colo', () => {
      const result = transformTailEvent(httpRequestOk)
      expect(result.geo_colo).toBe('SJC')
    })

    it('extracts geo_country from cf.country', () => {
      const result = transformTailEvent(httpRequestOk)
      expect(result.geo_country).toBe('US')
    })

    it('extracts geo_city from cf.city', () => {
      const result = transformTailEvent(httpRequestOk)
      expect(result.geo_city).toBe('San Jose')
    })

    it('extracts geo_region from cf.region', () => {
      const result = transformTailEvent(httpRequestOk)
      expect(result.geo_region).toBe('California')
    })

    it('extracts geo_timezone from cf.timezone', () => {
      const result = transformTailEvent(httpRequestOk)
      expect(result.geo_timezone).toBe('America/Los_Angeles')
    })

    it('extracts geo_asn from cf.asn', () => {
      const result = transformTailEvent(httpRequestOk)
      expect(result.geo_asn).toBe(13335)
    })

    it('extracts geo_as_org from cf.asOrganization', () => {
      const result = transformTailEvent(httpRequestOk)
      expect(result.geo_as_org).toBe('Cloudflare Inc')
    })

    it('handles full geo data', () => {
      const result = transformTailEvent(fullGeoEvent)
      expect(result.geo_colo).toBe('SYD')
      expect(result.geo_country).toBe('AU')
      expect(result.geo_city).toBe('Sydney')
      expect(result.geo_region).toBe('New South Wales')
      expect(result.geo_timezone).toBe('Australia/Sydney')
      expect(result.geo_asn).toBe(15169)
      expect(result.geo_as_org).toBe('Google LLC')
    })

    it('handles missing geo data', () => {
      const result = transformTailEvent(minimalEvent)
      expect(result.geo_colo).toBeNull()
      expect(result.geo_country).toBeNull()
      expect(result.geo_city).toBeNull()
      expect(result.geo_region).toBeNull()
      expect(result.geo_timezone).toBeNull()
      expect(result.geo_asn).toBeNull()
      expect(result.geo_as_org).toBeNull()
    })
  })

  // ===========================================================================
  // HTTP Context
  // ===========================================================================

  describe('HttpContext mapping', () => {
    it('extracts http_method from request.method', () => {
      const result = transformTailEvent(httpRequestOk)
      expect(result.http_method).toBe('GET')
    })

    it('extracts http_url from request.url', () => {
      const result = transformTailEvent(httpRequestOk)
      expect(result.http_url).toBe('https://api.example.com/users/123')
    })

    it('extracts http_host from request.url', () => {
      const result = transformTailEvent(httpRequestOk)
      expect(result.http_host).toBe('api.example.com')
    })

    it('extracts http_path from request.url', () => {
      const result = transformTailEvent(httpRequestOk)
      expect(result.http_path).toBe('/users/123')
    })

    it('extracts http_status from response.status', () => {
      const result = transformTailEvent(httpRequestOk)
      expect(result.http_status).toBe(200)
    })

    it('extracts http_protocol from cf.httpProtocol', () => {
      const result = transformTailEvent(httpRequestOk)
      expect(result.http_protocol).toBe('HTTP/2')
    })

    it('handles missing HTTP context', () => {
      const result = transformTailEvent(cronEvent)
      expect(result.http_method).toBeNull()
      expect(result.http_url).toBeNull()
      expect(result.http_host).toBeNull()
      expect(result.http_path).toBeNull()
      expect(result.http_status).toBeNull()
    })

    it('handles missing response', () => {
      const result = transformTailEvent(cpuExceeded)
      expect(result.http_status).toBeNull()
    })
  })

  // ===========================================================================
  // Event Types (scheduled, queue, alarm)
  // ===========================================================================

  describe('Scheduled event handling', () => {
    it('extracts cron expression for scheduled events', () => {
      const result = transformTailEvent(cronEvent)
      expect(result.data).toBeDefined()
      expect((result.data as Record<string, unknown>).cron).toBe('0 * * * *')
    })

    it('extracts scheduledTime for scheduled events', () => {
      const result = transformTailEvent(cronEvent)
      expect((result.data as Record<string, unknown>).scheduledTime).toBe(1704067200000)
    })
  })

  describe('Queue event handling', () => {
    it('extracts queue name for queue events', () => {
      const result = transformTailEvent(queueEvent)
      expect(result.msg_destination).toBe('my-queue')
    })

    it('extracts batch size for queue events', () => {
      const result = transformTailEvent(queueEvent)
      expect(result.msg_batch_size).toBe(10)
    })

    it('sets msg_system to "cloudflare_queues"', () => {
      const result = transformTailEvent(queueEvent)
      expect(result.msg_system).toBe('cloudflare_queues')
    })
  })

  // ===========================================================================
  // Exception Handling
  // ===========================================================================

  describe('Exception handling', () => {
    it('extracts error_type from first exception', () => {
      const result = transformTailEvent(httpRequestException)
      expect(result.error_type).toBe('TypeError')
    })

    it('extracts error_message from first exception', () => {
      const result = transformTailEvent(httpRequestException)
      expect(result.error_message).toBe('Cannot read property "id" of undefined')
    })

    it('handles no exceptions', () => {
      const result = transformTailEvent(httpRequestOk)
      expect(result.error_type).toBeNull()
      expect(result.error_message).toBeNull()
    })

    it('uses first exception when multiple exist', () => {
      const result = transformTailEvent(multiExceptionEvent)
      expect(result.error_type).toBe('Error')
      expect(result.error_message).toBe('First error')
    })

    it('preserves all exceptions in data payload', () => {
      const result = transformTailEvent(multiExceptionEvent)
      const data = result.data as Record<string, unknown>
      const exceptions = data.exceptions as Array<{ name: string; message: string }>
      expect(exceptions).toHaveLength(3)
      expect(exceptions[0].name).toBe('Error')
      expect(exceptions[1].name).toBe('TypeError')
      expect(exceptions[2].name).toBe('RangeError')
    })
  })

  // ===========================================================================
  // Log Handling
  // ===========================================================================

  describe('Log handling', () => {
    it('preserves logs in data payload', () => {
      const result = transformTailEvent(httpRequestException)
      const data = result.data as Record<string, unknown>
      const logs = data.logs as Array<{ level: string; message: unknown[] }>
      expect(logs).toHaveLength(2)
      expect(logs[0].level).toBe('log')
      expect(logs[1].level).toBe('error')
    })

    it('handles multiple logs', () => {
      const result = transformTailEvent(multiLogEvent)
      const data = result.data as Record<string, unknown>
      const logs = data.logs as Array<{ level: string }>
      expect(logs).toHaveLength(4)
    })

    it('handles no logs', () => {
      const result = transformTailEvent(httpRequestOk)
      // httpRequestOk has no logs, so data should be null or logs should be undefined
      expect(result.data === null || (result.data as Record<string, unknown>).logs === undefined).toBe(true)
    })
  })

  // ===========================================================================
  // Timing
  // ===========================================================================

  describe('Timing mapping', () => {
    it('converts eventTimestamp to ISO timestamp', () => {
      const result = transformTailEvent(httpRequestOk)
      expect(result.timestamp).toBe('2024-01-01T00:00:00.000Z')
    })

    it('derives day partition from timestamp', () => {
      const result = transformTailEvent(httpRequestOk)
      expect(result.day).toBe('2024-01-01')
    })

    it('derives hour partition from timestamp', () => {
      const result = transformTailEvent(httpRequestOk)
      expect(result.hour).toBe(0)
    })
  })

  // ===========================================================================
  // Status Code Mapping
  // ===========================================================================

  describe('Status code mapping', () => {
    it('maps HTTP status to status_code', () => {
      const result = transformTailEvent(httpRequestOk)
      expect(result.status_code).toBe(200)
    })

    it('maps error status to status_code', () => {
      const result = transformTailEvent(httpRequestException)
      expect(result.status_code).toBe(500)
    })
  })

  // ===========================================================================
  // Event Source
  // ===========================================================================

  describe('Event source mapping', () => {
    it('sets event_source to "workers_tail"', () => {
      const result = transformTailEvent(httpRequestOk)
      expect(result.event_source).toBe('workers_tail')
    })
  })

  // ===========================================================================
  // Schema Version
  // ===========================================================================

  describe('Schema version', () => {
    it('sets schema_version to 1', () => {
      const result = transformTailEvent(httpRequestOk)
      expect(result.schema_version).toBe(1)
    })
  })
})

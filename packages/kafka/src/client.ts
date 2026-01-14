/**
 * Kafka Client - Main entry point for creating Kafka clients
 *
 * Provides KafkaJS-compatible API with in-memory backend.
 */

import { KafkaAdmin, type Admin } from './admin'
import { KafkaProducer, type Producer, type ExtendedProducerConfig } from './producer'
import { KafkaConsumer, type Consumer, type ExtendedConsumerConfig } from './consumer'
import { resetRegistry } from './backends/memory'
import type { KafkaConfig, ConsumerConfig, ProducerConfig } from './types'

/**
 * Kafka client interface
 */
export interface Kafka {
  /** Create an admin client */
  admin(): Admin
  /** Create a producer */
  producer(config?: ProducerConfig): Producer
  /** Create a consumer */
  consumer(config: ConsumerConfig): Consumer
}

/**
 * Kafka client implementation
 */
export class KafkaClient implements Kafka {
  private config: KafkaConfig
  private adminInstance: KafkaAdmin | null = null

  constructor(config: KafkaConfig) {
    this.config = config
  }

  /**
   * Create an admin client
   */
  admin(): Admin {
    if (!this.adminInstance) {
      this.adminInstance = new KafkaAdmin()
    }
    return this.adminInstance
  }

  /**
   * Create a producer
   */
  producer(config: ProducerConfig = {}): Producer {
    const extendedConfig: ExtendedProducerConfig = {
      ...config,
      admin: this.adminInstance ?? new KafkaAdmin(),
    }
    return new KafkaProducer(extendedConfig)
  }

  /**
   * Create a consumer
   */
  consumer(config: ConsumerConfig): Consumer {
    const extendedConfig: ExtendedConsumerConfig = {
      ...config,
      admin: this.adminInstance ?? new KafkaAdmin(),
    }
    return new KafkaConsumer(extendedConfig)
  }
}

/**
 * Create a new Kafka client
 */
export function createKafka(config: KafkaConfig): Kafka {
  return new KafkaClient(config)
}

// Re-export for convenience
export { resetRegistry }

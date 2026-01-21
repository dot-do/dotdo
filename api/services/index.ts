// Service layer exports - business logic separated from transport
//
// Clean Architecture:
// - Services contain business logic (what to do)
// - Route handlers contain transport logic (how to respond)
// - This separation makes testing easier and allows reuse across transports

export {
  // Health service
  HealthService,
  getHealthService,
  resetHealthService,
  type HealthResponse,
  type ReadinessResponse,
  type HealthDependency,
  type HealthServiceConfig
} from './health'

export {
  // Discovery service
  DiscoveryService,
  getDiscoveryService,
  resetDiscoveryService,
  type APIRootResponse,
  type ErrorWithLinks,
  type DiscoveryServiceConfig
} from './discovery'

/**
 * DO Presets - Pre-composed Durable Object Classes
 *
 * Presets are ready-to-use DO classes with common capability combinations.
 * They reduce boilerplate and ensure proper mixin composition order.
 *
 * Available presets:
 * - DOWithPrimitives: Full dev environment (fs, git, bash, npm)
 *
 * @example
 * ```typescript
 * import { DOWithPrimitives } from 'dotdo/presets'
 *
 * class MyDO extends DOWithPrimitives {
 *   // Has $.fs, $.git, $.bash, $.npm ready to use
 * }
 * ```
 */

export {
  DOWithPrimitives,
  DOWithAllPrimitives,
  type DOWithPrimitivesInstance,
  type DOWithPrimitivesContext,
  type PrimitivesContext,
} from './primitives'

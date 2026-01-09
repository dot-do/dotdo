/**
 * TypeDoc Configuration Module
 *
 * Provides configuration for TypeScript type documentation extraction
 * using fumadocs-typescript integration.
 */

import { typeDocConfig } from '../../../docs/source.config'

/**
 * TypeDoc configuration interface
 */
export interface TypeDocConfig {
  sourceFiles: string[]
  outputPath: string
  exportedTypes: string[]
  typeTableComponent: string
}

/**
 * Get the TypeDoc configuration for SDK documentation
 */
export function getTypeDocConfiguration(): TypeDocConfig {
  return {
    sourceFiles: typeDocConfig.sourceFiles,
    outputPath: typeDocConfig.outputPath,
    exportedTypes: typeDocConfig.exportedTypes,
    typeTableComponent: typeDocConfig.typeTableComponent,
  }
}

/**
 * Check if a type is in the exported types list
 */
export function isExportedType(typeName: string): boolean {
  return typeDocConfig.exportedTypes.includes(typeName)
}

/**
 * Get source file for a type
 */
export function getSourceFileForType(typeName: string): string | undefined {
  // Map type names to source files
  const typeToFile: Record<string, string> = {
    Thing: 'types/Thing.ts',
    ThingData: 'types/Thing.ts',
    ThingDO: 'types/Thing.ts',
    ThingIdentity: 'types/Thing.ts',
    WorkflowContext: 'types/WorkflowContext.ts',
    OnProxy: 'types/WorkflowContext.ts',
    ScheduleBuilder: 'types/WorkflowContext.ts',
    DomainProxy: 'types/WorkflowContext.ts',
    DOFunction: 'types/WorkflowContext.ts',
    FsCapability: 'types/capabilities.ts',
    GitCapability: 'types/capabilities.ts',
    BashCapability: 'types/capabilities.ts',
    WithFs: 'types/capabilities.ts',
    WithGit: 'types/capabilities.ts',
    WithBash: 'types/capabilities.ts',
    WithAllCapabilities: 'types/capabilities.ts',
    RateLimitResult: 'types/WorkflowContext.ts',
    RateLimitCheckOptions: 'types/WorkflowContext.ts',
    RateLimitCapability: 'types/WorkflowContext.ts',
    Things: 'types/Things.ts',
  }

  return typeToFile[typeName]
}

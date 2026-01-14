/**
 * Safety analysis types
 */

export type ViolationType =
  | 'dangerous_import'
  | 'code_execution'
  | 'filesystem_access'
  | 'network_access'
  | 'dangerous_attribute'
  | 'serialization_danger'
  | 'ffi_danger'
  | 'infinite_loop'
  | 'resource_exhaustion'
  | 'command_injection'

export type Severity = 'error' | 'warning'

export interface SafetyViolation {
  type: ViolationType
  message: string
  line?: number
  column?: number
  severity: Severity
}

export interface SafetyReport {
  safe: boolean
  violations: SafetyViolation[]
}

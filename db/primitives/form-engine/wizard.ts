/**
 * FormEngine Wizard Module
 *
 * Multi-step form navigation with progress tracking, validation, and state persistence
 */

import type {
  FormSchema,
  FormStep,
  FormField,
  FormData,
  ValidationResult,
} from './types'
import { validate, createValidator } from './validation'
import { evaluateConditions } from './conditional'

// ============================================================================
// TYPES
// ============================================================================

export interface WizardState {
  currentStep: number
  data: FormData
  completedSteps: string[]
}

export interface StepInfo {
  id: string
  title: string
  description?: string
  fields: FormField[]
  status: 'complete' | 'current' | 'upcoming' | 'skipped'
}

export interface StepNavigation {
  from: number
  to: number
  fromStepId: string
  toStepId: string
}

export interface StepCompleteEvent {
  stepIndex: number
  stepId: string
  data: FormData
}

export interface WizardCompleteEvent {
  data: FormData
}

export interface WizardOptions {
  startStep?: number
  initialData?: FormData
  completedSteps?: string[]
  validateOnNext?: boolean
  beforeNext?: (data: FormData, step: FormStep) => boolean | Promise<boolean>
  beforePrevious?: (data: FormData, step: FormStep) => boolean | Promise<boolean>
}

export interface SubmitResult {
  data: FormData
  status: 'partial' | 'complete'
  currentStep?: number
  completedSteps?: string[]
}

type WizardEventType = 'stepChange' | 'stepComplete' | 'validationError' | 'complete'

// ============================================================================
// FORM WIZARD CLASS
// ============================================================================

export class FormWizard {
  private schema: FormSchema
  private options: WizardOptions
  private _currentStep: number
  private _data: FormData
  private _completedSteps: Set<string>
  private eventListeners: Map<WizardEventType, Array<(data: unknown) => void>> = new Map()

  constructor(schema: FormSchema, options: WizardOptions = {}) {
    this.schema = schema
    this.options = {
      validateOnNext: true,
      ...options,
    }

    this._currentStep = options.startStep ?? 0
    this._data = options.initialData ?? {}
    this._completedSteps = new Set(options.completedSteps ?? [])
  }

  // ============================================================================
  // GETTERS
  // ============================================================================

  get currentStep(): number {
    return this._currentStep
  }

  get currentStepId(): string {
    return this.getSteps()[this._currentStep]?.id ?? ''
  }

  get data(): FormData {
    return this._data
  }

  get totalSteps(): number {
    return this.getSteps().length
  }

  get isComplete(): boolean {
    return this._completedSteps.size === this.totalSteps
  }

  get completedSteps(): string[] {
    return Array.from(this._completedSteps)
  }

  get progress(): number {
    if (this.totalSteps === 0) return 0
    return (this._completedSteps.size / this.totalSteps) * 100
  }

  // ============================================================================
  // NAVIGATION
  // ============================================================================

  /**
   * Go to the next step
   */
  async next(): Promise<void> {
    const currentStepDef = this.getCurrentStepDef()

    // Validate current step
    if (this.options.validateOnNext) {
      const result = await this.validateCurrentStep()
      if (!result.valid) {
        this.emit('validationError', result)
        throw new Error('Validation failed')
      }
    }

    // Run beforeNext hooks
    if (this.options.beforeNext) {
      const allowed = await this.options.beforeNext(this._data, currentStepDef)
      if (!allowed) {
        throw new Error('Navigation blocked by beforeNext hook')
      }
    }

    if (currentStepDef.beforeNext) {
      const allowed = await currentStepDef.beforeNext(this._data, this.createContext())
      if (!allowed) {
        throw new Error('Navigation blocked by step beforeNext hook')
      }
    }

    // Mark current step as complete
    this._completedSteps.add(currentStepDef.id)
    this.emit('stepComplete', {
      stepIndex: this._currentStep,
      stepId: currentStepDef.id,
      data: this.getStepData(currentStepDef.id),
    } as StepCompleteEvent)

    // Find next visible step
    const conditionResult = evaluateConditions(this.schema, this._data, { currentStep: this._currentStep })

    if (conditionResult.skipToEnd) {
      this._currentStep = this.totalSteps - 1
    } else if (conditionResult.nextStep !== undefined) {
      const fromStep = this._currentStep
      this._currentStep = Math.min(conditionResult.nextStep, this.totalSteps - 1)
      this.emitStepChange(fromStep, this._currentStep)
    } else {
      const fromStep = this._currentStep
      if (this._currentStep < this.totalSteps - 1) {
        this._currentStep++
        this.emitStepChange(fromStep, this._currentStep)
      }
    }
  }

  /**
   * Go to the previous step
   */
  async previous(): Promise<void> {
    if (this._currentStep <= 0) {
      return
    }

    const currentStepDef = this.getCurrentStepDef()

    // Run beforePrevious hook
    if (this.options.beforePrevious) {
      const allowed = await this.options.beforePrevious(this._data, currentStepDef)
      if (!allowed) {
        throw new Error('Navigation blocked by beforePrevious hook')
      }
    }

    const fromStep = this._currentStep
    this._currentStep--
    this.emitStepChange(fromStep, this._currentStep)
  }

  /**
   * Go to a specific step by index or ID
   */
  async goToStep(stepOrId: number | string): Promise<void> {
    let targetStep: number

    if (typeof stepOrId === 'string') {
      targetStep = this.getSteps().findIndex(s => s.id === stepOrId)
      if (targetStep === -1) {
        throw new Error(`Invalid step ID: ${stepOrId}`)
      }
    } else {
      targetStep = stepOrId
    }

    if (targetStep < 0 || targetStep >= this.totalSteps) {
      throw new Error(`Invalid step index: ${targetStep}`)
    }

    const fromStep = this._currentStep
    this._currentStep = targetStep
    this.emitStepChange(fromStep, targetStep)
  }

  /**
   * Skip to a specific step
   */
  async skipTo(stepId: string): Promise<void> {
    await this.goToStep(stepId)
  }

  /**
   * Skip to the end of the form
   */
  async skipToEnd(): Promise<void> {
    const fromStep = this._currentStep
    this._currentStep = this.totalSteps - 1
    this.emitStepChange(fromStep, this._currentStep)
  }

  // ============================================================================
  // VALIDATION
  // ============================================================================

  /**
   * Validate the current step
   */
  async validateCurrentStep(): Promise<ValidationResult> {
    const stepDef = this.getCurrentStepDef()

    // Create a schema with just the current step's fields
    const stepSchema: FormSchema = {
      id: this.schema.id,
      title: this.schema.title,
      fields: stepDef.fields,
    }

    return validate(stepSchema, this._data)
  }

  /**
   * Validate all steps
   */
  async validateAll(): Promise<ValidationResult> {
    return validate(this.schema, this._data)
  }

  // ============================================================================
  // DATA MANAGEMENT
  // ============================================================================

  /**
   * Set data for the current step
   */
  setStepData(data: FormData): void {
    this._data = { ...this._data, ...data }
  }

  /**
   * Get data for a specific step
   */
  getStepData(stepId: string): FormData {
    const step = this.getSteps().find(s => s.id === stepId)
    if (!step) return {}

    const stepData: FormData = {}
    for (const field of step.fields) {
      if (field.id in this._data) {
        stepData[field.id] = this._data[field.id]
      }
    }
    return stepData
  }

  /**
   * Get all form data
   */
  getAllData(): FormData {
    return { ...this._data }
  }

  /**
   * Clear all data
   */
  clearData(): void {
    this._data = {}
  }

  /**
   * Reset the wizard
   */
  reset(): void {
    this._currentStep = this.options.startStep ?? 0
    this._data = {}
    this._completedSteps.clear()
  }

  // ============================================================================
  // STEP INFORMATION
  // ============================================================================

  /**
   * Get current step information
   */
  getCurrentStepInfo(): StepInfo {
    return this.getStepInfo(this._currentStep)
  }

  /**
   * Get step information by index or ID
   */
  getStepInfo(stepOrId: number | string): StepInfo {
    let step: FormStep
    let stepIndex: number

    if (typeof stepOrId === 'string') {
      stepIndex = this.getSteps().findIndex(s => s.id === stepOrId)
      step = this.getSteps()[stepIndex]
    } else {
      stepIndex = stepOrId
      step = this.getSteps()[stepIndex]
    }

    if (!step) {
      throw new Error(`Step not found: ${stepOrId}`)
    }

    return {
      id: step.id,
      title: step.title,
      description: step.description,
      fields: step.fields,
      status: this.getStepStatus(step.id, stepIndex),
    }
  }

  /**
   * Get all steps information
   */
  getAllStepsInfo(): StepInfo[] {
    return this.getSteps().map((step, index) => ({
      id: step.id,
      title: step.title,
      description: step.description,
      fields: step.fields,
      status: this.getStepStatus(step.id, index),
    }))
  }

  /**
   * Get visible steps only
   */
  getVisibleSteps(): StepInfo[] {
    const conditionResult = evaluateConditions(this.schema, this._data)

    return this.getAllStepsInfo().filter(
      step => conditionResult.stepVisibility[step.id] !== false
    )
  }

  /**
   * Get step completion status
   */
  isStepComplete(stepId: string): boolean {
    return this._completedSteps.has(stepId)
  }

  /**
   * Manually mark a step as complete
   */
  markStepComplete(stepId: string): void {
    this._completedSteps.add(stepId)
  }

  // ============================================================================
  // NAVIGATION HELPERS
  // ============================================================================

  canGoNext(): boolean {
    return this._currentStep < this.totalSteps - 1
  }

  canGoPrevious(): boolean {
    return this._currentStep > 0
  }

  isFirstStep(): boolean {
    return this._currentStep === 0
  }

  isLastStep(): boolean {
    return this._currentStep === this.totalSteps - 1
  }

  // ============================================================================
  // STATE PERSISTENCE
  // ============================================================================

  /**
   * Export wizard state
   */
  exportState(): WizardState {
    return {
      currentStep: this._currentStep,
      data: { ...this._data },
      completedSteps: Array.from(this._completedSteps),
    }
  }

  /**
   * Import wizard state
   */
  importState(state: WizardState): void {
    this._currentStep = state.currentStep
    this._data = { ...state.data }
    this._completedSteps = new Set(state.completedSteps)
  }

  /**
   * Export to JSON
   */
  toJSON(): string {
    return JSON.stringify(this.exportState())
  }

  /**
   * Import from JSON
   */
  fromJSON(json: string): void {
    const state = JSON.parse(json) as WizardState
    this.importState(state)
  }

  // ============================================================================
  // SUBMISSION
  // ============================================================================

  /**
   * Submit the complete form
   */
  async submit(): Promise<SubmitResult> {
    // Validate all steps
    const result = await this.validateAll()
    if (!result.valid) {
      throw new Error('Form validation failed')
    }

    return {
      data: this.getAllData(),
      status: 'complete',
    }
  }

  /**
   * Submit partial form (save progress)
   */
  async submitPartial(): Promise<SubmitResult> {
    return {
      data: this.getAllData(),
      status: 'partial',
      currentStep: this._currentStep,
      completedSteps: this.completedSteps,
    }
  }

  /**
   * Mark wizard as complete (final step)
   */
  async complete(): Promise<void> {
    this.emit('complete', {
      data: this.getAllData(),
    } as WizardCompleteEvent)
  }

  // ============================================================================
  // EVENTS
  // ============================================================================

  /**
   * Register an event listener
   */
  on(event: WizardEventType, listener: (data: unknown) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, [])
    }
    this.eventListeners.get(event)!.push(listener)
  }

  private emit(event: WizardEventType, data: unknown): void {
    const listeners = this.eventListeners.get(event) || []
    for (const listener of listeners) {
      listener(data)
    }
  }

  private emitStepChange(from: number, to: number): void {
    const steps = this.getSteps()
    this.emit('stepChange', {
      from,
      to,
      fromStepId: steps[from]?.id ?? '',
      toStepId: steps[to]?.id ?? '',
    } as StepNavigation)
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private getSteps(): FormStep[] {
    return this.schema.steps ?? []
  }

  private getCurrentStepDef(): FormStep {
    const steps = this.getSteps()
    return steps[this._currentStep] ?? { id: '', title: '', fields: [] }
  }

  private getStepStatus(stepId: string, stepIndex: number): StepInfo['status'] {
    if (this._completedSteps.has(stepId)) {
      return 'complete'
    }
    if (stepIndex === this._currentStep) {
      return 'current'
    }
    if (stepIndex > this._currentStep) {
      return 'upcoming'
    }
    return 'skipped'
  }

  private createContext(): { data: FormData; schema: FormSchema } {
    return {
      data: this._data,
      schema: this.schema,
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createWizard(schema: FormSchema, options?: WizardOptions): FormWizard {
  return new FormWizard(schema, options)
}

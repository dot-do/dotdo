/**
 * Multi-step Form Wizard Tests
 *
 * Tests for wizard flows with progress tracking, step navigation,
 * and form state persistence across steps
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  FormWizard,
  createWizard,
  WizardState,
  StepNavigation,
} from '../wizard'
import { createFormSchema } from '../schema'
import type { FormSchema, FormStep, FormData } from '../types'

describe('FormWizard', () => {
  let schema: FormSchema
  let wizard: FormWizard

  beforeEach(() => {
    schema = createFormSchema({
      id: 'multi-step',
      title: 'Multi-Step Form',
      steps: [
        {
          id: 'personal',
          title: 'Personal Info',
          description: 'Tell us about yourself',
          fields: [
            { id: 'firstName', type: 'text', label: 'First Name', required: true },
            { id: 'lastName', type: 'text', label: 'Last Name', required: true },
          ],
        },
        {
          id: 'contact',
          title: 'Contact Info',
          description: 'How can we reach you?',
          fields: [
            { id: 'email', type: 'email', label: 'Email', required: true },
            { id: 'phone', type: 'phone', label: 'Phone' },
          ],
        },
        {
          id: 'review',
          title: 'Review',
          description: 'Review your information',
          fields: [],
        },
      ],
    })

    wizard = createWizard(schema)
  })

  describe('Initialization', () => {
    it('should start at step 0', () => {
      expect(wizard.currentStep).toBe(0)
      expect(wizard.currentStepId).toBe('personal')
    })

    it('should have empty initial data', () => {
      expect(wizard.data).toEqual({})
    })

    it('should know total steps', () => {
      expect(wizard.totalSteps).toBe(3)
    })

    it('should track completion state', () => {
      expect(wizard.isComplete).toBe(false)
    })

    it('should start from specific step', () => {
      const wizardFromStep = createWizard(schema, { startStep: 1 })
      expect(wizardFromStep.currentStep).toBe(1)
      expect(wizardFromStep.currentStepId).toBe('contact')
    })

    it('should initialize with data', () => {
      const wizardWithData = createWizard(schema, {
        initialData: { firstName: 'John', lastName: 'Doe' },
      })
      expect(wizardWithData.data.firstName).toBe('John')
    })

    it('should initialize with completed steps', () => {
      const wizardWithProgress = createWizard(schema, {
        startStep: 1,
        completedSteps: ['personal'],
      })
      expect(wizardWithProgress.isStepComplete('personal')).toBe(true)
    })
  })

  describe('Step Navigation', () => {
    it('should go to next step', async () => {
      wizard.setStepData({ firstName: 'John', lastName: 'Doe' })
      await wizard.next()

      expect(wizard.currentStep).toBe(1)
      expect(wizard.currentStepId).toBe('contact')
    })

    it('should mark step as complete when moving forward', async () => {
      wizard.setStepData({ firstName: 'John', lastName: 'Doe' })
      await wizard.next()

      expect(wizard.isStepComplete('personal')).toBe(true)
    })

    it('should go to previous step', async () => {
      wizard.setStepData({ firstName: 'John', lastName: 'Doe' })
      await wizard.next()
      wizard.setStepData({ email: 'john@example.com' })
      await wizard.previous()

      expect(wizard.currentStep).toBe(0)
      expect(wizard.currentStepId).toBe('personal')
    })

    it('should preserve data when going back', async () => {
      wizard.setStepData({ firstName: 'John', lastName: 'Doe' })
      await wizard.next()
      wizard.setStepData({ email: 'john@example.com' })
      await wizard.previous()

      expect(wizard.data.firstName).toBe('John')
      expect(wizard.data.email).toBe('john@example.com')
    })

    it('should not go before first step', async () => {
      await wizard.previous()
      expect(wizard.currentStep).toBe(0)
    })

    it('should not go beyond last step with next()', async () => {
      wizard.setStepData({ firstName: 'John', lastName: 'Doe' })
      await wizard.next()
      wizard.setStepData({ email: 'john@example.com' })
      await wizard.next()
      await wizard.next() // Already at last step

      expect(wizard.currentStep).toBe(2)
    })

    it('should go to specific step by index', async () => {
      await wizard.goToStep(2)
      expect(wizard.currentStep).toBe(2)
    })

    it('should go to specific step by id', async () => {
      await wizard.goToStep('review')
      expect(wizard.currentStepId).toBe('review')
    })

    it('should validate bounds for goToStep', async () => {
      await expect(wizard.goToStep(-1)).rejects.toThrow(/Invalid/)
      await expect(wizard.goToStep(10)).rejects.toThrow(/Invalid/)
    })
  })

  describe('Step Validation', () => {
    it('should validate current step before proceeding', async () => {
      // Don't fill required fields
      await expect(wizard.next()).rejects.toThrow(/Validation/)
      expect(wizard.currentStep).toBe(0) // Should stay on same step
    })

    it('should allow skip validation when configured', async () => {
      const skipWizard = createWizard(schema, { validateOnNext: false })
      await skipWizard.next() // Should work without data
      expect(skipWizard.currentStep).toBe(1)
    })

    it('should return validation errors', async () => {
      wizard.setStepData({ firstName: '' }) // Invalid

      const result = await wizard.validateCurrentStep()

      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('should validate all fields on current step', async () => {
      const result = await wizard.validateCurrentStep()

      // Should have errors for both firstName and lastName
      const errorFields = result.errors.map((e) => e.field)
      expect(errorFields).toContain('firstName')
      expect(errorFields).toContain('lastName')
    })

    it('should not validate hidden fields', async () => {
      const conditionalSchema = createFormSchema({
        id: 'conditional',
        title: 'Conditional',
        steps: [
          {
            id: 'step1',
            title: 'Step 1',
            fields: [
              { id: 'hasBusiness', type: 'checkbox', label: 'Has Business' },
              {
                id: 'businessName',
                type: 'text',
                label: 'Business Name',
                required: true,
                conditions: [
                  {
                    when: { field: 'hasBusiness', operator: 'equals', value: true },
                    action: 'show',
                  },
                ],
              },
            ],
          },
        ],
      })

      const condWizard = createWizard(conditionalSchema)
      condWizard.setStepData({ hasBusiness: false })

      const result = await condWizard.validateCurrentStep()
      expect(result.valid).toBe(true) // businessName is hidden, not required
    })
  })

  describe('Progress Tracking', () => {
    it('should calculate progress percentage', async () => {
      expect(wizard.progress).toBe(0)

      wizard.setStepData({ firstName: 'John', lastName: 'Doe' })
      await wizard.next()

      expect(wizard.progress).toBeCloseTo(33.33, 0) // 1/3 complete
    })

    it('should update progress as steps complete', async () => {
      wizard.setStepData({ firstName: 'John', lastName: 'Doe' })
      await wizard.next()
      wizard.setStepData({ email: 'john@example.com' })
      await wizard.next()

      expect(wizard.progress).toBeCloseTo(66.67, 0) // 2/3 complete
    })

    it('should track completed steps', async () => {
      expect(wizard.completedSteps).toEqual([])

      wizard.setStepData({ firstName: 'John', lastName: 'Doe' })
      await wizard.next()

      expect(wizard.completedSteps).toContain('personal')
    })

    it('should get step completion status', () => {
      expect(wizard.isStepComplete('personal')).toBe(false)

      wizard.markStepComplete('personal')

      expect(wizard.isStepComplete('personal')).toBe(true)
    })
  })

  describe('Step Information', () => {
    it('should get current step info', () => {
      const stepInfo = wizard.getCurrentStepInfo()

      expect(stepInfo.id).toBe('personal')
      expect(stepInfo.title).toBe('Personal Info')
      expect(stepInfo.description).toBe('Tell us about yourself')
      expect(stepInfo.fields).toHaveLength(2)
    })

    it('should get step info by index', () => {
      const stepInfo = wizard.getStepInfo(1)

      expect(stepInfo.id).toBe('contact')
      expect(stepInfo.title).toBe('Contact Info')
    })

    it('should get step info by id', () => {
      const stepInfo = wizard.getStepInfo('review')

      expect(stepInfo.title).toBe('Review')
    })

    it('should get all steps info', () => {
      const steps = wizard.getAllStepsInfo()

      expect(steps).toHaveLength(3)
      expect(steps.map((s) => s.id)).toEqual(['personal', 'contact', 'review'])
    })

    it('should include step status in info', async () => {
      wizard.setStepData({ firstName: 'John', lastName: 'Doe' })
      await wizard.next()

      const steps = wizard.getAllStepsInfo()

      expect(steps[0].status).toBe('complete')
      expect(steps[1].status).toBe('current')
      expect(steps[2].status).toBe('upcoming')
    })
  })

  describe('Data Management', () => {
    it('should set data for current step', () => {
      wizard.setStepData({ firstName: 'John' })

      expect(wizard.data.firstName).toBe('John')
    })

    it('should merge with existing data', () => {
      wizard.setStepData({ firstName: 'John' })
      wizard.setStepData({ lastName: 'Doe' })

      expect(wizard.data.firstName).toBe('John')
      expect(wizard.data.lastName).toBe('Doe')
    })

    it('should get data for specific step', async () => {
      wizard.setStepData({ firstName: 'John', lastName: 'Doe' })
      await wizard.next()
      wizard.setStepData({ email: 'john@example.com' })

      const step1Data = wizard.getStepData('personal')
      const step2Data = wizard.getStepData('contact')

      expect(step1Data).toEqual({ firstName: 'John', lastName: 'Doe' })
      expect(step2Data).toEqual({ email: 'john@example.com' })
    })

    it('should get all form data', async () => {
      wizard.setStepData({ firstName: 'John', lastName: 'Doe' })
      await wizard.next()
      wizard.setStepData({ email: 'john@example.com', phone: '555-1234' })

      const allData = wizard.getAllData()

      expect(allData).toEqual({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        phone: '555-1234',
      })
    })

    it('should clear data', () => {
      wizard.setStepData({ firstName: 'John' })
      wizard.clearData()

      expect(wizard.data).toEqual({})
    })

    it('should reset wizard', async () => {
      wizard.setStepData({ firstName: 'John', lastName: 'Doe' })
      await wizard.next()
      wizard.reset()

      expect(wizard.currentStep).toBe(0)
      expect(wizard.data).toEqual({})
      expect(wizard.completedSteps).toEqual([])
    })
  })

  describe('Step Skipping', () => {
    it('should skip hidden steps', async () => {
      const skipSchema = createFormSchema({
        id: 'skip',
        title: 'Skip Test',
        steps: [
          {
            id: 'step1',
            title: 'Step 1',
            fields: [{ id: 'skipNext', type: 'checkbox', label: 'Skip Next' }],
          },
          {
            id: 'step2',
            title: 'Step 2',
            fields: [{ id: 'data', type: 'text', label: 'Data' }],
            conditions: [
              {
                when: { field: 'skipNext', operator: 'equals', value: true },
                action: 'hide',
              },
            ],
          },
          {
            id: 'step3',
            title: 'Step 3',
            fields: [{ id: 'final', type: 'text', label: 'Final' }],
          },
        ],
      })

      const skipWizard = createWizard(skipSchema)
      skipWizard.setStepData({ skipNext: true })
      await skipWizard.next()

      expect(skipWizard.currentStepId).toBe('step3') // Skipped step2
    })

    it('should handle skip to specific step', async () => {
      wizard.setStepData({ firstName: 'John', lastName: 'Doe' })
      await wizard.skipTo('review')

      expect(wizard.currentStepId).toBe('review')
    })

    it('should handle skipToEnd', async () => {
      await wizard.skipToEnd()

      expect(wizard.currentStep).toBe(wizard.totalSteps - 1)
    })

    it('should get visible steps only', () => {
      const visibleSteps = wizard.getVisibleSteps()
      expect(visibleSteps).toHaveLength(3)
    })
  })

  describe('Navigation Guards', () => {
    it('should call beforeNext hook', async () => {
      const beforeNext = vi.fn().mockResolvedValue(true)
      const guardedWizard = createWizard(schema, { beforeNext })

      guardedWizard.setStepData({ firstName: 'John', lastName: 'Doe' })
      await guardedWizard.next()

      expect(beforeNext).toHaveBeenCalledWith(
        expect.objectContaining({ firstName: 'John' }),
        expect.objectContaining({ id: 'personal' })
      )
    })

    it('should block navigation when beforeNext returns false', async () => {
      const beforeNext = vi.fn().mockResolvedValue(false)
      const guardedWizard = createWizard(schema, { beforeNext })

      guardedWizard.setStepData({ firstName: 'John', lastName: 'Doe' })
      await expect(guardedWizard.next()).rejects.toThrow(/blocked/)

      expect(guardedWizard.currentStep).toBe(0)
    })

    it('should call beforePrevious hook', async () => {
      const beforePrevious = vi.fn().mockResolvedValue(true)
      const guardedWizard = createWizard(schema, { beforePrevious })

      guardedWizard.setStepData({ firstName: 'John', lastName: 'Doe' })
      await guardedWizard.next()
      await guardedWizard.previous()

      expect(beforePrevious).toHaveBeenCalled()
    })

    it('should support step-level beforeNext', async () => {
      const stepSchema = createFormSchema({
        id: 'test',
        title: 'Test',
        steps: [
          {
            id: 'step1',
            title: 'Step 1',
            fields: [{ id: 'agree', type: 'checkbox', label: 'Agree', required: true }],
            beforeNext: async (data) => {
              return data.agree === true
            },
          },
          {
            id: 'step2',
            title: 'Step 2',
            fields: [],
          },
        ],
      })

      const stepWizard = createWizard(stepSchema)
      stepWizard.setStepData({ agree: false })

      await expect(stepWizard.next()).rejects.toThrow()
    })
  })

  describe('Events', () => {
    it('should emit stepChange event', async () => {
      const onStepChange = vi.fn()
      wizard.on('stepChange', onStepChange)

      wizard.setStepData({ firstName: 'John', lastName: 'Doe' })
      await wizard.next()

      expect(onStepChange).toHaveBeenCalledWith({
        from: 0,
        to: 1,
        fromStepId: 'personal',
        toStepId: 'contact',
      })
    })

    it('should emit stepComplete event', async () => {
      const onStepComplete = vi.fn()
      wizard.on('stepComplete', onStepComplete)

      wizard.setStepData({ firstName: 'John', lastName: 'Doe' })
      await wizard.next()

      expect(onStepComplete).toHaveBeenCalledWith({
        stepIndex: 0,
        stepId: 'personal',
        data: expect.objectContaining({ firstName: 'John' }),
      })
    })

    it('should emit validationError event', async () => {
      const onValidationError = vi.fn()
      wizard.on('validationError', onValidationError)

      try {
        await wizard.next()
      } catch {
        // Expected
      }

      expect(onValidationError).toHaveBeenCalled()
    })

    it('should emit complete event on final step', async () => {
      const onComplete = vi.fn()
      wizard.on('complete', onComplete)

      wizard.setStepData({ firstName: 'John', lastName: 'Doe' })
      await wizard.next()
      wizard.setStepData({ email: 'john@example.com' })
      await wizard.next()

      // At review step, mark as complete
      await wizard.complete()

      expect(onComplete).toHaveBeenCalledWith({
        data: expect.objectContaining({
          firstName: 'John',
          email: 'john@example.com',
        }),
      })
    })
  })

  describe('State Persistence', () => {
    it('should export state', async () => {
      wizard.setStepData({ firstName: 'John', lastName: 'Doe' })
      await wizard.next()
      wizard.setStepData({ email: 'john@example.com' })

      const state = wizard.exportState()

      expect(state.currentStep).toBe(1)
      expect(state.data.firstName).toBe('John')
      expect(state.completedSteps).toContain('personal')
    })

    it('should import state', () => {
      const state: WizardState = {
        currentStep: 1,
        data: { firstName: 'John', lastName: 'Doe', email: 'john@example.com' },
        completedSteps: ['personal'],
      }

      wizard.importState(state)

      expect(wizard.currentStep).toBe(1)
      expect(wizard.data.firstName).toBe('John')
      expect(wizard.isStepComplete('personal')).toBe(true)
    })

    it('should serialize to JSON', async () => {
      wizard.setStepData({ firstName: 'John', lastName: 'Doe' })
      await wizard.next()

      const json = wizard.toJSON()
      const parsed = JSON.parse(json)

      expect(parsed.currentStep).toBe(1)
      expect(parsed.data.firstName).toBe('John')
    })

    it('should restore from JSON', () => {
      const json = JSON.stringify({
        currentStep: 2,
        data: { firstName: 'John', email: 'john@example.com' },
        completedSteps: ['personal', 'contact'],
      })

      wizard.fromJSON(json)

      expect(wizard.currentStep).toBe(2)
      expect(wizard.completedSteps).toContain('personal')
      expect(wizard.completedSteps).toContain('contact')
    })
  })

  describe('Submission', () => {
    it('should submit complete wizard', async () => {
      wizard.setStepData({ firstName: 'John', lastName: 'Doe' })
      await wizard.next()
      wizard.setStepData({ email: 'john@example.com' })
      await wizard.next()

      const submission = await wizard.submit()

      expect(submission.data).toEqual({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
      })
    })

    it('should validate all steps before submission', async () => {
      wizard.setStepData({ firstName: 'John' }) // Missing lastName
      await wizard.goToStep(2) // Skip to end without completing

      await expect(wizard.submit()).rejects.toThrow(/validation/)
    })

    it('should allow partial submission', async () => {
      wizard.setStepData({ firstName: 'John', lastName: 'Doe' })
      await wizard.next()

      const partial = await wizard.submitPartial()

      expect(partial.status).toBe('partial')
      expect(partial.currentStep).toBe(1)
    })
  })

  describe('Navigation Helpers', () => {
    it('should know if can go next', () => {
      expect(wizard.canGoNext()).toBe(true)

      wizard.goToStep(2)
      expect(wizard.canGoNext()).toBe(false) // At last step
    })

    it('should know if can go previous', () => {
      expect(wizard.canGoPrevious()).toBe(false) // At first step

      wizard.goToStep(1)
      expect(wizard.canGoPrevious()).toBe(true)
    })

    it('should check if on first step', () => {
      expect(wizard.isFirstStep()).toBe(true)

      wizard.goToStep(1)
      expect(wizard.isFirstStep()).toBe(false)
    })

    it('should check if on last step', () => {
      expect(wizard.isLastStep()).toBe(false)

      wizard.goToStep(2)
      expect(wizard.isLastStep()).toBe(true)
    })
  })
})

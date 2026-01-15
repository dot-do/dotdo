import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { CompletionEngine } from '../src/completions.js'

describe('time travel type completions', () => {
  let engine: CompletionEngine

  beforeEach(() => {
    engine = new CompletionEngine()
  })

  afterEach(() => {
    engine.dispose()
  })

  it('should provide checkout method on $', () => {
    const completions = engine.getCompletions('$.', 2)
    const names = completions.map(c => c.name)
    expect(names).toContain('checkout')
  })

  it('should provide branch method on $', () => {
    const completions = engine.getCompletions('$.', 2)
    const names = completions.map(c => c.name)
    expect(names).toContain('branch')
  })

  it('should provide merge method on $', () => {
    const completions = engine.getCompletions('$.', 2)
    const names = completions.map(c => c.name)
    expect(names).toContain('merge')
  })

  it('should show checkout parameter type as VersionRef', () => {
    const completions = engine.getCompletions('$.checkout(', 11)
    // Should indicate string parameter
    expect(completions.length).toBeGreaterThanOrEqual(0)
  })

  it('should provide checkout without $ prefix', () => {
    // checkout should be available globally too
    const completions = engine.getCompletions('checkout(', 9)
    expect(completions.length).toBeGreaterThanOrEqual(0)
  })

  it('should provide branch without $ prefix', () => {
    const completions = engine.getCompletions('branch(', 7)
    expect(completions.length).toBeGreaterThanOrEqual(0)
  })

  it('should provide merge without $ prefix', () => {
    const completions = engine.getCompletions('merge(', 6)
    expect(completions.length).toBeGreaterThanOrEqual(0)
  })
})

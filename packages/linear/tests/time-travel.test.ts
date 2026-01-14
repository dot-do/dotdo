/**
 * Time-Travel Query Tests
 *
 * Tests for the dotdo extension that allows querying issue state at a specific point in time.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { LinearLocal } from '../src/client'

describe('Time-Travel Queries', () => {
  let linear: LinearLocal
  let teamId: string

  beforeEach(async () => {
    linear = new LinearLocal()
    const team = await linear.teamCreate({
      name: 'Engineering',
      key: 'ENG',
    })
    teamId = team.team!.id
  })

  describe('issueAsOf', () => {
    it('returns null for non-existent issue', async () => {
      const result = await linear.issueAsOf('non-existent-id', Date.now())
      expect(result).toBeNull()
    })

    it('returns null for timestamp before issue creation', async () => {
      const beforeCreation = Date.now()

      // Wait a bit to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10))

      const issue = await linear.issueCreate({
        teamId,
        title: 'Test Issue',
      })

      const result = await linear.issueAsOf(issue.issue!.id, beforeCreation)
      expect(result).toBeNull()
    })

    it('returns issue state at creation time', async () => {
      const issue = await linear.issueCreate({
        teamId,
        title: 'Original Title',
      })

      const creationTime = Date.now()

      // Wait and update
      await new Promise((resolve) => setTimeout(resolve, 10))
      await linear.issueUpdate(issue.issue!.id, {
        title: 'Updated Title',
      })

      // Query at creation time should return original state
      const atCreation = await linear.issueAsOf(issue.issue!.id, creationTime)
      expect(atCreation).toBeDefined()
      expect(atCreation!.title).toBe('Original Title')
    })

    it('returns latest state for current timestamp', async () => {
      const issue = await linear.issueCreate({
        teamId,
        title: 'Original Title',
        priority: 0,
      })

      await new Promise((resolve) => setTimeout(resolve, 10))
      await linear.issueUpdate(issue.issue!.id, {
        title: 'First Update',
        priority: 2,
      })

      await new Promise((resolve) => setTimeout(resolve, 10))
      await linear.issueUpdate(issue.issue!.id, {
        title: 'Second Update',
        priority: 1,
      })

      const current = await linear.issueAsOf(issue.issue!.id, Date.now())
      expect(current).toBeDefined()
      expect(current!.title).toBe('Second Update')
      expect(current!.priority).toBe(1)
    })

    it('returns null for deleted issues', async () => {
      const issue = await linear.issueCreate({
        teamId,
        title: 'To Be Deleted',
      })

      const beforeDeletion = Date.now()

      await new Promise((resolve) => setTimeout(resolve, 10))
      await linear.issueDelete(issue.issue!.id)

      // After deletion, should return null
      const afterDeletion = await linear.issueAsOf(issue.issue!.id, Date.now())
      expect(afterDeletion).toBeNull()

      // Before deletion, should still return the issue
      const beforeDelete = await linear.issueAsOf(issue.issue!.id, beforeDeletion)
      expect(beforeDelete).toBeDefined()
      expect(beforeDelete!.title).toBe('To Be Deleted')
    })
  })

  describe('issueHistory', () => {
    it('returns history for an issue', async () => {
      const issue = await linear.issueCreate({
        teamId,
        title: 'Test Issue',
      })

      const history = await linear.issueHistory(issue.issue!.id)
      expect(history.length).toBeGreaterThan(0)
      expect(history[0].issue).toBeDefined()
    })

    it('returns empty for non-existent issue', async () => {
      const history = await linear.issueHistory('non-existent-id')
      expect(history.length).toBe(0)
    })
  })
})

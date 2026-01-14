/**
 * Jira Issue Compat Layer Tests (RED Phase)
 *
 * Tests for the local Jira implementation demonstrating:
 * - Issue CRUD operations
 * - Issue transitions (workflow state changes)
 * - Issue fields (standard and custom)
 * - Issue relationships (links, subtasks, parent)
 * - Issue comments and worklogs
 * - JQL search queries
 * - Webhook events
 *
 * Based on Jira REST API v3:
 * @see https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { JiraLocal, JiraClient } from '../index'
import type {
  Issue,
  IssueCreateInput,
  IssueUpdateInput,
  IssueTransitionInput,
  IssueFields,
  Project,
  WebhookPayload,
  JqlSearchResult,
} from '../types'

describe('JiraLocal - Local Jira Implementation', () => {
  let jira: JiraLocal
  const webhookEvents: WebhookPayload[] = []

  beforeEach(() => {
    webhookEvents.length = 0
    jira = new JiraLocal({
      webhooks: true,
      onWebhookEvent: (event) => {
        webhookEvents.push(event)
      },
      defaultProjectKey: 'TEST',
    })
  })

  afterEach(() => {
    jira.dispose()
  })

  // ===========================================================================
  // Initialization Tests
  // ===========================================================================

  describe('initialization', () => {
    it('should create a JiraLocal instance', () => {
      expect(jira).toBeDefined()
      // Verify core methods exist
      expect(jira.issues).toBeDefined()
      expect(jira.issues.create).toBeDefined()
      expect(jira.issues.get).toBeDefined()
      expect(jira.issues.update).toBeDefined()
      expect(jira.issues.delete).toBeDefined()
      expect(jira.issues.transition).toBeDefined()
    })

    it('should create a JiraClient instance with credentials', () => {
      const client = new JiraClient({
        host: 'test.atlassian.net',
        email: 'test@example.com',
        apiToken: 'test-token',
      })
      expect(client).toBeDefined()
    })

    it('should support myself query for current user', async () => {
      const myself = await jira.myself()
      expect(myself).toBeDefined()
      expect(myself.accountId).toBeDefined()
      expect(myself.displayName).toBeDefined()
    })
  })

  // ===========================================================================
  // Project Setup Tests
  // ===========================================================================

  describe('projects', () => {
    it('should create a project', async () => {
      const project = await jira.projects.create({
        key: 'PROJ',
        name: 'Test Project',
        projectTypeKey: 'software',
      })

      expect(project.id).toBeDefined()
      expect(project.key).toBe('PROJ')
      expect(project.name).toBe('Test Project')
    })

    it('should retrieve a project by key', async () => {
      await jira.projects.create({
        key: 'DEMO',
        name: 'Demo Project',
      })

      const project = await jira.projects.get('DEMO')
      expect(project.key).toBe('DEMO')
      expect(project.name).toBe('Demo Project')
    })

    it('should list all projects', async () => {
      await jira.projects.create({ key: 'PRJ1', name: 'Project 1' })
      await jira.projects.create({ key: 'PRJ2', name: 'Project 2' })

      const result = await jira.projects.list()
      expect(result.values.length).toBeGreaterThanOrEqual(2)
    })
  })

  // ===========================================================================
  // Issue CRUD Tests
  // ===========================================================================

  describe('issues - CRUD operations', () => {
    let projectKey: string

    beforeEach(async () => {
      const project = await jira.projects.create({
        key: 'CRUD',
        name: 'CRUD Test Project',
        projectTypeKey: 'software',
      })
      projectKey = project.key
    })

    describe('create', () => {
      it('should create an issue with required fields', async () => {
        const input: IssueCreateInput = {
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Test issue creation',
          },
        }

        const result = await jira.issues.create(input)

        expect(result.id).toBeDefined()
        expect(result.key).toMatch(new RegExp(`^${projectKey}-\\d+$`))
        expect(result.self).toBeDefined()
      })

      it('should create an issue with description', async () => {
        const result = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Issue with description',
            description: 'This is a detailed description of the issue.',
          },
        })

        const issue = await jira.issues.get(result.key)
        expect(issue.fields.description).toBe('This is a detailed description of the issue.')
      })

      it('should create an issue with ADF description', async () => {
        const result = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Issue with ADF',
            description: {
              type: 'doc',
              version: 1,
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'ADF formatted content' }],
                },
              ],
            },
          },
        })

        const issue = await jira.issues.get(result.key)
        expect(issue.fields.description).toMatchObject({
          type: 'doc',
          version: 1,
        })
      })

      it('should create an issue with priority', async () => {
        const result = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Bug' },
            summary: 'High priority bug',
            priority: { name: 'High' },
          },
        })

        const issue = await jira.issues.get(result.key)
        expect(issue.fields.priority?.name).toBe('High')
      })

      it('should create an issue with assignee', async () => {
        const myself = await jira.myself()

        const result = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Assigned issue',
            assignee: { accountId: myself.accountId },
          },
        })

        const issue = await jira.issues.get(result.key)
        expect(issue.fields.assignee?.accountId).toBe(myself.accountId)
      })

      it('should create an issue with labels', async () => {
        const result = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Labeled issue',
            labels: ['backend', 'api', 'urgent'],
          },
        })

        const issue = await jira.issues.get(result.key)
        expect(issue.fields.labels).toContain('backend')
        expect(issue.fields.labels).toContain('api')
        expect(issue.fields.labels).toContain('urgent')
      })

      it('should create an issue with due date', async () => {
        const dueDate = '2025-12-31'

        const result = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Issue with due date',
            duedate: dueDate,
          },
        })

        const issue = await jira.issues.get(result.key)
        expect(issue.fields.duedate).toBe(dueDate)
      })

      it('should create a Bug issue type', async () => {
        const result = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Bug' },
            summary: 'Application crashes on login',
          },
        })

        const issue = await jira.issues.get(result.key)
        expect(issue.fields.issuetype.name).toBe('Bug')
      })

      it('should create a Story issue type', async () => {
        const result = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Story' },
            summary: 'As a user, I want to reset my password',
          },
        })

        const issue = await jira.issues.get(result.key)
        expect(issue.fields.issuetype.name).toBe('Story')
      })

      it('should create an Epic issue type', async () => {
        const result = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Epic' },
            summary: 'User Authentication Epic',
          },
        })

        const issue = await jira.issues.get(result.key)
        expect(issue.fields.issuetype.name).toBe('Epic')
      })

      it('should create a subtask', async () => {
        // First create parent issue
        const parent = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Story' },
            summary: 'Parent story',
          },
        })

        // Create subtask
        const result = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Sub-task' },
            summary: 'Subtask of parent',
            parent: { key: parent.key },
          },
        })

        const subtask = await jira.issues.get(result.key)
        expect(subtask.fields.issuetype.subtask).toBe(true)
        expect(subtask.fields.parent?.key).toBe(parent.key)
      })
    })

    describe('get', () => {
      it('should retrieve an issue by key', async () => {
        const created = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Issue to retrieve',
          },
        })

        const issue = await jira.issues.get(created.key)
        expect(issue.key).toBe(created.key)
        expect(issue.id).toBe(created.id)
        expect(issue.fields.summary).toBe('Issue to retrieve')
      })

      it('should retrieve an issue by ID', async () => {
        const created = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Issue to retrieve by ID',
          },
        })

        const issue = await jira.issues.get(created.id)
        expect(issue.id).toBe(created.id)
      })

      it('should expand changelog when requested', async () => {
        const created = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Issue with changelog',
          },
        })

        // Update to create changelog entry
        await jira.issues.update(created.key, {
          fields: { summary: 'Updated summary' },
        })

        const issue = await jira.issues.get(created.key, { expand: ['changelog'] })
        expect(issue.changelog).toBeDefined()
        expect(issue.changelog!.histories.length).toBeGreaterThan(0)
      })

      it('should expand transitions when requested', async () => {
        const created = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Issue with transitions',
          },
        })

        const issue = await jira.issues.get(created.key, { expand: ['transitions'] })
        expect(issue.transitions).toBeDefined()
        expect(issue.transitions!.length).toBeGreaterThan(0)
      })

      it('should return specific fields when requested', async () => {
        const created = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Issue with specific fields',
            description: 'A description',
            labels: ['test'],
          },
        })

        const issue = await jira.issues.get(created.key, { fields: ['summary', 'status'] })
        expect(issue.fields.summary).toBeDefined()
        expect(issue.fields.status).toBeDefined()
        // Other fields should be undefined or not expanded
      })

      it('should throw error for non-existent issue', async () => {
        await expect(jira.issues.get('NONEXISTENT-999')).rejects.toThrow()
      })
    })

    describe('update', () => {
      it('should update issue summary', async () => {
        const created = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Original summary',
          },
        })

        await jira.issues.update(created.key, {
          fields: { summary: 'Updated summary' },
        })

        const issue = await jira.issues.get(created.key)
        expect(issue.fields.summary).toBe('Updated summary')
      })

      it('should update issue description', async () => {
        const created = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Issue to update description',
          },
        })

        await jira.issues.update(created.key, {
          fields: { description: 'New description content' },
        })

        const issue = await jira.issues.get(created.key)
        expect(issue.fields.description).toBe('New description content')
      })

      it('should update issue priority', async () => {
        const created = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Bug' },
            summary: 'Bug to reprioritize',
            priority: { name: 'Low' },
          },
        })

        await jira.issues.update(created.key, {
          fields: { priority: { name: 'Highest' } },
        })

        const issue = await jira.issues.get(created.key)
        expect(issue.fields.priority?.name).toBe('Highest')
      })

      it('should update issue assignee', async () => {
        const myself = await jira.myself()

        const created = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Issue to assign',
          },
        })

        await jira.issues.update(created.key, {
          fields: { assignee: { accountId: myself.accountId } },
        })

        const issue = await jira.issues.get(created.key)
        expect(issue.fields.assignee?.accountId).toBe(myself.accountId)
      })

      it('should unassign issue by setting assignee to null', async () => {
        const myself = await jira.myself()

        const created = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Assigned issue',
            assignee: { accountId: myself.accountId },
          },
        })

        await jira.issues.update(created.key, {
          fields: { assignee: null },
        })

        const issue = await jira.issues.get(created.key)
        expect(issue.fields.assignee).toBeNull()
      })

      it('should add labels using update operations', async () => {
        const created = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Issue for label updates',
            labels: ['existing'],
          },
        })

        await jira.issues.update(created.key, {
          update: {
            labels: [{ add: 'newlabel' }],
          },
        })

        const issue = await jira.issues.get(created.key)
        expect(issue.fields.labels).toContain('existing')
        expect(issue.fields.labels).toContain('newlabel')
      })

      it('should remove labels using update operations', async () => {
        const created = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Issue for label removal',
            labels: ['keep', 'remove'],
          },
        })

        await jira.issues.update(created.key, {
          update: {
            labels: [{ remove: 'remove' }],
          },
        })

        const issue = await jira.issues.get(created.key)
        expect(issue.fields.labels).toContain('keep')
        expect(issue.fields.labels).not.toContain('remove')
      })

      it('should update due date', async () => {
        const created = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Issue with due date',
          },
        })

        await jira.issues.update(created.key, {
          fields: { duedate: '2025-06-30' },
        })

        const issue = await jira.issues.get(created.key)
        expect(issue.fields.duedate).toBe('2025-06-30')
      })

      it('should track updated timestamp', async () => {
        const created = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Issue to track updates',
          },
        })

        const beforeUpdate = await jira.issues.get(created.key)
        const originalUpdated = beforeUpdate.fields.updated

        // Wait a bit to ensure different timestamp
        await new Promise((r) => setTimeout(r, 10))

        await jira.issues.update(created.key, {
          fields: { summary: 'Modified summary' },
        })

        const afterUpdate = await jira.issues.get(created.key)
        expect(new Date(afterUpdate.fields.updated).getTime()).toBeGreaterThan(
          new Date(originalUpdated).getTime()
        )
      })
    })

    describe('delete', () => {
      it('should delete an issue', async () => {
        const created = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Issue to delete',
          },
        })

        await jira.issues.delete(created.key)

        await expect(jira.issues.get(created.key)).rejects.toThrow()
      })

      it('should delete subtasks when deleting parent with deleteSubtasks flag', async () => {
        const parent = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Story' },
            summary: 'Parent to delete',
          },
        })

        const subtask = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Sub-task' },
            summary: 'Subtask to delete',
            parent: { key: parent.key },
          },
        })

        await jira.issues.delete(parent.key, { deleteSubtasks: true })

        await expect(jira.issues.get(parent.key)).rejects.toThrow()
        await expect(jira.issues.get(subtask.key)).rejects.toThrow()
      })
    })
  })

  // ===========================================================================
  // Issue Transitions Tests
  // ===========================================================================

  describe('issues - transitions', () => {
    let projectKey: string

    beforeEach(async () => {
      const project = await jira.projects.create({
        key: 'TRANS',
        name: 'Transitions Test Project',
        projectTypeKey: 'software',
      })
      projectKey = project.key
    })

    describe('getTransitions', () => {
      it('should list available transitions for an issue', async () => {
        const created = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Issue for transitions',
          },
        })

        const transitions = await jira.issues.getTransitions(created.key)

        expect(transitions.transitions).toBeDefined()
        expect(transitions.transitions.length).toBeGreaterThan(0)
        // Default workflow should have at least "In Progress" transition
        const transitionNames = transitions.transitions.map((t) => t.name)
        expect(transitionNames).toContain('In Progress')
      })

      it('should return transition with target status', async () => {
        const created = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Issue for transition details',
          },
        })

        const transitions = await jira.issues.getTransitions(created.key)
        const inProgress = transitions.transitions.find((t) => t.name === 'In Progress')

        expect(inProgress).toBeDefined()
        expect(inProgress!.to).toBeDefined()
        expect(inProgress!.to.name).toBe('In Progress')
        expect(inProgress!.to.statusCategory.key).toBe('indeterminate')
      })

      it('should return different transitions based on current status', async () => {
        const created = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Issue for status-based transitions',
          },
        })

        // Get transitions from initial state (To Do / Open)
        const initialTransitions = await jira.issues.getTransitions(created.key)

        // Transition to In Progress
        const inProgressTransition = initialTransitions.transitions.find(
          (t) => t.name === 'In Progress'
        )
        await jira.issues.transition(created.key, {
          transition: { id: inProgressTransition!.id },
        })

        // Get transitions from In Progress state
        const inProgressTransitions = await jira.issues.getTransitions(created.key)

        // Should now have different available transitions (e.g., Done, Back to To Do)
        const transitionNames = inProgressTransitions.transitions.map((t) => t.name)
        expect(transitionNames).toContain('Done')
      })
    })

    describe('transition', () => {
      it('should transition issue to In Progress', async () => {
        const created = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Issue to start',
          },
        })

        const transitions = await jira.issues.getTransitions(created.key)
        const inProgress = transitions.transitions.find((t) => t.name === 'In Progress')

        await jira.issues.transition(created.key, {
          transition: { id: inProgress!.id },
        })

        const issue = await jira.issues.get(created.key)
        expect(issue.fields.status.name).toBe('In Progress')
        expect(issue.fields.status.statusCategory.key).toBe('indeterminate')
      })

      it('should transition issue to Done', async () => {
        const created = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Issue to complete',
          },
        })

        // First transition to In Progress
        const transitions1 = await jira.issues.getTransitions(created.key)
        const inProgress = transitions1.transitions.find((t) => t.name === 'In Progress')
        await jira.issues.transition(created.key, {
          transition: { id: inProgress!.id },
        })

        // Then transition to Done
        const transitions2 = await jira.issues.getTransitions(created.key)
        const done = transitions2.transitions.find((t) => t.name === 'Done')
        await jira.issues.transition(created.key, {
          transition: { id: done!.id },
        })

        const issue = await jira.issues.get(created.key)
        expect(issue.fields.status.name).toBe('Done')
        expect(issue.fields.status.statusCategory.key).toBe('done')
      })

      it('should set resolution when transitioning to Done', async () => {
        const created = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Bug' },
            summary: 'Bug to resolve',
          },
        })

        // Transition to In Progress then Done
        const transitions1 = await jira.issues.getTransitions(created.key)
        await jira.issues.transition(created.key, {
          transition: { id: transitions1.transitions.find((t) => t.name === 'In Progress')!.id },
        })

        const transitions2 = await jira.issues.getTransitions(created.key)
        await jira.issues.transition(created.key, {
          transition: { id: transitions2.transitions.find((t) => t.name === 'Done')!.id },
          fields: {
            resolution: { name: 'Fixed' },
          },
        })

        const issue = await jira.issues.get(created.key)
        expect(issue.fields.resolution?.name).toBe('Fixed')
        expect(issue.fields.resolutiondate).toBeDefined()
      })

      it('should update fields during transition', async () => {
        const created = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Issue with transition fields',
          },
        })

        const transitions = await jira.issues.getTransitions(created.key)
        const inProgress = transitions.transitions.find((t) => t.name === 'In Progress')

        await jira.issues.transition(created.key, {
          transition: { id: inProgress!.id },
          fields: {
            assignee: { accountId: (await jira.myself()).accountId },
          },
        })

        const issue = await jira.issues.get(created.key)
        expect(issue.fields.status.name).toBe('In Progress')
        expect(issue.fields.assignee).toBeDefined()
      })

      it('should record transition in changelog', async () => {
        const created = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Issue for changelog',
          },
        })

        const transitions = await jira.issues.getTransitions(created.key)
        const inProgress = transitions.transitions.find((t) => t.name === 'In Progress')

        await jira.issues.transition(created.key, {
          transition: { id: inProgress!.id },
        })

        const issue = await jira.issues.get(created.key, { expand: ['changelog'] })
        const statusChange = issue.changelog!.histories
          .flatMap((h) => h.items)
          .find((item) => item.field === 'status')

        expect(statusChange).toBeDefined()
        expect(statusChange!.toString).toBe('In Progress')
      })

      it('should fail for invalid transition', async () => {
        const created = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Issue for invalid transition',
          },
        })

        await expect(
          jira.issues.transition(created.key, {
            transition: { id: 'invalid-transition-id' },
          })
        ).rejects.toThrow()
      })

      it('should transition by name', async () => {
        const created = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Issue for name transition',
          },
        })

        await jira.issues.transition(created.key, {
          transition: { name: 'In Progress' },
        })

        const issue = await jira.issues.get(created.key)
        expect(issue.fields.status.name).toBe('In Progress')
      })
    })
  })

  // ===========================================================================
  // Issue Fields Tests
  // ===========================================================================

  describe('issues - fields', () => {
    let projectKey: string

    beforeEach(async () => {
      const project = await jira.projects.create({
        key: 'FLDS',
        name: 'Fields Test Project',
        projectTypeKey: 'software',
      })
      projectKey = project.key
    })

    describe('standard fields', () => {
      it('should support summary field', async () => {
        const result = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Test summary field',
          },
        })

        const issue = await jira.issues.get(result.key)
        expect(issue.fields.summary).toBe('Test summary field')
      })

      it('should support description field as plain text', async () => {
        const result = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Issue with plain text description',
            description: 'Plain text description',
          },
        })

        const issue = await jira.issues.get(result.key)
        expect(issue.fields.description).toBe('Plain text description')
      })

      it('should support description field as ADF', async () => {
        const adf = {
          type: 'doc' as const,
          version: 1 as const,
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Bold text', marks: [{ type: 'strong' }] },
                { type: 'text', text: ' and normal text' },
              ],
            },
          ],
        }

        const result = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Issue with ADF description',
            description: adf,
          },
        })

        const issue = await jira.issues.get(result.key)
        expect(issue.fields.description).toMatchObject({
          type: 'doc',
          version: 1,
          content: expect.arrayContaining([
            expect.objectContaining({ type: 'paragraph' }),
          ]),
        })
      })

      it('should support priority field', async () => {
        const priorities = ['Highest', 'High', 'Medium', 'Low', 'Lowest']

        for (const priority of priorities) {
          const result = await jira.issues.create({
            fields: {
              project: { key: projectKey },
              issuetype: { name: 'Task' },
              summary: `${priority} priority issue`,
              priority: { name: priority },
            },
          })

          const issue = await jira.issues.get(result.key)
          expect(issue.fields.priority?.name).toBe(priority)
        }
      })

      it('should support labels field', async () => {
        const result = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Issue with labels',
            labels: ['frontend', 'backend', 'urgent', 'tech-debt'],
          },
        })

        const issue = await jira.issues.get(result.key)
        expect(issue.fields.labels).toHaveLength(4)
        expect(issue.fields.labels).toEqual(
          expect.arrayContaining(['frontend', 'backend', 'urgent', 'tech-debt'])
        )
      })

      it('should support components field', async () => {
        // First create a component
        await jira.projects.createComponent(projectKey, {
          name: 'API',
          description: 'API component',
        })

        const result = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Issue with component',
            components: [{ name: 'API' }],
          },
        })

        const issue = await jira.issues.get(result.key)
        expect(issue.fields.components).toHaveLength(1)
        expect(issue.fields.components![0].name).toBe('API')
      })

      it('should support fixVersions field', async () => {
        // First create a version
        await jira.projects.createVersion(projectKey, {
          name: 'v1.0.0',
          description: 'First release',
        })

        const result = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Bug' },
            summary: 'Bug to fix in v1.0.0',
            fixVersions: [{ name: 'v1.0.0' }],
          },
        })

        const issue = await jira.issues.get(result.key)
        expect(issue.fields.fixVersions).toHaveLength(1)
        expect(issue.fields.fixVersions![0].name).toBe('v1.0.0')
      })

      it('should support duedate field', async () => {
        const result = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Issue with due date',
            duedate: '2025-12-31',
          },
        })

        const issue = await jira.issues.get(result.key)
        expect(issue.fields.duedate).toBe('2025-12-31')
      })

      it('should support time tracking fields', async () => {
        const result = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Issue with time tracking',
            timetracking: {
              originalEstimate: '2d',
              remainingEstimate: '1d 4h',
            },
          },
        })

        const issue = await jira.issues.get(result.key)
        expect(issue.fields.timetracking?.originalEstimate).toBe('2d')
        expect(issue.fields.timetracking?.remainingEstimate).toBe('1d 4h')
        expect(issue.fields.timetracking?.originalEstimateSeconds).toBe(2 * 8 * 60 * 60) // 2 days in seconds
      })

      it('should auto-populate created timestamp', async () => {
        const beforeCreate = new Date()

        const result = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Issue with created timestamp',
          },
        })

        const afterCreate = new Date()
        const issue = await jira.issues.get(result.key)

        const created = new Date(issue.fields.created)
        expect(created.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime())
        expect(created.getTime()).toBeLessThanOrEqual(afterCreate.getTime())
      })

      it('should auto-populate reporter from current user', async () => {
        const myself = await jira.myself()

        const result = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Issue with auto reporter',
          },
        })

        const issue = await jira.issues.get(result.key)
        expect(issue.fields.reporter?.accountId).toBe(myself.accountId)
      })

      it('should set initial status based on workflow', async () => {
        const result = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Issue with initial status',
          },
        })

        const issue = await jira.issues.get(result.key)
        // Default workflow starts in "To Do" or "Open"
        expect(issue.fields.status.statusCategory.key).toBe('new')
      })
    })

    describe('custom fields', () => {
      it('should support story points custom field', async () => {
        const result = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Story' },
            summary: 'Story with points',
            customfield_10016: 5, // Story points
          },
        })

        const issue = await jira.issues.get(result.key)
        expect(issue.fields.customfield_10016).toBe(5)
      })

      it('should support sprint custom field', async () => {
        // Create a board and sprint first
        const board = await jira.agile.boards.create({
          name: 'Test Board',
          type: 'scrum',
          projectKeyOrId: projectKey,
        })

        const sprint = await jira.agile.sprints.create({
          name: 'Sprint 1',
          originBoardId: board.id,
        })

        const result = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Story' },
            summary: 'Story in sprint',
            customfield_10020: sprint.id, // Sprint
          },
        })

        const issue = await jira.issues.get(result.key)
        expect(issue.fields.customfield_10020).toBe(sprint.id)
      })

      it('should support epic link custom field', async () => {
        // Create an epic first
        const epic = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Epic' },
            summary: 'Parent Epic',
          },
        })

        const result = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Story' },
            summary: 'Story linked to epic',
            customfield_10014: epic.key, // Epic link
          },
        })

        const issue = await jira.issues.get(result.key)
        expect(issue.fields.customfield_10014).toBe(epic.key)
      })

      it('should support arbitrary custom fields', async () => {
        const result = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Issue with custom fields',
            customfield_10001: 'Custom text value',
            customfield_10002: 42,
            customfield_10003: ['option1', 'option2'],
          },
        })

        const issue = await jira.issues.get(result.key)
        expect(issue.fields.customfield_10001).toBe('Custom text value')
        expect(issue.fields.customfield_10002).toBe(42)
        expect(issue.fields.customfield_10003).toEqual(['option1', 'option2'])
      })
    })

    describe('field updates', () => {
      it('should update multiple fields atomically', async () => {
        const result = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Original summary',
            description: 'Original description',
            priority: { name: 'Low' },
          },
        })

        await jira.issues.update(result.key, {
          fields: {
            summary: 'Updated summary',
            description: 'Updated description',
            priority: { name: 'High' },
          },
        })

        const issue = await jira.issues.get(result.key)
        expect(issue.fields.summary).toBe('Updated summary')
        expect(issue.fields.description).toBe('Updated description')
        expect(issue.fields.priority?.name).toBe('High')
      })

      it('should support set operation for labels', async () => {
        const result = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Issue for label set',
            labels: ['old1', 'old2'],
          },
        })

        await jira.issues.update(result.key, {
          update: {
            labels: [{ set: ['new1', 'new2', 'new3'] }],
          },
        })

        const issue = await jira.issues.get(result.key)
        expect(issue.fields.labels).toEqual(['new1', 'new2', 'new3'])
      })
    })
  })

  // ===========================================================================
  // Issue Relationships Tests
  // ===========================================================================

  describe('issues - relationships', () => {
    let projectKey: string

    beforeEach(async () => {
      const project = await jira.projects.create({
        key: 'RELS',
        name: 'Relationships Test Project',
        projectTypeKey: 'software',
      })
      projectKey = project.key
    })

    describe('issue links', () => {
      it('should create a blocks link', async () => {
        const blocker = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Blocking issue',
          },
        })

        const blocked = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Blocked issue',
          },
        })

        await jira.issueLinks.create({
          type: { name: 'Blocks' },
          inwardIssue: { key: blocked.key },
          outwardIssue: { key: blocker.key },
        })

        const blockedIssue = await jira.issues.get(blocked.key)
        const link = blockedIssue.fields.issuelinks?.find(
          (l) => l.type.name === 'Blocks' && l.outwardIssue?.key === blocker.key
        )
        expect(link).toBeDefined()
      })

      it('should create a relates to link', async () => {
        const issue1 = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Related issue 1',
          },
        })

        const issue2 = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Related issue 2',
          },
        })

        await jira.issueLinks.create({
          type: { name: 'Relates' },
          inwardIssue: { key: issue1.key },
          outwardIssue: { key: issue2.key },
        })

        const linkedIssue = await jira.issues.get(issue1.key)
        expect(linkedIssue.fields.issuelinks?.length).toBeGreaterThan(0)
      })

      it('should delete an issue link', async () => {
        const issue1 = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Issue 1',
          },
        })

        const issue2 = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Task' },
            summary: 'Issue 2',
          },
        })

        const link = await jira.issueLinks.create({
          type: { name: 'Relates' },
          inwardIssue: { key: issue1.key },
          outwardIssue: { key: issue2.key },
        })

        await jira.issueLinks.delete(link.id)

        const updatedIssue = await jira.issues.get(issue1.key)
        expect(
          updatedIssue.fields.issuelinks?.some((l) => l.id === link.id)
        ).toBe(false)
      })
    })

    describe('subtasks', () => {
      it('should create subtask with parent reference', async () => {
        const parent = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Story' },
            summary: 'Parent story',
          },
        })

        const subtask = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Sub-task' },
            summary: 'Child subtask',
            parent: { key: parent.key },
          },
        })

        const subtaskIssue = await jira.issues.get(subtask.key)
        expect(subtaskIssue.fields.parent?.key).toBe(parent.key)
        expect(subtaskIssue.fields.issuetype.subtask).toBe(true)
      })

      it('should list subtasks on parent issue', async () => {
        const parent = await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Story' },
            summary: 'Parent with subtasks',
          },
        })

        await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Sub-task' },
            summary: 'Subtask 1',
            parent: { key: parent.key },
          },
        })

        await jira.issues.create({
          fields: {
            project: { key: projectKey },
            issuetype: { name: 'Sub-task' },
            summary: 'Subtask 2',
            parent: { key: parent.key },
          },
        })

        const parentIssue = await jira.issues.get(parent.key)
        expect(parentIssue.fields.subtasks).toHaveLength(2)
      })
    })
  })

  // ===========================================================================
  // Issue Comments Tests
  // ===========================================================================

  describe('issues - comments', () => {
    let projectKey: string
    let issueKey: string

    beforeEach(async () => {
      const project = await jira.projects.create({
        key: 'CMNT',
        name: 'Comments Test Project',
        projectTypeKey: 'software',
      })
      projectKey = project.key

      const issue = await jira.issues.create({
        fields: {
          project: { key: projectKey },
          issuetype: { name: 'Task' },
          summary: 'Issue for comments',
        },
      })
      issueKey = issue.key
    })

    it('should add a comment', async () => {
      const comment = await jira.issues.addComment(issueKey, {
        body: 'This is a comment',
      })

      expect(comment.id).toBeDefined()
      expect(comment.body).toBe('This is a comment')
      expect(comment.author).toBeDefined()
    })

    it('should add a comment with ADF body', async () => {
      const comment = await jira.issues.addComment(issueKey, {
        body: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'ADF comment' }],
            },
          ],
        },
      })

      expect(comment.body).toMatchObject({
        type: 'doc',
        version: 1,
      })
    })

    it('should get comments for an issue', async () => {
      await jira.issues.addComment(issueKey, { body: 'Comment 1' })
      await jira.issues.addComment(issueKey, { body: 'Comment 2' })

      const comments = await jira.issues.getComments(issueKey)

      expect(comments.comments).toHaveLength(2)
      expect(comments.total).toBe(2)
    })

    it('should update a comment', async () => {
      const comment = await jira.issues.addComment(issueKey, {
        body: 'Original comment',
      })

      await jira.issues.updateComment(issueKey, comment.id, {
        body: 'Updated comment',
      })

      const comments = await jira.issues.getComments(issueKey)
      const updated = comments.comments.find((c) => c.id === comment.id)
      expect(updated?.body).toBe('Updated comment')
    })

    it('should delete a comment', async () => {
      const comment = await jira.issues.addComment(issueKey, {
        body: 'Comment to delete',
      })

      await jira.issues.deleteComment(issueKey, comment.id)

      const comments = await jira.issues.getComments(issueKey)
      expect(comments.comments.find((c) => c.id === comment.id)).toBeUndefined()
    })
  })

  // ===========================================================================
  // JQL Search Tests
  // ===========================================================================

  describe('search - JQL', () => {
    let projectKey: string

    beforeEach(async () => {
      const project = await jira.projects.create({
        key: 'SRCH',
        name: 'Search Test Project',
        projectTypeKey: 'software',
      })
      projectKey = project.key

      // Create test issues
      await jira.issues.create({
        fields: {
          project: { key: projectKey },
          issuetype: { name: 'Bug' },
          summary: 'Critical authentication bug',
          priority: { name: 'Highest' },
          labels: ['security', 'auth'],
        },
      })

      await jira.issues.create({
        fields: {
          project: { key: projectKey },
          issuetype: { name: 'Task' },
          summary: 'Implement OAuth flow',
          priority: { name: 'High' },
          labels: ['auth'],
        },
      })

      await jira.issues.create({
        fields: {
          project: { key: projectKey },
          issuetype: { name: 'Story' },
          summary: 'User login story',
          priority: { name: 'Medium' },
        },
      })
    })

    it('should search by project', async () => {
      const result = await jira.search({
        jql: `project = ${projectKey}`,
      })

      expect(result.total).toBe(3)
      expect(result.issues).toHaveLength(3)
    })

    it('should search by issue type', async () => {
      const result = await jira.search({
        jql: `project = ${projectKey} AND issuetype = Bug`,
      })

      expect(result.total).toBe(1)
      expect(result.issues[0].fields.issuetype.name).toBe('Bug')
    })

    it('should search by priority', async () => {
      const result = await jira.search({
        jql: `project = ${projectKey} AND priority = Highest`,
      })

      expect(result.total).toBe(1)
      expect(result.issues[0].fields.priority?.name).toBe('Highest')
    })

    it('should search by label', async () => {
      const result = await jira.search({
        jql: `project = ${projectKey} AND labels = auth`,
      })

      expect(result.total).toBe(2)
    })

    it('should search by text', async () => {
      const result = await jira.search({
        jql: `project = ${projectKey} AND summary ~ "authentication"`,
      })

      expect(result.total).toBe(1)
      expect(result.issues[0].fields.summary).toContain('authentication')
    })

    it('should search by status category', async () => {
      const result = await jira.search({
        jql: `project = ${projectKey} AND statusCategory = "To Do"`,
      })

      expect(result.total).toBe(3) // All new issues
    })

    it('should support pagination', async () => {
      const page1 = await jira.search({
        jql: `project = ${projectKey}`,
        startAt: 0,
        maxResults: 2,
      })

      expect(page1.startAt).toBe(0)
      expect(page1.maxResults).toBe(2)
      expect(page1.issues).toHaveLength(2)
      expect(page1.total).toBe(3)

      const page2 = await jira.search({
        jql: `project = ${projectKey}`,
        startAt: 2,
        maxResults: 2,
      })

      expect(page2.startAt).toBe(2)
      expect(page2.issues).toHaveLength(1)
    })

    it('should return specific fields', async () => {
      const result = await jira.search({
        jql: `project = ${projectKey}`,
        fields: ['summary', 'status'],
      })

      expect(result.issues[0].fields.summary).toBeDefined()
      expect(result.issues[0].fields.status).toBeDefined()
    })

    it('should order results', async () => {
      const result = await jira.search({
        jql: `project = ${projectKey} ORDER BY priority DESC`,
      })

      const priorities = result.issues.map((i) => i.fields.priority?.name)
      expect(priorities[0]).toBe('Highest')
    })

    it('should support complex JQL with AND/OR', async () => {
      const result = await jira.search({
        jql: `project = ${projectKey} AND (issuetype = Bug OR priority = High)`,
      })

      expect(result.total).toBe(2)
    })
  })

  // ===========================================================================
  // Webhook Events Tests
  // ===========================================================================

  describe('webhook events', () => {
    let projectKey: string

    beforeEach(async () => {
      const project = await jira.projects.create({
        key: 'HOOK',
        name: 'Webhook Test Project',
        projectTypeKey: 'software',
      })
      projectKey = project.key
    })

    it('should emit jira:issue_created event', async () => {
      await jira.issues.create({
        fields: {
          project: { key: projectKey },
          issuetype: { name: 'Task' },
          summary: 'Webhook test issue',
        },
      })

      await new Promise((r) => setTimeout(r, 10))

      const createEvent = webhookEvents.find(
        (e) => e.webhookEvent === 'jira:issue_created'
      )
      expect(createEvent).toBeDefined()
      expect(createEvent!.issue).toBeDefined()
    })

    it('should emit jira:issue_updated event', async () => {
      const created = await jira.issues.create({
        fields: {
          project: { key: projectKey },
          issuetype: { name: 'Task' },
          summary: 'Issue to update',
        },
      })

      webhookEvents.length = 0

      await jira.issues.update(created.key, {
        fields: { summary: 'Updated summary' },
      })

      await new Promise((r) => setTimeout(r, 10))

      const updateEvent = webhookEvents.find(
        (e) => e.webhookEvent === 'jira:issue_updated'
      )
      expect(updateEvent).toBeDefined()
      expect(updateEvent!.changelog).toBeDefined()
    })

    it('should emit jira:issue_deleted event', async () => {
      const created = await jira.issues.create({
        fields: {
          project: { key: projectKey },
          issuetype: { name: 'Task' },
          summary: 'Issue to delete',
        },
      })

      webhookEvents.length = 0

      await jira.issues.delete(created.key)

      await new Promise((r) => setTimeout(r, 10))

      const deleteEvent = webhookEvents.find(
        (e) => e.webhookEvent === 'jira:issue_deleted'
      )
      expect(deleteEvent).toBeDefined()
    })

    it('should emit comment_created event', async () => {
      const created = await jira.issues.create({
        fields: {
          project: { key: projectKey },
          issuetype: { name: 'Task' },
          summary: 'Issue for comment',
        },
      })

      webhookEvents.length = 0

      await jira.issues.addComment(created.key, {
        body: 'New comment',
      })

      await new Promise((r) => setTimeout(r, 10))

      const commentEvent = webhookEvents.find(
        (e) => e.webhookEvent === 'comment_created'
      )
      expect(commentEvent).toBeDefined()
      expect(commentEvent!.comment).toBeDefined()
    })

    it('should include changelog in update events', async () => {
      const created = await jira.issues.create({
        fields: {
          project: { key: projectKey },
          issuetype: { name: 'Task' },
          summary: 'Original',
          priority: { name: 'Low' },
        },
      })

      webhookEvents.length = 0

      await jira.issues.update(created.key, {
        fields: {
          summary: 'Updated',
          priority: { name: 'High' },
        },
      })

      await new Promise((r) => setTimeout(r, 10))

      const updateEvent = webhookEvents.find(
        (e) => e.webhookEvent === 'jira:issue_updated'
      )
      expect(updateEvent!.changelog!.histories).toHaveLength(1)

      const changedFields = updateEvent!.changelog!.histories[0].items.map(
        (i) => i.field
      )
      expect(changedFields).toContain('summary')
      expect(changedFields).toContain('priority')
    })
  })

  // ===========================================================================
  // Changelog / History Tests
  // ===========================================================================

  describe('issues - changelog', () => {
    let projectKey: string

    beforeEach(async () => {
      const project = await jira.projects.create({
        key: 'HIST',
        name: 'History Test Project',
        projectTypeKey: 'software',
      })
      projectKey = project.key
    })

    it('should track summary changes in changelog', async () => {
      const created = await jira.issues.create({
        fields: {
          project: { key: projectKey },
          issuetype: { name: 'Task' },
          summary: 'Original summary',
        },
      })

      await jira.issues.update(created.key, {
        fields: { summary: 'Updated summary' },
      })

      const issue = await jira.issues.get(created.key, { expand: ['changelog'] })
      const change = issue.changelog!.histories[0].items.find(
        (i) => i.field === 'summary'
      )

      expect(change?.fromString).toBe('Original summary')
      expect(change?.toString).toBe('Updated summary')
    })

    it('should track status changes in changelog', async () => {
      const created = await jira.issues.create({
        fields: {
          project: { key: projectKey },
          issuetype: { name: 'Task' },
          summary: 'Status tracking',
        },
      })

      const transitions = await jira.issues.getTransitions(created.key)
      const inProgress = transitions.transitions.find((t) => t.name === 'In Progress')

      await jira.issues.transition(created.key, {
        transition: { id: inProgress!.id },
      })

      const issue = await jira.issues.get(created.key, { expand: ['changelog'] })
      const statusChange = issue.changelog!.histories
        .flatMap((h) => h.items)
        .find((i) => i.field === 'status')

      expect(statusChange?.toString).toBe('In Progress')
    })

    it('should track assignee changes in changelog', async () => {
      const myself = await jira.myself()

      const created = await jira.issues.create({
        fields: {
          project: { key: projectKey },
          issuetype: { name: 'Task' },
          summary: 'Assignee tracking',
        },
      })

      await jira.issues.update(created.key, {
        fields: { assignee: { accountId: myself.accountId } },
      })

      const issue = await jira.issues.get(created.key, { expand: ['changelog'] })
      const assigneeChange = issue.changelog!.histories
        .flatMap((h) => h.items)
        .find((i) => i.field === 'assignee')

      expect(assigneeChange?.toString).toBe(myself.displayName)
      expect(assigneeChange?.to).toBe(myself.accountId)
    })

    it('should record author of each change', async () => {
      const myself = await jira.myself()

      const created = await jira.issues.create({
        fields: {
          project: { key: projectKey },
          issuetype: { name: 'Task' },
          summary: 'Author tracking',
        },
      })

      await jira.issues.update(created.key, {
        fields: { summary: 'Changed' },
      })

      const issue = await jira.issues.get(created.key, { expand: ['changelog'] })
      expect(issue.changelog!.histories[0].author.accountId).toBe(myself.accountId)
    })

    it('should record timestamp of each change', async () => {
      const created = await jira.issues.create({
        fields: {
          project: { key: projectKey },
          issuetype: { name: 'Task' },
          summary: 'Timestamp tracking',
        },
      })

      const beforeUpdate = new Date()
      await jira.issues.update(created.key, {
        fields: { summary: 'Changed' },
      })
      const afterUpdate = new Date()

      const issue = await jira.issues.get(created.key, { expand: ['changelog'] })
      const changeTime = new Date(issue.changelog!.histories[0].created)

      expect(changeTime.getTime()).toBeGreaterThanOrEqual(beforeUpdate.getTime())
      expect(changeTime.getTime()).toBeLessThanOrEqual(afterUpdate.getTime())
    })
  })
})

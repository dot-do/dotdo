/**
 * LinearLocal Client Tests
 *
 * Tests for the core Linear client functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { LinearLocal } from '../src/client'

describe('LinearLocal', () => {
  let linear: LinearLocal

  beforeEach(async () => {
    linear = new LinearLocal()
  })

  afterEach(async () => {
    // Clear state after each test to prevent memory buildup
    await linear.clear()
  })

  describe('viewer', () => {
    it('returns the current user', async () => {
      const user = await linear.viewer
      expect(user).toBeDefined()
      expect(user.id).toBeDefined()
      expect(user.name).toBe('Local User')
      expect(user.email).toBe('user@local.dev')
    })
  })

  describe('teams', () => {
    it('creates a team with default workflow states', async () => {
      const result = await linear.teamCreate({
        name: 'Engineering',
        key: 'ENG',
      })

      expect(result.success).toBe(true)
      expect(result.team).toBeDefined()
      expect(result.team!.name).toBe('Engineering')
      expect(result.team!.key).toBe('ENG')

      // Verify default workflow states
      const states = await result.team!.states!()
      expect(states.nodes.length).toBe(5)
      expect(states.nodes.map((s) => s.name)).toContain('Backlog')
      expect(states.nodes.map((s) => s.name)).toContain('Done')
    })

    it('retrieves and lists teams', async () => {
      await linear.teamCreate({ name: 'Engineering', key: 'ENG' })
      await linear.teamCreate({ name: 'Product', key: 'PROD' })

      const teams = await linear.teams()
      expect(teams.nodes.length).toBe(2)

      const team = await linear.team(teams.nodes[0].id)
      expect(team.name).toBeDefined()
    })

    it('updates a team', async () => {
      const created = await linear.teamCreate({
        name: 'Engineering',
        key: 'ENG',
      })

      const updated = await linear.teamUpdate(created.team!.id, {
        name: 'Engineering Team',
        description: 'The engineering team',
      })

      expect(updated.team!.name).toBe('Engineering Team')
      expect(updated.team!.description).toBe('The engineering team')
    })
  })

  describe('issues', () => {
    let teamId: string

    beforeEach(async () => {
      const team = await linear.teamCreate({
        name: 'Engineering',
        key: 'ENG',
      })
      teamId = team.team!.id
    })

    it('creates issues with sequential numbers', async () => {
      const issue1 = await linear.issueCreate({ teamId, title: 'Issue 1' })
      const issue2 = await linear.issueCreate({ teamId, title: 'Issue 2' })

      expect(issue1.issue!.number).toBe(1)
      expect(issue1.issue!.identifier).toBe('ENG-1')
      expect(issue2.issue!.number).toBe(2)
      expect(issue2.issue!.identifier).toBe('ENG-2')
    })

    it('retrieves and updates an issue', async () => {
      const created = await linear.issueCreate({
        teamId,
        title: 'Test Issue',
        priority: 2,
      })

      expect(created.issue!.priority).toBe(2)
      expect(created.issue!.priorityLabel).toBe('High')

      const updated = await linear.issueUpdate(created.issue!.id, {
        title: 'Updated Title',
        priority: 1,
      })

      expect(updated.issue!.title).toBe('Updated Title')
      expect(updated.issue!.priority).toBe(1)
      expect(updated.issue!.priorityLabel).toBe('Urgent')
    })

    it('archives and deletes issues', async () => {
      const created = await linear.issueCreate({ teamId, title: 'To Archive' })

      const archived = await linear.issueArchive(created.issue!.id)
      expect(archived.success).toBe(true)
      expect(archived.entity!.archivedAt).toBeDefined()

      const unarchived = await linear.issueUnarchive(created.issue!.id)
      expect(unarchived.entity!.archivedAt).toBeNull()

      const deleted = await linear.issueDelete(created.issue!.id)
      expect(deleted.success).toBe(true)

      await expect(linear.issue(created.issue!.id)).rejects.toThrow('Issue not found')
    })

    it('lists and filters issues', async () => {
      await linear.issueCreate({ teamId, title: 'High Priority', priority: 1 })
      await linear.issueCreate({ teamId, title: 'Medium Priority', priority: 3 })
      await linear.issueCreate({ teamId, title: 'Low Priority', priority: 4 })

      const all = await linear.issues()
      expect(all.nodes.length).toBe(3)

      const urgent = await linear.issues({ filter: { priority: { eq: 1 } } })
      expect(urgent.nodes.length).toBe(1)
      expect(urgent.nodes[0].title).toBe('High Priority')
    })

    it('searches issues by text', async () => {
      await linear.issueCreate({ teamId, title: 'Fix login bug' })
      await linear.issueCreate({ teamId, title: 'Add new feature' })

      const results = await linear.searchIssues('login')
      expect(results.nodes.length).toBe(1)
      expect(results.nodes[0].title).toBe('Fix login bug')
    })

    it('paginates issues', async () => {
      for (let i = 1; i <= 5; i++) {
        await linear.issueCreate({ teamId, title: `Issue ${i}` })
      }

      const page1 = await linear.issues({ first: 2 })
      expect(page1.nodes.length).toBe(2)
      expect(page1.pageInfo.hasNextPage).toBe(true)

      const page2 = await linear.issues({ first: 2, after: page1.pageInfo.endCursor })
      expect(page2.nodes.length).toBe(2)
      expect(page2.pageInfo.hasNextPage).toBe(true)
    })

    it('tracks state transitions with timestamps', async () => {
      const created = await linear.issueCreate({ teamId, title: 'Track State' })
      expect(created.issue!.startedAt).toBeNull()
      expect(created.issue!.completedAt).toBeNull()

      const team = await linear.team(teamId)
      const states = await team.states!()
      const doneState = states.nodes.find((s) => s.type === 'completed')!

      const done = await linear.issueUpdate(created.issue!.id, {
        stateId: doneState.id,
      })
      expect(done.issue!.completedAt).toBeDefined()
    })
  })

  describe('projects', () => {
    let teamId: string

    beforeEach(async () => {
      const team = await linear.teamCreate({
        name: 'Engineering',
        key: 'ENG',
      })
      teamId = team.team!.id
    })

    it('creates and retrieves a project', async () => {
      const result = await linear.projectCreate({
        name: 'Q1 Launch',
        teamIds: [teamId],
      })

      expect(result.success).toBe(true)
      expect(result.project!.name).toBe('Q1 Launch')
      expect(result.project!.state).toBe('planned')

      const project = await linear.project(result.project!.id)
      expect(project.name).toBe('Q1 Launch')
    })

    it('updates and archives a project', async () => {
      const created = await linear.projectCreate({
        name: 'Test',
        teamIds: [teamId],
      })

      const updated = await linear.projectUpdate(created.project!.id, {
        name: 'Updated',
        state: 'started',
      })
      expect(updated.project!.name).toBe('Updated')
      expect(updated.project!.state).toBe('started')
      expect(updated.project!.startedAt).toBeDefined()

      const archived = await linear.projectArchive(created.project!.id)
      expect(archived.project!.archivedAt).toBeDefined()
    })

    it('lists and filters projects', async () => {
      await linear.projectCreate({ name: 'Planned', teamIds: [teamId], state: 'planned' })
      await linear.projectCreate({ name: 'Started', teamIds: [teamId], state: 'started' })

      const all = await linear.projects()
      expect(all.nodes.length).toBe(2)

      const started = await linear.projects({ filter: { state: { eq: 'started' } } })
      expect(started.nodes.length).toBe(1)
      expect(started.nodes[0].name).toBe('Started')
    })

    it('creates project milestones and updates', async () => {
      const project = await linear.projectCreate({
        name: 'Milestone Project',
        teamIds: [teamId],
      })

      const milestone = await linear.projectMilestoneCreate({
        projectId: project.project!.id,
        name: 'Beta Release',
      })
      expect(milestone.projectMilestone!.name).toBe('Beta Release')

      const update = await linear.projectUpdateCreate({
        projectId: project.project!.id,
        body: 'Making progress!',
        health: 'onTrack',
      })
      expect(update.projectUpdate!.body).toBe('Making progress!')
    })
  })

  describe('cycles', () => {
    let teamId: string

    beforeEach(async () => {
      const team = await linear.teamCreate({
        name: 'Engineering',
        key: 'ENG',
      })
      teamId = team.team!.id
    })

    it('creates cycles with sequential numbers', async () => {
      const start = new Date().toISOString()
      const end = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()

      const cycle1 = await linear.cycleCreate({
        teamId,
        name: 'Sprint 1',
        startsAt: start,
        endsAt: end,
      })
      const cycle2 = await linear.cycleCreate({
        teamId,
        startsAt: start,
        endsAt: end,
      })

      expect(cycle1.cycle!.number).toBe(1)
      expect(cycle1.cycle!.name).toBe('Sprint 1')
      expect(cycle2.cycle!.number).toBe(2)
    })

    it('updates a cycle', async () => {
      const start = new Date().toISOString()
      const end = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()

      const created = await linear.cycleCreate({
        teamId,
        startsAt: start,
        endsAt: end,
      })

      const updated = await linear.cycleUpdate(created.cycle!.id, {
        name: 'Updated Sprint',
        description: 'Sprint goals',
      })

      expect(updated.cycle!.name).toBe('Updated Sprint')
      expect(updated.cycle!.description).toBe('Sprint goals')
    })
  })

  describe('comments', () => {
    let teamId: string
    let issueId: string

    beforeEach(async () => {
      const team = await linear.teamCreate({
        name: 'Engineering',
        key: 'ENG',
      })
      teamId = team.team!.id

      const issue = await linear.issueCreate({
        teamId,
        title: 'Test Issue',
      })
      issueId = issue.issue!.id
    })

    it('creates, updates, and deletes comments', async () => {
      const created = await linear.commentCreate({
        issueId,
        body: 'Original text',
      })
      expect(created.comment!.body).toBe('Original text')

      const updated = await linear.commentUpdate(created.comment!.id, {
        body: 'Updated text',
      })
      expect(updated.comment!.body).toBe('Updated text')
      expect(updated.comment!.editedAt).toBeDefined()

      const deleted = await linear.commentDelete(created.comment!.id)
      expect(deleted.success).toBe(true)

      await expect(linear.comment(created.comment!.id)).rejects.toThrow('Comment not found')
    })
  })

  describe('labels', () => {
    let teamId: string

    beforeEach(async () => {
      const team = await linear.teamCreate({
        name: 'Engineering',
        key: 'ENG',
      })
      teamId = team.team!.id
    })

    it('creates and updates labels', async () => {
      const created = await linear.issueLabelCreate({
        teamId,
        name: 'Bug',
        color: '#ff0000',
      })
      expect(created.issueLabel!.name).toBe('Bug')
      expect(created.issueLabel!.color).toBe('#ff0000')

      const updated = await linear.issueLabelUpdate(created.issueLabel!.id, {
        name: 'Critical Bug',
        color: '#990000',
      })
      expect(updated.issueLabel!.name).toBe('Critical Bug')
      expect(updated.issueLabel!.color).toBe('#990000')

      const labels = await linear.issueLabels()
      expect(labels.nodes.length).toBe(1)
    })
  })

  describe('webhooks', () => {
    it('creates and manages webhooks', async () => {
      const created = await linear.webhookCreate({
        url: 'https://example.com/webhook',
        resourceTypes: ['Issue', 'Comment'],
      })
      expect(created.webhook!.url).toBe('https://example.com/webhook')
      expect(created.webhook!.secret).toBeDefined()

      const updated = await linear.webhookUpdate(created.webhook!.id, {
        enabled: false,
      })
      expect(updated.webhook!.enabled).toBe(false)

      const webhooks = await linear.webhooks()
      expect(webhooks.nodes.length).toBe(1)

      const deleted = await linear.webhookDelete(created.webhook!.id)
      expect(deleted.success).toBe(true)
    })
  })

  describe('clear', () => {
    it('clears all state', async () => {
      const team = await linear.teamCreate({ name: 'Test', key: 'TEST' })
      await linear.issueCreate({ teamId: team.team!.id, title: 'Issue' })
      await linear.projectCreate({ name: 'Project', teamIds: [team.team!.id] })

      await linear.clear()

      const teams = await linear.teams()
      expect(teams.nodes.length).toBe(0)

      const issues = await linear.issues()
      expect(issues.nodes.length).toBe(0)
    })
  })
})

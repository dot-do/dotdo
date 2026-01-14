/**
 * Linear Compat Layer Comprehensive Tests
 *
 * Tests for the local Linear implementation demonstrating:
 * - Issues (TemporalStore - time-travel queries)
 * - Projects (CRUD operations)
 * - Cycles (sprint/cycle management)
 * - Teams (team configuration)
 * - Comments (issue comments)
 * - Labels (issue labeling)
 * - Webhooks (event handling)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { LinearClient, LinearLocal } from '../index'
import type {
  Issue,
  Project,
  Cycle,
  Team,
  User,
  Comment,
  IssueLabel,
  WebhookPayload,
  IssueCreateInput,
  IssueUpdateInput,
  ProjectCreateInput,
  CycleCreateInput,
} from '../types'

describe('LinearLocal - Local Linear Implementation', () => {
  let linear: LinearLocal
  const webhookEvents: WebhookPayload[] = []

  beforeEach(() => {
    webhookEvents.length = 0
    linear = new LinearLocal({
      webhooks: true,
      onWebhookEvent: (event) => {
        webhookEvents.push(event)
      },
    })
  })

  afterEach(() => {
    linear.dispose()
  })

  // ===========================================================================
  // Initialization Tests
  // ===========================================================================

  describe('initialization', () => {
    it('should create a LinearLocal instance', () => {
      expect(linear).toBeDefined()
      // Verify core methods exist
      expect(linear.issueCreate).toBeDefined()
      expect(linear.projectCreate).toBeDefined()
      expect(linear.cycleCreate).toBeDefined()
      expect(linear.teamCreate).toBeDefined()
      expect(linear.commentCreate).toBeDefined()
      expect(linear.issueLabelCreate).toBeDefined()
    })

    it('should create a LinearClient instance with API key', () => {
      const client = new LinearClient({ apiKey: 'test-api-key' })
      expect(client).toBeDefined()
    })

    it('should support viewer query for current user', async () => {
      const viewer = await linear.viewer
      expect(viewer).toBeDefined()
      expect(viewer.id).toBeDefined()
      expect(viewer.name).toBeDefined()
    })
  })

  // ===========================================================================
  // Team Tests
  // ===========================================================================

  describe('teams', () => {
    it('should create a team', async () => {
      const team = await linear.teamCreate({
        name: 'Engineering',
        key: 'ENG',
      })

      expect(team.success).toBe(true)
      expect(team.team).toBeDefined()
      expect(team.team!.id).toBeDefined()
      expect(team.team!.name).toBe('Engineering')
      expect(team.team!.key).toBe('ENG')
    })

    it('should retrieve a team', async () => {
      const { team: created } = await linear.teamCreate({
        name: 'Product',
        key: 'PROD',
      })

      const team = await linear.team(created!.id)
      expect(team.name).toBe('Product')
      expect(team.key).toBe('PROD')
    })

    it('should list teams', async () => {
      await linear.teamCreate({ name: 'Team A', key: 'TEMA' })
      await linear.teamCreate({ name: 'Team B', key: 'TEMB' })

      const result = await linear.teams()
      expect(result.nodes.length).toBeGreaterThanOrEqual(2)
    })

    it('should update a team', async () => {
      const { team: created } = await linear.teamCreate({
        name: 'Original',
        key: 'ORIG',
      })

      const result = await linear.teamUpdate(created!.id, {
        name: 'Updated Team Name',
      })

      expect(result.success).toBe(true)
      expect(result.team!.name).toBe('Updated Team Name')
    })
  })

  // ===========================================================================
  // Issue Tests (TemporalStore - time-travel queries)
  // ===========================================================================

  describe('issues', () => {
    let teamId: string

    beforeEach(async () => {
      const { team } = await linear.teamCreate({ name: 'Test Team', key: 'TEST' })
      teamId = team!.id
    })

    describe('CRUD operations', () => {
      it('should create an issue', async () => {
        const result = await linear.issueCreate({
          teamId,
          title: 'Test Issue',
          description: 'This is a test issue',
        })

        expect(result.success).toBe(true)
        expect(result.issue).toBeDefined()
        expect(result.issue!.id).toBeDefined()
        expect(result.issue!.title).toBe('Test Issue')
        expect(result.issue!.description).toBe('This is a test issue')
        expect(result.issue!.identifier).toMatch(/^TEST-\d+$/)
      })

      it('should create an issue with priority', async () => {
        const result = await linear.issueCreate({
          teamId,
          title: 'Urgent Issue',
          priority: 1, // Urgent
        })

        expect(result.issue!.priority).toBe(1)
      })

      it('should create an issue with estimate', async () => {
        const result = await linear.issueCreate({
          teamId,
          title: 'Estimated Issue',
          estimate: 3,
        })

        expect(result.issue!.estimate).toBe(3)
      })

      it('should retrieve an issue', async () => {
        const { issue: created } = await linear.issueCreate({
          teamId,
          title: 'To Retrieve',
        })

        const issue = await linear.issue(created!.id)
        expect(issue.id).toBe(created!.id)
        expect(issue.title).toBe('To Retrieve')
      })

      it('should update an issue', async () => {
        const { issue: created } = await linear.issueCreate({
          teamId,
          title: 'Original Title',
        })

        const result = await linear.issueUpdate(created!.id, {
          title: 'Updated Title',
          description: 'Updated description',
        })

        expect(result.success).toBe(true)
        expect(result.issue!.title).toBe('Updated Title')
        expect(result.issue!.description).toBe('Updated description')
      })

      it('should archive an issue', async () => {
        const { issue: created } = await linear.issueCreate({
          teamId,
          title: 'To Archive',
        })

        const result = await linear.issueArchive(created!.id)
        expect(result.success).toBe(true)

        const archived = await linear.issue(created!.id)
        expect(archived.archivedAt).toBeDefined()
      })

      it('should delete an issue', async () => {
        const { issue: created } = await linear.issueCreate({
          teamId,
          title: 'To Delete',
        })

        const result = await linear.issueDelete(created!.id)
        expect(result.success).toBe(true)
      })
    })

    describe('list and filter', () => {
      beforeEach(async () => {
        await linear.issueCreate({ teamId, title: 'Issue 1', priority: 1 })
        await linear.issueCreate({ teamId, title: 'Issue 2', priority: 2 })
        await linear.issueCreate({ teamId, title: 'Issue 3', priority: 3 })
      })

      it('should list issues', async () => {
        const result = await linear.issues()
        expect(result.nodes.length).toBeGreaterThanOrEqual(3)
      })

      it('should filter by priority', async () => {
        const result = await linear.issues({
          filter: { priority: { eq: 1 } },
        })

        expect(result.nodes.every((i) => i.priority === 1)).toBe(true)
      })

      it('should support pagination with first/after', async () => {
        const page1 = await linear.issues({ first: 2 })
        expect(page1.nodes).toHaveLength(2)
        expect(page1.pageInfo.hasNextPage).toBe(true)

        const page2 = await linear.issues({
          first: 2,
          after: page1.pageInfo.endCursor!,
        })
        expect(page2.nodes.length).toBeGreaterThan(0)
      })

      it('should order by createdAt', async () => {
        const result = await linear.issues({
          orderBy: 'createdAt',
        })

        const dates = result.nodes.map((i) => new Date(i.createdAt).getTime())
        const sortedDates = [...dates].sort((a, b) => b - a)
        expect(dates).toEqual(sortedDates)
      })
    })

    describe('issue states', () => {
      it('should transition issue state', async () => {
        const { issue: created } = await linear.issueCreate({
          teamId,
          title: 'State Test',
        })

        // Get team workflow states
        const team = await linear.team(teamId)
        const states = await team.states()
        const inProgressState = states.nodes.find((s) => s.name === 'In Progress')

        if (inProgressState) {
          const result = await linear.issueUpdate(created!.id, {
            stateId: inProgressState.id,
          })

          expect(result.issue!.state.name).toBe('In Progress')
        }
      })
    })

    describe('time-travel queries (TemporalStore)', () => {
      it('should retrieve issue state at a point in time', async () => {
        const { issue: created } = await linear.issueCreate({
          teamId,
          title: 'Original Title',
        })

        const timestampBefore = Date.now()

        // Wait a bit and update
        await new Promise((r) => setTimeout(r, 10))
        await linear.issueUpdate(created!.id, { title: 'Updated Title' })

        // Query at the original timestamp (dotdo extension)
        const originalState = await linear.issueAsOf(created!.id, timestampBefore)
        expect(originalState?.title).toBe('Original Title')

        // Current state should be updated
        const currentState = await linear.issue(created!.id)
        expect(currentState.title).toBe('Updated Title')
      })

      it('should list issue history', async () => {
        const { issue: created } = await linear.issueCreate({
          teamId,
          title: 'Version 1',
        })

        await linear.issueUpdate(created!.id, { title: 'Version 2' })
        await linear.issueUpdate(created!.id, { title: 'Version 3' })

        // dotdo extension - returns at least current version
        const history = await linear.issueHistory(created!.id)
        expect(history.length).toBeGreaterThanOrEqual(1)
      })
    })

    describe('issue relationships', () => {
      it('should add parent issue', async () => {
        const { issue: parent } = await linear.issueCreate({
          teamId,
          title: 'Parent Issue',
        })

        const { issue: child } = await linear.issueCreate({
          teamId,
          title: 'Child Issue',
          parentId: parent!.id,
        })

        expect(child!.parent).toBeDefined()
        expect(child!.parent!.id).toBe(parent!.id)
      })

      it('should list sub-issues', async () => {
        const { issue: parent } = await linear.issueCreate({
          teamId,
          title: 'Parent',
        })

        await linear.issueCreate({
          teamId,
          title: 'Child 1',
          parentId: parent!.id,
        })

        await linear.issueCreate({
          teamId,
          title: 'Child 2',
          parentId: parent!.id,
        })

        const parentIssue = await linear.issue(parent!.id)
        const children = await parentIssue.children()
        expect(children.nodes).toHaveLength(2)
      })

      it('should add blocking relationship', async () => {
        const { issue: blocker } = await linear.issueCreate({
          teamId,
          title: 'Blocker',
        })

        const { issue: blocked } = await linear.issueCreate({
          teamId,
          title: 'Blocked',
        })

        await linear.issueRelationCreate({
          issueId: blocked!.id,
          relatedIssueId: blocker!.id,
          type: 'blocks',
        })

        const issue = await linear.issue(blocked!.id)
        const blockers = await issue.blockedBy()
        expect(blockers.nodes.some((b) => b.id === blocker!.id)).toBe(true)
      })
    })

    describe('webhook events', () => {
      it('should emit Issue event on create', async () => {
        await linear.issueCreate({
          teamId,
          title: 'Webhook Test',
        })

        await new Promise((r) => setTimeout(r, 10))

        expect(webhookEvents.length).toBeGreaterThan(0)
        const createEvent = webhookEvents.find(
          (e) => e.type === 'Issue' && e.action === 'create'
        )
        expect(createEvent).toBeDefined()
      })

      it('should emit Issue event on update', async () => {
        const { issue } = await linear.issueCreate({
          teamId,
          title: 'Webhook Update Test',
        })

        webhookEvents.length = 0
        await linear.issueUpdate(issue!.id, { title: 'Updated' })

        await new Promise((r) => setTimeout(r, 10))

        const updateEvent = webhookEvents.find(
          (e) => e.type === 'Issue' && e.action === 'update'
        )
        expect(updateEvent).toBeDefined()
      })
    })
  })

  // ===========================================================================
  // Project Tests
  // ===========================================================================

  describe('projects', () => {
    let teamId: string

    beforeEach(async () => {
      const { team } = await linear.teamCreate({ name: 'Project Team', key: 'PROJ' })
      teamId = team!.id
    })

    describe('CRUD operations', () => {
      it('should create a project', async () => {
        const result = await linear.projectCreate({
          name: 'Q1 Launch',
          teamIds: [teamId],
        })

        expect(result.success).toBe(true)
        expect(result.project).toBeDefined()
        expect(result.project!.id).toBeDefined()
        expect(result.project!.name).toBe('Q1 Launch')
      })

      it('should create a project with description', async () => {
        const result = await linear.projectCreate({
          name: 'Feature Project',
          teamIds: [teamId],
          description: 'A comprehensive feature release',
        })

        expect(result.project!.description).toBe('A comprehensive feature release')
      })

      it('should create a project with target date', async () => {
        const targetDate = new Date('2025-03-31')
        const result = await linear.projectCreate({
          name: 'Deadline Project',
          teamIds: [teamId],
          targetDate: targetDate.toISOString(),
        })

        expect(result.project!.targetDate).toBeDefined()
      })

      it('should retrieve a project', async () => {
        const { project: created } = await linear.projectCreate({
          name: 'To Retrieve',
          teamIds: [teamId],
        })

        const project = await linear.project(created!.id)
        expect(project.name).toBe('To Retrieve')
      })

      it('should update a project', async () => {
        const { project: created } = await linear.projectCreate({
          name: 'Original',
          teamIds: [teamId],
        })

        const result = await linear.projectUpdate(created!.id, {
          name: 'Updated Project',
          state: 'started',
        })

        expect(result.success).toBe(true)
        expect(result.project!.name).toBe('Updated Project')
        expect(result.project!.state).toBe('started')
      })

      it('should archive a project', async () => {
        const { project: created } = await linear.projectCreate({
          name: 'To Archive',
          teamIds: [teamId],
        })

        const result = await linear.projectArchive(created!.id)
        expect(result.success).toBe(true)

        const archived = await linear.project(created!.id)
        expect(archived.archivedAt).toBeDefined()
      })

      it('should delete a project', async () => {
        const { project: created } = await linear.projectCreate({
          name: 'To Delete',
          teamIds: [teamId],
        })

        const result = await linear.projectDelete(created!.id)
        expect(result.success).toBe(true)
      })
    })

    describe('list and filter', () => {
      it('should list projects', async () => {
        await linear.projectCreate({ name: 'Project A', teamIds: [teamId] })
        await linear.projectCreate({ name: 'Project B', teamIds: [teamId] })

        const result = await linear.projects()
        expect(result.nodes.length).toBeGreaterThanOrEqual(2)
      })

      it('should support pagination', async () => {
        for (let i = 0; i < 5; i++) {
          await linear.projectCreate({ name: `Project ${i}`, teamIds: [teamId] })
        }

        const page1 = await linear.projects({ first: 2 })
        expect(page1.nodes).toHaveLength(2)
        expect(page1.pageInfo.hasNextPage).toBe(true)
      })
    })

    describe('project issues', () => {
      it('should link issues to project', async () => {
        const { project } = await linear.projectCreate({
          name: 'Issue Container',
          teamIds: [teamId],
        })

        await linear.issueCreate({
          teamId,
          title: 'Project Issue 1',
          projectId: project!.id,
        })

        await linear.issueCreate({
          teamId,
          title: 'Project Issue 2',
          projectId: project!.id,
        })

        const proj = await linear.project(project!.id)
        const issues = await proj.issues()
        expect(issues.nodes).toHaveLength(2)
      })
    })

    describe('project milestones', () => {
      it('should create project milestone', async () => {
        const { project } = await linear.projectCreate({
          name: 'Milestone Project',
          teamIds: [teamId],
        })

        const result = await linear.projectMilestoneCreate({
          projectId: project!.id,
          name: 'Beta Release',
          targetDate: new Date('2025-02-15').toISOString(),
        })

        expect(result.success).toBe(true)
        expect(result.projectMilestone!.name).toBe('Beta Release')
      })

      it('should list project milestones', async () => {
        const { project } = await linear.projectCreate({
          name: 'Multi-milestone',
          teamIds: [teamId],
        })

        await linear.projectMilestoneCreate({
          projectId: project!.id,
          name: 'Milestone 1',
        })

        await linear.projectMilestoneCreate({
          projectId: project!.id,
          name: 'Milestone 2',
        })

        const proj = await linear.project(project!.id)
        const milestones = await proj.projectMilestones()
        expect(milestones.nodes).toHaveLength(2)
      })
    })
  })

  // ===========================================================================
  // Cycle Tests (Sprint Management)
  // ===========================================================================

  describe('cycles', () => {
    let teamId: string

    beforeEach(async () => {
      const { team } = await linear.teamCreate({ name: 'Sprint Team', key: 'SPRN' })
      teamId = team!.id
    })

    describe('CRUD operations', () => {
      it('should create a cycle', async () => {
        const startsAt = new Date()
        const endsAt = new Date(startsAt.getTime() + 14 * 24 * 60 * 60 * 1000)

        const result = await linear.cycleCreate({
          teamId,
          name: 'Sprint 1',
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
        })

        expect(result.success).toBe(true)
        expect(result.cycle).toBeDefined()
        expect(result.cycle!.name).toBe('Sprint 1')
        expect(result.cycle!.number).toBeDefined()
      })

      it('should retrieve a cycle', async () => {
        const { cycle: created } = await linear.cycleCreate({
          teamId,
          name: 'To Retrieve',
          startsAt: new Date().toISOString(),
          endsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        })

        const cycle = await linear.cycle(created!.id)
        expect(cycle.name).toBe('To Retrieve')
      })

      it('should update a cycle', async () => {
        const { cycle: created } = await linear.cycleCreate({
          teamId,
          name: 'Original',
          startsAt: new Date().toISOString(),
          endsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        })

        const result = await linear.cycleUpdate(created!.id, {
          name: 'Renamed Sprint',
        })

        expect(result.success).toBe(true)
        expect(result.cycle!.name).toBe('Renamed Sprint')
      })

      it('should archive a cycle', async () => {
        const { cycle: created } = await linear.cycleCreate({
          teamId,
          name: 'To Archive',
          startsAt: new Date().toISOString(),
          endsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        })

        const result = await linear.cycleArchive(created!.id)
        expect(result.success).toBe(true)
      })
    })

    describe('list and filter', () => {
      it('should list cycles for team', async () => {
        const team = await linear.team(teamId)
        const cycles = await team.cycles()

        expect(cycles.nodes).toBeDefined()
      })

      it('should get active cycle', async () => {
        const startsAt = new Date()
        const endsAt = new Date(startsAt.getTime() + 14 * 24 * 60 * 60 * 1000)

        await linear.cycleCreate({
          teamId,
          name: 'Active Sprint',
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
        })

        const team = await linear.team(teamId)
        const activeCycle = await team.activeCycle

        expect(activeCycle).toBeDefined()
      })
    })

    describe('cycle issues', () => {
      it('should add issues to cycle', async () => {
        const { cycle } = await linear.cycleCreate({
          teamId,
          name: 'Sprint with Issues',
          startsAt: new Date().toISOString(),
          endsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        })

        await linear.issueCreate({
          teamId,
          title: 'Sprint Issue 1',
          cycleId: cycle!.id,
        })

        await linear.issueCreate({
          teamId,
          title: 'Sprint Issue 2',
          cycleId: cycle!.id,
        })

        const cycleObj = await linear.cycle(cycle!.id)
        const issues = await cycleObj.issues()
        expect(issues.nodes).toHaveLength(2)
      })

      it('should calculate cycle progress', async () => {
        const { cycle } = await linear.cycleCreate({
          teamId,
          name: 'Progress Sprint',
          startsAt: new Date().toISOString(),
          endsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        })

        const cycleObj = await linear.cycle(cycle!.id)
        expect(cycleObj.progress).toBeDefined()
        expect(cycleObj.progress).toBeGreaterThanOrEqual(0)
        expect(cycleObj.progress).toBeLessThanOrEqual(100)
      })
    })
  })

  // ===========================================================================
  // Comment Tests
  // ===========================================================================

  describe('comments', () => {
    let teamId: string
    let issueId: string

    beforeEach(async () => {
      const { team } = await linear.teamCreate({ name: 'Comment Team', key: 'CMNT' })
      teamId = team!.id
      const { issue } = await linear.issueCreate({ teamId, title: 'Issue with Comments' })
      issueId = issue!.id
    })

    it('should create a comment', async () => {
      const result = await linear.commentCreate({
        issueId,
        body: 'This is a comment',
      })

      expect(result.success).toBe(true)
      expect(result.comment).toBeDefined()
      expect(result.comment!.body).toBe('This is a comment')
    })

    it('should retrieve a comment', async () => {
      const { comment: created } = await linear.commentCreate({
        issueId,
        body: 'To retrieve',
      })

      const comment = await linear.comment(created!.id)
      expect(comment.body).toBe('To retrieve')
    })

    it('should update a comment', async () => {
      const { comment: created } = await linear.commentCreate({
        issueId,
        body: 'Original',
      })

      const result = await linear.commentUpdate(created!.id, {
        body: 'Updated comment body',
      })

      expect(result.success).toBe(true)
      expect(result.comment!.body).toBe('Updated comment body')
    })

    it('should delete a comment', async () => {
      const { comment: created } = await linear.commentCreate({
        issueId,
        body: 'To delete',
      })

      const result = await linear.commentDelete(created!.id)
      expect(result.success).toBe(true)
    })

    it('should list issue comments', async () => {
      await linear.commentCreate({ issueId, body: 'Comment 1' })
      await linear.commentCreate({ issueId, body: 'Comment 2' })

      const issue = await linear.issue(issueId)
      const comments = await issue.comments()
      expect(comments.nodes).toHaveLength(2)
    })

    it('should support comment reactions', async () => {
      const { comment } = await linear.commentCreate({
        issueId,
        body: 'React to me',
      })

      const result = await linear.reactionCreate({
        commentId: comment!.id,
        emoji: '+1',
      })

      expect(result.success).toBe(true)
    })
  })

  // ===========================================================================
  // Label Tests
  // ===========================================================================

  describe('labels', () => {
    let teamId: string

    beforeEach(async () => {
      const { team } = await linear.teamCreate({ name: 'Label Team', key: 'LABL' })
      teamId = team!.id
    })

    it('should create a label', async () => {
      const result = await linear.issueLabelCreate({
        teamId,
        name: 'Bug',
        color: '#FF0000',
      })

      expect(result.success).toBe(true)
      expect(result.issueLabel).toBeDefined()
      expect(result.issueLabel!.name).toBe('Bug')
      expect(result.issueLabel!.color).toBe('#FF0000')
    })

    it('should update a label', async () => {
      const { issueLabel: created } = await linear.issueLabelCreate({
        teamId,
        name: 'Original',
        color: '#000000',
      })

      const result = await linear.issueLabelUpdate(created!.id, {
        name: 'Updated Label',
        color: '#00FF00',
      })

      expect(result.success).toBe(true)
      expect(result.issueLabel!.name).toBe('Updated Label')
    })

    it('should archive a label', async () => {
      const { issueLabel: created } = await linear.issueLabelCreate({
        teamId,
        name: 'To Archive',
        color: '#000000',
      })

      const result = await linear.issueLabelArchive(created!.id)
      expect(result.success).toBe(true)
    })

    it('should list team labels', async () => {
      await linear.issueLabelCreate({ teamId, name: 'Label A', color: '#FF0000' })
      await linear.issueLabelCreate({ teamId, name: 'Label B', color: '#00FF00' })

      const result = await linear.issueLabels()
      expect(result.nodes.length).toBeGreaterThanOrEqual(2)
    })

    it('should add labels to issue', async () => {
      const { issueLabel: label1 } = await linear.issueLabelCreate({
        teamId,
        name: 'Priority',
        color: '#FF0000',
      })

      const { issueLabel: label2 } = await linear.issueLabelCreate({
        teamId,
        name: 'Feature',
        color: '#00FF00',
      })

      const { issue } = await linear.issueCreate({
        teamId,
        title: 'Labeled Issue',
        labelIds: [label1!.id, label2!.id],
      })

      const issueObj = await linear.issue(issue!.id)
      const labels = await issueObj.labels()
      expect(labels.nodes).toHaveLength(2)
    })
  })

  // ===========================================================================
  // User Tests
  // ===========================================================================

  describe('users', () => {
    it('should list users', async () => {
      const result = await linear.users()
      expect(result.nodes).toBeDefined()
    })

    it('should retrieve current user', async () => {
      const viewer = await linear.viewer
      expect(viewer.id).toBeDefined()
      expect(viewer.email).toBeDefined()
    })

    it('should retrieve a user by ID', async () => {
      const viewer = await linear.viewer
      const user = await linear.user(viewer.id)
      expect(user.id).toBe(viewer.id)
    })

    it('should assign user to issue', async () => {
      const { team } = await linear.teamCreate({ name: 'User Team', key: 'USER' })
      const viewer = await linear.viewer

      const { issue } = await linear.issueCreate({
        teamId: team!.id,
        title: 'Assigned Issue',
        assigneeId: viewer.id,
      })

      expect(issue!.assignee).toBeDefined()
      expect(issue!.assignee!.id).toBe(viewer.id)
    })
  })

  // ===========================================================================
  // Workflow States Tests
  // ===========================================================================

  describe('workflow states', () => {
    let teamId: string

    beforeEach(async () => {
      const { team } = await linear.teamCreate({ name: 'Workflow Team', key: 'WKFL' })
      teamId = team!.id
    })

    it('should have default workflow states', async () => {
      const team = await linear.team(teamId)
      const states = await team.states()

      expect(states.nodes.length).toBeGreaterThan(0)
      const stateNames = states.nodes.map((s) => s.name)

      // Default states
      expect(stateNames).toContain('Backlog')
      expect(stateNames).toContain('Todo')
      expect(stateNames).toContain('In Progress')
      expect(stateNames).toContain('Done')
      expect(stateNames).toContain('Canceled')
    })

    it('should create custom workflow state', async () => {
      const result = await linear.workflowStateCreate({
        teamId,
        name: 'In Review',
        type: 'started',
        color: '#FFA500',
      })

      expect(result.success).toBe(true)
      expect(result.workflowState!.name).toBe('In Review')
    })

    it('should update workflow state', async () => {
      const team = await linear.team(teamId)
      const states = await team.states()
      const todoState = states.nodes.find((s) => s.name === 'Todo')

      if (todoState) {
        const result = await linear.workflowStateUpdate(todoState.id, {
          name: 'Ready',
        })

        expect(result.success).toBe(true)
        expect(result.workflowState!.name).toBe('Ready')
      }
    })
  })

  // ===========================================================================
  // Webhook Tests
  // ===========================================================================

  describe('webhooks', () => {
    let teamId: string

    beforeEach(async () => {
      const { team } = await linear.teamCreate({ name: 'Webhook Team', key: 'HOOK' })
      teamId = team!.id
    })

    it('should create a webhook', async () => {
      const result = await linear.webhookCreate({
        url: 'https://example.com/webhook',
        teamId,
        resourceTypes: ['Issue', 'Comment', 'Project'],
      })

      expect(result.success).toBe(true)
      expect(result.webhook).toBeDefined()
      expect(result.webhook!.url).toBe('https://example.com/webhook')
    })

    it('should list webhooks', async () => {
      await linear.webhookCreate({
        url: 'https://example.com/webhook1',
        teamId,
        resourceTypes: ['Issue'],
      })

      const result = await linear.webhooks()
      expect(result.nodes.length).toBeGreaterThanOrEqual(1)
    })

    it('should update a webhook', async () => {
      const { webhook: created } = await linear.webhookCreate({
        url: 'https://example.com/webhook',
        teamId,
        resourceTypes: ['Issue'],
      })

      const result = await linear.webhookUpdate(created!.id, {
        enabled: false,
      })

      expect(result.success).toBe(true)
      expect(result.webhook!.enabled).toBe(false)
    })

    it('should delete a webhook', async () => {
      const { webhook: created } = await linear.webhookCreate({
        url: 'https://example.com/webhook',
        teamId,
        resourceTypes: ['Issue'],
      })

      const result = await linear.webhookDelete(created!.id)
      expect(result.success).toBe(true)
    })

    it('should verify webhook signature', async () => {
      const payload = JSON.stringify({ type: 'Issue', action: 'create' })
      const secret = 'webhook-secret'

      const signature = await LinearLocal.webhooks.sign(payload, secret)
      const isValid = await LinearLocal.webhooks.verify(payload, signature, secret)

      expect(isValid).toBe(true)
    })

    it('should reject invalid webhook signature', async () => {
      const payload = JSON.stringify({ type: 'Issue', action: 'create' })
      const signature = 'invalid-signature'

      const isValid = await LinearLocal.webhooks.verify(payload, signature, 'secret')
      expect(isValid).toBe(false)
    })
  })

  // ===========================================================================
  // Search Tests
  // ===========================================================================

  describe('search', () => {
    let teamId: string

    beforeEach(async () => {
      const { team } = await linear.teamCreate({ name: 'Search Team', key: 'SRCH' })
      teamId = team!.id
    })

    it('should search issues by text', async () => {
      await linear.issueCreate({
        teamId,
        title: 'Implement authentication',
        description: 'Add OAuth2 support',
      })

      await linear.issueCreate({
        teamId,
        title: 'Fix database bug',
      })

      const result = await linear.searchIssues('authentication')
      expect(result.nodes.some((i) => i.title.includes('authentication'))).toBe(true)
    })

    it('should search projects', async () => {
      await linear.projectCreate({
        name: 'API Redesign',
        teamIds: [teamId],
      })

      const result = await linear.searchProjects('API')
      expect(result.nodes.some((p) => p.name.includes('API'))).toBe(true)
    })
  })

  // ===========================================================================
  // Integration Tests
  // ===========================================================================

  describe('integration', () => {
    it('should handle complete sprint workflow', async () => {
      // Create team
      const { team } = await linear.teamCreate({ name: 'Sprint Workflow', key: 'SPRT' })

      // Create project
      const { project } = await linear.projectCreate({
        name: 'Q1 Goals',
        teamIds: [team!.id],
      })

      // Create sprint/cycle
      const { cycle } = await linear.cycleCreate({
        teamId: team!.id,
        name: 'Sprint 1',
        startsAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      })

      // Create labels
      const { issueLabel: bugLabel } = await linear.issueLabelCreate({
        teamId: team!.id,
        name: 'Bug',
        color: '#FF0000',
      })

      // Create issues in sprint
      const { issue: issue1 } = await linear.issueCreate({
        teamId: team!.id,
        title: 'User story 1',
        projectId: project!.id,
        cycleId: cycle!.id,
        estimate: 3,
      })

      const { issue: issue2 } = await linear.issueCreate({
        teamId: team!.id,
        title: 'Bug fix',
        projectId: project!.id,
        cycleId: cycle!.id,
        labelIds: [bugLabel!.id],
        estimate: 1,
      })

      // Add comments
      await linear.commentCreate({
        issueId: issue1!.id,
        body: 'Starting work on this',
      })

      // Update issue state
      const teamObj = await linear.team(team!.id)
      const states = await teamObj.states()
      const inProgressState = states.nodes.find((s) => s.name === 'In Progress')

      await linear.issueUpdate(issue1!.id, {
        stateId: inProgressState!.id,
      })

      // Verify cycle contains issues
      const cycleObj = await linear.cycle(cycle!.id)
      const cycleIssues = await cycleObj.issues()
      expect(cycleIssues.nodes).toHaveLength(2)

      // Verify project contains issues
      const projectObj = await linear.project(project!.id)
      const projectIssues = await projectObj.issues()
      expect(projectIssues.nodes).toHaveLength(2)

      // Give webhook events time to process
      await new Promise((r) => setTimeout(r, 10))

      // Verify webhook events were emitted
      expect(webhookEvents.length).toBeGreaterThan(0)
      const issueEvents = webhookEvents.filter((e) => e.type === 'Issue')
      expect(issueEvents.length).toBeGreaterThan(0)
    })
  })
})

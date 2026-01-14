/**
 * Jira Client - Stub Implementation
 *
 * This file contains stub implementations that will cause tests to fail.
 * Implementation will be added in the GREEN phase.
 */

import type { JiraClientConfig, JiraLocalConfig } from './types'

/**
 * JiraLocal - Local Jira implementation for testing and development
 */
export class JiraLocal {
  constructor(_config?: JiraLocalConfig) {
    throw new Error('JiraLocal not implemented')
  }

  dispose(): void {
    throw new Error('JiraLocal.dispose not implemented')
  }

  get issues() {
    throw new Error('JiraLocal.issues not implemented')
  }

  get projects() {
    throw new Error('JiraLocal.projects not implemented')
  }

  get issueLinks() {
    throw new Error('JiraLocal.issueLinks not implemented')
  }

  get agile() {
    throw new Error('JiraLocal.agile not implemented')
  }

  myself(): Promise<never> {
    throw new Error('JiraLocal.myself not implemented')
  }

  search(_options: unknown): Promise<never> {
    throw new Error('JiraLocal.search not implemented')
  }
}

/**
 * JiraClient - Jira REST API client
 */
export class JiraClient {
  constructor(_config: JiraClientConfig) {
    throw new Error('JiraClient not implemented')
  }
}

export default JiraLocal

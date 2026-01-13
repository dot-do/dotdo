/**
 * @module db/schema/cascade/generator
 *
 * CascadeGenerator - Orchestrates cascade entity generation across multiple levels.
 *
 * This generator implements the massive scale-out cascade pattern:
 * ~20 industries x ~1,000 occupations x ~20,000 tasks
 * -> 3 problems x 2 solutions = 240,000 product ideas
 * -> 3 ICPs x 5 startups = 3,600,000 testable hypotheses
 *
 * For testing, use scaled-down configurations (mini cascade).
 */

export interface CascadeGeneratorConfig {
  // Base entities
  industries: number
  occupationsPerIndustry: number
  tasksPerOccupation: number
  // Cascade multipliers
  problemsPerTask: number
  solutionsPerProblem: number
  icpsPerSolution: number
  startupsPerIcp: number
}

export interface CascadeGeneratorResult {
  levels: number
  entities: {
    industries: number
    occupations: number
    tasks: number
    problems: number
    solutions: number
    icps: number
    startups: number
  }
  relationships: {
    industryToOccupations: number
    occupationToTasks: number
    taskToProblems: number
    problemToSolutions: number
    solutionToIcps: number
    icpToStartups: number
    total: number
  }
  metrics?: {
    durationMs: number
    entitiesPerSecond: number
    relationshipsPerSecond: number
  }
}

export interface CascadeEntity {
  id: string
  type: string
  parentId?: string
  data: Record<string, unknown>
  createdAt: Date
}

export interface CascadeRelationship {
  id: string
  verb: string
  from: string
  to: string
  createdAt: Date
}

/**
 * CascadeGenerator - Generates cascade of entities across multiple levels
 */
export class CascadeGenerator {
  private config: CascadeGeneratorConfig
  private entities: CascadeEntity[] = []
  private relationships: CascadeRelationship[] = []

  constructor(config: CascadeGeneratorConfig) {
    this.config = config
  }

  /**
   * Generate the full cascade
   */
  async generate(): Promise<CascadeGeneratorResult> {
    const startTime = Date.now()
    this.entities = []
    this.relationships = []

    // Level 1: Industries
    const industries = this.generateIndustries()

    // Level 2: Occupations
    const occupations = this.generateOccupations(industries)

    // Level 3: Tasks
    const tasks = this.generateTasks(occupations)

    // Level 4: Problems
    const problems = this.generateProblems(tasks)

    // Level 5: Solutions
    const solutions = this.generateSolutions(problems)

    // Level 6: ICPs
    const icps = this.generateIcps(solutions)

    // Level 7: Startups
    const startups = this.generateStartups(icps)

    const durationMs = Date.now() - startTime
    const totalEntities = this.entities.length
    const totalRelationships = this.relationships.length

    return {
      levels: 7, // Industry -> Occupation -> Task -> Problem -> Solution -> ICP -> Startup
      entities: {
        industries: industries.length,
        occupations: occupations.length,
        tasks: tasks.length,
        problems: problems.length,
        solutions: solutions.length,
        icps: icps.length,
        startups: startups.length,
      },
      relationships: {
        industryToOccupations: industries.length * this.config.occupationsPerIndustry,
        occupationToTasks: occupations.length * this.config.tasksPerOccupation,
        taskToProblems: tasks.length * this.config.problemsPerTask,
        problemToSolutions: problems.length * this.config.solutionsPerProblem,
        solutionToIcps: solutions.length * this.config.icpsPerSolution,
        icpToStartups: icps.length * this.config.startupsPerIcp,
        // Total counts downstream relationships from task level (problems + solutions + icps + startups)
        // This excludes industry->occupation and occupation->task relationships
        total: problems.length + solutions.length + icps.length + startups.length,
      },
      metrics: {
        durationMs,
        entitiesPerSecond: durationMs > 0 ? (totalEntities / durationMs) * 1000 : totalEntities * 1000,
        relationshipsPerSecond: durationMs > 0 ? (totalRelationships / durationMs) * 1000 : totalRelationships * 1000,
      },
    }
  }

  /**
   * Generate industries
   */
  private generateIndustries(): CascadeEntity[] {
    const industries: CascadeEntity[] = []
    for (let i = 0; i < this.config.industries; i++) {
      const entity: CascadeEntity = {
        id: `industry-${i}`,
        type: 'Industry',
        data: { name: `Industry ${i}`, index: i },
        createdAt: new Date(),
      }
      industries.push(entity)
      this.entities.push(entity)
    }
    return industries
  }

  /**
   * Generate occupations for each industry
   */
  private generateOccupations(industries: CascadeEntity[]): CascadeEntity[] {
    const occupations: CascadeEntity[] = []
    for (const industry of industries) {
      for (let i = 0; i < this.config.occupationsPerIndustry; i++) {
        const entity: CascadeEntity = {
          id: `occupation-${industry.id}-${i}`,
          type: 'Occupation',
          parentId: industry.id,
          data: { name: `Occupation ${i}`, industryId: industry.id, index: i },
          createdAt: new Date(),
        }
        occupations.push(entity)
        this.entities.push(entity)

        // Create relationship
        const relationship: CascadeRelationship = {
          id: `rel-${industry.id}-occupation-${i}`,
          verb: 'hasOccupation',
          from: industry.id,
          to: entity.id,
          createdAt: new Date(),
        }
        this.relationships.push(relationship)
      }
    }
    return occupations
  }

  /**
   * Generate tasks for each occupation
   */
  private generateTasks(occupations: CascadeEntity[]): CascadeEntity[] {
    const tasks: CascadeEntity[] = []
    for (const occupation of occupations) {
      for (let i = 0; i < this.config.tasksPerOccupation; i++) {
        const entity: CascadeEntity = {
          id: `task-${occupation.id}-${i}`,
          type: 'Task',
          parentId: occupation.id,
          data: { name: `Task ${i}`, occupationId: occupation.id, index: i },
          createdAt: new Date(),
        }
        tasks.push(entity)
        this.entities.push(entity)

        // Create relationship
        const relationship: CascadeRelationship = {
          id: `rel-${occupation.id}-task-${i}`,
          verb: 'hasTask',
          from: occupation.id,
          to: entity.id,
          createdAt: new Date(),
        }
        this.relationships.push(relationship)
      }
    }
    return tasks
  }

  /**
   * Generate problems for each task
   */
  private generateProblems(tasks: CascadeEntity[]): CascadeEntity[] {
    const problems: CascadeEntity[] = []
    for (const task of tasks) {
      for (let i = 0; i < this.config.problemsPerTask; i++) {
        const entity: CascadeEntity = {
          id: `problem-${task.id}-${i}`,
          type: 'Problem',
          parentId: task.id,
          data: { name: `Problem ${i}`, taskId: task.id, index: i },
          createdAt: new Date(),
        }
        problems.push(entity)
        this.entities.push(entity)

        // Create relationship
        const relationship: CascadeRelationship = {
          id: `rel-${task.id}-problem-${i}`,
          verb: 'hasProblem',
          from: task.id,
          to: entity.id,
          createdAt: new Date(),
        }
        this.relationships.push(relationship)
      }
    }
    return problems
  }

  /**
   * Generate solutions for each problem
   */
  private generateSolutions(problems: CascadeEntity[]): CascadeEntity[] {
    const solutions: CascadeEntity[] = []
    for (const problem of problems) {
      for (let i = 0; i < this.config.solutionsPerProblem; i++) {
        const entity: CascadeEntity = {
          id: `solution-${problem.id}-${i}`,
          type: 'Solution',
          parentId: problem.id,
          data: { name: `Solution ${i}`, problemId: problem.id, index: i },
          createdAt: new Date(),
        }
        solutions.push(entity)
        this.entities.push(entity)

        // Create relationship
        const relationship: CascadeRelationship = {
          id: `rel-${problem.id}-solution-${i}`,
          verb: 'hasSolution',
          from: problem.id,
          to: entity.id,
          createdAt: new Date(),
        }
        this.relationships.push(relationship)
      }
    }
    return solutions
  }

  /**
   * Generate ICPs for each solution
   */
  private generateIcps(solutions: CascadeEntity[]): CascadeEntity[] {
    const icps: CascadeEntity[] = []
    for (const solution of solutions) {
      for (let i = 0; i < this.config.icpsPerSolution; i++) {
        const entity: CascadeEntity = {
          id: `icp-${solution.id}-${i}`,
          type: 'ICP',
          parentId: solution.id,
          data: { name: `ICP ${i}`, solutionId: solution.id, index: i },
          createdAt: new Date(),
        }
        icps.push(entity)
        this.entities.push(entity)

        // Create relationship
        const relationship: CascadeRelationship = {
          id: `rel-${solution.id}-icp-${i}`,
          verb: 'hasICP',
          from: solution.id,
          to: entity.id,
          createdAt: new Date(),
        }
        this.relationships.push(relationship)
      }
    }
    return icps
  }

  /**
   * Generate startups for each ICP
   */
  private generateStartups(icps: CascadeEntity[]): CascadeEntity[] {
    const startups: CascadeEntity[] = []
    for (const icp of icps) {
      for (let i = 0; i < this.config.startupsPerIcp; i++) {
        const entity: CascadeEntity = {
          id: `startup-${icp.id}-${i}`,
          type: 'Startup',
          parentId: icp.id,
          data: { name: `Startup ${i}`, icpId: icp.id, index: i },
          createdAt: new Date(),
        }
        startups.push(entity)
        this.entities.push(entity)

        // Create relationship
        const relationship: CascadeRelationship = {
          id: `rel-${icp.id}-startup-${i}`,
          verb: 'hasStartup',
          from: icp.id,
          to: entity.id,
          createdAt: new Date(),
        }
        this.relationships.push(relationship)
      }
    }
    return startups
  }

  /**
   * Get all generated entities
   */
  getEntities(): CascadeEntity[] {
    return this.entities
  }

  /**
   * Get all generated relationships
   */
  getRelationships(): CascadeRelationship[] {
    return this.relationships
  }
}

export default CascadeGenerator

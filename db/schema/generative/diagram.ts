/**
 * DiagramGenerator - AI Diagram Generation for $diagram directives
 *
 * Handles diagram generation with support for:
 * - Multiple diagram types (Flowchart, Sequence, Class, ER, State, Gantt, Pie, Mindmap)
 * - Various output formats (Mermaid, D2, PlantUML, Graphviz, SVG)
 * - Direction control (TB, BT, LR, RL)
 * - Theme customization
 */

import type { GenerationContext } from './handler'

// ============================================================================
// Type Definitions
// ============================================================================

export type DiagramType = 'Flowchart' | 'Sequence' | 'Class' | 'ER' | 'State' | 'Gantt' | 'Pie' | 'Mindmap'
export type DiagramFormat = 'Mermaid' | 'D2' | 'PlantUML' | 'Graphviz' | 'SVG'
export type DiagramDirection = 'TB' | 'BT' | 'LR' | 'RL'
export type DiagramTheme = 'default' | 'dark' | 'forest' | 'neutral'

export interface DiagramConfig {
  type: DiagramType
  format: DiagramFormat
  direction?: DiagramDirection
  title?: string
  theme?: DiagramTheme
}

export interface DiagramDirective {
  $diagram: DiagramConfig
}

export interface DiagramResultMetadata {
  type?: DiagramType
  format?: DiagramFormat
  direction?: DiagramDirection
  title?: string
  theme?: DiagramTheme
  [key: string]: unknown
}

export interface DiagramResult {
  markup: string
  format: DiagramFormat
  metadata?: DiagramResultMetadata
}

export interface DiagramGeneratorConfig {
  provider?: string
  apiKey?: string
}

// ============================================================================
// Diagram Generation Error
// ============================================================================

export class DiagramGenerationError extends Error {
  context?: {
    directive?: DiagramConfig
    [key: string]: unknown
  }

  constructor(message: string, directive?: DiagramConfig) {
    super(message)
    this.name = 'DiagramGenerationError'
    this.context = { directive }
  }
}

// ============================================================================
// Constants
// ============================================================================

const VALID_TYPES: DiagramType[] = ['Flowchart', 'Sequence', 'Class', 'ER', 'State', 'Gantt', 'Pie', 'Mindmap']
const VALID_FORMATS: DiagramFormat[] = ['Mermaid', 'D2', 'PlantUML', 'Graphviz', 'SVG']
const VALID_DIRECTIONS: DiagramDirection[] = ['TB', 'BT', 'LR', 'RL']
const VALID_THEMES: DiagramTheme[] = ['default', 'dark', 'forest', 'neutral']

// ============================================================================
// Mermaid Diagram Templates
// ============================================================================

const MERMAID_TEMPLATES: Record<DiagramType, (config: DiagramConfig, context?: GenerationContext) => string> = {
  Flowchart: (config, context) => {
    const direction = config.direction ?? 'TB'
    const title = config.title ?? context?.prompt ?? 'Flowchart'
    return `flowchart ${direction}
    A[Start] --> B{Decision}
    B -->|Yes| C[Process 1]
    B -->|No| D[Process 2]
    C --> E[End]
    D --> E
    %% ${title}
`
  },

  Sequence: (config, context) => {
    const title = config.title ?? context?.prompt ?? 'Sequence Diagram'
    return `sequenceDiagram
    participant A as Actor
    participant S as System
    participant D as Database
    A->>S: Request
    S->>D: Query
    D-->>S: Response
    S-->>A: Result
    %% ${title}
`
  },

  Class: (config, context) => {
    const title = config.title ?? context?.prompt ?? 'Class Diagram'
    return `classDiagram
    class Entity {
        +id: string
        +name: string
        +create(): void
        +update(): void
    }
    class Service {
        +entity: Entity
        +process(): void
    }
    Service --> Entity
    %% ${title}
`
  },

  ER: (config, context) => {
    const title = config.title ?? context?.prompt ?? 'ER Diagram'
    return `erDiagram
    USER ||--o{ POST : creates
    USER {
        string id PK
        string name
        string email
    }
    POST {
        string id PK
        string title
        string content
        string userId FK
    }
    %% ${title}
`
  },

  State: (config, context) => {
    const title = config.title ?? context?.prompt ?? 'State Diagram'
    return `stateDiagram-v2
    [*] --> Idle
    Idle --> Processing : start
    Processing --> Complete : finish
    Processing --> Error : fail
    Error --> Idle : reset
    Complete --> [*]
    %% ${title}
`
  },

  Gantt: (config, context) => {
    const title = config.title ?? context?.prompt ?? 'Project Timeline'
    return `gantt
    title ${title}
    dateFormat  YYYY-MM-DD
    section Planning
    Research           :a1, 2024-01-01, 7d
    Design             :a2, after a1, 5d
    section Development
    Implementation     :a3, after a2, 14d
    Testing            :a4, after a3, 7d
`
  },

  Pie: (config, context) => {
    const title = config.title ?? context?.prompt ?? 'Distribution'
    return `pie showData
    title ${title}
    "Category A" : 45
    "Category B" : 30
    "Category C" : 15
    "Category D" : 10
`
  },

  Mindmap: (config, context) => {
    const title = config.title ?? context?.prompt ?? 'Mindmap'
    return `mindmap
  root((${title}))
    Topic A
      Subtopic A1
      Subtopic A2
    Topic B
      Subtopic B1
      Subtopic B2
    Topic C
      Subtopic C1
`
  },
}

// ============================================================================
// D2 Diagram Templates
// ============================================================================

const D2_TEMPLATES: Record<DiagramType, (config: DiagramConfig, context?: GenerationContext) => string> = {
  Flowchart: (config, context) => {
    const direction = config.direction ?? 'down'
    const title = config.title ?? context?.prompt ?? 'Flowchart'
    return `direction: ${direction === 'TB' ? 'down' : direction === 'LR' ? 'right' : 'down'}
# ${title}

start: Start {shape: oval}
decision: Decision {shape: diamond}
process1: Process 1
process2: Process 2
end: End {shape: oval}

start -> decision
decision -> process1: Yes
decision -> process2: No
process1 -> end
process2 -> end
`
  },

  Sequence: (config, context) => {
    const title = config.title ?? context?.prompt ?? 'Sequence Diagram'
    return `# ${title}

actor: Actor
system: System
database: Database

actor -> system: Request
system -> database: Query
database -> system: Response
system -> actor: Result
`
  },

  Class: (config, context) => {
    const title = config.title ?? context?.prompt ?? 'Class Diagram'
    return `# ${title}

Entity: {
  shape: class
  id: string
  name: string
  create(): void
  update(): void
}

Service: {
  shape: class
  entity: Entity
  process(): void
}

Service -> Entity
`
  },

  ER: (config, context) => {
    const title = config.title ?? context?.prompt ?? 'ER Diagram'
    return `# ${title}

User: {
  shape: sql_table
  id: string {constraint: primary_key}
  name: string
  email: string
}

Post: {
  shape: sql_table
  id: string {constraint: primary_key}
  title: string
  content: string
  userId: string {constraint: foreign_key}
}

User -> Post: creates
`
  },

  State: (config, context) => {
    const title = config.title ?? context?.prompt ?? 'State Diagram'
    return `# ${title}

idle: Idle {shape: oval}
processing: Processing
complete: Complete {shape: oval}
error: Error

idle -> processing: start
processing -> complete: finish
processing -> error: fail
error -> idle: reset
`
  },

  Gantt: (config, context) => {
    const title = config.title ?? context?.prompt ?? 'Project Timeline'
    return `# ${title}
# Note: D2 doesn't natively support Gantt charts
# This is a simplified representation

timeline: {
  planning: Planning (7 days)
  design: Design (5 days)
  development: Development (14 days)
  testing: Testing (7 days)
}

timeline.planning -> timeline.design
timeline.design -> timeline.development
timeline.development -> timeline.testing
`
  },

  Pie: (config, context) => {
    const title = config.title ?? context?.prompt ?? 'Distribution'
    return `# ${title}
# Note: D2 doesn't natively support pie charts
# This is a visual representation

distribution: {
  a: Category A (45%)
  b: Category B (30%)
  c: Category C (15%)
  d: Category D (10%)
}
`
  },

  Mindmap: (config, context) => {
    const title = config.title ?? context?.prompt ?? 'Mindmap'
    return `# ${title}

root: ${title} {
  style.fill: "#f0f0f0"
}

root -> topicA: Topic A
root -> topicB: Topic B
root -> topicC: Topic C

topicA -> subtopicA1: Subtopic A1
topicA -> subtopicA2: Subtopic A2
topicB -> subtopicB1: Subtopic B1
topicB -> subtopicB2: Subtopic B2
topicC -> subtopicC1: Subtopic C1
`
  },
}

// ============================================================================
// PlantUML Templates
// ============================================================================

const PLANTUML_TEMPLATES: Record<DiagramType, (config: DiagramConfig, context?: GenerationContext) => string> = {
  Flowchart: (config, context) => {
    const title = config.title ?? context?.prompt ?? 'Flowchart'
    return `@startuml
title ${title}
start
:Start;
if (Decision?) then (yes)
  :Process 1;
else (no)
  :Process 2;
endif
:End;
stop
@enduml
`
  },

  Sequence: (config, context) => {
    const title = config.title ?? context?.prompt ?? 'Sequence Diagram'
    return `@startuml
title ${title}
actor Actor
participant System
database Database

Actor -> System: Request
System -> Database: Query
Database --> System: Response
System --> Actor: Result
@enduml
`
  },

  Class: (config, context) => {
    const title = config.title ?? context?.prompt ?? 'Class Diagram'
    return `@startuml
title ${title}

class Entity {
  +id: string
  +name: string
  +create(): void
  +update(): void
}

class Service {
  +entity: Entity
  +process(): void
}

Service --> Entity

@enduml
`
  },

  ER: (config, context) => {
    const title = config.title ?? context?.prompt ?? 'ER Diagram'
    return `@startuml
title ${title}

entity User {
  * id : string <<PK>>
  --
  name : string
  email : string
}

entity Post {
  * id : string <<PK>>
  --
  title : string
  content : string
  userId : string <<FK>>
}

User ||--o{ Post : creates

@enduml
`
  },

  State: (config, context) => {
    const title = config.title ?? context?.prompt ?? 'State Diagram'
    return `@startuml
title ${title}

[*] --> Idle
Idle --> Processing : start
Processing --> Complete : finish
Processing --> Error : fail
Error --> Idle : reset
Complete --> [*]

@enduml
`
  },

  Gantt: (config, context) => {
    const title = config.title ?? context?.prompt ?? 'Project Timeline'
    return `@startgantt
title ${title}
[Research] lasts 7 days
[Design] lasts 5 days
[Design] starts after [Research]'s end
[Implementation] lasts 14 days
[Implementation] starts after [Design]'s end
[Testing] lasts 7 days
[Testing] starts after [Implementation]'s end
@endgantt
`
  },

  Pie: (config, context) => {
    const title = config.title ?? context?.prompt ?? 'Distribution'
    return `@startuml
title ${title}

pie
  "Category A" : 45
  "Category B" : 30
  "Category C" : 15
  "Category D" : 10

@enduml
`
  },

  Mindmap: (config, context) => {
    const title = config.title ?? context?.prompt ?? 'Mindmap'
    return `@startmindmap
title ${title}

* ${title}
** Topic A
*** Subtopic A1
*** Subtopic A2
** Topic B
*** Subtopic B1
*** Subtopic B2
** Topic C
*** Subtopic C1

@endmindmap
`
  },
}

// ============================================================================
// Graphviz Templates
// ============================================================================

const GRAPHVIZ_TEMPLATES: Record<DiagramType, (config: DiagramConfig, context?: GenerationContext) => string> = {
  Flowchart: (config, context) => {
    const rankdir = config.direction === 'LR' ? 'LR' : config.direction === 'RL' ? 'RL' : config.direction === 'BT' ? 'BT' : 'TB'
    const title = config.title ?? context?.prompt ?? 'Flowchart'
    return `digraph "${title}" {
  rankdir=${rankdir}

  start [shape=oval label="Start"]
  decision [shape=diamond label="Decision"]
  process1 [shape=box label="Process 1"]
  process2 [shape=box label="Process 2"]
  end [shape=oval label="End"]

  start -> decision
  decision -> process1 [label="Yes"]
  decision -> process2 [label="No"]
  process1 -> end
  process2 -> end
}
`
  },

  Sequence: (config, context) => {
    const title = config.title ?? context?.prompt ?? 'Sequence Diagram'
    return `digraph "${title}" {
  rankdir=TB

  subgraph cluster_actors {
    label="Participants"
    actor [shape=box label="Actor"]
    system [shape=box label="System"]
    database [shape=cylinder label="Database"]
  }

  actor -> system [label="Request"]
  system -> database [label="Query"]
  database -> system [label="Response" style=dashed]
  system -> actor [label="Result" style=dashed]
}
`
  },

  Class: (config, context) => {
    const title = config.title ?? context?.prompt ?? 'Class Diagram'
    return `digraph "${title}" {
  rankdir=TB
  node [shape=record]

  Entity [label="{Entity|+id: string\\l+name: string\\l|+create(): void\\l+update(): void\\l}"]
  Service [label="{Service|+entity: Entity\\l|+process(): void\\l}"]

  Service -> Entity
}
`
  },

  ER: (config, context) => {
    const title = config.title ?? context?.prompt ?? 'ER Diagram'
    return `digraph "${title}" {
  rankdir=LR
  node [shape=record]

  User [label="{User|id: PK\\lname\\lemail\\l}"]
  Post [label="{Post|id: PK\\ltitle\\lcontent\\luserId: FK\\l}"]

  User -> Post [label="creates" dir=both arrowtail=crow arrowhead=none]
}
`
  },

  State: (config, context) => {
    const title = config.title ?? context?.prompt ?? 'State Diagram'
    return `digraph "${title}" {
  rankdir=LR

  node [shape=circle]
  start [shape=point]
  end [shape=doublecircle label=""]

  idle [label="Idle"]
  processing [label="Processing"]
  complete [label="Complete"]
  error [label="Error"]

  start -> idle
  idle -> processing [label="start"]
  processing -> complete [label="finish"]
  processing -> error [label="fail"]
  error -> idle [label="reset"]
  complete -> end
}
`
  },

  Gantt: (config, context) => {
    const title = config.title ?? context?.prompt ?? 'Project Timeline'
    return `digraph "${title}" {
  rankdir=LR
  node [shape=box]

  label="${title}"

  planning [label="Planning\\n(7 days)"]
  design [label="Design\\n(5 days)"]
  development [label="Development\\n(14 days)"]
  testing [label="Testing\\n(7 days)"]

  planning -> design -> development -> testing
}
`
  },

  Pie: (config, context) => {
    const title = config.title ?? context?.prompt ?? 'Distribution'
    return `digraph "${title}" {
  rankdir=TB
  label="${title}"

  center [shape=point]
  a [label="Category A\\n45%"]
  b [label="Category B\\n30%"]
  c [label="Category C\\n15%"]
  d [label="Category D\\n10%"]

  center -> {a b c d}
}
`
  },

  Mindmap: (config, context) => {
    const title = config.title ?? context?.prompt ?? 'Mindmap'
    return `digraph "${title}" {
  rankdir=TB

  root [label="${title}" shape=ellipse style=filled fillcolor=lightgray]

  topicA [label="Topic A"]
  topicB [label="Topic B"]
  topicC [label="Topic C"]

  subtopicA1 [label="Subtopic A1"]
  subtopicA2 [label="Subtopic A2"]
  subtopicB1 [label="Subtopic B1"]
  subtopicB2 [label="Subtopic B2"]
  subtopicC1 [label="Subtopic C1"]

  root -> {topicA topicB topicC}
  topicA -> {subtopicA1 subtopicA2}
  topicB -> {subtopicB1 subtopicB2}
  topicC -> subtopicC1
}
`
  },
}

// ============================================================================
// SVG Templates (inline SVG)
// ============================================================================

const SVG_TEMPLATES: Record<DiagramType, (config: DiagramConfig, context?: GenerationContext) => string> = {
  Flowchart: (config, context) => {
    const title = config.title ?? context?.prompt ?? 'Flowchart'
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
  <title>${title}</title>
  <!-- Start -->
  <ellipse cx="200" cy="30" rx="50" ry="20" fill="#4CAF50" stroke="#333"/>
  <text x="200" y="35" text-anchor="middle" fill="white">Start</text>

  <!-- Decision -->
  <polygon points="200,70 250,110 200,150 150,110" fill="#FFC107" stroke="#333"/>
  <text x="200" y="115" text-anchor="middle">Decision</text>

  <!-- Processes -->
  <rect x="50" y="170" width="100" height="40" fill="#2196F3" stroke="#333"/>
  <text x="100" y="195" text-anchor="middle" fill="white">Process 1</text>

  <rect x="250" y="170" width="100" height="40" fill="#2196F3" stroke="#333"/>
  <text x="300" y="195" text-anchor="middle" fill="white">Process 2</text>

  <!-- End -->
  <ellipse cx="200" cy="260" rx="50" ry="20" fill="#f44336" stroke="#333"/>
  <text x="200" y="265" text-anchor="middle" fill="white">End</text>

  <!-- Arrows -->
  <line x1="200" y1="50" x2="200" y2="70" stroke="#333" marker-end="url(#arrow)"/>
  <line x1="150" y1="110" x2="100" y2="170" stroke="#333" marker-end="url(#arrow)"/>
  <line x1="250" y1="110" x2="300" y2="170" stroke="#333" marker-end="url(#arrow)"/>
  <line x1="100" y1="210" x2="200" y2="240" stroke="#333" marker-end="url(#arrow)"/>
  <line x1="300" y1="210" x2="200" y2="240" stroke="#333" marker-end="url(#arrow)"/>

  <defs>
    <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
      <path d="M0,0 L0,6 L9,3 z" fill="#333"/>
    </marker>
  </defs>
</svg>
`
  },

  Sequence: (config, context) => {
    const title = config.title ?? context?.prompt ?? 'Sequence Diagram'
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 250">
  <title>${title}</title>

  <!-- Lifelines -->
  <rect x="40" y="20" width="60" height="30" fill="#4CAF50" stroke="#333"/>
  <text x="70" y="40" text-anchor="middle" fill="white">Actor</text>
  <line x1="70" y1="50" x2="70" y2="230" stroke="#333" stroke-dasharray="5,5"/>

  <rect x="170" y="20" width="60" height="30" fill="#2196F3" stroke="#333"/>
  <text x="200" y="40" text-anchor="middle" fill="white">System</text>
  <line x1="200" y1="50" x2="200" y2="230" stroke="#333" stroke-dasharray="5,5"/>

  <rect x="300" y="20" width="60" height="30" fill="#9C27B0" stroke="#333"/>
  <text x="330" y="40" text-anchor="middle" fill="white">Database</text>
  <line x1="330" y1="50" x2="330" y2="230" stroke="#333" stroke-dasharray="5,5"/>

  <!-- Messages -->
  <line x1="70" y1="80" x2="200" y2="80" stroke="#333" marker-end="url(#arrow)"/>
  <text x="135" y="75" text-anchor="middle" font-size="12">Request</text>

  <line x1="200" y1="120" x2="330" y2="120" stroke="#333" marker-end="url(#arrow)"/>
  <text x="265" y="115" text-anchor="middle" font-size="12">Query</text>

  <line x1="330" y1="160" x2="200" y2="160" stroke="#333" stroke-dasharray="3,3" marker-end="url(#arrow)"/>
  <text x="265" y="155" text-anchor="middle" font-size="12">Response</text>

  <line x1="200" y1="200" x2="70" y2="200" stroke="#333" stroke-dasharray="3,3" marker-end="url(#arrow)"/>
  <text x="135" y="195" text-anchor="middle" font-size="12">Result</text>

  <defs>
    <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
      <path d="M0,0 L0,6 L9,3 z" fill="#333"/>
    </marker>
  </defs>
</svg>
`
  },

  Class: () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200">
  <rect x="20" y="20" width="120" height="80" fill="#E3F2FD" stroke="#1976D2"/>
  <line x1="20" y1="45" x2="140" y2="45" stroke="#1976D2"/>
  <line x1="20" y1="65" x2="140" y2="65" stroke="#1976D2"/>
  <text x="80" y="38" text-anchor="middle" font-weight="bold">Entity</text>
  <text x="25" y="58" font-size="11">+id: string</text>
  <text x="25" y="78" font-size="11">+create(): void</text>
</svg>`,

  ER: () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 150">
  <rect x="20" y="20" width="100" height="60" fill="#E8F5E9" stroke="#4CAF50"/>
  <text x="70" y="55" text-anchor="middle" font-weight="bold">User</text>
  <rect x="180" y="20" width="100" height="60" fill="#FFF3E0" stroke="#FF9800"/>
  <text x="230" y="55" text-anchor="middle" font-weight="bold">Post</text>
  <line x1="120" y1="50" x2="180" y2="50" stroke="#333"/>
</svg>`,

  State: () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100">
  <circle cx="50" cy="50" r="25" fill="#4CAF50" stroke="#333"/>
  <text x="50" y="55" text-anchor="middle" fill="white">Idle</text>
  <circle cx="150" cy="50" r="25" fill="#2196F3" stroke="#333"/>
  <text x="150" y="55" text-anchor="middle" fill="white" font-size="10">Process</text>
  <circle cx="250" cy="50" r="25" fill="#f44336" stroke="#333"/>
  <text x="250" y="55" text-anchor="middle" fill="white" font-size="10">Done</text>
</svg>`,

  Gantt: () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 150">
  <rect x="100" y="30" width="70" height="20" fill="#4CAF50"/>
  <text x="10" y="45">Planning</text>
  <rect x="170" y="60" width="50" height="20" fill="#2196F3"/>
  <text x="10" y="75">Design</text>
  <rect x="220" y="90" width="140" height="20" fill="#FF9800"/>
  <text x="10" y="105">Development</text>
</svg>`,

  Pie: () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <circle cx="100" cy="100" r="80" fill="#4CAF50"/>
  <path d="M100,100 L100,20 A80,80 0 0,1 180,100 Z" fill="#2196F3"/>
  <path d="M100,100 L180,100 A80,80 0 0,1 100,180 Z" fill="#FF9800"/>
</svg>`,

  Mindmap: () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200">
  <ellipse cx="150" cy="100" rx="50" ry="25" fill="#E3F2FD" stroke="#1976D2"/>
  <text x="150" y="105" text-anchor="middle">Root</text>
  <line x1="100" y1="100" x2="50" y2="50" stroke="#333"/>
  <line x1="100" y1="100" x2="50" y2="150" stroke="#333"/>
  <line x1="200" y1="100" x2="250" y2="50" stroke="#333"/>
</svg>`,
}

// ============================================================================
// DiagramGenerator Class
// ============================================================================

export class DiagramGenerator {
  private provider: string
  private apiKey?: string

  constructor(config: DiagramGeneratorConfig = {}) {
    this.provider = config.provider ?? 'claude'
    this.apiKey = config.apiKey
  }

  /**
   * Generate a diagram based on the config
   */
  async generate(config: DiagramConfig, context?: GenerationContext): Promise<DiagramResult> {
    // Validate config
    this.validateConfig(config)

    // Generate markup based on format
    let markup: string

    switch (config.format) {
      case 'Mermaid':
        markup = MERMAID_TEMPLATES[config.type](config, context)
        break
      case 'D2':
        markup = D2_TEMPLATES[config.type](config, context)
        break
      case 'PlantUML':
        markup = PLANTUML_TEMPLATES[config.type](config, context)
        break
      case 'Graphviz':
        markup = GRAPHVIZ_TEMPLATES[config.type](config, context)
        break
      case 'SVG':
        markup = SVG_TEMPLATES[config.type](config, context)
        break
      default:
        markup = MERMAID_TEMPLATES[config.type](config, context)
    }

    return {
      markup,
      format: config.format,
      metadata: {
        type: config.type,
        format: config.format,
        direction: config.direction,
        title: config.title,
        theme: config.theme,
      },
    }
  }

  private validateConfig(config: DiagramConfig): void {
    if (!config) {
      throw new DiagramGenerationError('Missing diagram config')
    }

    if (!config.type) {
      throw new DiagramGenerationError('Missing required field: type', config)
    }

    if (!VALID_TYPES.includes(config.type)) {
      throw new DiagramGenerationError(
        `Invalid diagram type: ${config.type}. Valid options: ${VALID_TYPES.join(', ')}`,
        config
      )
    }

    if (!config.format) {
      throw new DiagramGenerationError('Missing required field: format', config)
    }

    if (!VALID_FORMATS.includes(config.format)) {
      throw new DiagramGenerationError(
        `Invalid format: ${config.format}. Valid options: ${VALID_FORMATS.join(', ')}`,
        config
      )
    }

    if (config.direction && !VALID_DIRECTIONS.includes(config.direction)) {
      throw new DiagramGenerationError(
        `Invalid direction: ${config.direction}. Valid options: ${VALID_DIRECTIONS.join(', ')}`,
        config
      )
    }

    if (config.theme && !VALID_THEMES.includes(config.theme)) {
      throw new DiagramGenerationError(
        `Invalid theme: ${config.theme}. Valid options: ${VALID_THEMES.join(', ')}`,
        config
      )
    }
  }
}

// Export types as values for runtime type checking (tests expect these)
export const DiagramDirective = undefined
export const DiagramConfig = undefined
export const DiagramResult = undefined
export const DiagramType = undefined
export const DiagramFormat = undefined

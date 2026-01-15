# notes.example.com.ai

Collaborative notes built on dotdo. Notes are Things you can query, share, and enhance with AI.

## The Problem

Your team's notes are scattered across apps. Collaboration means copy-pasting links. Search is siloed. And your notes just sit there -- they don't help you think.

## The Solution

dotdo notes are Durable Objects. Every notebook, note, and block is a Thing with real-time sync, semantic relationships, and AI that suggests what to write next.

## Data Model

```typescript
// Nouns
const Notebook = noun('Notebook')
const Note = noun('Note')
const Block = noun('Block')

// A notebook contains notes, notes contain blocks
const notebook = thing(Notebook, 'work-ideas')
const note = thing(Note, 'quarterly-goals')
const block = thing(Block, 'block-001')

// Relationships via actions
note.addedTo(notebook)
block.addedTo(note)
```

## Real-Time Sync

Blocks sync across all connected clients via WebSocket:

```typescript
// Client connects to note's DO
const ws = new WebSocket('wss://notes.example.com.ai/notes/quarterly-goals')

// Send block update
ws.send(JSON.stringify({
  type: 'update',
  $type: 'Block',
  $id: 'block-001',
  content: 'Ship v2 by March'
}))

// Receive updates from other editors
ws.onmessage = (event) => {
  const { $id, content } = JSON.parse(event.data)
  updateBlockInUI($id, content)
}
```

Server-side, the DO broadcasts to all subscribers:

```typescript
// In the Note DO
handleBlockUpdate(block: Block) {
  // Persist
  this.things.update(block)

  // Broadcast to all connected clients
  for (const ws of this.sessions) {
    ws.send(JSON.stringify(block))
  }
}
```

## AI Suggestions

Use `ai` template literals to suggest completions and summaries:

```typescript
import { ai, $ } from 'dotdo'

// Suggest next steps based on note content
async function suggestNextSteps(note: Note) {
  const blocks = await note -> 'Block'
  const content = blocks.map(b => b.content).join('\n')

  return ai`Extract 3 action items from: ${content}`
}

// Auto-generate summary when note changes
$.on.Note.updated(async (event) => {
  const note = event.data as Note
  const blocks = await note -> 'Block'

  const summary = await ai`
    Summarize in one sentence:
    ${blocks.map(b => b.content).join('\n')}
  `

  await $.things.Note(note.$id).update({ summary })
})
```

Smart title suggestions:

```typescript
async function suggestTitle(blocks: Block[]) {
  const content = blocks.map(b => b.content).join('\n')
  return ai`Suggest a short title (3-5 words) for: ${content}`
}
```

## Sharing

Notes emit events when shared. Subscribe to trigger notifications or access control:

```typescript
// Handle share events
$.on.Note.shared(async (event) => {
  const { note, sharedWith, permission } = event.data

  // Create access relationship
  await $.things.User(sharedWith).canAccess(note, { permission })

  // Notify recipient
  await $.User(sharedWith).notify({
    title: `${event.subject} shared a note with you`,
    noteId: note.$id
  })
})

// Trigger a share
async function shareNote(noteId: string, userId: string, permission: 'view' | 'edit') {
  $.send('Note.shared', {
    note: { $id: noteId },
    sharedWith: userId,
    permission
  })
}
```

## Quick Start

```bash
# Clone and install
git clone https://github.com/dot-do/dotdo
cd dotdo/examples/notes
npm install

# Run locally
npm run dev

# Deploy to Cloudflare
npm run deploy
```

Your notes are now live at `notes.example.com.ai`.

## What You Get

- **Query notes like a database** - Find notes by content, date, or relationships
- **Real-time collaboration** - Changes sync instantly across all editors
- **AI that thinks with you** - Summaries, suggestions, and action items
- **Share with one event** - Access control via semantic relationships
- **Runs at the edge** - Durable Objects in every Cloudflare datacenter

Start your first notebook.

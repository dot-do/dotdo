/**
 * CLI Components
 *
 * Ink components for the dotdo REPL interface.
 */

export { Input, StatusBar } from './Input.js'
export type { InputProps, StatusBarProps } from './Input.js'

export { Suggestions, SignatureHelp, QuickInfo } from './Suggestions.js'
export type { SuggestionsProps, SignatureHelpProps, QuickInfoProps } from './Suggestions.js'

export {
  Output,
  ErrorOutput,
  TableOutput,
  createOutputEntry,
  resetEntryCounter,
  useStreamingOutput,
  OutputBuffer,
} from './Output.js'
export type {
  OutputProps,
  OutputEntry,
  OutputType,
  ErrorOutputProps,
  TableOutputProps,
  StreamingOutputConfig,
} from './Output.js'

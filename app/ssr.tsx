import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/start/server'

// createStartHandler now takes a HandlerCallback directly
// Router and manifest are loaded via virtual modules automatically
export default createStartHandler(defaultStreamHandler)

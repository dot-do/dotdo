// Main App component - see do-7rf.8.1, do-7rf.8.6
import { RouterProvider } from '@tanstack/react-router'
import { createRouter } from './router'

const router = createRouter()

export function App() {
  return <RouterProvider router={router} />
}

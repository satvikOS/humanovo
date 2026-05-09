import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { ThemeProvider } from './contexts/ThemeContext'
import { ToastProvider } from './contexts/ToastContext'
import { WorkspaceProvider } from './contexts/WorkspaceContext'
import { AuthProvider } from './contexts/AuthContext'
import { Toaster } from './components/Toaster'
import { SkeletonStyles } from './components/Skeleton'
import App from './App'
import { installGlobalErrorHandlers } from './lib/errorLog'
import { installLifecycle } from './lib/lifecycle'
import './index.css'

// Install before render so the very first runtime error gets captured —
// even errors that surface during initial component mounting.
installGlobalErrorHandlers()
// Also snapshot the prior session's shutdown state before we mark
// this one as "running"; the diagnostics block uses the snapshot to
// surface unclean shutdowns (Rust panic / OOM kill) that the JS
// error log can't see.
installLifecycle()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <WorkspaceProvider>
            <BrowserRouter>
              {/* AuthProvider lives inside BrowserRouter so the first-run
                  Onboarding wizard (rendered from Layout) can use
                  react-router's useNavigate to send the user to the
                  step's CTA target. Outside the router, that hook
                  throws. */}
              <AuthProvider>
                <App />
              </AuthProvider>
            </BrowserRouter>
          </WorkspaceProvider>
          <Toaster />
          <SkeletonStyles />
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)

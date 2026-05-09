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
import './index.css'

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

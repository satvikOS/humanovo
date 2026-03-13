import { Routes, Route, Navigate } from 'react-router-dom'
import { Component, type ReactNode } from 'react'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Projects from './pages/Projects'
import ProjectDetail from './pages/ProjectDetail'

import Evidence from './pages/Evidence'
import Workbench from './pages/Workbench'
import HumanAnatomy from './pages/HumanAnatomy'
import Settings from './pages/Settings'
import Notebook from './pages/Notebook'
import Search from './pages/Search'
import Timeline from './pages/Timeline'
import Agents from './pages/Agents'
import Simulations from './pages/Simulations'
import LiteratureReview from './pages/LiteratureReview'
import CitationManager from './pages/CitationManager'
import ExperimentTracker from './pages/ExperimentTracker'
import DataVisualization from './pages/DataVisualization'
import StatisticalAnalysis from './pages/StatisticalAnalysis'
import DataManager from './pages/DataManager'
import Collaboration from './pages/Collaboration'
import ClinicalTrials from './pages/ClinicalTrials'
import GenomicsAnalysis from './pages/GenomicsAnalysis'
import ManuscriptManager from './pages/ManuscriptManager'
import RegulatoryCompliance from './pages/RegulatoryCompliance'
import ResearchImaging from './pages/ResearchImaging'
// ML Models removed
import BiobankManager from './pages/BiobankManager'

// Error boundary to prevent blank pages on runtime errors
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: string }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false, error: '' }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message }
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('Page error:', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-full p-8">
          <div className="text-center max-w-md">
            <div className="text-4xl mb-4 opacity-20">⚠</div>
            <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Something went wrong</h2>
            <p className="text-sm mb-4" style={{ color: 'var(--color-text-muted)' }}>{this.state.error}</p>
            <button
              onClick={() => { this.setState({ hasError: false, error: '' }); window.location.reload() }}
              className="btn text-sm"
              style={{ color: 'var(--color-accent-blue)' }}
            >
              Reload Page
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

function PageWrapper({ children }: { children: ReactNode }) {
  return <ErrorBoundary>{children}</ErrorBoundary>
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<PageWrapper><Dashboard /></PageWrapper>} />
        <Route path="projects" element={<PageWrapper><Projects /></PageWrapper>} />
        <Route path="projects/:projectId" element={<PageWrapper><ProjectDetail /></PageWrapper>} />
        <Route path="evidence" element={<PageWrapper><Evidence /></PageWrapper>} />
        <Route path="simulations" element={<PageWrapper><Simulations /></PageWrapper>} />
        <Route path="workbench" element={<PageWrapper><Workbench /></PageWrapper>} />
        <Route path="anatomy" element={<PageWrapper><HumanAnatomy /></PageWrapper>} />
        <Route path="notebook" element={<PageWrapper><Notebook /></PageWrapper>} />
        <Route path="agents" element={<PageWrapper><Agents /></PageWrapper>} />
        <Route path="timeline" element={<PageWrapper><Timeline /></PageWrapper>} />
        <Route path="search" element={<PageWrapper><Search /></PageWrapper>} />
        <Route path="settings" element={<PageWrapper><Settings /></PageWrapper>} />
        <Route path="literature-review" element={<PageWrapper><LiteratureReview /></PageWrapper>} />
        <Route path="citation-manager" element={<PageWrapper><CitationManager /></PageWrapper>} />
        <Route path="experiment-tracker" element={<PageWrapper><ExperimentTracker /></PageWrapper>} />
        <Route path="data-visualization" element={<PageWrapper><DataVisualization /></PageWrapper>} />
        <Route path="statistical-analysis" element={<PageWrapper><StatisticalAnalysis /></PageWrapper>} />
        <Route path="data-manager" element={<PageWrapper><DataManager /></PageWrapper>} />
        <Route path="collaboration" element={<PageWrapper><Collaboration /></PageWrapper>} />
        <Route path="clinical-trials" element={<PageWrapper><ClinicalTrials /></PageWrapper>} />
        <Route path="genomics" element={<PageWrapper><GenomicsAnalysis /></PageWrapper>} />
        <Route path="manuscripts" element={<PageWrapper><ManuscriptManager /></PageWrapper>} />
        <Route path="regulatory" element={<PageWrapper><RegulatoryCompliance /></PageWrapper>} />
        <Route path="imaging" element={<PageWrapper><ResearchImaging /></PageWrapper>} />
        {/* ML Models removed */}
        <Route path="biobank" element={<PageWrapper><BiobankManager /></PageWrapper>} />
      </Route>
    </Routes>
  )
}

export default App

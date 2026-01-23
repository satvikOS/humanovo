import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Projects from './pages/Projects'
import ProjectDetail from './pages/ProjectDetail'
import Hypotheses from './pages/Hypotheses'
import HypothesisDetail from './pages/HypothesisDetail'
import KnowledgeGraph from './pages/KnowledgeGraph'
import Simulations from './pages/Simulations'
import Evidence from './pages/Evidence'
import Workbench from './pages/Workbench'
import Settings from './pages/Settings'

// Placeholder pages for routes not yet fully implemented
function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <h1 className="text-xl font-semibold mb-2">{title}</h1>
        <p className="text-sm text-[var(--color-text-muted)]">Coming soon</p>
      </div>
    </div>
  )
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="projects" element={<Projects />} />
        <Route path="projects/:projectId" element={<ProjectDetail />} />
        <Route path="evidence" element={<Evidence />} />
        <Route path="knowledge" element={<KnowledgeGraph />} />
        <Route path="hypotheses" element={<Hypotheses />} />
        <Route path="hypotheses/:hypothesisId" element={<HypothesisDetail />} />
        <Route path="simulations" element={<Simulations />} />
        <Route path="workbench" element={<Workbench />} />
        <Route path="notebook" element={<PlaceholderPage title="Research Notebook" />} />
        <Route path="agents" element={<PlaceholderPage title="Multi-Agent Research" />} />
        <Route path="timeline" element={<PlaceholderPage title="Discovery Timeline" />} />
        <Route path="search" element={<PlaceholderPage title="Search" />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  )
}

export default App

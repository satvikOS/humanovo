import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Projects from './pages/Projects'
import ProjectDetail from './pages/ProjectDetail'
import Hypotheses from './pages/Hypotheses'
import HypothesisDetail from './pages/HypothesisDetail'
import KnowledgeGraph from './pages/KnowledgeGraph'
import Simulations from './pages/Simulations'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="projects" element={<Projects />} />
        <Route path="projects/:projectId" element={<ProjectDetail />} />
        <Route path="hypotheses" element={<Hypotheses />} />
        <Route path="hypotheses/:hypothesisId" element={<HypothesisDetail />} />
        <Route path="knowledge" element={<KnowledgeGraph />} />
        <Route path="simulations" element={<Simulations />} />
      </Route>
    </Routes>
  )
}

export default App

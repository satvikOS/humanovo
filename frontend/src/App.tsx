import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Projects from './pages/Projects'
import ProjectDetail from './pages/ProjectDetail'
import Hypotheses from './pages/Hypotheses'
import HypothesisDetail from './pages/HypothesisDetail'

import Evidence from './pages/Evidence'
import Workbench from './pages/Workbench'
import HumanAnatomy from './pages/HumanAnatomy'
import Settings from './pages/Settings'
import Notebook from './pages/Notebook'
import Search from './pages/Search'
import Timeline from './pages/Timeline'
import Agents from './pages/Agents'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="projects" element={<Projects />} />
        <Route path="projects/:projectId" element={<ProjectDetail />} />
        <Route path="evidence" element={<Evidence />} />

        <Route path="hypotheses" element={<Hypotheses />} />
        <Route path="hypotheses/:hypothesisId" element={<HypothesisDetail />} />
        <Route path="simulations" element={<Navigate to="/agents" replace />} />
        <Route path="workbench" element={<Workbench />} />
        <Route path="anatomy" element={<HumanAnatomy />} />
        <Route path="notebook" element={<Notebook />} />
        <Route path="agents" element={<Agents />} />
        <Route path="timeline" element={<Timeline />} />
        <Route path="search" element={<Search />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  )
}

export default App

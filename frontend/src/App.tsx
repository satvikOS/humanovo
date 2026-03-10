import { Routes, Route, Navigate } from 'react-router-dom'
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
import KnowledgeGraphViewer from './pages/KnowledgeGraphViewer'
import ClinicalTrials from './pages/ClinicalTrials'
import GenomicsAnalysis from './pages/GenomicsAnalysis'
import ManuscriptManager from './pages/ManuscriptManager'
import RegulatoryCompliance from './pages/RegulatoryCompliance'
import ResearchImaging from './pages/ResearchImaging'
import MLModelManager from './pages/MLModelManager'
import BiobankManager from './pages/BiobankManager'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="projects" element={<Projects />} />
        <Route path="projects/:projectId" element={<ProjectDetail />} />
        <Route path="evidence" element={<Evidence />} />

        {/* Hypotheses integrated into Discovery — redirect old routes */}
        <Route path="hypotheses" element={<Navigate to="/agents" replace />} />
        <Route path="hypotheses/:hypothesisId" element={<Navigate to="/agents" replace />} />
        <Route path="simulations" element={<Simulations />} />
        <Route path="workbench" element={<Workbench />} />
        <Route path="anatomy" element={<HumanAnatomy />} />
        <Route path="notebook" element={<Notebook />} />
        <Route path="agents" element={<Agents />} />
        <Route path="timeline" element={<Timeline />} />
        <Route path="search" element={<Search />} />
        <Route path="settings" element={<Settings />} />
        <Route path="literature-review" element={<LiteratureReview />} />
        <Route path="citation-manager" element={<CitationManager />} />
        <Route path="experiment-tracker" element={<ExperimentTracker />} />
        <Route path="data-visualization" element={<DataVisualization />} />
        <Route path="statistical-analysis" element={<StatisticalAnalysis />} />
        <Route path="data-manager" element={<DataManager />} />
        <Route path="collaboration" element={<Collaboration />} />
        <Route path="knowledge-graph-viewer" element={<KnowledgeGraphViewer />} />
        <Route path="clinical-trials" element={<ClinicalTrials />} />
        <Route path="genomics" element={<GenomicsAnalysis />} />
        <Route path="manuscripts" element={<ManuscriptManager />} />
        <Route path="regulatory" element={<RegulatoryCompliance />} />
        <Route path="imaging" element={<ResearchImaging />} />
        <Route path="ml-models" element={<MLModelManager />} />
        <Route path="biobank" element={<BiobankManager />} />
      </Route>
    </Routes>
  )
}

export default App

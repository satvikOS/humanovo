import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { type ReactNode } from 'react'
import Layout from './components/Layout'
import ErrorBoundary from './components/ErrorBoundary'
import Dashboard from './pages/Dashboard'
import Projects from './pages/Projects'
import ProjectDetail from './pages/ProjectDetail'

// Eagerly-loaded pages: landing surfaces users hit on cold-start. Keeping
// them in the main bundle avoids a network round-trip on first paint.
import Evidence from './pages/Evidence'
import Settings from './pages/Settings'
import Notebook from './pages/Notebook'
import Search from './pages/Search'
import Timeline from './pages/Timeline'
import Agents from './pages/Agents'
import DataManager from './pages/DataManager'

// Lazy-loaded pages: heavy (recharts, canvas, MATLAB interpreter, 3D),
// or rarely the entry point. Split into their own chunks so we don't
// block initial paint on code that the user may never reach.
const Workbench = lazy(() => import('./pages/Workbench'))
const HumanAnatomy = lazy(() => import('./pages/HumanAnatomy'))
const LiteratureReview = lazy(() => import('./pages/LiteratureReview'))
const CitationManager = lazy(() => import('./pages/CitationManager'))
const ExperimentTracker = lazy(() => import('./pages/ExperimentTracker'))
const DataVisualization = lazy(() => import('./pages/DataVisualization'))
const Collaboration = lazy(() => import('./pages/Collaboration'))
const ClinicalTrials = lazy(() => import('./pages/ClinicalTrials'))
const GenomicsAnalysis = lazy(() => import('./pages/GenomicsAnalysis'))
const ManuscriptManager = lazy(() => import('./pages/ManuscriptManager'))
const RegulatoryCompliance = lazy(() => import('./pages/RegulatoryCompliance'))
const ResearchImaging = lazy(() => import('./pages/ResearchImaging'))
const BiobankManager = lazy(() => import('./pages/BiobankManager'))
const ComputeLab = lazy(() => import('./pages/compute'))

// Project Jamison — integrated project workspace routes.
const ProjectWorkspace = lazy(() => import('./pages/ProjectWorkspace'))
const DiscoveryRunner = lazy(() => import('./pages/DiscoveryRunner'))
const HypothesisReview = lazy(() => import('./pages/HypothesisReview'))
const ProjectKnowledgeGraph = lazy(() => import('./pages/ProjectKnowledgeGraph'))
const PgvectorManager = lazy(() => import('./pages/PgvectorManager'))

// Previously-orphaned pages: code existed on disk but no route pointed
// to them. Now reachable from the sidebar.
const Hypotheses = lazy(() => import('./pages/Hypotheses'))
const HypothesisDetail = lazy(() => import('./pages/HypothesisDetail'))
const KnowledgeGraph = lazy(() => import('./pages/KnowledgeGraph'))
const KnowledgeGraphViewer = lazy(() => import('./pages/KnowledgeGraphViewer'))
const MLModelManager = lazy(() => import('./pages/MLModelManager'))

function PageWrapper({ children }: { children: ReactNode }) {
  // Pass the current pathname as resetKey so a user who crashes on
  // /projects and navigates to /dashboard doesn't stay stuck on the
  // error screen — the boundary auto-resets when the route changes.
  const { pathname } = useLocation()
  return <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>
}

// Legacy /simulations etc. redirects. We want to preserve the ?tab=…
// query so that existing bookmarks like "/simulations?tab=montecarlo"
// land on the correct Compute Lab tab instead of the default.
function LegacyComputeRedirect() {
  const { search } = useLocation()
  return <Navigate to={`/compute-lab${search}`} replace />
}

function LazyPageWrapper({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  return (
    <ErrorBoundary resetKey={pathname}>
      <Suspense fallback={
        <div className="flex items-center justify-center h-full p-8">
          <div className="animate-pulse text-sm" style={{ color: 'var(--color-text-muted)' }}>Loading...</div>
        </div>
      }>
        {children}
      </Suspense>
    </ErrorBoundary>
  )
}

function App() {
  return (
    <Routes>
      {/* Marketing lives at https://www.humanovo.net/ — the in-app /welcome,
          /pricing, /docs routes were removed (commit following this one)
          to keep the bundle lean. External site is the canonical surface. */}
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<PageWrapper><Dashboard /></PageWrapper>} />
        <Route path="projects" element={<PageWrapper><Projects /></PageWrapper>} />
        <Route path="projects/:projectId" element={<PageWrapper><ProjectDetail /></PageWrapper>} />
        {/* Project Jamison — integrated project workspace routes */}
        <Route path="projects/:projectId/workspace" element={<LazyPageWrapper><ProjectWorkspace /></LazyPageWrapper>} />
        <Route path="projects/:projectId/discover" element={<LazyPageWrapper><DiscoveryRunner /></LazyPageWrapper>} />
        <Route path="projects/:projectId/hypotheses/:hypothesisId" element={<LazyPageWrapper><HypothesisReview /></LazyPageWrapper>} />
        <Route path="projects/:projectId/graph" element={<LazyPageWrapper><ProjectKnowledgeGraph /></LazyPageWrapper>} />
        <Route path="evidence" element={<PageWrapper><Evidence /></PageWrapper>} />
        <Route path="compute-lab" element={<LazyPageWrapper><ComputeLab /></LazyPageWrapper>} />
        {/* Legacy redirects → unified Compute Lab */}
        <Route path="simulations" element={<LegacyComputeRedirect />} />
        <Route path="statistical-analysis" element={<LegacyComputeRedirect />} />
        <Route path="numeric-compute" element={<LegacyComputeRedirect />} />
        <Route path="matlab-compute" element={<LegacyComputeRedirect />} />
        <Route path="workbench" element={<LazyPageWrapper><Workbench /></LazyPageWrapper>} />
        <Route path="anatomy" element={<LazyPageWrapper><HumanAnatomy /></LazyPageWrapper>} />
        <Route path="notebook" element={<PageWrapper><Notebook /></PageWrapper>} />
        <Route path="agents" element={<PageWrapper><Agents /></PageWrapper>} />
        <Route path="timeline" element={<PageWrapper><Timeline /></PageWrapper>} />
        <Route path="search" element={<PageWrapper><Search /></PageWrapper>} />
        <Route path="settings" element={<PageWrapper><Settings /></PageWrapper>} />
        <Route path="literature-review" element={<LazyPageWrapper><LiteratureReview /></LazyPageWrapper>} />
        <Route path="citation-manager" element={<LazyPageWrapper><CitationManager /></LazyPageWrapper>} />
        <Route path="experiment-tracker" element={<LazyPageWrapper><ExperimentTracker /></LazyPageWrapper>} />
        <Route path="data-visualization" element={<LazyPageWrapper><DataVisualization /></LazyPageWrapper>} />
        <Route path="data-manager" element={<PageWrapper><DataManager /></PageWrapper>} />
        <Route path="collaboration" element={<LazyPageWrapper><Collaboration /></LazyPageWrapper>} />
        <Route path="clinical-trials" element={<LazyPageWrapper><ClinicalTrials /></LazyPageWrapper>} />
        <Route path="genomics" element={<LazyPageWrapper><GenomicsAnalysis /></LazyPageWrapper>} />
        <Route path="manuscripts" element={<LazyPageWrapper><ManuscriptManager /></LazyPageWrapper>} />
        <Route path="regulatory" element={<LazyPageWrapper><RegulatoryCompliance /></LazyPageWrapper>} />
        <Route path="imaging" element={<LazyPageWrapper><ResearchImaging /></LazyPageWrapper>} />
        <Route path="biobank" element={<LazyPageWrapper><BiobankManager /></LazyPageWrapper>} />
        {/* Previously-orphaned pages — now routed + in sidebar nav */}
        <Route path="hypotheses" element={<LazyPageWrapper><Hypotheses /></LazyPageWrapper>} />
        <Route path="hypotheses/:hypothesisId" element={<LazyPageWrapper><HypothesisDetail /></LazyPageWrapper>} />
        <Route path="knowledge-graph" element={<LazyPageWrapper><KnowledgeGraph /></LazyPageWrapper>} />
        <Route path="knowledge-graph/viewer" element={<LazyPageWrapper><KnowledgeGraphViewer /></LazyPageWrapper>} />
        <Route path="ml-models" element={<LazyPageWrapper><MLModelManager /></LazyPageWrapper>} />
        {/* Project Jamison — platform-level pages */}
        <Route path="dev/pgvector" element={<LazyPageWrapper><PgvectorManager /></LazyPageWrapper>} />
      </Route>
    </Routes>
  )
}

export default App

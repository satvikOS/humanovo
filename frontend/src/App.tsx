import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { type ReactNode } from 'react'
import Layout from './components/Layout'
import ErrorBoundary from './components/ErrorBoundary'
import RouteGatePlaceholder from './components/RouteGatePlaceholder'
import Dashboard from './pages/Dashboard'
import Projects from './pages/Projects'
import { isHiddenInV1 } from './utils/featureFlags'

// Eagerly-loaded pages: cold-start surfaces users hit immediately
// (Dashboard, Projects, Search, Agents, Evidence). Keeping them in
// the main bundle avoids a network round-trip on first paint.
import Evidence from './pages/Evidence'
import Search from './pages/Search'
import Agents from './pages/Agents'

// Stage 4 bundle audit (PATH_TO_100_PERCENT.md): pages users only
// reach via deep navigation move to React.lazy so they don't block
// first paint. ProjectDetail, Settings, Notebook, Timeline, and
// DataManager were eagerly imported pre-Stage-4 even though most
// sessions never touch them — collectively a sizeable fraction of
// the 2 MB main bundle.
const ProjectDetail = lazy(() => import('./pages/ProjectDetail'))
const SettingsPage = lazy(() => import('./pages/Settings'))
const Notebook = lazy(() => import('./pages/Notebook'))
const Timeline = lazy(() => import('./pages/Timeline'))
const DataManager = lazy(() => import('./pages/DataManager'))

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
const AgentsChatMode = lazy(() => import('./pages/AgentsChatMode'))

// the v2 platform — integrated project workspace routes.
const ProjectWorkspace = lazy(() => import('./pages/ProjectWorkspace'))
const DiscoveryRunner = lazy(() => import('./pages/DiscoveryRunner'))
const HypothesisReview = lazy(() => import('./pages/HypothesisReview'))
const ProjectKnowledgeGraph = lazy(() => import('./pages/ProjectKnowledgeGraph'))
const PgvectorManager = lazy(() => import('./pages/PgvectorManager'))

// Previously-orphaned pages: code existed on disk but no route pointed
// to them. Now reachable from the sidebar.
// The standalone Hypotheses route was retired; hypotheses live inside
// projects now. Import dropped to avoid shipping the bundle.
const HypothesisDetail = lazy(() => import('./pages/HypothesisDetail'))
const KnowledgeGraph = lazy(() => import('./pages/KnowledgeGraph'))
const KnowledgeGraphViewer = lazy(() => import('./pages/KnowledgeGraphViewer'))
const MLModelManager = lazy(() => import('./pages/MLModelManager'))

function PageWrapper({ children }: { children: ReactNode }) {
  // Pass the current pathname as resetKey so a user who crashes on
  // /projects and navigates to /dashboard doesn't stay stuck on the
  // error screen — the boundary auto-resets when the route changes.
  // Every route also funnels through RouteGatePlaceholder so Stage 5
  // of PATH_TO_100_PERCENT.md can flip auth on with a single edit
  // to that component.
  const { pathname } = useLocation()
  return (
    <ErrorBoundary resetKey={pathname}>
      <RouteGatePlaceholder>{children}</RouteGatePlaceholder>
    </ErrorBoundary>
  )
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
      <RouteGatePlaceholder>
        <Suspense fallback={
          <div className="flex items-center justify-center h-full p-8">
            <div className="animate-pulse text-sm" style={{ color: 'var(--color-text-muted)' }}>Loading...</div>
          </div>
        }>
          {children}
        </Suspense>
      </RouteGatePlaceholder>
    </ErrorBoundary>
  )
}

/** Routes hidden in v1 redirect to /dashboard. Code stays so v1.1 can
 *  re-enable them via VITE_V1_HIDDEN_ROUTES_ENABLED=true. */
function V1Gate({ path, children }: { path: string; children: ReactNode }) {
  if (isHiddenInV1(path)) return <Navigate to="/dashboard" replace />
  return <>{children}</>
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
        <Route path="projects/:projectId" element={<LazyPageWrapper><ProjectDetail /></LazyPageWrapper>} />
        {/* the v2 platform — integrated project workspace routes */}
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
        <Route path="workbench" element={<V1Gate path="/workbench"><LazyPageWrapper><Workbench /></LazyPageWrapper></V1Gate>} />
        <Route path="anatomy" element={<V1Gate path="/anatomy"><LazyPageWrapper><HumanAnatomy /></LazyPageWrapper></V1Gate>} />
        <Route path="notebook" element={<LazyPageWrapper><Notebook /></LazyPageWrapper>} />
        <Route path="agents" element={<PageWrapper><Agents /></PageWrapper>} />
        <Route path="agents-chat-mode" element={<LazyPageWrapper><AgentsChatMode /></LazyPageWrapper>} />
        <Route path="timeline" element={<LazyPageWrapper><Timeline /></LazyPageWrapper>} />
        <Route path="search" element={<PageWrapper><Search /></PageWrapper>} />
        <Route path="settings" element={<LazyPageWrapper><SettingsPage /></LazyPageWrapper>} />
        <Route path="literature-review" element={<LazyPageWrapper><LiteratureReview /></LazyPageWrapper>} />
        <Route path="citation-manager" element={<LazyPageWrapper><CitationManager /></LazyPageWrapper>} />
        <Route path="experiment-tracker" element={<V1Gate path="/experiment-tracker"><LazyPageWrapper><ExperimentTracker /></LazyPageWrapper></V1Gate>} />
        <Route path="data-visualization" element={<LazyPageWrapper><DataVisualization /></LazyPageWrapper>} />
        <Route path="data-manager" element={<LazyPageWrapper><DataManager /></LazyPageWrapper>} />
        <Route path="collaboration" element={<V1Gate path="/collaboration"><LazyPageWrapper><Collaboration /></LazyPageWrapper></V1Gate>} />
        <Route path="clinical-trials" element={<V1Gate path="/clinical-trials"><LazyPageWrapper><ClinicalTrials /></LazyPageWrapper></V1Gate>} />
        <Route path="genomics" element={<LazyPageWrapper><GenomicsAnalysis /></LazyPageWrapper>} />
        <Route path="manuscripts" element={<V1Gate path="/manuscripts"><LazyPageWrapper><ManuscriptManager /></LazyPageWrapper></V1Gate>} />
        <Route path="regulatory" element={<V1Gate path="/regulatory"><LazyPageWrapper><RegulatoryCompliance /></LazyPageWrapper></V1Gate>} />
        <Route path="imaging" element={<V1Gate path="/imaging"><LazyPageWrapper><ResearchImaging /></LazyPageWrapper></V1Gate>} />
        <Route path="biobank" element={<V1Gate path="/biobank"><LazyPageWrapper><BiobankManager /></LazyPageWrapper></V1Gate>} />
        {/* Standalone Hypotheses list removed per redesign — hypotheses
            live within projects. Old /hypotheses links redirect to
            /projects so external bookmarks still land somewhere useful;
            per-id hypothesis links still open the detail pane since
            hypotheses do have a canonical URL. */}
        <Route path="hypotheses" element={<Navigate to="/projects" replace />} />
        <Route path="hypotheses/:hypothesisId" element={<LazyPageWrapper><HypothesisDetail /></LazyPageWrapper>} />
        <Route path="knowledge-graph" element={<LazyPageWrapper><KnowledgeGraph /></LazyPageWrapper>} />
        <Route path="knowledge-graph/viewer" element={<LazyPageWrapper><KnowledgeGraphViewer /></LazyPageWrapper>} />
        <Route path="ml-models" element={<V1Gate path="/ml-models"><LazyPageWrapper><MLModelManager /></LazyPageWrapper></V1Gate>} />
        {/* the v2 platform — platform-level pages */}
        <Route path="dev/pgvector" element={<LazyPageWrapper><PgvectorManager /></LazyPageWrapper>} />
      </Route>
    </Routes>
  )
}

export default App

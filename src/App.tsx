import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ShieldAlert, Boxes } from 'lucide-react'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import CommandPalette from '@/components/layout/CommandPalette'
import AssistPanel from '@/components/layout/AssistPanel'
import NotificationPanel from '@/components/layout/NotificationPanel'
import { UIProvider, useUI } from '@/store/ui'
import Login from '@/pages/Login'
import Invite from '@/pages/Invite'
import MobileScan from '@/pages/MobileScan'
import NotFound from '@/pages/NotFound'

// 概览
const Launcher = lazy(() => import('@/pages/Launcher'))
const Overview = lazy(() => import('@/pages/Overview'))
// 数据
const Connections = lazy(() => import('@/pages/data/Connections'))
const Pipelines = lazy(() => import('@/pages/data/Pipelines'))
const CodeRepo = lazy(() => import('@/pages/data/CodeRepo'))
const Datasets = lazy(() => import('@/pages/data/Datasets'))
const Lineage = lazy(() => import('@/pages/data/Lineage'))
// 本体
const OntologyManager = lazy(() => import('@/pages/ontology/OntologyManager'))
const ObjectExplorer = lazy(() => import('@/pages/ontology/ObjectExplorer'))
const ObjectViews = lazy(() => import('@/pages/ontology/ObjectViews'))
const VertexGraph = lazy(() => import('@/pages/ontology/VertexGraph'))
const Rules = lazy(() => import('@/pages/ontology/Rules'))
const Machinery = lazy(() => import('@/pages/ontology/Machinery'))
const Scheduling = lazy(() => import('@/pages/ontology/Scheduling'))
const TimeSeries = lazy(() => import('@/pages/ontology/TimeSeries'))
// 知识
const KnowledgeLibrary = lazy(() => import('@/pages/knowledge/Library'))
const KnowledgeSearch = lazy(() => import('@/pages/knowledge/Search'))
const KnowledgeExtract = lazy(() => import('@/pages/knowledge/Extract'))
// 分析
const Contour = lazy(() => import('@/pages/analytics/Contour'))
const Quiver = lazy(() => import('@/pages/analytics/Quiver'))
const Insight = lazy(() => import('@/pages/analytics/Insight'))
const MapPage = lazy(() => import('@/pages/analytics/MapPage'))
const Notepad = lazy(() => import('@/pages/analytics/Notepad'))
const Fusion = lazy(() => import('@/pages/analytics/Fusion'))
// 应用
const Workshop = lazy(() => import('@/pages/apps/Workshop'))
const Automate = lazy(() => import('@/pages/apps/Automate'))
const Carbon = lazy(() => import('@/pages/apps/Carbon'))
const Marketplace = lazy(() => import('@/pages/apps/Marketplace'))
// AIP
const AipLogic = lazy(() => import('@/pages/aip/Logic'))
const AgentStudio = lazy(() => import('@/pages/aip/Agents'))
const Threads = lazy(() => import('@/pages/aip/Threads'))
const Evals = lazy(() => import('@/pages/aip/Evals'))
const Models = lazy(() => import('@/pages/aip/Models'))
const Developers = lazy(() => import('@/pages/aip/Developers'))
// 治理
const Approvals = lazy(() => import('@/pages/gov/Approvals'))
const Audit = lazy(() => import('@/pages/gov/Audit'))
const Security = lazy(() => import('@/pages/gov/Security'))
// 管理
const UsersAdmin = lazy(() => import('@/pages/admin/Users'))
const Roadmap = lazy(() => import('@/pages/admin/Roadmap'))
const ControlPanel = lazy(() => import('@/pages/admin/ControlPanel'))
const ScanTemplates = lazy(() => import('@/pages/admin/ScanTemplates'))
const Apollo = lazy(() => import('@/pages/admin/Apollo'))

function canAccess(apps: string[], path: string): boolean {
  return apps.includes('*') || apps.includes(path)
}

function Shell() {
  const location = useLocation()
  const { currentUser } = useUI()
  const allowed = location.pathname === '/' || (currentUser ? canAccess(currentUser.role.apps, location.pathname) : false)

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="min-h-0 flex-1 overflow-y-auto bg-slate-100">
          {!allowed ? (
            <div className="flex min-h-full flex-col items-center justify-center gap-3 p-10 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-500">
                <ShieldAlert size={26} />
              </div>
              <div className="text-lg font-bold text-slate-800">无权访问该应用</div>
              <div className="max-w-md text-sm text-slate-500">
                当前身份「{currentUser?.name} · {currentUser?.role.name}」未获得此应用的访问授权。
              </div>
            </div>
          ) : (
            <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-slate-400">加载中…</div>}>
              <Routes>
                <Route path="/" element={<Navigate to="/launcher" replace />} />
                <Route path="/launcher" element={<Launcher />} />
                <Route path="/overview" element={<Overview />} />
                <Route path="/data/connections" element={<Connections />} />
                <Route path="/data/pipelines" element={<Pipelines />} />
                <Route path="/data/code" element={<CodeRepo />} />
                <Route path="/data/datasets" element={<Datasets />} />
                <Route path="/data/lineage" element={<Lineage />} />
                <Route path="/ontology/manager" element={<OntologyManager />} />
                <Route path="/ontology/explorer" element={<ObjectExplorer />} />
                <Route path="/ontology/views" element={<ObjectViews />} />
                <Route path="/ontology/graph" element={<VertexGraph />} />
                <Route path="/ontology/rules" element={<Rules />} />
                <Route path="/ontology/machinery" element={<Machinery />} />
                <Route path="/ontology/scheduling" element={<Scheduling />} />
                <Route path="/ontology/timeseries" element={<TimeSeries />} />
                <Route path="/knowledge/library" element={<KnowledgeLibrary />} />
                <Route path="/knowledge/search" element={<KnowledgeSearch />} />
                <Route path="/knowledge/extract" element={<KnowledgeExtract />} />
                <Route path="/analytics/contour" element={<Contour />} />
                <Route path="/analytics/quiver" element={<Quiver />} />
                <Route path="/analytics/insight" element={<Insight />} />
                <Route path="/analytics/map" element={<MapPage />} />
                <Route path="/analytics/notepad" element={<Notepad />} />
                <Route path="/analytics/fusion" element={<Fusion />} />
                <Route path="/apps/workshop" element={<Workshop />} />
                <Route path="/apps/automate" element={<Automate />} />
                <Route path="/apps/carbon" element={<Carbon />} />
                <Route path="/apps/marketplace" element={<Marketplace />} />
                <Route path="/aip/logic" element={<AipLogic />} />
                <Route path="/aip/agents" element={<AgentStudio />} />
                <Route path="/aip/threads" element={<Threads />} />
                <Route path="/aip/evals" element={<Evals />} />
                <Route path="/aip/models" element={<Models />} />
                <Route path="/aip/developers" element={<Developers />} />
                <Route path="/gov/approvals" element={<Approvals />} />
                <Route path="/gov/audit" element={<Audit />} />
                <Route path="/gov/security" element={<Security />} />
                <Route path="/admin/users" element={<UsersAdmin />} />
                <Route path="/admin/roadmap" element={<Roadmap />} />
                <Route path="/admin/control" element={<ControlPanel />} />
                <Route path="/admin/scan-templates" element={<ScanTemplates />} />
                <Route path="/admin/apollo" element={<Apollo />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          )}
        </main>
      </div>
      <CommandPalette />
      <AssistPanel />
      <NotificationPanel />
    </div>
  )
}

/** 会话门卫：未登录 → /login */
function Gate() {
  const { currentUser, sessionLoading } = useUI()
  if (sessionLoading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-slate-100">
        <div className="flex h-12 w-12 animate-pulse items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-violet-600 text-white">
          <Boxes size={24} />
        </div>
        <div className="text-sm text-slate-400">正在恢复会话…</div>
      </div>
    )
  }
  if (!currentUser) return <Navigate to="/login" replace />
  return <Shell />
}

export default function App() {
  return (
    <UIProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/invite" element={<Invite />} />
        {/* 手机扫码协同：公开路由，不经过登录门卫 */}
        <Route path="/m/:id" element={<MobileScan />} />
        <Route path="/*" element={<Gate />} />
      </Routes>
    </UIProvider>
  )
}

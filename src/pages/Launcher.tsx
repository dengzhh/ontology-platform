import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Clock, LayoutGrid, Star, type LucideIcon } from 'lucide-react'
import { NAV_GROUPS, findNav, type NavItem } from '@/config/nav'
import { statusOf } from '@/config/status'
import PageShell from '@/components/ui/PageShell'
import { Badge } from '@/components/ui/Badge'
import { StatusDot } from '@/components/ui/StatusBadge'
import { cn } from '@/lib/utils'

const FAV_KEY = 'ontoos_favorites'
const RECENT_KEY = 'ontoos_recent'
const RECENT_MAX = 6

interface RecentVisit { path: string; at: number }

/** localStorage 读取：损坏数据按空处理，不抛错 */
function readStorage<T>(key: string, fallback: T, validate: (v: unknown) => v is T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const parsed: unknown = JSON.parse(raw)
    return validate(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

function isPathArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

function isRecentArray(v: unknown): v is RecentVisit[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'object' && x !== null && typeof (x as RecentVisit).path === 'string' && typeof (x as RecentVisit).at === 'number')
}

function readFavorites(): string[] {
  return readStorage<string[]>(FAV_KEY, [], isPathArray)
}

function readRecent(): RecentVisit[] {
  return readStorage<RecentVisit[]>(RECENT_KEY, [], isRecentArray)
}

/** 记录一次真实访问（本地浏览记录），去重后按时间倒序保留前若干条 */
function pushRecent(path: string) {
  const next = [{ path, at: Date.now() }, ...readRecent().filter((r) => r.path !== path)].slice(0, RECENT_MAX)
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* 隐私模式下忽略写入失败 */ }
}

/** 相对时间：本地浏览记录的时间戳派生，非服务端统计 */
function relativeTime(at: number): string {
  const diff = Date.now() - at
  if (diff < 60_000) return '刚刚访问'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前访问`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前访问`
  return `${Math.floor(diff / 86_400_000)} 天前访问`
}

/** 应用中心：全产品矩阵入口 */
export default function Launcher() {
  const [favorites, setFavorites] = useState<string[]>(readFavorites)
  const [recent, setRecent] = useState<RecentVisit[]>(readRecent)

  const favSet = new Set(favorites)

  function toggleFav(path: string) {
    const next = favSet.has(path) ? favorites.filter((p) => p !== path) : [...favorites, path]
    setFavorites(next)
    try { localStorage.setItem(FAV_KEY, JSON.stringify(next)) } catch { /* 隐私模式下忽略写入失败 */ }
  }

  function onVisit(path: string) {
    pushRecent(path)
    setRecent(readRecent())
  }

  // 最近访问：仅显示本地记录过的、且仍在导航中存在的页面（本地浏览记录，非服务端统计）
  const recentItems: { nav: NavItem; at: number }[] = recent
    .map((r) => ({ nav: findNav(r.path), at: r.at }))
    .filter((r): r is { nav: NavItem; at: number } => !!r.nav)

  return (
    <PageShell
      icon={LayoutGrid}
      title="应用中心"
      subtitle="一站式访问平台全部应用 · 数据 → 本体 → 分析 → 应用 → AI → 治理"
      benchmark="应用门户"
      features={[
        '统一应用启动器：按业务域分组呈现平台全部应用',
        '最近使用与收藏：按个人工作习惯快速直达',
        '全局搜索（Ctrl+K）：跨应用、对象、数据集、Agent 检索',
        '产品矩阵总览：覆盖数据集成、本体建模、知识、分析、AI 与治理的全链路应用体系',
      ]}
      actions={
        <Link to="/overview" className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-brand-700">
          进入平台仪表盘 <ArrowRight size={14} />
        </Link>
      }
    >
      {/* 收藏 */}
      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Star size={15} className="text-amber-500" /> 我的收藏
          </div>
          <span className="text-[11px] text-slate-400">点击应用卡片右上角星标即可收藏（本地保存）</span>
        </div>
        {favorites.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400">
            暂无收藏，点击下方应用卡片的星标添加常用应用
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {favorites.map((path) => {
              const nav = findNav(path)
              if (!nav) return null
              const Icon: LucideIcon = nav.icon
              return (
                <Link
                  key={path}
                  to={path}
                  onClick={() => onVisit(path)}
                  className="group inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50/60 px-2.5 py-1.5 text-[12px] font-medium text-amber-800 hover:border-amber-300 hover:bg-amber-50"
                >
                  <Icon size={13} /> {nav.name}
                  <ArrowRight size={12} className="text-amber-400 group-hover:text-amber-600" />
                </Link>
              )
            })}
          </div>
        )}
      </div>

      {/* 最近使用 */}
      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Clock size={15} className="text-brand-600" /> 最近使用
          </div>
          <Badge color="slate">本地浏览记录 · 非服务端统计</Badge>
        </div>
        {recentItems.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400">
            暂无浏览记录，点击任意应用后将在此显示最近访问
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {recentItems.map(({ nav, at }) => {
              const Icon: LucideIcon = nav.icon
              return (
                <Link key={nav.path} to={nav.path} onClick={() => onVisit(nav.path)} className="group flex items-center gap-3 rounded-xl border border-slate-200 p-3 transition-colors hover:border-brand-300 hover:bg-brand-50/40">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-500 group-hover:bg-brand-100 group-hover:text-brand-600">
                    <Icon size={17} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-slate-800">{nav.name}</div>
                    <div className="text-[11px] text-slate-400">{relativeTime(at)}</div>
                  </div>
                  <ArrowRight size={14} className="shrink-0 text-slate-300 group-hover:text-brand-500" />
                </Link>
              )
            })}
          </div>
        )}
      </div>

      {/* 应用矩阵 */}
      {NAV_GROUPS.filter((g) => g.group !== '概览').map((g) => (
        <div key={g.group} className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <span className="h-4 w-1 rounded-full bg-gradient-to-b from-brand-500 to-violet-500" />
              {g.group}
            </div>
            <Badge color="slate">{g.items.length} 个应用</Badge>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {g.items.map((it) => {
              const isFav = favSet.has(it.path)
              return (
                <Link
                  key={it.path}
                  to={it.path}
                  onClick={() => onVisit(it.path)}
                  className="group relative flex flex-col gap-2 rounded-xl border border-slate-200 p-4 transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-card"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 text-slate-500 transition-colors group-hover:from-brand-500 group-hover:to-violet-500 group-hover:text-white">
                      <it.icon size={19} />
                    </div>
                    <span className="flex items-center gap-1.5">
                      {statusOf(it.path) && <StatusDot info={statusOf(it.path)!} />}
                      <button
                        type="button"
                        title={isFav ? '取消收藏' : '收藏此应用'}
                        aria-label={isFav ? `取消收藏 ${it.name}` : `收藏 ${it.name}`}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFav(it.path) }}
                        className="flex h-5 w-5 items-center justify-center rounded hover:bg-amber-50"
                      >
                        <Star size={14} className={cn('transition-colors', isFav ? 'fill-amber-400 text-amber-400' : 'text-slate-200 hover:text-amber-400')} />
                      </button>
                    </span>
                  </div>
                  <div>
                    <div className="text-[14px] font-bold text-slate-800 group-hover:text-brand-700">{it.name}</div>
                    <div className="mt-1 line-clamp-2 min-h-[32px] text-xs leading-4 text-slate-400">{it.desc}</div>
                  </div>
                  <div className={cn('mt-auto inline-flex w-fit items-center rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-500')}>
                    {it.benchmark}
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      ))}
    </PageShell>
  )
}

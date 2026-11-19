import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * 顶层错误边界：单个页面渲染崩溃时展示可恢复界面，而不是整站白屏
 * - 展示错误摘要（便于用户反馈）+ 重新加载/返回首页
 * - 上报到服务端日志（生产）或控制台（开发）
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 动态导入避免循环依赖（telemetry 只用 window/fetch）
    void import('@/lib/telemetry').then(({ reportClientError }) => {
      reportClientError({
        kind: 'react-boundary',
        message: error.message,
        stack: `${error.stack ?? ''}\n--- componentStack ---\n${info.componentStack ?? ''}`,
        url: location.href,
      })
    })
  }

  render() {
    if (!this.state.error) return this.props.children
    const msg = this.state.error.message || '未知错误'
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-7 shadow-pop">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-red-50 text-xl">⚠️</div>
          <h1 className="text-lg font-bold text-slate-900">页面出现异常</h1>
          <p className="mt-1.5 text-[13px] leading-6 text-slate-500">
            该页面渲染时发生错误，其他功能不受影响。可尝试重新加载；若反复出现请把下方信息反馈给管理员。
          </p>
          <pre className="mt-3 max-h-32 overflow-auto rounded-lg bg-slate-50 p-3 text-[11px] leading-5 text-slate-500">{msg}</pre>
          <div className="mt-5 flex gap-2">
            <button
              onClick={() => location.reload()}
              className="rounded-lg bg-brand-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-brand-700"
            >
              重新加载
            </button>
            <button
              onClick={() => { location.href = '/' }}
              className="rounded-lg border border-slate-200 px-4 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-50"
            >
              返回首页
            </button>
            <button
              onClick={() => { navigator.clipboard?.writeText(`${msg}\n${location.href}`) }}
              className="rounded-lg border border-slate-200 px-4 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-50"
            >
              复制错误信息
            </button>
          </div>
        </div>
      </div>
    )
  }
}

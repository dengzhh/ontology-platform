import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import './index.css'
import { reportClientError } from './lib/telemetry'

// 全局兜底：未捕获异常与 Promise 拒绝统一上报（开发态打印，生产态送服务端日志）
window.addEventListener('error', (e) => {
  reportClientError({ kind: 'error', message: e.message, stack: e.error?.stack, url: location.href })
})
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason
  reportClientError({
    kind: 'unhandledrejection',
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
    url: location.href,
  })
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)

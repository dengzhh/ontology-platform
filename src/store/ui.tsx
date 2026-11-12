import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { SessionUser } from '../../shared/types'
import { api, getToken, setToken, clearToken } from '@/lib/api'

interface LoginResult {
  ok: boolean
  error?: string
}

interface UIContextValue {
  paletteOpen: boolean
  setPaletteOpen: (v: boolean) => void
  assistOpen: boolean
  setAssistOpen: (v: boolean) => void
  notifOpen: boolean
  setNotifOpen: (v: boolean) => void
  /** 当前登录会话（真实 JWT 驱动） */
  currentUser: SessionUser | null
  sessionLoading: boolean
  login: (account: string, password: string) => Promise<LoginResult>
  logout: () => void
}

export const UIContext = createContext<UIContextValue>({
  paletteOpen: false,
  setPaletteOpen: () => {},
  assistOpen: false,
  setAssistOpen: () => {},
  notifOpen: false,
  setNotifOpen: () => {},
  currentUser: null,
  sessionLoading: true,
  login: async () => ({ ok: false }),
  logout: () => {},
})

export function UIProvider({ children }: { children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [assistOpen, setAssistOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null)
  const [sessionLoading, setSessionLoading] = useState(true)

  const hydrate = useCallback(async () => {
    if (!getToken()) {
      setCurrentUser(null)
      setSessionLoading(false)
      return
    }
    try {
      const { user } = await api<{ user: SessionUser }>('/auth/me')
      setCurrentUser(user)
    } catch {
      clearToken()
      setCurrentUser(null)
    } finally {
      setSessionLoading(false)
    }
  }, [])

  useEffect(() => {
    hydrate()
  }, [hydrate])

  const login = useCallback(async (account: string, password: string): Promise<LoginResult> => {
    try {
      const res = await api<{ token: string; user: SessionUser }>('/auth/login', {
        method: 'POST',
        body: { account, password },
      })
      setToken(res.token)
      setCurrentUser(res.user)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : '登录失败' }
    }
  }, [])

  const logout = useCallback(() => {
    api('/auth/logout', { method: 'POST' }).catch(() => {})
    clearToken()
    setCurrentUser(null)
  }, [])

  return (
    <UIContext.Provider
      value={{ paletteOpen, setPaletteOpen, assistOpen, setAssistOpen, notifOpen, setNotifOpen, currentUser, sessionLoading, login, logout }}
    >
      {children}
    </UIContext.Provider>
  )
}

export function useUI() {
  return useContext(UIContext)
}

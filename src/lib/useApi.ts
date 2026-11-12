import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from './api'

/** 轻量数据获取 hook：useApi<T>('/users') → { data, loading, error, reload } */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(!!path)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!path) return
    setLoading(true)
    setError(null)
    try {
      setData(await api<T>(path))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [path])

  useEffect(() => {
    load()
  }, [load])

  return { data, loading, error, reload: load }
}

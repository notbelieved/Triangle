import { useMemo } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { AuthApiContext } from './authApiContext.js'

export default function AuthApiProvider({ children }) {
  const { getAccessToken } = usePrivy()

  const api = useMemo(
    () =>
      async function request(path, options = {}) {
        const token = await getAccessToken()
        if (!token) throw new Error('Not signed in')
        const headers = {
          ...options.headers,
          Authorization: `Bearer ${token}`,
        }
        if (options.body && typeof options.body === 'string') {
          headers['Content-Type'] = 'application/json'
        }
        const res = await fetch(`/api${path}`, { ...options, headers })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || res.statusText)
        return data
      },
    [getAccessToken],
  )

  return <AuthApiContext.Provider value={api}>{children}</AuthApiContext.Provider>
}

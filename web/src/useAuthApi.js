import { useContext } from 'react'
import { AuthApiContext } from './authApiContext.js'

export function useAuthApi() {
  const v = useContext(AuthApiContext)
  if (!v) throw new Error('useAuthApi must be used inside AuthApiProvider')
  return v
}

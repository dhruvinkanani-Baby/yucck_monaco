import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from 'react'
import type { UserPublic, LoginDTO, RegisterDTO } from '@interncert/types'
import { apiFetch } from '../lib/api.js'

interface AuthContextType {
  user: UserPublic | null
  loading: boolean
  login: (credentials: LoginDTO) => Promise<void>
  register: (data: RegisterDTO) => Promise<void>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserPublic | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshUser = useCallback(async () => {
    try {
      const data = await apiFetch<{ user: UserPublic }>('/auth/me')
      setUser(data.user)
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshUser()
  }, [refreshUser])

  const login = async (credentials: LoginDTO) => {
    const data = await apiFetch<{ user: UserPublic }>('/auth/login', {
      method: 'POST',
      data: credentials,
    })
    setUser(data.user)
  }

  const register = async (data: RegisterDTO) => {
    const res = await apiFetch<{ user: UserPublic }>('/auth/register', {
      method: 'POST',
      data,
    })
    setUser(res.user)
  }

  const logout = async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' })
    } finally {
      setUser(null)
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        register,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

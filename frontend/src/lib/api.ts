function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(^|;\\s*)(${name})=([^;]*)`))
  return match ? decodeURIComponent(match[3]) : null
}

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000'

interface FetchOptions extends RequestInit {
  data?: unknown
}

export async function ensureCsrfToken(): Promise<string | null> {
  let token = getCookie('csrf_token')
  if (!token) {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/csrf`, {
        credentials: 'include',
      })
      if (res.ok) {
        const body = (await res.json()) as { csrf_token: string }
        token = body.csrf_token
      }
    } catch {
      // Ignore network errors during CSRF preflight
    }
  }
  return token
}

export async function apiFetch<T = unknown>(
  endpoint: string,
  options: FetchOptions = {},
): Promise<T> {
  const url = endpoint.startsWith('http')
    ? endpoint
    : `${API_BASE_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`

  const method = (options.method || 'GET').toUpperCase()
  const isStateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)

  const headers = new Headers(options.headers || {})
  headers.set('Accept', 'application/json')

  if (isStateChanging) {
    const csrfToken = await ensureCsrfToken()
    if (csrfToken) {
      headers.set('x-csrf-token', csrfToken)
    }
  }

  let body = options.body
  if (options.data !== undefined) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(options.data)
  }

  const response = await fetch(url, {
    ...options,
    method,
    headers,
    body,
    credentials: 'include',
  })

  if (!response.ok) {
    let errorData: { error?: string; message?: string } = {}
    try {
      errorData = (await response.json()) as {
        error?: string
        message?: string
      }
    } catch {
      errorData = { error: 'request_failed', message: response.statusText }
    }
    const err = new Error(
      errorData.message || errorData.error || 'Request failed',
    )
    Object.assign(err, { status: response.status, data: errorData })
    throw err
  }

  // Handle empty or 204 response
  if (response.status === 204) {
    return {} as T
  }

  return (await response.json()) as T
}

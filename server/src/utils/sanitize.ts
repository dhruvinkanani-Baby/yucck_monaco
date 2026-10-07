/**
 * HTML entity escaping for user-controlled strings in HTML templates (e.g. transactional emails, notifications).
 * Neutralizes HTML/XSS injection attacks (SEC-08).
 */
export function escapeHtml(input: string): string {
  if (typeof input !== 'string') {
    return ''
  }

  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;')
}

export interface UrlValidationOptions {
  allowedProtocols?: string[]
  allowedHostnames?: string[]
}

/**
 * Validates and sanitizes URLs against scheme abuse (e.g., javascript: pseudo-protocol)
 * and hostname spoofing (SEC-07).
 */
export function validateSafeUrl(
  input: string,
  options: UrlValidationOptions = {},
): { valid: boolean; error?: string; url?: URL } {
  if (typeof input !== 'string' || !input.trim()) {
    return { valid: false, error: 'URL must be a non-empty string.' }
  }

  const trimmed = input.trim()

  // Explicit check against javascript: pseudo-protocol (case-insensitive and whitespace-stripped)
  // Rejects bypasses such as "javascript:...linkedin.com" or "  JAVAscript:alert(1)"
  const lowerWithoutWhitespace = trimmed.replace(/\s+/g, '').toLowerCase()
  if (
    lowerWithoutWhitespace.startsWith('javascript:') ||
    lowerWithoutWhitespace.startsWith('data:') ||
    lowerWithoutWhitespace.startsWith('vbscript:')
  ) {
    return {
      valid: false,
      error:
        'Unsafe URL scheme detected. Only HTTP and HTTPS protocols are permitted.',
    }
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { valid: false, error: 'Invalid URL format.' }
  }

  const allowedProtocols = options.allowedProtocols ?? ['https:', 'http:']
  if (!allowedProtocols.includes(parsed.protocol.toLowerCase())) {
    return {
      valid: false,
      error: `Protocol '${parsed.protocol}' is not permitted. Only [${allowedProtocols.join(', ')}] allowed.`,
    }
  }

  if (options.allowedHostnames && options.allowedHostnames.length > 0) {
    const hostname = parsed.hostname.toLowerCase()
    const isAllowed = options.allowedHostnames.some((allowed) => {
      const allowedLower = allowed.toLowerCase()
      return hostname === allowedLower || hostname.endsWith(`.${allowedLower}`)
    })

    if (!isAllowed) {
      return {
        valid: false,
        error: `Hostname '${hostname}' is not in the allowed list: [${options.allowedHostnames.join(', ')}].`,
      }
    }
  }

  return { valid: true, url: parsed }
}

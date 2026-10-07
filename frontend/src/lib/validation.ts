export interface ClientUrlValidationOptions {
  allowedProtocols?: string[]
  allowedHostnames?: string[]
}

/**
 * Client-side URL validator mirroring backend DTO rules (SEC-07).
 * Rejects javascript: / vbscript: pseudo-protocols and unapproved hostnames.
 */
export function validateClientSafeUrl(
  input: string,
  options: ClientUrlValidationOptions = {},
): { valid: boolean; error?: string; url?: URL } {
  if (!input || !input.trim()) {
    return { valid: false, error: 'URL cannot be empty.' }
  }

  const trimmed = input.trim()
  const lowerWithoutWhitespace = trimmed.replace(/\s+/g, '').toLowerCase()

  if (
    lowerWithoutWhitespace.startsWith('javascript:') ||
    lowerWithoutWhitespace.startsWith('data:') ||
    lowerWithoutWhitespace.startsWith('vbscript:')
  ) {
    return {
      valid: false,
      error:
        'Unsafe URL scheme detected. Only HTTP/HTTPS protocols are permitted.',
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
      error: `Protocol '${parsed.protocol}' is prohibited. Only [${allowedProtocols.join(', ')}] allowed.`,
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
        error: `Hostname '${hostname}' is not permitted.`,
      }
    }
  }

  return { valid: true, url: parsed }
}

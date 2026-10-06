/**
 * Escapes characters with special meaning in regular expressions.
 * Used to sanitize user inputs before supplying them to MongoDB $regex queries,
 * preventing regular expression injection and ReDoS vulnerabilities.
 */
export function escapeRegex(input: string): string {
  if (typeof input !== 'string') {
    return ''
  }
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

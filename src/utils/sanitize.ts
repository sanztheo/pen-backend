/**
 * Input sanitization utilities for security-critical fields.
 * Defends against Stored XSS and Prototype Pollution.
 */

const HTML_TAG_REGEX = /<[^>]*>?/g;

const DANGEROUS_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "__defineGetter__",
  "__defineSetter__",
]);

/**
 * Strip all HTML tags from a string.
 * Prevents Stored XSS when values are rendered in admin dashboards or emails.
 */
export function stripHtmlTags(input: string): string {
  return input.replace(HTML_TAG_REGEX, "");
}

/**
 * Recursively remove dangerous keys from an object to prevent Prototype Pollution.
 * Filters out __proto__, constructor, and prototype keys at every nesting level.
 */
export function sanitizeObjectKeys(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(obj)) {
    if (DANGEROUS_KEYS.has(key)) {
      continue;
    }

    const value = obj[key];

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      result[key] = sanitizeObjectKeys(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result;
}

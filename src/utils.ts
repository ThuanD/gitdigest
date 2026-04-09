// Improved hash function for cache keys (reduced collision risk)
export function secureHash(str: string): string {
  // Use two different hash functions for better distribution
  let hash1 = 5381,
    hash2 = 52773;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash1 = (hash1 << 5) + hash1 + char;
    hash2 = (hash2 << 5) - hash2 + char * 2;
    hash1 = hash1 & hash1; // Convert to 32-bit integer
    hash2 = hash2 & hash2;
  }
  return `${Math.abs(hash1).toString(16).padStart(8, "0")}${Math.abs(hash2).toString(16).padStart(8, "0")}`;
}

// Legacy simple hash for backwards compatibility
export function simpleHash(str: string): string {
  return secureHash(str).slice(0, 8);
}

// Escape user input for AI prompts
export function escapePrompt(input: unknown): string {
  if (typeof input !== "string") {
    throw new Error("Input must be string");
  }
  return input
    .slice(0, 1000) // Limit length first
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

// Standardized cache key generator
export function generateCacheKey(
  prefix: string,
  parts: Record<string, string>,
  maxLength: number = 128, // Increased default
): string {
  const sortedParts = Object.entries(parts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${secureHash(value)}`);

  const key = `${prefix}_${sortedParts.join("_")}`;

  // Don't truncate if under limit, otherwise hash the full key
  return key.length <= maxLength ? key : secureHash(key);
}

// Utility: check IPv4
function isIPv4(ip: string): boolean {
  return /^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)$/.test(
    ip,
  );
}

// Utility: check IPv6 (basic)
function isIPv6(ip: string): boolean {
  return /^[0-9a-fA-F:]+$/.test(ip) && ip.includes(":");
}

// Get trusted client IP (Cloudflare only)
export function getClientIP(request: Request): string {
  const cfIP = request.headers.get("CF-Connecting-IP")?.trim();

  if (cfIP && (isIPv4(cfIP) || isIPv6(cfIP))) {
    return cfIP;
  }

  // Optional: Cloudflare metadata
  const cf = (request as Request & { cf?: { colo?: string } }).cf;

  if (cf?.colo) {
    return `cf-colo-${cf.colo}`;
  }

  return "unknown";
}

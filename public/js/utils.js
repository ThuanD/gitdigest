import { MD_SANITIZE } from "./constants.js";

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function markdownToSafeHtml(md) {
  const raw = marked.parse(String(md ?? ""));
  return typeof DOMPurify !== "undefined" && DOMPurify.sanitize
    ? DOMPurify.sanitize(raw, MD_SANITIZE)
    : raw;
}

export function applyBlankTargets(root) {
  if (!root) return;
  root.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href");
    if (!href || href.startsWith("#")) return;
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
  });
}

// ─── WordCloud Cache Utils ─────────────────────────────────────────────────────
export function getWordcloudCacheKey(period, lang) {
  // Validate inputs to prevent cache key injection
  if (!period || !lang || typeof period !== 'string' || typeof lang !== 'string') {
    throw new Error('Invalid cache key parameters: period and lang must be non-empty strings');
  }
  
  // Sanitize inputs: only allow alphanumeric, underscore, and hyphen
  const sanitizeInput = (input) => {
    return input.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 20);
  };
  
  const safePeriod = sanitizeInput(period);
  const safeLang = sanitizeInput(lang);
  
  if (!safePeriod || !safeLang) {
    throw new Error('Cache key parameters contain invalid characters');
  }
  
  return `wc_${safePeriod}_${safeLang}`;
}

export function getWordcloudCache(period, lang) {
  const cache = safeJsonParse(localStorage.getItem("wordcloud_cache") || "{}", {});
  
  // Validate cache structure
  if (!isValidCacheStructure(cache)) {
    console.warn('Invalid cache structure detected, clearing cache');
    localStorage.removeItem("wordcloud_cache");
    return null;
  }
  
  const key = getWordcloudCacheKey(period, lang);
  const entry = cache[key];
  
  if (!entry) return null;
  
  // Validate entry structure
  if (!isValidCacheEntry(entry)) {
    console.warn('Invalid cache entry detected, removing entry');
    delete cache[key];
    localStorage.setItem("wordcloud_cache", JSON.stringify(cache));
    return null;
  }
  
  // Check TTL (25 minutes - slightly less than server TTL)
  const now = Date.now();
  const ttl = 25 * 60 * 1000; // 25 minutes
  if (now - entry.timestamp > ttl) {
    delete cache[key];
    localStorage.setItem("wordcloud_cache", JSON.stringify(cache));
    return null;
  }
  
  return entry.data;
}

export function setWordcloudCache(period, lang, data) {
  try {
    // Validate inputs
    if (!period || !lang || !data) {
      console.warn('Invalid parameters for cache storage');
      return false;
    }
    
    // Sanitize data before storage to prevent XSS
    const sanitizedData = sanitizeCacheData(data);
    
    const cache = safeJsonParse(localStorage.getItem("wordcloud_cache") || "{}", {});
    const key = getWordcloudCacheKey(period, lang);
    
    // Check cache size limits (max 50 entries, max 2MB total)
    if (!enforceCacheSizeLimits(cache)) {
      console.warn('Cache size limits exceeded, clearing cache');
      localStorage.removeItem("wordcloud_cache");
      return false;
    }
    
    cache[key] = {
      data: sanitizedData,
      timestamp: Date.now()
    };
    
    // Atomic operation: try to save, rollback on failure
    try {
      localStorage.setItem("wordcloud_cache", JSON.stringify(cache));
      return true;
    } catch (error) {
      console.error('Failed to save cache:', error);
      // Rollback: remove the entry we just added
      delete cache[key];
      return false;
    }
  } catch (error) {
    console.error('Cache storage error:', error);
    return false;
  }
}

export function clearWordcloudCache() {
  localStorage.removeItem("wordcloud_cache");
}

// Smart cache invalidation strategies
export function invalidateWordcloudCacheByPattern(pattern) {
  try {
    const cache = safeJsonParse(localStorage.getItem("wordcloud_cache") || "{}", {});
    let removed = 0;
    
    // Remove entries matching pattern
    for (const key of Object.keys(cache)) {
      if (key.includes(pattern)) {
        delete cache[key];
        removed++;
      }
    }
    
    if (removed > 0) {
      localStorage.setItem("wordcloud_cache", JSON.stringify(cache));
      console.log(`Invalidated ${removed} cache entries matching pattern: ${pattern}`);
    }
    
    return removed;
  } catch (error) {
    console.error('Cache invalidation error:', error);
    return 0;
  }
}

export function invalidateWordcloudCacheByPeriod(period) {
  return invalidateWordcloudCacheByPattern(`wc_${period}_`);
}

export function invalidateWordcloudCacheByLanguage(lang) {
  return invalidateWordcloudCacheByPattern(`_${lang}`);
}

export function invalidateExpiredWordcloudCache() {
  try {
    const cache = safeJsonParse(localStorage.getItem("wordcloud_cache") || "{}", {});
    const now = Date.now();
    const ttl = 25 * 60 * 1000; // 25 minutes
    let removed = 0;
    
    // Remove expired entries
    for (const [key, entry] of Object.entries(cache)) {
      if (now - entry.timestamp > ttl) {
        delete cache[key];
        removed++;
      }
    }
    
    if (removed > 0) {
      localStorage.setItem("wordcloud_cache", JSON.stringify(cache));
      console.log(`Invalidated ${removed} expired cache entries`);
    }
    
    return removed;
  } catch (error) {
    console.error('Cache expiration cleanup error:', error);
    return 0;
  }
}

// Periodic cache maintenance
export function performCacheMaintenance() {
  try {
    // Clean expired entries
    const expiredRemoved = invalidateExpiredWordcloudCache();
    
    // Check and enforce size limits
    const cache = safeJsonParse(localStorage.getItem("wordcloud_cache") || "{}", {});
    const sizeBefore = Object.keys(cache).length;
    enforceCacheSizeLimits(cache);
    const sizeAfter = Object.keys(cache).length;
    const sizeRemoved = sizeBefore - sizeAfter;
    
    // Save updated cache if size changed
    if (sizeRemoved > 0) {
      localStorage.setItem("wordcloud_cache", JSON.stringify(cache));
    }
    
    console.log(`Cache maintenance: removed ${expiredRemoved} expired, ${sizeRemoved} oversized entries`);
    
    return expiredRemoved + sizeRemoved;
  } catch (error) {
    console.error('Cache maintenance error:', error);
    return 0;
  }
}

// Cache data sanitization to prevent XSS
function sanitizeCacheData(data) {
  if (!data) return null;
  
  // Create a deep copy to avoid mutating original data
  const sanitized = JSON.parse(JSON.stringify(data));
  
  // Sanitize string properties to prevent XSS
  function sanitizeObject(obj) {
    if (typeof obj === 'string') {
      return escapeHtml(obj);
    }
    
    if (Array.isArray(obj)) {
      return obj.map(sanitizeObject);
    }
    
    if (obj && typeof obj === 'object') {
      const sanitizedObj = {};
      for (const [key, value] of Object.entries(obj)) {
        // Sanitize keys and values
        const sanitizedKey = escapeHtml(key);
        sanitizedObj[sanitizedKey] = sanitizeObject(value);
      }
      return sanitizedObj;
    }
    
    return obj; // Primitives (numbers, booleans) are returned as-is
  }
  
  return sanitizeObject(sanitized);
}

// Cache size limit enforcement
function enforceCacheSizeLimits(cache) {
  const MAX_ENTRIES = 50;
  const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2MB
  
  // Check entry count
  const entryCount = Object.keys(cache).length;
  if (entryCount >= MAX_ENTRIES) {
    // Remove oldest entries to make room
    const entries = Object.entries(cache)
      .map(([key, value]) => ({ key, timestamp: value.timestamp }))
      .sort((a, b) => a.timestamp - b.timestamp);
    
    // Remove oldest 10 entries
    const toRemove = entries.slice(0, 10);
    toRemove.forEach(({ key }) => delete cache[key]);
  }
  
  // Check total size
  const currentSize = JSON.stringify(cache).length;
  if (currentSize > MAX_SIZE_BYTES) {
    // Remove entries until size is acceptable
    const entries = Object.entries(cache)
      .map(([key, value]) => ({ key, timestamp: value.timestamp, size: JSON.stringify(value).length }))
      .sort((a, b) => a.timestamp - b.timestamp);
    
    let totalSize = currentSize;
    for (const entry of entries) {
      if (totalSize <= MAX_SIZE_BYTES * 0.8) break; // Leave 20% buffer
      delete cache[entry.key];
      totalSize -= entry.size;
    }
  }
  
  return true;
}

// Cache validation helper functions
function isValidCacheStructure(cache) {
  if (!cache || typeof cache !== 'object' || Array.isArray(cache)) {
    return false;
  }
  
  // Check that all keys are strings and values are objects
  for (const [key, value] of Object.entries(cache)) {
    if (typeof key !== 'string' || !isValidCacheEntry(value)) {
      return false;
    }
  }
  
  return true;
}

function isValidCacheEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return false;
  }
  
  // Check required properties
  if (!entry.hasOwnProperty('data') || !entry.hasOwnProperty('timestamp')) {
    return false;
  }
  
  // Validate timestamp is a number and within reasonable range
  const timestamp = entry.timestamp;
  if (typeof timestamp !== 'number' || timestamp <= 0 || timestamp > Date.now() + 86400000) {
    return false; // Not more than 24 hours in future
  }
  
  return true;
}

/** Resolve relative image/media paths in raw README markdown to absolute raw URLs. */
export function resolveReadmeImages(
  markdown,
  fullName,
  defaultBranch = "main",
) {
  const base = `https://raw.githubusercontent.com/${fullName}/${defaultBranch}`;
  return markdown
    .replace(
      /!\[([^\]]*)\]\((?!https?:\/\/)([^)]+)\)/g,
      (_, alt, src) => `![${alt}](${base}/${src.replace(/^\.\//, "")})`,
    )
    .replace(
      /<img([^>]*)\ssrc="(?!https?:\/\/)([^"]+)"([^>]*)>/gi,
      (_, b, src, a) =>
        `<img${b} src="${base}/${src.replace(/^\.\//, "")}"${a}>`,
    )
    .replace(
      /<img([^>]*)\ssrc='(?!https?:\/\/)([^']+)'([^>]*)>/gi,
      (_, b, src, a) =>
        `<img${b} src="${base}/${src.replace(/^\.\//, "")}"${a}>`,
    );
}

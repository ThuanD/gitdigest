// Unit tests for cache functions
// Run with: node test/cache.test.js

// Mock DOM and localStorage for testing
global.localStorage = {
  data: {},
  getItem: function(key) { return this.data[key] || null; },
  setItem: function(key, value) { this.data[key] = value; },
  removeItem: function(key) { delete this.data[key]; },
  clear: function() { this.data = {}; }
};

// Mock escapeHtml function
global.escapeHtml = function(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};

// Mock safeJsonParse function
global.safeJsonParse = function(str, fallback) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
};

// Import cache functions (simulate ES modules)
const cacheUtils = {
  getWordcloudCacheKey: function(period, lang) {
    if (!period || !lang || typeof period !== 'string' || typeof lang !== 'string') {
      throw new Error('Invalid cache key parameters: period and lang must be non-empty strings');
    }
    
    const sanitizeInput = (input) => {
      return input.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 20);
    };
    
    const safePeriod = sanitizeInput(period);
    const safeLang = sanitizeInput(lang);
    
    if (!safePeriod || !safeLang) {
      throw new Error('Cache key parameters contain invalid characters');
    }
    
    return `wc_${safePeriod}_${safeLang}`;
  },
  
  getWordcloudCache: function(period, lang) {
    const cache = safeJsonParse(localStorage.getItem("wordcloud_cache") || "{}", {});
    
    if (!cache || typeof cache !== 'object' || Array.isArray(cache)) {
      console.warn('Invalid cache structure detected, clearing cache');
      localStorage.removeItem("wordcloud_cache");
      return null;
    }
    
    const key = this.getWordcloudCacheKey(period, lang);
    const entry = cache[key];
    
    if (!entry) return null;
    
    if (!entry || typeof entry !== 'object' || !entry.hasOwnProperty('data') || !entry.hasOwnProperty('timestamp')) {
      console.warn('Invalid cache entry detected, removing entry');
      delete cache[key];
      localStorage.setItem("wordcloud_cache", JSON.stringify(cache));
      return null;
    }
    
    const timestamp = entry.timestamp;
    if (typeof timestamp !== 'number' || timestamp <= 0 || timestamp > Date.now() + 86400000) {
      return false;
    }
    
    const now = Date.now();
    const ttl = 25 * 60 * 1000;
    if (now - timestamp > ttl) {
      delete cache[key];
      localStorage.setItem("wordcloud_cache", JSON.stringify(cache));
      return null;
    }
    
    return entry.data;
  },
  
  setWordcloudCache: function(period, lang, data) {
    try {
      if (!period || !lang || !data) {
        console.warn('Invalid parameters for cache storage');
        return false;
      }
      
      const sanitizedData = this.sanitizeCacheData(data);
      
      const cache = safeJsonParse(localStorage.getItem("wordcloud_cache") || "{}", {});
      const key = this.getWordcloudCacheKey(period, lang);
      
      if (!this.enforceCacheSizeLimits(cache)) {
        console.warn('Cache size limits exceeded, clearing cache');
        localStorage.removeItem("wordcloud_cache");
        return false;
      }
      
      cache[key] = {
        data: sanitizedData,
        timestamp: Date.now()
      };
      
      try {
        localStorage.setItem("wordcloud_cache", JSON.stringify(cache));
        return true;
      } catch (error) {
        console.error('Failed to save cache:', error);
        delete cache[key];
        return false;
      }
    } catch (error) {
      console.error('Cache storage error:', error);
      return false;
    }
  },
  
  sanitizeCacheData: function(data) {
    if (!data) return null;
    
    const sanitized = JSON.parse(JSON.stringify(data));
    
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
          const sanitizedKey = escapeHtml(key);
          sanitizedObj[sanitizedKey] = sanitizeObject(value);
        }
        return sanitizedObj;
      }
      
      return obj;
    }
    
    return sanitizeObject(sanitized);
  },
  
  enforceCacheSizeLimits: function(cache) {
    const MAX_ENTRIES = 50;
    const MAX_SIZE_BYTES = 2 * 1024 * 1024;
    
    const entryCount = Object.keys(cache).length;
    if (entryCount >= MAX_ENTRIES) {
      const entries = Object.entries(cache)
        .map(([key, value]) => ({ key, timestamp: value.timestamp }))
        .sort((a, b) => a.timestamp - b.timestamp);
      
      const toRemove = entries.slice(0, 10);
      toRemove.forEach(({ key }) => delete cache[key]);
    }
    
    const currentSize = JSON.stringify(cache).length;
    if (currentSize > MAX_SIZE_BYTES) {
      const entries = Object.entries(cache)
        .map(([key, value]) => ({ key, timestamp: value.timestamp, size: JSON.stringify(value).length }))
        .sort((a, b) => a.timestamp - b.timestamp);
      
      let totalSize = currentSize;
      for (const entry of entries) {
        if (totalSize <= MAX_SIZE_BYTES * 0.8) break;
        delete cache[entry.key];
        totalSize -= entry.size;
      }
    }
    
    return true;
  },
  
  clearWordcloudCache: function() {
    localStorage.removeItem("wordcloud_cache");
  }
};

// Test framework
class TestRunner {
  constructor() {
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
  }
  
  test(name, fn) {
    this.tests.push({ name, fn });
  }
  
  assertEqual(actual, expected, message = '') {
    if (actual !== expected) {
      throw new Error(`${message} - Expected: ${expected}, Got: ${actual}`);
    }
  }
  
  assertTrue(condition, message = '') {
    if (!condition) {
      throw new Error(`${message} - Expected truthy value`);
    }
  }
  
  assertFalse(condition, message = '') {
    if (condition) {
      throw new Error(`${message} - Expected falsy value`);
    }
  }
  
  assertThrows(fn, message = '') {
    try {
      fn();
      throw new Error(`${message} - Expected function to throw`);
    } catch (error) {
      if (error.message.includes('Expected function to throw')) {
        throw error;
      }
      // Function threw as expected
    }
  }
  
  run() {
    console.log('Running cache tests...\n');
    
    for (const test of this.tests) {
      try {
        // Clear cache before each test
        localStorage.clear();
        
        test.fn.call(this);
        console.log(`\u2713 ${test.name}`);
        this.passed++;
      } catch (error) {
        console.log(`\u2717 ${test.name}`);
        console.log(`  Error: ${error.message}`);
        this.failed++;
      }
    }
    
    console.log(`\nResults: ${this.passed} passed, ${this.failed} failed`);
    return this.failed === 0;
  }
}

// Test cases
const runner = new TestRunner();

// Cache key generation tests
runner.test('getWordcloudCacheKey - valid inputs', function() {
  const key = cacheUtils.getWordcloudCacheKey('daily', 'en');
  this.assertEqual(key, 'wc_daily_en');
});

runner.test('getWordcloudCacheKey - invalid period', function() {
  this.assertThrows(() => {
    cacheUtils.getWordcloudCacheKey('', 'en');
  });
});

runner.test('getWordcloudCacheKey - invalid language', function() {
  this.assertThrows(() => {
    cacheUtils.getWordcloudCacheKey('daily', '');
  });
});

runner.test('getWordcloudCacheKey - sanitizes special characters', function() {
  const key = cacheUtils.getWordcloudCacheKey('daily<script>', 'en</script>');
  this.assertEqual(key, 'wc_dailyscript_en');
});

runner.test('getWordcloudCacheKey - limits length', function() {
  const longPeriod = 'a'.repeat(30);
  const key = cacheUtils.getWordcloudCacheKey(longPeriod, 'en');
  this.assertEqual(key.length, 'wc_aaaaaaaaaaaaaaaaaaaa_en'.length);
});

// Cache storage and retrieval tests
runner.test('setWordcloudCache and getWordcloudCache - basic functionality', function() {
  const testData = { words: [{ text: 'test', size: 10 }] };
  const setResult = cacheUtils.setWordcloudCache('daily', 'en', testData);
  this.assertTrue(setResult);
  
  const cachedData = cacheUtils.getWordcloudCache('daily', 'en');
  this.assertEqual(JSON.stringify(cachedData), JSON.stringify(testData));
});

runner.test('getWordcloudCache - non-existent entry', function() {
  const data = cacheUtils.getWordcloudCache('nonexistent', 'en');
  this.assertEqual(data, null);
});

runner.test('getWordcloudCache - expired entry', function() {
  const testData = { words: [{ text: 'test', size: 10 }] };
  cacheUtils.setWordcloudCache('daily', 'en', testData);
  
  // Manually expire the cache
  const cache = JSON.parse(localStorage.getItem("wordcloud_cache"));
  const key = cacheUtils.getWordcloudCacheKey('daily', 'en');
  cache[key].timestamp = Date.now() - (30 * 60 * 1000); // 30 minutes ago
  localStorage.setItem("wordcloud_cache", JSON.stringify(cache));
  
  const data = cacheUtils.getWordcloudCache('daily', 'en');
  this.assertEqual(data, null);
});

runner.test('setWordcloudCache - invalid parameters', function() {
  const result1 = cacheUtils.setWordcloudCache('', 'en', { test: 'data' });
  const result2 = cacheUtils.setWordcloudCache('daily', '', { test: 'data' });
  const result3 = cacheUtils.setWordcloudCache('daily', 'en', null);
  
  this.assertFalse(result1);
  this.assertFalse(result2);
  this.assertFalse(result3);
});

// Data sanitization tests
runner.test('sanitizeCacheData - XSS prevention', function() {
  const maliciousData = {
    message: '<script>alert("xss")</script>',
    nested: {
      safe: 'hello',
      dangerous: '<img src="x" onerror="alert(1)">'
    },
    array: ['<script>evil()</script>', 'safe']
  };
  
  const result = cacheUtils.setWordcloudCache('daily', 'en', maliciousData);
  this.assertTrue(result);
  
  const cachedData = cacheUtils.getWordcloudCache('daily', 'en');
  this.assertEqual(cachedData.message, '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  this.assertEqual(cachedData.nested.dangerous, '&lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;&gt;');
  this.assertEqual(cachedData.array[0], '&lt;script&gt;evil()&lt;/script&gt;');
});

// Cache size limits tests
runner.test('enforceCacheSizeLimits - entry count limit', function() {
  const cache = {};
  
  // Add 55 entries (more than MAX_ENTRIES of 50)
  for (let i = 0; i < 55; i++) {
    cache[`wc_test_${i}`] = {
      data: { test: i },
      timestamp: Date.now() - i
    };
  }
  
  const result = cacheUtils.enforceCacheSizeLimits(cache);
  this.assertTrue(result);
  this.assertTrue(Object.keys(cache).length <= 50);
});

runner.test('clearWordcloudCache - clears all cache', function() {
  cacheUtils.setWordcloudCache('daily', 'en', { test: 'data' });
  cacheUtils.setWordcloudCache('weekly', 'vi', { test: 'data' });
  
  cacheUtils.clearWordcloudCache();
  
  const data1 = cacheUtils.getWordcloudCache('daily', 'en');
  const data2 = cacheUtils.getWordcloudCache('weekly', 'vi');
  
  this.assertEqual(data1, null);
  this.assertEqual(data2, null);
});

// Error handling tests
runner.test('getWordcloudCache - handles corrupted cache', function() {
  localStorage.setItem("wordcloud_cache", "invalid json");
  
  const data = cacheUtils.getWordcloudCache('daily', 'en');
  this.assertEqual(data, null);
  
  // Should clear the corrupted cache
  this.assertEqual(localStorage.getItem("wordcloud_cache"), null);
});

runner.test('getWordcloudCache - handles invalid cache structure', function() {
  localStorage.setItem("wordcloud_cache", JSON.stringify(["invalid", "structure"]));
  
  const data = cacheUtils.getWordcloudCache('daily', 'en');
  this.assertEqual(data, null);
  
  // Should clear the invalid cache
  this.assertEqual(localStorage.getItem("wordcloud_cache"), null);
});

// Performance tests
runner.test('Performance - large dataset caching', function() {
  const largeData = {
    words: Array.from({ length: 1000 }, (_, i) => ({
      text: `word${i}`,
      size: Math.random() * 100
    }))
  };
  
  const startTime = Date.now();
  const setResult = cacheUtils.setWordcloudCache('daily', 'en', largeData);
  const endTime = Date.now();
  
  this.assertTrue(setResult);
  this.assertTrue((endTime - startTime) < 1000); // Should complete within 1 second
});

// Run tests
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { runner, cacheUtils };
} else {
  runner.run();
}

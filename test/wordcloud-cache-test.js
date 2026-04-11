// Simple test script for WordCloud chat cache functionality
// Run this in browser console to test the implementation

import { 
  clearWordcloudCache, 
  getWordcloudCacheStats, 
  getWordcloudChatHistory,
  persistWordcloudChatMessage,
  generateWordcloudCacheKey,
  wordcloudAnswerCache 
} from '../public/js/chat.js';

// Test functions
function testWordcloudCacheKeyGeneration() {
  console.log('Testing WordCloud cache key generation...');
  
  const key1 = generateWordcloudCacheKey('daily', 'What are the top trends?', 'en');
  const key2 = generateWordcloudCacheKey('weekly', 'What are the top trends?', 'en');
  const key3 = generateWordcloudCacheKey('daily', 'What are the top trends?', 'vi');
  
  console.log('Daily EN key:', key1);
  console.log('Weekly EN key:', key2);
  console.log('Daily VI key:', key3);
  
  // Keys should be different for different periods and languages
  if (key1 !== key2 && key1 !== key3 && key2 !== key3) {
    console.log('Cache key generation: PASS');
  } else {
    console.log('Cache key generation: FAIL');
  }
}

function testWordcloudPersistence() {
  console.log('Testing WordCloud persistence...');
  
  // Clear existing data
  clearWordcloudCache('daily');
  
  // Add test messages
  persistWordcloudChatMessage('daily', {
    type: 'user',
    text: 'Test question',
    questionId: 'test-q1'
  });
  
  persistWordcloudChatMessage('daily', {
    type: 'assistant',
    text: 'Test answer',
    isCached: false
  });
  
  // Retrieve and verify
  const history = getWordcloudChatHistory('daily');
  console.log('Retrieved history:', history);
  
  if (history.length === 2 && 
      history[0].type === 'user' && 
      history[1].type === 'assistant') {
    console.log('WordCloud persistence: PASS');
  } else {
    console.log('WordCloud persistence: FAIL');
  }
}

function testWordcloudMemoryCache() {
  console.log('Testing WordCloud memory cache...');
  
  // Clear cache
  wordcloudAnswerCache.clear();
  
  // Add test entries
  const key1 = generateWordcloudCacheKey('daily', 'Test question 1', 'en');
  const key2 = generateWordcloudCacheKey('daily', 'Test question 2', 'en');
  
  wordcloudAnswerCache.set(key1, 'Answer 1');
  wordcloudAnswerCache.set(key2, 'Answer 2');
  
  console.log('Memory cache size:', wordcloudAnswerCache.size);
  console.log('Memory cache entries:', Array.from(wordcloudAnswerCache.entries()));
  
  if (wordcloudAnswerCache.size === 2 && 
      wordcloudAnswerCache.get(key1) === 'Answer 1' &&
      wordcloudAnswerCache.get(key2) === 'Answer 2') {
    console.log('WordCloud memory cache: PASS');
  } else {
    console.log('WordCloud memory cache: FAIL');
  }
}

function testWordcloudStats() {
  console.log('Testing WordCloud cache stats...');
  
  const stats = getWordcloudCacheStats();
  console.log('Cache statistics:', stats);
  
  if (stats && 
      stats.periods && 
      typeof stats.totalMemoryEntries === 'number' &&
      stats.memoryUtilization) {
    console.log('WordCloud cache stats: PASS');
  } else {
    console.log('WordCloud cache stats: FAIL');
  }
}

function testPeriodIsolation() {
  console.log('Testing period isolation...');
  
  // Clear all periods
  clearWordcloudCache('daily');
  clearWordcloudCache('weekly');
  clearWordcloudCache('monthly');
  
  // Add different data to each period
  persistWordcloudChatMessage('daily', {
    type: 'user',
    text: 'Daily question'
  });
  
  persistWordcloudChatMessage('weekly', {
    type: 'user',
    text: 'Weekly question'
  });
  
  const dailyHistory = getWordcloudChatHistory('daily');
  const weeklyHistory = getWordcloudChatHistory('weekly');
  const monthlyHistory = getWordcloudChatHistory('monthly');
  
  if (dailyHistory.length === 1 && 
      weeklyHistory.length === 1 && 
      monthlyHistory.length === 0 &&
      dailyHistory[0].text === 'Daily question' &&
      weeklyHistory[0].text === 'Weekly question') {
    console.log('Period isolation: PASS');
  } else {
    console.log('Period isolation: FAIL');
  }
}

// Run all tests
function runWordcloudCacheTests() {
  console.log('Starting WordCloud cache tests...\n');
  
  try {
    testWordcloudCacheKeyGeneration();
    console.log('');
    
    testWordcloudPersistence();
    console.log('');
    
    testWordcloudMemoryCache();
    console.log('');
    
    testWordcloudStats();
    console.log('');
    
    testPeriodIsolation();
    console.log('');
    
    console.log('All WordCloud cache tests completed!');
  } catch (error) {
    console.error('Test error:', error);
  }
}

// Export for use in browser console
if (typeof window !== 'undefined') {
  window.runWordcloudCacheTests = runWordcloudCacheTests;
  window.testWordcloudCacheKeyGeneration = testWordcloudCacheKeyGeneration;
  window.testWordcloudPersistence = testWordcloudPersistence;
  window.testWordcloudMemoryCache = testWordcloudMemoryCache;
  window.testWordcloudStats = testWordcloudStats;
  window.testPeriodIsolation = testPeriodIsolation;
}

console.log('WordCloud cache test script loaded. Run runWordcloudCacheTests() to execute all tests.');

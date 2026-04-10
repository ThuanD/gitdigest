// Comprehensive error handling and defensive programming utilities

// Error types for better categorization
export class CacheError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'CacheError';
    this.code = code;
    this.details = details;
  }
}

export class SecurityError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'SecurityError';
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends Error {
  constructor(message, field, value) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
    this.value = value;
  }
}

// Error handler with logging and user feedback
export class ErrorHandler {
  static log(error, context = {}) {
    const errorInfo = {
      timestamp: new Date().toISOString(),
      type: error.name || 'Error',
      message: error.message,
      stack: error.stack,
      context: context,
      userAgent: navigator.userAgent,
      url: window.location.href
    };

    // Log to console with appropriate level
    if (error instanceof SecurityError) {
      console.error('Security Error:', errorInfo);
    } else if (error instanceof CacheError) {
      console.warn('Cache Error:', errorInfo);
    } else if (error instanceof ValidationError) {
      console.warn('Validation Error:', errorInfo);
    } else {
      console.error('General Error:', errorInfo);
    }

    // Store error in localStorage for debugging (max 50 errors)
    try {
      const errors = JSON.parse(localStorage.getItem('error_log') || '[]');
      errors.push(errorInfo);
      
      // Keep only last 50 errors
      if (errors.length > 50) {
        errors.splice(0, errors.length - 50);
      }
      
      localStorage.setItem('error_log', JSON.stringify(errors));
    } catch (e) {
      console.error('Failed to log error:', e);
    }
  }

  static handle(error, context = {}) {
    this.log(error, context);
    
    // Return user-friendly message
    if (error instanceof SecurityError) {
      return 'Security error occurred. Please refresh the page.';
    } else if (error instanceof CacheError) {
      return 'Cache error occurred. Data will be refreshed.';
    } else if (error instanceof ValidationError) {
      return 'Invalid input provided. Please check your input.';
    } else {
      return 'An unexpected error occurred. Please try again.';
    }
  }

  static getErrorHistory() {
    try {
      return JSON.parse(localStorage.getItem('error_log') || '[]');
    } catch (e) {
      console.error('Failed to retrieve error history:', e);
      return [];
    }
  }

  static clearErrorHistory() {
    try {
      localStorage.removeItem('error_log');
      return true;
    } catch (e) {
      console.error('Failed to clear error history:', e);
      return false;
    }
  }
}

// Defensive programming utilities
export class DefensiveChecker {
  static isString(value, fieldName = 'value') {
    if (typeof value !== 'string') {
      throw new ValidationError(`${fieldName} must be a string`, fieldName, value);
    }
    return true;
  }

  static isNonEmptyString(value, fieldName = 'value') {
    this.isString(value, fieldName);
    if (value.trim().length === 0) {
      throw new ValidationError(`${fieldName} cannot be empty`, fieldName, value);
    }
    return true;
  }

  static isObject(value, fieldName = 'value') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ValidationError(`${fieldName} must be a non-null object`, fieldName, value);
    }
    return true;
  }

  static isNumber(value, fieldName = 'value') {
    if (typeof value !== 'number' || isNaN(value)) {
      throw new ValidationError(`${fieldName} must be a valid number`, fieldName, value);
    }
    return true;
  }

  static isInRange(value, min, max, fieldName = 'value') {
    this.isNumber(value, fieldName);
    if (value < min || value > max) {
      throw new ValidationError(`${fieldName} must be between ${min} and ${max}`, fieldName, value);
    }
    return true;
  }

  static hasProperty(obj, prop, fieldName = 'object') {
    this.isObject(obj, fieldName);
    if (!obj.hasOwnProperty(prop)) {
      throw new ValidationError(`${fieldName} must have property ${prop}`, fieldName, obj);
    }
    return true;
  }

  static isValidPeriod(period) {
    this.isNonEmptyString(period, 'period');
    const validPeriods = ['daily', 'weekly', 'monthly'];
    if (!validPeriods.includes(period)) {
      throw new ValidationError(`Period must be one of: ${validPeriods.join(', ')}`, 'period', period);
    }
    return true;
  }

  static isValidLanguage(lang) {
    this.isNonEmptyString(lang, 'lang');
    const validLangs = ['en', 'vi'];
    if (!validLangs.includes(lang)) {
      throw new ValidationError(`Language must be one of: ${validLangs.join(', ')}`, 'lang', lang);
    }
    return true;
  }

  static isValidApiKey(key) {
    this.isNonEmptyString(key, 'apiKey');
    this.isInRange(key.length, 10, 1000, 'apiKey');
    
    // Basic pattern validation for common API key formats
    const patterns = [
      /^[a-zA-Z0-9_-]{10,}$/, // Generic alphanumeric
      /^[a-zA-Z0-9_-]{20,}$/, // Longer keys
      /^sk-[a-zA-Z0-9_-]{20,}$/, // OpenAI format
      /^[a-zA-Z0-9_-]{32,}$/ // Very long keys
    ];
    
    if (!patterns.some(pattern => pattern.test(key))) {
      throw new ValidationError('API key format appears invalid', 'apiKey', key.substring(0, 10) + '...');
    }
    
    return true;
  }
}

// Safe function wrapper with error handling
export function safeExecute(fn, context = {}) {
  return function(...args) {
    try {
      const result = fn.apply(this, args);
      
      // Handle promises
      if (result && typeof result.catch === 'function') {
        return result.catch(error => {
          const errorMessage = ErrorHandler.handle(error, context);
          console.error('Async operation failed:', errorMessage);
          throw error;
        });
      }
      
      return result;
    } catch (error) {
      const errorMessage = ErrorHandler.handle(error, context);
      console.error('Operation failed:', errorMessage);
      throw error;
    }
  };
}

// Safe localStorage operations
export class SafeStorage {
  static getItem(key, defaultValue = null) {
    try {
      const value = localStorage.getItem(key);
      return value !== null ? value : defaultValue;
    } catch (error) {
      ErrorHandler.handle(new CacheError('Failed to read from localStorage', 'STORAGE_READ_ERROR'), { key });
      return defaultValue;
    }
  }

  static setItem(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (error) {
      ErrorHandler.handle(new CacheError('Failed to write to localStorage', 'STORAGE_WRITE_ERROR'), { key });
      return false;
    }
  }

  static removeItem(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch (error) {
      ErrorHandler.handle(new CacheError('Failed to remove from localStorage', 'STORAGE_DELETE_ERROR'), { key });
      return false;
    }
  }

  static clear() {
    try {
      localStorage.clear();
      return true;
    } catch (error) {
      ErrorHandler.handle(new CacheError('Failed to clear localStorage', 'STORAGE_CLEAR_ERROR'));
      return false;
    }
  }

  static getUsedSpace() {
    try {
      let total = 0;
      for (let key in localStorage) {
        if (localStorage.hasOwnProperty(key)) {
          total += localStorage[key].length + key.length;
        }
      }
      return total;
    } catch (error) {
      ErrorHandler.handle(new CacheError('Failed to calculate localStorage usage', 'STORAGE_SPACE_ERROR'));
      return 0;
    }
  }
}

// Performance monitoring
export class PerformanceMonitor {
  static startTimer(name) {
    return {
      name,
      startTime: performance.now(),
      end: function() {
        const duration = performance.now() - this.startTime;
        console.log(`${this.name}: ${duration.toFixed(2)}ms`);
        return duration;
      }
    };
  }

  static measureFunction(fn, name = fn.name || 'anonymous') {
    return function(...args) {
      const timer = PerformanceMonitor.startTimer(name);
      try {
        const result = fn.apply(this, args);
        timer.end();
        return result;
      } catch (error) {
        timer.end();
        throw error;
      }
    };
  }
}

// Input sanitization utilities
export class InputSanitizer {
  static sanitizeString(input, maxLength = 1000) {
    if (typeof input !== 'string') {
      return '';
    }
    
    return input
      .trim()
      .substring(0, maxLength)
      .replace(/[<>]/g, '') // Remove potential HTML tags
      .replace(/javascript:/gi, '') // Remove javascript protocol
      .replace(/on\w+=/gi, ''); // Remove event handlers
  }

  static sanitizeHtml(input) {
    if (typeof input !== 'string') {
      return '';
    }
    
    // Basic HTML sanitization (for demo - use DOMPurify in production)
    return input
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
      .replace(/on\w+="[^"]*"/gi, '')
      .replace(/javascript:/gi, '');
  }

  static sanitizeNumber(input, min = -Infinity, max = Infinity) {
    const num = Number(input);
    if (isNaN(num)) return 0;
    return Math.max(min, Math.min(max, num));
  }
}

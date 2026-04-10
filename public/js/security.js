// Security utilities for API key management and secure storage

// Constants for secure storage
const API_KEY_STORAGE_PREFIX = 'secure_';
const ENCRYPTION_KEY = 'gitdigest_secure_storage';

/**
 * Encrypt data using simple XOR cipher (for demo purposes)
 * In production, use Web Crypto API with proper encryption
 */
function simpleEncrypt(data) {
  try {
    const key = ENCRYPTION_KEY;
    let encrypted = '';
    for (let i = 0; i < data.length; i++) {
      encrypted += String.fromCharCode(
        data.charCodeAt(i) ^ key.charCodeAt(i % key.length)
      );
    }
    return btoa(encrypted); // Base64 encode
  } catch (error) {
    console.error('Encryption failed:', error);
    return null;
  }
}

/**
 * Decrypt data using simple XOR cipher
 */
function simpleDecrypt(encryptedData) {
  try {
    const key = ENCRYPTION_KEY;
    const decoded = atob(encryptedData); // Base64 decode
    let decrypted = '';
    for (let i = 0; i < decoded.length; i++) {
      decrypted += String.fromCharCode(
        decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length)
      );
    }
    return decrypted;
  } catch (error) {
    console.error('Decryption failed:', error);
    return null;
  }
}

/**
 * Securely store API key with encryption and validation
 */
export function setSecureApiKey(provider, apiKey) {
  try {
    if (!provider || !apiKey || typeof apiKey !== 'string') {
      console.warn('Invalid API key parameters');
      return false;
    }

    // Validate API key format (basic validation)
    if (apiKey.length < 10 || apiKey.length > 1000) {
      console.warn('API key length invalid');
      return false;
    }

    // Encrypt the API key
    const encryptedKey = simpleEncrypt(apiKey);
    if (!encryptedKey) {
      console.error('Failed to encrypt API key');
      return false;
    }

    // Store with timestamp and provider
    const storageKey = `${API_KEY_STORAGE_PREFIX}${provider}`;
    const secureData = {
      key: encryptedKey,
      timestamp: Date.now(),
      provider: provider
    };

    localStorage.setItem(storageKey, JSON.stringify(secureData));
    return true;
  } catch (error) {
    console.error('Failed to store API key securely:', error);
    return false;
  }
}

/**
 * Retrieve and decrypt API key
 */
export function getSecureApiKey(provider) {
  try {
    if (!provider) {
      console.warn('Provider not specified');
      return null;
    }

    const storageKey = `${API_KEY_STORAGE_PREFIX}${provider}`;
    const storedData = localStorage.getItem(storageKey);
    
    if (!storedData) {
      return null;
    }

    const secureData = JSON.parse(storedData);
    
    // Validate stored data structure
    if (!secureData.key || !secureData.timestamp || !secureData.provider) {
      console.warn('Invalid stored API key format');
      localStorage.removeItem(storageKey);
      return null;
    }

    // Check if key is too old (30 days)
    const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
    if (Date.now() - secureData.timestamp > maxAge) {
      console.warn('API key expired, removing');
      localStorage.removeItem(storageKey);
      return null;
    }

    // Decrypt the key
    const decryptedKey = simpleDecrypt(secureData.key);
    if (!decryptedKey) {
      console.error('Failed to decrypt API key');
      localStorage.removeItem(storageKey);
      return null;
    }

    return decryptedKey;
  } catch (error) {
    console.error('Failed to retrieve API key securely:', error);
    return null;
  }
}

/**
 * Remove API key securely
 */
export function removeSecureApiKey(provider) {
  try {
    if (!provider) return false;
    
    const storageKey = `${API_KEY_STORAGE_PREFIX}${provider}`;
    localStorage.removeItem(storageKey);
    return true;
  } catch (error) {
    console.error('Failed to remove API key:', error);
    return false;
  }
}

/**
 * Clear all secure API keys
 */
export function clearAllSecureApiKeys() {
  try {
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith(API_KEY_STORAGE_PREFIX)) {
        localStorage.removeItem(key);
      }
    });
    return true;
  } catch (error) {
    console.error('Failed to clear API keys:', error);
    return false;
  }
}

/**
 * Check if secure API key exists for provider
 */
export function hasSecureApiKey(provider) {
  try {
    if (!provider) return false;
    
    const storageKey = `${API_KEY_STORAGE_PREFIX}${provider}`;
    return localStorage.getItem(storageKey) !== null;
  } catch (error) {
    console.error('Failed to check API key existence:', error);
    return false;
  }
}

/**
 * Migrate existing plain API keys to secure storage
 */
export function migrateApiKeysToSecureStorage() {
  try {
    const providers = ['openai', 'anthropic', 'google'];
    let migrated = 0;

    providers.forEach(provider => {
      const oldKey = localStorage.getItem(`api_key_${provider}`);
      if (oldKey && !hasSecureApiKey(provider)) {
        if (setSecureApiKey(provider, oldKey)) {
          localStorage.removeItem(`api_key_${provider}`);
          migrated++;
        }
      }
    });

    // Also migrate the generic api_key
    const genericKey = localStorage.getItem('api_key');
    if (genericKey && !hasSecureApiKey('default')) {
      if (setSecureApiKey('default', genericKey)) {
        localStorage.removeItem('api_key');
        migrated++;
      }
    }

    console.log(`Migrated ${migrated} API keys to secure storage`);
    return migrated;
  } catch (error) {
    console.error('Failed to migrate API keys:', error);
    return 0;
  }
}

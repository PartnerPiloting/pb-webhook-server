/**
 * Environment Variable Validation Utility
 * 
 * Validates required environment variables and provides helpful error messages
 * for missing or incorrectly configured variables.
 */

// Determine environment-specific defaults
const getEnvironmentDefaults = () => {
  // Check if we're in hotfix environment (can be determined multiple ways)
  const isHotfix = process.env.VERCEL_GIT_COMMIT_REF === 'hotfix' || 
                   process.env.VERCEL_URL?.includes('hotfix') ||
                   process.env.NODE_ENV === 'hotfix';
  
  const baseUrl = isHotfix 
    ? 'https://pb-webhook-server-hotfix.onrender.com'
    : 'https://pb-webhook-server.onrender.com';
  
  return {
    apiBaseUrl: `${baseUrl}/api/linkedin`
  };
};

export const validateEnvironment = () => {
  const errors = [];
  const warnings = [];
  const envDefaults = getEnvironmentDefaults();

  // Required environment variables for production
  const requiredVars = {
    // API Configuration
    'NEXT_PUBLIC_API_BASE_URL': {
      description: 'Base URL for the backend API',
      example: envDefaults.apiBaseUrl,
      required: false, // We have a fallback, so not strictly required
      fallback: envDefaults.apiBaseUrl
    }
  };

  // Optional environment variables that enhance functionality
  const optionalVars = {
    // WordPress Authentication (for future use)
    'NEXT_PUBLIC_WP_BASE_URL': {
      description: 'WordPress base URL for authentication',
      example: 'https://yoursite.com/wp-json/wp/v2'
    },
    
    // Development/Debug Settings
    'NODE_ENV': {
      description: 'Environment mode (development/production)',
      example: 'production'
    }
  };

  // Check required variables
  Object.entries(requiredVars).forEach(([varName, config]) => {
    const value = process.env[varName];
    
    if (!value || value.trim() === '') {
      if (config.required) {
        errors.push({
          variable: varName,
          error: 'Missing required environment variable',
          description: config.description,
          example: config.example
        });
      } else if (config.fallback) {
        warnings.push({
          variable: varName,
          warning: `Using fallback value: ${config.fallback}`,
          description: config.description,
          recommendation: `Set ${varName}=${config.example}`
        });
      }
    } else {
      // Validate format if specified
      if (config.validate && !config.validate(value)) {
        errors.push({
          variable: varName,
          error: 'Invalid format',
          description: config.description,
          example: config.example,
          currentValue: value
        });
      }
    }
  });

  // Check optional variables and provide info
  Object.entries(optionalVars).forEach(([varName, config]) => {
    const value = process.env[varName];
    
    if (!value || value.trim() === '') {
      // Just informational for optional vars
      console.info(`ℹ️  Optional: ${varName} not set (${config.description})`);
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    summary: {
      totalChecked: Object.keys(requiredVars).length + Object.keys(optionalVars).length,
      errors: errors.length,
      warnings: warnings.length
    }
  };
};

/**
 * Display validation results in a user-friendly format
 */
export const displayValidationResults = (results) => {
  if (results.isValid) {
    console.log('✅ Environment validation passed');
    
    if (results.warnings.length > 0) {
      console.log('\n⚠️  Configuration Warnings:');
      results.warnings.forEach(warning => {
        console.log(`   ${warning.variable}: ${warning.warning}`);
        console.log(`   💡 ${warning.recommendation}`);
      });
    }
    
    return true;
  } else {
    console.error('❌ Environment validation failed');
    console.error('\n🚨 Required Configuration Missing:');
    
    results.errors.forEach(error => {
      console.error(`   ${error.variable}: ${error.error}`);
      console.error(`   📝 ${error.description}`);
      console.error(`   💡 Example: ${error.example}`);
      if (error.currentValue) {
        console.error(`   ❌ Current: ${error.currentValue}`);
      }
      console.error('');
    });
    
    console.error('Please configure the missing environment variables and restart the application.');
    return false;
  }
};

/**
 * Validate environment and exit if critical errors found
 * Call this at application startup
 */
export const validateOrExit = () => {
  const results = validateEnvironment();
  const isValid = displayValidationResults(results);
  
  if (!isValid) {
    console.error('Exiting due to configuration errors...');
    process.exit(1);
  }
  
  return results;
};

// Export individual validation functions for testing
export const validators = {
  isUrl: (value) => {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  },
  
  isEmail: (value) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(value);
  }
};

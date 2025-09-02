/**
 * Environment Variable Validation Utility
 *
 * Combined version: dynamic environment defaults + quiet localhost fallback.
 * (All ASCII to avoid encoding issues.)
 */

const getEnvironmentDefaults = () => {
  const isHotfix =
    process.env.VERCEL_GIT_COMMIT_REF === 'hotfix' ||
    (process.env.VERCEL_URL || '').includes('hotfix') ||
    process.env.NODE_ENV === 'hotfix';

  const baseUrl = isHotfix
    ? 'https://pb-webhook-server-hotfix.onrender.com'
    : 'https://pb-webhook-server.onrender.com';

  return {
    apiBaseUrl: baseUrl + '/api/linkedin'
  };
};

export const validateEnvironment = () => {
  const errors = [];
  const warnings = [];
  const envDefaults = getEnvironmentDefaults();

  const isLocalhost = () => {
    try {
      if (typeof window !== 'undefined') {
        return /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
      }
    } catch (e) {}
    return false;
  };

  const requiredVars = {
    NEXT_PUBLIC_API_BASE_URL: {
      description: 'Base URL for the backend API',
      example: envDefaults.apiBaseUrl,
      required: false,
      fallback: envDefaults.apiBaseUrl
    }
  };

  const optionalVars = {
    NEXT_PUBLIC_WP_BASE_URL: {
      description: 'WordPress base URL for authentication',
      example: 'https://yoursite.com/wp-json/wp/v2'
    },
    NODE_ENV: {
      description: 'Environment mode (development/production)',
      example: 'production'
    }
  };

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
        if (varName === 'NEXT_PUBLIC_API_BASE_URL' && isLocalhost()) {
          try { console.info('INFO: NEXT_PUBLIC_API_BASE_URL not set; using http://localhost:3001/api/linkedin for local development'); } catch (e) {}
        } else {
          warnings.push({
            variable: varName,
            warning: 'Using fallback value: ' + config.fallback,
            description: config.description,
            recommendation: 'Set ' + varName + '=' + config.example
          });
        }
      }
    } else if (config.validate && !config.validate(value)) {
      errors.push({
        variable: varName,
        error: 'Invalid format',
        description: config.description,
        example: config.example,
        currentValue: value
      });
    }
  });

  Object.entries(optionalVars).forEach(([varName, config]) => {
    const value = process.env[varName];
    if (!value || value.trim() === '') {
      try { console.info('INFO: Optional ' + varName + ' not set (' + config.description + ')'); } catch (e) {}
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

export const displayValidationResults = (results) => {
  if (results.isValid) {
    console.log('Environment validation passed');
    if (results.warnings.length > 0) {
      console.log('\nConfiguration Warnings:');
      results.warnings.forEach(w => {
        console.log('  ' + w.variable + ': ' + w.warning);
        console.log('    Recommendation: ' + w.recommendation);
      });
    }
    return true;
  } else {
    console.error('Environment validation failed');
    console.error('\nRequired Configuration Missing:');
    results.errors.forEach(e => {
      console.error('  ' + e.variable + ': ' + e.error);
      console.error('    Description: ' + e.description);
      console.error('    Example: ' + e.example);
      if (e.currentValue) console.error('    Current: ' + e.currentValue);
      console.error('');
    });
    console.error('Please configure the missing environment variables and restart the application.');
    return false;
  }
};

export const validateOrExit = () => {
  const results = validateEnvironment();
  const ok = displayValidationResults(results);
  if (!ok) {
    console.error('Exiting due to configuration errors...');
    process.exit(1);
  }
  return results;
};

export const validators = {
  isUrl: (value) => {
    try { new URL(value); return true; } catch (e) { return false; }
  },
  isEmail: (value) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/).test(value)
};

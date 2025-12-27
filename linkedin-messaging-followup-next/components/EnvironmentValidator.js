"use client";
import { useEffect, useState } from 'react';
import { validateEnvironment, displayValidationResults } from '../utils/validateEnv';
// Show the actually resolved backend base to avoid confusion with env var fallbacks
import { getBackendBase } from '../services/api';

const EnvironmentValidator = ({ children }) => {
  const [isValidated, setIsValidated] = useState(false);
  const [validationFailed, setValidationFailed] = useState(false);
  const [validationResults, setValidationResults] = useState(null);

  useEffect(() => {
    // Only run validation on client side
    if (typeof window !== 'undefined') {
      const results = validateEnvironment();
      setValidationResults(results);
      
      // Display results (warnings are OK, errors are not)
      const isValid = displayValidationResults(results);
      try {
        const resolved = getBackendBase();
        console.info('[Environment] Resolved backend base:', resolved);
      } catch {}
      
      if (isValid) {
        setIsValidated(true);
      } else {
        setValidationFailed(true);
      }
    }
  }, []);

  // Show loading state while validating
  if (!isValidated && !validationFailed) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Validating configuration...</p>
        </div>
      </div>
    );
  }

  // Show error state if validation failed
  if (validationFailed) {
    return (
      <div className="min-h-screen bg-red-50 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h1 className="text-2xl font-bold text-red-800 mb-4">
              ⚠️ Configuration Error
            </h1>
            
            <div className="bg-red-100 border border-red-300 rounded-md p-4 mb-6">
              <p className="text-red-800 font-medium mb-2">
                The application cannot start due to missing or invalid configuration.
              </p>
              <p className="text-red-700 text-sm">
                Please check the browser console for detailed error messages and configure the required environment variables.
              </p>
            </div>

            {validationResults && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-gray-800">Configuration Summary:</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-gray-100 p-3 rounded">
                    <div className="text-sm text-gray-600">Variables Checked</div>
                    <div className="text-xl font-bold">{validationResults.summary.totalChecked}</div>
                  </div>
                  <div className="bg-red-100 p-3 rounded">
                    <div className="text-sm text-red-600">Errors</div>
                    <div className="text-xl font-bold text-red-700">{validationResults.summary.errors}</div>
                  </div>
                  <div className="bg-yellow-100 p-3 rounded">
                    <div className="text-sm text-yellow-600">Warnings</div>
                    <div className="text-xl font-bold text-yellow-700">{validationResults.summary.warnings}</div>
                  </div>
                </div>

                {validationResults.errors.length > 0 && (
                  <div>
                    <h3 className="font-medium text-gray-800 mb-2">Required Actions:</h3>
                    <ul className="list-disc list-inside space-y-1 text-sm text-gray-700">
                      {validationResults.errors.map((error, index) => (
                        <li key={index}>
                          Set <code className="bg-gray-200 px-1 rounded">{error.variable}</code>: {error.description}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <div className="mt-6 pt-4 border-t border-gray-200">
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
              >
                Retry Validation
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Validation passed, render the app
  return <>{children}</>;
};

export default EnvironmentValidator;

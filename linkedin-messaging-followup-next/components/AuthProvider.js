// components/AuthProvider.js
// Authentication and client initialization wrapper for the app

"use client";
import { createContext, useContext, useState, useEffect } from 'react';
import { initializeClient, getClientProfile, getCurrentClientId } from '../utils/clientUtils.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [clientProfile, setClientProfile] = useState(null);

  useEffect(() => {
    async function initialize() {
      try {
        console.log('AuthProvider: Initializing authentication...');
        
        // Initialize client profile from backend
        const success = await initializeClient();
        
        if (success) {
          const profile = getClientProfile();
          setClientProfile(profile);
          setIsInitialized(true);
          console.log('AuthProvider: Authentication initialized successfully');
        } else {
          setError('Failed to initialize client authentication');
        }
      } catch (err) {
        console.error('AuthProvider: Initialization error:', err);
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    }

    initialize();
  }, []);

  const contextValue = {
    isInitialized,
    isLoading,
    error,
    clientProfile,
    clientId: getCurrentClientId(),
    // Helper functions
    refresh: async () => {
      setIsLoading(true);
      setError(null);
      try {
        await initializeClient();
        setClientProfile(getClientProfile());
        setIsInitialized(true);
      } catch (err) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    }
  };

  // Show loading state during initialization
  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Initializing authentication...</p>
        </div>
      </div>
    );
  }

  // Show error state if initialization failed
  if (error && !isInitialized) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-center max-w-md">
          <div className="text-red-600 mb-4">
            <svg className="w-12 h-12 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Authentication Error</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <button 
            onClick={contextValue.refresh}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default AuthProvider;

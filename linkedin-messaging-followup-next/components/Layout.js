"use client";
import React, { Suspense, useEffect, useState } from 'react';
import { getEnvLabel } from '../utils/clientUtils.js';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { MagnifyingGlassIcon, CalendarDaysIcon, UserPlusIcon, TrophyIcon, CogIcon, BookOpenIcon, QuestionMarkCircleIcon } from '@heroicons/react/24/outline';
import { initializeClient, getClientProfile } from '../utils/clientUtils.js';

// Client initialization hook
const useClientInitialization = () => {
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState(null);
  const searchParams = useSearchParams();
  
  useEffect(() => {
    const initClient = async () => {
      try {
        console.log('Layout: Starting client initialization...');
        
        // Check for test client parameter in URL
        const testClient = searchParams.get('testClient');
        if (testClient) {
          console.log(`Layout: Found test client parameter: ${testClient}`);
        }
        
        await initializeClient();
        setIsInitialized(true);
        console.log('Layout: Client initialization successful');
      } catch (error) {
        console.error('Layout: Client initialization failed:', error);
        setError(error);
        setIsInitialized(true); // Set to true to show error message instead of loading
      }
    };
    
    initClient();
  }, [searchParams]);
  
  return { isInitialized, error };
};

// Component that uses useSearchParams wrapped in Suspense
const NavigationWithParams = ({ pathname, children }) => {
  const searchParams = useSearchParams();
  // Removed horizontal scroll / hidden items – use wrapping layout instead
  // Get service level from URL parameters (level=1 basic, level=2 includes post scoring)
  const serviceLevel = parseInt(searchParams.get('level') || '2');
  // Always show Top Scoring Leads in the navigation
  
  // Build navigation; include Top Scoring Leads (left of Posts)
  const navigation = [
    {
      name: 'Lead Search & Update',
      href: '/',
      icon: MagnifyingGlassIcon,
      description: 'Find and update existing leads',
      minLevel: 1
    },
    {
      name: 'Follow-Up Manager',
      href: '/follow-up',
      icon: CalendarDaysIcon,
      description: 'Manage scheduled follow-ups',
      minLevel: 1
    },
    {
      name: 'New Leads',
      href: '/new-leads',
      icon: UserPlusIcon,
      description: 'Review and process new leads',
      minLevel: 1
    },
    {
      name: 'Top Scoring Leads',
      href: '/top-scoring-leads',
      icon: TrophyIcon,
      description: 'Pick the best candidates for the next LH batch',
      minLevel: 2
    },
    {
      name: 'Top Scoring Posts',
      href: '/top-scoring-posts',
      icon: TrophyIcon,
      description: 'Leads with high-relevance posts ready for action',
      minLevel: 2
    },
    {
      name: 'Settings',
      href: '/settings',
      icon: CogIcon,
      description: 'Configure scoring attributes and system settings',
      minLevel: 1
    },
    {
      name: 'Start Here',
      href: '/start-here',
      icon: BookOpenIcon,
      description: 'Onboarding categories and topics',
      minLevel: 1
    },
    {
      name: 'Help',
      href: '/help',
      icon: QuestionMarkCircleIcon,
      description: 'Help center (coming soon)',
      minLevel: 1
    }
  ];

  // Filter navigation based on service level
  const filteredNavigation = navigation.filter(item => item.minLevel <= serviceLevel);

  return (
    <nav className="mb-8" aria-label="Primary">
      <div className="flex flex-wrap gap-x-8 gap-y-3 items-stretch">
        {filteredNavigation.map(item => {
          if (!item) return null;
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.name}
              href={`${item.href}?${searchParams.toString()}`}
              title={item.description || item.name}
              className={`group inline-flex items-center border-b-2 px-1 py-1.5 text-sm font-medium transition-colors ${
                isActive ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {Icon && <Icon className={`h-5 w-5 mr-2 ${isActive ? 'text-blue-600' : 'text-gray-400 group-hover:text-gray-500'}`} />}
              <span className="leading-tight">
                {item.name}
                <span className="block text-[11px] font-normal text-gray-400 leading-tight max-w-[11rem] truncate" aria-hidden="true">{item.description}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
};

const Layout = ({ children }) => {
  const pathname = usePathname();
  const [clientProfile, setClientProfile] = useState(null);
  
  // Initialize client authentication
  const { isInitialized, error } = useClientInitialization();

  // Update client profile when initialization completes
  useEffect(() => {
    if (isInitialized && !error) {
      const profile = getClientProfile();
      setClientProfile(profile);
    }
  }, [isInitialized, error]);

  // Show loading state while initializing
  if (!isInitialized) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="text-center">
          <p className="text-gray-500">Initializing authentication...</p>
        </div>
      </div>
    );
  }

  // Show error state if initialization failed
  if (error) {
    // Check if testClient parameter is present - if so, this might be a different issue
    const urlParams = new URLSearchParams(window.location.search);
    const testClient = urlParams.get('testClient');
    
    if (testClient) {
      // Developer mode - log error but continue (might be backend issue)
      console.warn('Layout: Authentication failed in developer mode, but continuing:', error);
      // Continue to render the app for developers
    } else {
      // Parse error message and provide specific UI based on error type
      const errorMessage = error.message || 'Access restricted';
      let title = 'Access Restricted';
      let message = errorMessage;
      let details = null;
      let showLoginButton = false;
      
      // Handle specific error scenarios
      if (errorMessage.includes('log into australiansidehustles.com.au')) {
        title = 'Login Required';
        message = 'Please log into australiansidehustles.com.au to proceed.';
        showLoginButton = true;
      } else if (errorMessage.includes('Check with your coach to gain access')) {
        title = 'Access Not Yet Activated';
        message = 'Check with your coach to gain access.';
        details = 'Your Australian Side Hustles account was found, but you don\'t have access to the LinkedIn Portal yet. Please contact Australian Side Hustles Support for assistance.';
      } else if (errorMessage.includes('membership may have expired')) {
        title = 'Membership Issue';
        message = 'Looks like your membership may have expired - check with your coach.';
        details = 'Your LinkedIn Portal access is currently inactive. Please contact Australian Side Hustles Support to reactivate your access.';
      } else if (errorMessage.includes('System temporarily unavailable')) {
        title = 'System Temporarily Unavailable';
        message = 'System temporarily unavailable. Please try again in a moment.';
        details = 'If this persists, contact Australian Side Hustles Support.';
      } else {
        // Generic fallback
        message = 'This portal is available to authorized users only.';
        details = 'Please ensure you are logged into your Australian Side Hustles account, then access this portal through the member dashboard.';
      }
      
      return (
        <div className="min-h-screen bg-gray-50 p-8">
          <div className="text-center">
            <div className="max-w-md mx-auto bg-white p-8 rounded-lg shadow-sm border border-red-200">
              <div className="text-red-600 mb-4">
                <svg className="h-12 w-12 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.314 15.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">{title}</h2>
              <p className="text-gray-600 mb-4">{message}</p>
              
              {details && (
                <div className="text-sm text-gray-500 mb-4">
                  <p>{details}</p>
                </div>
              )}
              
              {showLoginButton && (
                <div className="mt-6">
                  <a 
                    href="https://australiansidehustles.com.au/wp-login.php"
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Login to Australian Side Hustles
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }
  }

  // Ensure children is defined
  if (!children) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="text-center">
          <p className="text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="w-full px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-semibold text-gray-900">
                {(() => {
                  const envLabel = getEnvLabel();
                  const clientName = clientProfile?.clientName || clientProfile?.client?.clientName;
                  let displayName = clientName || '';
                  let isTestMode = false;
                  if (clientName && clientName.includes('(' + envLabel + ' Mode)')) {
                    displayName = clientName.replace(' (' + envLabel + ' Mode)', '');
                    isTestMode = true;
                  }
                  return envLabel && displayName
                    ? `${envLabel} - ${displayName}${isTestMode ? ' (' + envLabel + ' Mode)' : ''}'s LinkedIn Follow-Up Portal`
                    : envLabel
                      ? `${envLabel} - LinkedIn Follow-Up Portal`
                      : displayName
                        ? `${displayName}'s LinkedIn Follow-Up Portal`
                        : 'LinkedIn Follow-Up Portal';
                })()}
              </h1>
            </div>
            <div className="flex items-center space-x-4">
              {/* Future: Add user menu or additional controls */}
            </div>
          </div>
        </div>
      </header>

      <div className="w-full px-4 sm:px-6 lg:px-8 py-8">
        {/* Navigation Tabs */}
        <Suspense fallback={<div>Loading navigation...</div>}>
          <NavigationWithParams pathname={pathname}>
            {children}
          </NavigationWithParams>
        </Suspense>

        {/* Main Content */}
        <main>
          {children}
        </main>
      </div>
    </div>
  );
};

export default Layout;

"use client";
import React, { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { getEnvLabel, initializeClient, getClientProfile } from '../utils/clientUtils.js';
import { MagnifyingGlassIcon, CalendarDaysIcon, UserPlusIcon, TrophyIcon, CogIcon, BookOpenIcon, QuestionMarkCircleIcon } from '@heroicons/react/24/outline';
import ClientCodeEntry from './ClientCodeEntry';

// Lazy-load the help panel to keep initial bundle lean
const ContextHelpPanel = dynamic(() => import('./ContextHelpPanel'), { ssr: false });

// Client initialization hook (encapsulated)
const useClientInitialization = () => {
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState(null);
  const searchParams = useSearchParams();

  useEffect(() => {
    let active = true;
    const init = async () => {
      try {
        await initializeClient();
        if (active) setIsInitialized(true);
      } catch (e) {
        console.error('Layout: Client initialization failed:', e);
        if (active) {
          setError(e);
          setIsInitialized(true);
        }
      }
    };
    init();
    return () => { active = false; };
  }, [searchParams]);

  return { isInitialized, error };
};

// Primary navigation tabs (URL params preserved)
const NavigationWithParams = ({ pathname }) => {
  const searchParams = useSearchParams();
  const serviceLevel = parseInt(searchParams.get('level') || '2', 10);
  const nav = [
    { name: 'Lead Search & Update', href: '/', icon: MagnifyingGlassIcon, description: 'Find and update existing leads', minLevel: 1 },
    { name: 'Follow-Up Manager', href: '/follow-up', icon: CalendarDaysIcon, description: 'Manage scheduled follow-ups', minLevel: 1 },
    { name: 'New Leads', href: '/new-leads', icon: UserPlusIcon, description: 'Review and process new leads', minLevel: 1 },
    { name: 'Top Scoring Leads', href: '/top-scoring-leads', icon: TrophyIcon, description: 'Pick the best candidates for the next LH batch', minLevel: 2 },
    { name: 'Top Scoring Posts', href: '/top-scoring-posts', icon: TrophyIcon, description: 'Leads with high-relevance posts ready for action', minLevel: 2 },
    { name: 'Settings', href: '/settings', icon: CogIcon, description: 'Configure scoring attributes and system settings', minLevel: 1 },
    { name: 'Start Here', href: '/start-here', icon: BookOpenIcon, description: 'Onboarding categories and topics', minLevel: 1 }
  ];
  const items = nav.filter(n => n.minLevel <= serviceLevel);
  return (
    <nav className="mb-8" aria-label="Primary">
      <div className="flex flex-wrap gap-x-8 gap-y-3 items-stretch">
        {items.map(item => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          const href = `${item.href}?${searchParams.toString()}`;
          const handleClick = (e) => {
            try {
              // If we're already in /settings, clicking Settings should behave like "Back to Settings"
              if (item.href === '/settings' && pathname.startsWith('/settings')) {
                e.preventDefault();
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('settings-nav', { detail: { action: 'backToMenu' } }));
                }
              }
            } catch (_) {}
          };
          return (
            <Link key={item.name} href={href} title={item.description || item.name} onClick={handleClick}
              className={`group inline-flex items-center border-b-2 px-1 py-1.5 text-sm font-medium transition-colors ${isActive ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>
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
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpAreaOverride, setHelpAreaOverride] = useState(null);
  const { isInitialized, error } = useClientInitialization();
  
  // Allow child pages to open the Help panel via a simple custom event
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const openHandler = (e) => {
      try {
        const area = e?.detail?.area;
        setHelpAreaOverride(area || null);
      } catch (_) {
        setHelpAreaOverride(null);
      }
      setHelpOpen(true);
    };
    window.addEventListener('open-help', openHandler);
    return () => { window.removeEventListener('open-help', openHandler); };
  }, []);

  // Compute contextual help area from current pathname
  const helpArea = useMemo(() => {
    if (!pathname) return 'global';
    if (pathname === '/' || pathname.startsWith('/lead') || pathname.startsWith('/new-lead')) return 'lead_search_and_update';
    if (pathname.startsWith('/follow-up')) return 'lead_follow_up';
    if (pathname.startsWith('/new-leads')) return 'new_lead';
    if (pathname.startsWith('/top-scoring-leads')) return 'top_scoring_leads';
    if (pathname.startsWith('/top-scoring-posts')) return 'top_scoring_posts';
    if (pathname.startsWith('/settings')) return 'profile_attributes';
    if (pathname.startsWith('/start-here')) return 'global';
    return 'global';
  }, [pathname]);

  // Load client profile after init success
  useEffect(() => {
    if (isInitialized && !error) {
      setClientProfile(getClientProfile());
    }
  }, [isInitialized, error]);

  // Init state
  if (!isInitialized) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="text-center">
          <p className="text-gray-500">Initializing authentication...</p>
        </div>
      </div>
    );
  }

  // Error state (allow Start Here publicly, require client code for other pages)
  if (error) {
    let testClient = '';
    try { 
      const u = new URL(window.location.href); 
      testClient = u.searchParams.get('testClient') || localStorage.getItem('clientCode') || ''; 
    } catch {}
    
    // Allow Start Here to be viewed publicly without auth
    const isStartHere = pathname && pathname.startsWith('/start-here');
    
    if (!testClient) {
      // No client code provided
      if (isStartHere) {
        // Allow Start Here to render publicly
        console.info('Layout: Rendering Start Here in public mode (no auth required)');
      } else {
        // Show client code entry form for all other pages
        let errorMessage = null;
        const msg = String(error?.message || '');
        if (msg.includes('access has been suspended') || msg.includes('not Active')) {
          errorMessage = 'Your membership has expired. Please check with your coach.';
        }
        return <ClientCodeEntry error={errorMessage} />;
      }
    } else {
      // Dev mode: log and continue rendering the app UI
      console.warn('Layout: auth failed but continuing in dev mode (testClient present):', error);
    }
  }

  // Children fallback
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
                  const isProduction = process.env.NODE_ENV === 'production' && !envLabel;
                  
                  return (
                    <div>
                      <div className="text-2xl font-bold">
                        {clientName
                          ? `${clientName}'s Network Accelerator${!isProduction && envLabel ? ` (${envLabel})` : ''}`
                          : `Network Accelerator${!isProduction && envLabel ? ` (${envLabel})` : ''}`}
                      </div>
                      <div className="text-base text-gray-600 mt-2">
                        Score leads — Start conversations — Close deals
                      </div>
                    </div>
                  );
                })()}
              </h1>
            </div>
            <div className="flex items-center space-x-4">
              {/* Per-page Help buttons are rendered within individual components via HelpButton */}
            </div>
          </div>
        </div>
      </header>

      <div className="w-full px-4 sm:px-6 lg:px-8 py-8">
        {/* Navigation Tabs */}
        <Suspense fallback={<div>Loading navigation...</div>}>
          <NavigationWithParams pathname={pathname} />
        </Suspense>

        {/* Main Content */}
        <main>
          {children}
        </main>
      </div>

      {/* Context Help Panel */}
      {helpOpen && (
        <ContextHelpPanel area={helpAreaOverride || helpArea} isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
      )}
    </div>
  );
};

export default Layout;

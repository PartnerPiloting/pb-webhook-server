"use client";
import React, { Suspense, useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { getEnvLabel, initializeClient, getClientProfile, getCurrentClientId, buildAuthUrl } from '../utils/clientUtils.js';
import { MagnifyingGlassIcon, CalendarDaysIcon, UserPlusIcon, TrophyIcon, CogIcon, BookOpenIcon, QuestionMarkCircleIcon, PencilSquareIcon, CalendarIcon, UsersIcon, WrenchScrewdriverIcon, CreditCardIcon, SparklesIcon, EnvelopeIcon, MicrophoneIcon, HandRaisedIcon } from '@heroicons/react/24/outline';
import ClientCodeEntry from './ClientCodeEntry';
import UploadEmailsModal from './UploadEmailsModal';

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
const NavigationWithParams = ({ pathname, showThanksForConnecting = false, showWingguy = false, showFollowupsScreen = false, assistantFunctions = null }) => {
  const searchParams = useSearchParams();
  const serviceLevel = parseInt(searchParams.get('level') || '2', 10);
  const clientParam = searchParams.get('client') || searchParams.get('testClient') || '';
  const nav = [
    { name: 'Lead Search & Update', href: '/', icon: MagnifyingGlassIcon, description: 'Find and update existing leads', minLevel: 1, fn: 'Lead Search & Update' },
    // Guy's tab rule (2026-08-15): a client with the smart Follow-Ups screen does NOT also see the
    // simple manager — `hideGate` hides this tab when that gate is on. The /follow-up page itself
    // stays reachable by URL as a fallback; only the tab hides. Never delete the simple screen —
    // it is the no-key tier, and tiers must be losslessly reversible.
    { name: 'Follow-Up Manager', href: '/follow-up', icon: CalendarDaysIcon, description: 'Manage scheduled follow-ups', minLevel: 1, hideGate: 'followupsScreen', fn: 'Follow-Up Manager' },
    // The Wingguy queue as a screen (docs/FOLLOWUPS-SCREEN-PLAN.md). Same assistant tick as the
    // simple manager, so an assistant's access carries across the tiers unchanged.
    { name: 'Follow-Ups', href: '/followups', icon: CalendarDaysIcon, description: 'Work the queue: replies owed & gone quiet', minLevel: 1, gate: 'followupsScreen', fn: 'Follow-Up Manager' },
    { name: 'New Leads', href: '/new-leads', icon: UserPlusIcon, description: 'Review and process new leads', minLevel: 1, fn: 'New Leads' },
    { name: 'Top Scoring Leads', href: '/top-scoring-leads', icon: TrophyIcon, description: 'Pick the best candidates for the next LH batch', minLevel: 1, fn: 'Top Scoring Leads' },
    // Per-client rollout: only shown when the master "Thanks for Connecting" switch is on (gated below).
    { name: 'Thanks for Connecting', href: '/thanks-for-connecting', icon: HandRaisedIcon, description: 'Welcome your recent connections', minLevel: 1, gate: 'thanksForConnecting', fn: 'Thanks for Connecting' },
    // Per-client Wingguy rollout: the setup page (and the what's-changed page via its own nav).
    // The portal link is the ONE link clients keep, so Wingguy has to be reachable from it -
    // the ?token= in the URL flows through searchParams like every other tab.
    { name: 'My Wingguy', href: '/my-wingguy', icon: SparklesIcon, description: 'Your setup, and what has changed', minLevel: 1, gate: 'wingguy', fn: 'My Wingguy' },
    // LEGACY-DISABLED 2026-05-16: Top Scoring Posts retired (Apify cost). Resurrect by un-commenting.
    // { name: 'Top Scoring Posts', href: '/top-scoring-posts', icon: TrophyIcon, description: 'Leads with high-relevance posts ready for action', minLevel: 2 },
    { name: 'Settings', href: '/settings', icon: CogIcon, description: 'Configure scoring attributes and settings', minLevel: 1, fn: 'Settings' },
    { name: 'Start Here', href: '/start-here', icon: BookOpenIcon, description: 'Onboarding categories and topics', minLevel: 1 }
  ];
  const gates = { thanksForConnecting: showThanksForConnecting, wingguy: showWingguy, followupsScreen: showFollowupsScreen };
  // An assistant sees only the tabs their row has ticked (fn names match the Assistants table's
  // checkbox columns). No fn on an item means it is open to everyone - e.g. Start Here.
  const fnAllowed = (n) => !assistantFunctions || !n.fn || assistantFunctions.includes(n.fn);
  // gate = show only when on; hideGate = hide when on (the smart tier replacing the simple tab).
  const items = nav.filter(n => n.minLevel <= serviceLevel && (!n.gate || gates[n.gate] === true) && !(n.hideGate && gates[n.hideGate] === true) && fnAllowed(n));
  return (
    <nav className="mb-8" aria-label="Primary">
      <div className="flex flex-wrap gap-x-8 gap-y-3 items-stretch">
        {items.map(item => {
          const Icon = item.icon;
          // Sub-pages count as the tab being active: /my-wingguy/setup must keep "My Wingguy"
          // highlighted, the same way a client expects a section to stay lit while inside it.
          const isActive = item.href === '/'
            ? pathname === '/'
            : (pathname === item.href || pathname.startsWith(`${item.href}/`));
          // The Wingguy pages are standalone (no portal session) - their auth is the query
          // string itself. The portal usually cleans ?token= off its own URL after login, so
          // for this tab the link is rebuilt from the stored auth rather than the bare params.
          const href = item.href === '/my-wingguy' && !searchParams.get('token') && !searchParams.get('devKey')
            ? buildAuthUrl(item.href)
            : `${item.href}?${searchParams.toString()}`;
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
  const searchParams = useSearchParams();
  const [clientProfile, setClientProfile] = useState(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpAreaOverride, setHelpAreaOverride] = useState(null);
  const [uploadEmailsOpen, setUploadEmailsOpen] = useState(false);
  const { isInitialized, error } = useClientInitialization();
  
  // Get client param for Calendar Booking link
  const clientParam = searchParams.get('client') || searchParams.get('testClient') || '';
  
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
    if (pathname.startsWith('/thanks-for-connecting')) return 'thanks_for_connecting';
    // LEGACY-DISABLED 2026-05-16: Top Scoring Posts retired (Apify cost).
    // if (pathname.startsWith('/top-scoring-posts')) return 'top_scoring_posts';
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

  // Error state (allow Start Here publicly, require token for other pages)
  if (error) {
    // Allow Start Here to be viewed publicly without auth
    const isStartHere = pathname && pathname.startsWith('/start-here');
    
    if (isStartHere) {
      // Allow Start Here to render publicly
      console.info('Layout: Rendering Start Here in public mode (no auth required)');
    } else {
      // Show appropriate error message for all other pages
      let errorMessage = null;
      const msg = String(error?.message || '');
      
      if (msg.includes('database service (Airtable)') || msg.includes('temporary outage')) {
        errorMessage = 'Our database service (Airtable) is experiencing a temporary outage. Please try again later.';
      } else if (msg.includes('portal link has been updated') || msg.includes('contact your coach for your new secure link')) {
        errorMessage = 'Your portal link has been updated for security. Please contact your coach for your new secure link.';
      } else if (msg.includes('Invalid') && msg.includes('link')) {
        errorMessage = 'Invalid access link. Please contact your coach for a valid link.';
      } else if (msg.includes('not currently active') || msg.includes('access has been suspended') || msg.includes('not Active')) {
        errorMessage = 'Your membership has expired. Please check with your coach.';
      } else {
        errorMessage = null; // No specific error - just show the default instructions
      }
      
      return <ClientCodeEntry error={errorMessage} />;
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
                  const assistantName = clientProfile?.assistant?.name;
                  const isProduction = process.env.NODE_ENV === 'production' && !envLabel;
                  // An assistant's key opens the client's account, so the top line names HER and
                  // says whose account she is in - otherwise the page claims she is the client.
                  const title = assistantName && clientName
                    ? `${assistantName} - assisting ${clientName}`
                    : clientName
                      ? `${clientName}'s Network Accelerator`
                      : 'Network Accelerator';
                  
                  return (
                    <div>
                      <div className="text-2xl font-bold">
                        {`${title}${!isProduction && envLabel ? ` (${envLabel})` : ''}`}
                      </div>
                      <div className="text-base text-gray-600 mt-2">
                        Score leads — Start conversations — Close deals
                      </div>
                    </div>
                  );
                })()}
              </h1>
            </div>
            <div className="flex items-center space-x-3">
              {/* Quick Update Link */}
              <Link
                href={buildAuthUrl('/quick-update')}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                title="Quick Update - rapid notes entry"
              >
                <PencilSquareIcon className="h-5 w-5" />
                <span className="hidden sm:inline">Quick Update</span>
              </Link>
              
              {/* Calendar Booking Link */}
              <Link
                href={buildAuthUrl('/calendar-booking')}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-purple-600 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors"
                title="Book a meeting with a lead"
              >
                <CalendarIcon className="h-5 w-5" />
                <span className="hidden sm:inline">Book Meeting</span>
              </Link>
              
              {/* Coached Clients Link */}
              <Link
                href={buildAuthUrl('/coached-clients')}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-green-600 bg-green-50 hover:bg-green-100 rounded-lg transition-colors"
                title="View clients you are coaching"
              >
                <UsersIcon className="h-5 w-5" />
                <span className="hidden sm:inline">My Coached Clients</span>
              </Link>
              
              {/* Smart Follow-ups, Upload Emails, Owner — Guy-Wilson only */}
              {getCurrentClientId() === 'Guy-Wilson' && (
                <>
                  <Link
                    href={buildAuthUrl('/smart-followups')}
                    className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
                    title="Smart Follow-ups - AI-powered prioritization"
                  >
                    <SparklesIcon className="h-5 w-5" />
                    <span className="hidden sm:inline">Smart Follow-ups</span>
                  </Link>
                  <Link
                    href={buildAuthUrl('/recall-review')}
                    className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-violet-600 bg-violet-50 hover:bg-violet-100 rounded-lg transition-colors"
                    title="Review meeting transcripts — verify speakers and link to leads"
                  >
                    <MicrophoneIcon className="h-5 w-5" />
                    <span className="hidden sm:inline">Transcripts</span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => setUploadEmailsOpen(true)}
                    className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-lg transition-colors"
                    title="Copy blank-email LinkedIn URLs or upload a CSV from LinkedHelper"
                  >
                    <EnvelopeIcon className="h-5 w-5" />
                    <span className="hidden sm:inline">Upload Emails</span>
                  </button>
                  <Link
                    href={buildAuthUrl('/onboard-client')}
                    className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors"
                    title="Onboard a new client — validate base, create record, mint portal token"
                  >
                    <UserPlusIcon className="h-5 w-5" />
                    <span className="hidden sm:inline">Onboard Client</span>
                  </Link>
                  <Link
                    href={buildAuthUrl('/owner-dashboard')}
                    className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-amber-600 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors"
                    title="Owner Dashboard - admin tools"
                  >
                    <WrenchScrewdriverIcon className="h-5 w-5" />
                    <span className="hidden sm:inline">Owner</span>
                  </Link>
                </>
              )}
              {/* Per-page Help buttons are rendered within individual components via HelpButton */}
            </div>
          </div>
        </div>
      </header>

      <div className="w-full px-4 sm:px-6 lg:px-8 py-8">
        {/* Navigation Tabs */}
        <Suspense fallback={<div>Loading navigation...</div>}>
          <NavigationWithParams pathname={pathname} showThanksForConnecting={clientProfile?.features?.thanksForConnecting === true} showWingguy={clientProfile?.features?.wingguy === true} showFollowupsScreen={clientProfile?.features?.followupsScreen === true} assistantFunctions={clientProfile?.assistant?.functions || null} />
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

      <UploadEmailsModal isOpen={uploadEmailsOpen} onClose={() => setUploadEmailsOpen(false)} />
    </div>
  );
};

export default Layout;

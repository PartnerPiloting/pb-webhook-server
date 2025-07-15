"use client";
import React, { Suspense } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { MagnifyingGlassIcon, CalendarDaysIcon, UserPlusIcon, TrophyIcon, CogIcon } from '@heroicons/react/24/outline';

// Component that uses useSearchParams wrapped in Suspense
const NavigationWithParams = ({ pathname, children }) => {
  const searchParams = useSearchParams();
  // Get service level from URL parameters (level=1 basic, level=2 includes post scoring)
  const serviceLevel = parseInt(searchParams.get('level') || '2');
  
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
    }
  ];

  // Filter navigation based on service level
  const filteredNavigation = navigation.filter(item => item.minLevel <= serviceLevel);

  return (
    <nav className="flex space-x-8 mb-8" aria-label="Tabs">
      {filteredNavigation && filteredNavigation.map((item) => {
        if (!item || !item.name || !item.href) return null;
        
        const Icon = item.icon;
        // Check if current pathname matches this navigation item
        const isActive = pathname === item.href;
        
        return (
          <Link
            key={item.name}
            href={`${item.href}?${searchParams.toString()}`}
            className={`${
              isActive
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap flex items-center py-2 px-1 border-b-2 font-medium text-sm transition-colors duration-200`}
          >
            {Icon && <Icon className="h-5 w-5 mr-2" />}
            <div>
              <div>{item.name || ''}</div>
              {item.description && (
                <div className="text-xs text-gray-400 font-normal">
                  {item.description}
                </div>
              )}
            </div>
          </Link>
        );
      })}
    </nav>
  );
};

const Layout = ({ children }) => {
  const pathname = usePathname();

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
                LinkedIn Follow-Up Portal
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

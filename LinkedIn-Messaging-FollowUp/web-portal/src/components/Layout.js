import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MagnifyingGlassIcon, CalendarDaysIcon, UserPlusIcon } from '@heroicons/react/24/outline';

const Layout = ({ children }) => {
  const location = useLocation();

  const navigation = [
    {
      name: 'Lead Search & Update',
      href: '/lead-search',
      icon: MagnifyingGlassIcon,
      description: 'Find and update existing leads'
    },
    {
      name: 'Follow-Up Manager',
      href: '/follow-up',
      icon: CalendarDaysIcon,
      description: 'Manage scheduled follow-ups'
    },
    {
      name: 'New Leads',
      href: '/new-leads',
      icon: UserPlusIcon,
      description: 'Review and process new leads'
    }
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-semibold text-gray-900">
                LinkedIn Follow-Up Portal
              </h1>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-500">
                Multi-Tenant Lead Management
              </span>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Navigation Tabs */}
        <nav className="flex space-x-8 mb-8" aria-label="Tabs">
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.href || 
                           (location.pathname === '/' && item.href === '/lead-search');
            
            return (
              <Link
                key={item.name}
                to={item.href}
                className={`${
                  isActive
                    ? 'border-linkedin-600 text-linkedin-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                } whitespace-nowrap flex items-center py-2 px-1 border-b-2 font-medium text-sm transition-colors duration-200`}
              >
                <Icon className="h-5 w-5 mr-2" />
                <div>
                  <div>{item.name}</div>
                  <div className="text-xs text-gray-400 font-normal">
                    {item.description}
                  </div>
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Main Content */}
        <main>
          {children}
        </main>
      </div>
    </div>
  );
};

export default Layout;

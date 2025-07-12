import React, { useState, useEffect } from 'react';

const Layout = ({ children, activeTab, onTabChange }) => {
  const [serviceLevel, setServiceLevel] = useState(1);
  
  // Get service level from URL parameter for development/testing
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const level = urlParams.get('level');
    if (level) {
      setServiceLevel(parseInt(level, 10));
    }
  }, []);

  const tabs = [
    {
      id: 'search',
      name: 'Lead Search & Update',
      description: 'Find and update existing leads',
      icon: '🔍',
      minLevel: 1
    },
    {
      id: 'followup',
      name: 'Follow-Up Manager',
      description: 'Manage scheduled follow-ups',
      icon: '📅',
      minLevel: 1
    },
    {
      id: 'topscoring',
      name: 'Top Scoring Posts',
      description: 'Leads with relevant posts for action',
      icon: '⭐',
      minLevel: 2 // Only for level 2 service
    },
    {
      id: 'newleads',
      name: 'New Leads',
      description: 'Review and process new leads',
      icon: '👤',
      minLevel: 1
    }
  ];

  // Filter tabs based on service level
  const availableTabs = tabs.filter(tab => serviceLevel >= tab.minLevel);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <h1 className="text-xl font-semibold text-gray-900">
              LinkedIn Follow-Up Portal
            </h1>
            <div className="flex items-center space-x-4">
              <div className="text-sm text-gray-600">
                Service Level: {serviceLevel} 
                {serviceLevel >= 2 && <span className="text-green-600 ml-1">(+ Post Scoring)</span>}
              </div>
              {serviceLevel < 2 && (
                <div className="text-xs text-orange-600">
                  Post Scoring requires Level 2 service
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-8" aria-label="Tabs">
            {availableTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center space-x-2`}
              >
                <span>{tab.icon}</span>
                <span>{tab.name}</span>
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow min-h-96">
          {children}
        </div>
      </main>

      {/* Service Level Notice for Level 1 users */}
      {serviceLevel === 1 && (
        <div className="fixed bottom-4 right-4 bg-blue-50 border border-blue-200 rounded-lg p-4 max-w-sm">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <span className="text-blue-500">💡</span>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-blue-800">
                Upgrade Available
              </h3>
              <p className="text-sm text-blue-700 mt-1">
                Get access to Top Scoring Posts and advanced features with Level 2 service.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Layout;

"use client";
import React, { useState, useEffect } from 'react';
import { getCoachedClients } from '../services/api';
import { UsersIcon, ArrowTopRightOnSquareIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';

/**
 * CoachedClients - Dashboard for coaches to view their coached clients
 * Shows list of clients with links to their Notion progress pages
 */
const CoachedClients = () => {
  const [clients, setClients] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [coachName, setCoachName] = useState('');

  useEffect(() => {
    loadCoachedClients();
  }, []);

  const loadCoachedClients = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const response = await getCoachedClients();
      
      if (response.success) {
        setClients(response.clients || []);
        setCoachName(response.coachName || '');
      } else {
        setError(response.error || 'Failed to load coached clients');
      }
    } catch (err) {
      console.error('Error loading coached clients:', err);
      setError(err.message || 'Failed to load coached clients');
    } finally {
      setIsLoading(false);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-gray-500">Loading coached clients...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="max-w-2xl mx-auto mt-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <ExclamationTriangleIcon className="h-12 w-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-red-800 mb-2">Error Loading Coached Clients</h2>
          <p className="text-red-600">{error}</p>
          <button
            onClick={loadCoachedClients}
            className="mt-4 px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // Empty state - not a coach
  if (clients.length === 0) {
    return (
      <div className="max-w-2xl mx-auto mt-8">
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
          <UsersIcon className="h-16 w-16 text-gray-300 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-700 mb-2">No Coached Clients</h2>
          <p className="text-gray-500">
            You don't have any clients assigned to you yet.
          </p>
        </div>
      </div>
    );
  }

  // Main view - list of coached clients
  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
          <UsersIcon className="h-7 w-7 text-blue-600" />
          My Coached Clients
        </h1>
        <p className="text-gray-600 mt-1">
          {clients.length} client{clients.length !== 1 ? 's' : ''} • {coachName}
        </p>
      </div>

      {/* Client Cards */}
      <div className="space-y-4">
        {clients.map((client) => (
          <div
            key={client.clientId}
            className="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow p-5"
          >
            <div className="flex items-center justify-between">
              {/* Client Info */}
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900">
                  {client.clientName}
                </h3>
                <div className="flex items-center gap-3 mt-1">
                  {/* Coaching Status Badge */}
                  {client.coachingStatus && (
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      client.coachingStatus === 'Active' 
                        ? 'bg-green-100 text-green-800'
                        : client.coachingStatus === 'Paused'
                        ? 'bg-yellow-100 text-yellow-800'
                        : client.coachingStatus === 'Graduated'
                        ? 'bg-purple-100 text-purple-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      {client.coachingStatus}
                    </span>
                  )}
                  
                  {/* Account Status */}
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    client.status === 'Active' 
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-gray-100 text-gray-600'
                  }`}>
                    Account: {client.status}
                  </span>
                </div>
              </div>

              {/* Notion Link */}
              <div className="flex-shrink-0 ml-4">
                {client.notionProgressUrl ? (
                  <a
                    href={client.notionProgressUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                  >
                    Open in Notion
                    <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                  </a>
                ) : (
                  <span className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-500 rounded-lg cursor-not-allowed">
                    <ExclamationTriangleIcon className="h-4 w-4" />
                    Notion page not configured
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Help Text */}
      <div className="mt-8 p-4 bg-blue-50 border border-blue-100 rounded-lg">
        <h4 className="text-sm font-medium text-blue-800 mb-1">Quick Tip</h4>
        <p className="text-sm text-blue-700">
          Click "Open in Notion" to view each client's progress page. 
          You can update their progress checkboxes and add coaching notes directly in Notion.
        </p>
      </div>
    </div>
  );
};

export default CoachedClients;

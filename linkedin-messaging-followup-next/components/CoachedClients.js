"use client";
import React, { useState, useEffect } from 'react';
import { getCoachedClients, getSystemSettings } from '../services/api';
import { UsersIcon, ArrowTopRightOnSquareIcon, ExclamationTriangleIcon, BookOpenIcon, ClipboardDocumentListIcon } from '@heroicons/react/24/outline';

/**
 * CoachedClients - Dashboard for coaches to view their coached clients
 * Shows list of clients with task progress
 */
const CoachedClients = () => {
  const [clients, setClients] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [coachName, setCoachName] = useState('');
  const [coachingResourcesUrl, setCoachingResourcesUrl] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Load coached clients and system settings in parallel
      const [clientsResponse, settingsResponse] = await Promise.all([
        getCoachedClients(),
        getSystemSettings().catch(() => ({ success: false }))
      ]);
      
      if (clientsResponse.success) {
        setClients(clientsResponse.clients || []);
        setCoachName(clientsResponse.coachName || '');
      } else {
        setError(clientsResponse.error || 'Failed to load coached clients');
      }
      
      if (settingsResponse.success && settingsResponse.settings) {
        setCoachingResourcesUrl(settingsResponse.settings.coachingResourcesUrl);
      }
    } catch (err) {
      console.error('Error loading coached clients:', err);
      setError(err.message || 'Failed to load coached clients');
    } finally {
      setIsLoading(false);
    }
  };

  // Progress bar component
  const ProgressBar = ({ progress }) => {
    const { total, completed, percentage } = progress || { total: 0, completed: 0, percentage: 0 };
    
    if (total === 0) {
      return (
        <span className="text-xs text-gray-400 italic">No tasks</span>
      );
    }
    
    return (
      <div className="flex items-center gap-3">
        <div className="w-32 bg-gray-200 rounded-full h-2.5">
          <div 
            className={`h-2.5 rounded-full ${
              percentage === 100 ? 'bg-green-500' : 
              percentage >= 50 ? 'bg-blue-500' : 
              percentage > 0 ? 'bg-yellow-500' : 'bg-gray-300'
            }`}
            style={{ width: `${percentage}%` }}
          ></div>
        </div>
        <span className="text-sm text-gray-600 whitespace-nowrap">
          {completed}/{total} ({percentage}%)
        </span>
      </div>
    );
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
            onClick={loadData}
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
          {coachingResourcesUrl && (
            <a
              href={coachingResourcesUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 mt-4 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
            >
              <BookOpenIcon className="h-5 w-5" />
              View Coaching Resources
            </a>
          )}
        </div>
      </div>
    );
  }

  // Main view - list of coached clients
  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            <UsersIcon className="h-7 w-7 text-green-600" />
            My Coached Clients
          </h1>
          <p className="text-gray-600 mt-1">
            {clients.length} client{clients.length !== 1 ? 's' : ''} • {coachName}
          </p>
        </div>
        
        {/* Coaching Resources Button */}
        {coachingResourcesUrl && (
          <a
            href={coachingResourcesUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium"
          >
            <BookOpenIcon className="h-5 w-5" />
            Coaching Resources
          </a>
        )}
      </div>

      {/* Client Cards */}
      <div className="space-y-4">
        {clients.map((client) => (
          <div
            key={client.clientId}
            className="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow p-5"
          >
            <div className="flex items-start justify-between">
              {/* Client Info */}
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900">
                  {client.clientName}
                </h3>
                
                {/* Status Badges */}
                <div className="flex items-center gap-3 mt-1">
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
                  
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    client.status === 'Active' 
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-gray-100 text-gray-600'
                  }`}>
                    Account: {client.status}
                  </span>
                </div>
                
                {/* Task Progress */}
                <div className="mt-3 flex items-center gap-2">
                  <ClipboardDocumentListIcon className="h-4 w-4 text-gray-400" />
                  <ProgressBar progress={client.taskProgress} />
                </div>
                
                {/* Coach Notes Preview */}
                {client.coachNotes && (
                  <p className="mt-2 text-sm text-gray-500 italic line-clamp-2">
                    "{client.coachNotes}"
                  </p>
                )}
              </div>

              {/* View Tasks Button */}
              <div className="flex-shrink-0 ml-4">
                {client.taskProgress?.total > 0 ? (
                  <a
                    href={`https://airtable.com/${process.env.NEXT_PUBLIC_MASTER_CLIENTS_BASE_ID || ''}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                  >
                    View Tasks
                    <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                  </a>
                ) : (
                  <span className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-500 rounded-lg cursor-not-allowed">
                    <ExclamationTriangleIcon className="h-4 w-4" />
                    No tasks yet
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Help Text */}
      <div className="mt-8 p-4 bg-green-50 border border-green-100 rounded-lg">
        <h4 className="text-sm font-medium text-green-800 mb-1">Quick Tip</h4>
        <p className="text-sm text-green-700">
          Client tasks are tracked in Airtable. Click "View Tasks" to see and update each client's onboarding progress.
          Update the Status field as you complete each step.
        </p>
      </div>
    </div>
  );
};

export default CoachedClients;

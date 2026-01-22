"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getCoachedClients, getSystemSettings, getBackendBase, getAuthenticatedHeaders } from '../services/api';
import { buildAuthUrl, getCurrentClientId } from '../utils/clientUtils';
import { UsersIcon, ArrowTopRightOnSquareIcon, ExclamationTriangleIcon, BookOpenIcon, ClipboardDocumentListIcon, PlusCircleIcon, EyeIcon, KeyIcon, ClipboardDocumentIcon, CheckIcon } from '@heroicons/react/24/outline';

/**
 * CoachedClients - Dashboard for coaches to view their coached clients
 * Shows list of clients with task progress
 */
const CoachedClients = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [clients, setClients] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [coachName, setCoachName] = useState('');
  const [coachingResourcesUrl, setCoachingResourcesUrl] = useState(null);
  const [addingTasksFor, setAddingTasksFor] = useState(null); // Track which client is getting tasks added
  
  // Token regeneration state
  const [regeneratingTokenFor, setRegeneratingTokenFor] = useState(null);
  const [generatedTokens, setGeneratedTokens] = useState({}); // { clientId: { token, url, copied } }
  const [tokenError, setTokenError] = useState(null);

  // Get dynamic backend URL
  const backendBase = getBackendBase();

  useEffect(() => {
    loadData();
  }, []);

  // Regenerate token for a specific client
  const handleRegenerateToken = async (clientId, clientName) => {
    setRegeneratingTokenFor(clientId);
    setTokenError(null);
    
    try {
      // Get the coach's client ID (the logged-in user)
      const coachClientId = getCurrentClientId();
      if (!coachClientId) {
        setTokenError('Not authenticated. Please log in again.');
        setRegeneratingTokenFor(null);
        return;
      }
      
      // Use the coach-level endpoint (no admin key needed)
      const response = await fetch(`${backendBase}/api/coached-clients/${coachClientId}/regenerate-token/${clientId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthenticatedHeaders()
        }
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Server returned ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.success && data.token) {
        const token = data.token;
        const url = data.portalUrl || `https://ashportal.com.au/quick-update?token=${token}`;
        setGeneratedTokens(prev => ({
          ...prev,
          [clientId]: { token, url, copied: false }
        }));
      } else {
        setTokenError(data.error || `Failed to generate token for ${clientName}`);
      }
    } catch (err) {
      // Provide more helpful error messages
      if (err.message === 'Failed to fetch') {
        setTokenError(`Cannot reach backend server. It may be starting up - please try again in 30 seconds.`);
      } else {
        setTokenError(`Error: ${err.message}`);
      }
    } finally {
      setRegeneratingTokenFor(null);
    }
  };
  
  // Copy URL to clipboard
  const handleCopyUrl = (clientId) => {
    const tokenData = generatedTokens[clientId];
    if (tokenData?.url) {
      navigator.clipboard.writeText(tokenData.url);
      setGeneratedTokens(prev => ({
        ...prev,
        [clientId]: { ...prev[clientId], copied: true }
      }));
      // Reset copied state after 3 seconds
      setTimeout(() => {
        setGeneratedTokens(prev => ({
          ...prev,
          [clientId]: { ...prev[clientId], copied: false }
        }));
      }, 3000);
    }
  };

  // Add tasks to a client
  const handleAddTasks = async (clientId, clientName) => {
    if (addingTasksFor) return; // Prevent double-clicks
    
    setAddingTasksFor(clientId);
    try {
      const response = await fetch(`${backendBase}/api/client/${clientId}/create-tasks`, {
        method: 'POST',
        headers: getAuthenticatedHeaders()
      });
      
      const data = await response.json();
      
      if (data.success) {
        if (data.tasksCreated > 0) {
          alert(`✅ Added ${data.tasksCreated} new tasks for ${clientName}`);
        } else {
          alert(`✅ ${clientName} already has all tasks`);
        }
        // Reload the data to show updated task counts
        loadData();
      } else {
        alert(`❌ ${data.error || 'Failed to sync tasks'}`);
      }
    } catch (err) {
      console.error('Error syncing tasks:', err);
      alert(`❌ Error: ${err.message}`);
    } finally {
      setAddingTasksFor(null);
    }
  };

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

      {/* Token Error Alert */}
      {tokenError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
          <p className="text-sm text-red-700">{tokenError}</p>
          <button 
            onClick={() => setTokenError(null)}
            className="text-red-500 hover:text-red-700 text-lg font-bold"
          >
            ×
          </button>
        </div>
      )}

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
                
                {/* Generated Token URL - shown after regeneration */}
                {generatedTokens[client.clientId] && (
                  <div className="mt-3 p-2 bg-green-50 border border-green-200 rounded-lg">
                    <p className="text-xs font-medium text-green-700 mb-1">🔐 New Portal URL:</p>
                    <div className="flex gap-2 items-center">
                      <code className="flex-1 text-xs bg-white px-2 py-1 rounded border border-green-200 text-gray-700 truncate">
                        {generatedTokens[client.clientId].url}
                      </code>
                      <button
                        onClick={() => handleCopyUrl(client.clientId)}
                        className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                          generatedTokens[client.clientId].copied
                            ? 'bg-green-600 text-white'
                            : 'bg-green-100 text-green-700 hover:bg-green-200'
                        }`}
                      >
                        {generatedTokens[client.clientId].copied ? (
                          <span className="flex items-center gap-1"><CheckIcon className="h-3 w-3" /> Copied!</span>
                        ) : (
                          <span className="flex items-center gap-1"><ClipboardDocumentIcon className="h-3 w-3" /> Copy</span>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex-shrink-0 ml-4 flex flex-col items-end gap-2">
                {/* View Tasks Button - navigates to task page */}
                {client.taskProgress?.total > 0 && (
                  <button
                    onClick={() => router.push(buildAuthUrl(`/client-tasks/${client.clientId}`))}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                  >
                    <EyeIcon className="h-4 w-4" />
                    View Tasks
                  </button>
                )}
                
                {/* Sync Tasks button - always available */}
                <button
                  onClick={() => handleAddTasks(client.clientId, client.clientName)}
                  disabled={addingTasksFor === client.clientId}
                  className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    addingTasksFor === client.clientId
                      ? 'bg-gray-200 text-gray-500 cursor-wait'
                      : client.taskProgress?.total > 0
                        ? 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-300'
                        : 'bg-amber-500 text-white hover:bg-amber-600'
                  }`}
                  title="Sync any new task templates"
                >
                  {addingTasksFor === client.clientId ? (
                    <>
                      <div className="animate-spin h-4 w-4 border-2 border-gray-400 border-t-transparent rounded-full"></div>
                      Syncing...
                    </>
                  ) : (
                    <>
                      <PlusCircleIcon className="h-4 w-4" />
                      {client.taskProgress?.total > 0 ? 'Sync' : 'Add Tasks'}
                    </>
                  )}
                </button>
                
                {/* Regenerate Token button */}
                <button
                  onClick={() => handleRegenerateToken(client.clientId, client.clientName)}
                  disabled={regeneratingTokenFor === client.clientId}
                  className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    regeneratingTokenFor === client.clientId
                      ? 'bg-gray-200 text-gray-500 cursor-wait'
                      : 'bg-purple-100 text-purple-700 hover:bg-purple-200 border border-purple-300'
                  }`}
                  title="Generate a new secure portal link for this client"
                >
                  {regeneratingTokenFor === client.clientId ? (
                    <>
                      <div className="animate-spin h-4 w-4 border-2 border-purple-400 border-t-transparent rounded-full"></div>
                      Generating...
                    </>
                  ) : (
                    <>
                      <KeyIcon className="h-4 w-4" />
                      New Token
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Help Text */}
      <div className="mt-8 p-4 bg-green-50 border border-green-100 rounded-lg">
        <h4 className="text-sm font-medium text-green-800 mb-1">Quick Tip</h4>
        <p className="text-sm text-green-700">
          Click "View Tasks" to see and update each client's onboarding progress.
          You can mark tasks as complete directly from the task view.
        </p>
      </div>
    </div>
  );
};

export default CoachedClients;

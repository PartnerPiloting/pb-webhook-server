"use client";
import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import LeadDetailForm from './LeadDetailForm';

// Component that uses useSearchParams wrapped in Suspense
const TopScoringPostsWithParams = () => {
  const [leads, setLeads] = useState([]);
  const [selectedLead, setSelectedLead] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const searchParams = useSearchParams();
  const client = searchParams.get('client') || 'Guy-Wilson';

  // Field names from master field list - single source of truth
  const FIELD_NAMES = {
    FIRST_NAME: 'First Name',
    LAST_NAME: 'Last Name',
    LINKEDIN_PROFILE_URL: 'LinkedIn Profile URL',
    SALES_NAVIGATOR_URL: 'Sales Navigator URL', // Try this first
    SALES_NAV_URL: 'Sales Nav URL', // Alternative
    LINKEDIN_SALES_NAVIGATOR: 'LinkedIn Sales Navigator', // Another alternative
    LINKEDIN_CONNECTION_STATUS: 'LinkedIn Connection Status',
    NOTES: 'Notes',
    AI_PROFILE_ASSESSMENT: 'AI Profile Assessment',
    AI_SCORE: 'AI Score',
    POSTS_RELEVANCE_PERCENTAGE: 'Posts Relevance Percentage',
    TOP_SCORING_POST: 'Top Scoring Post',
    POSTS_ACTIONED: 'Posts Actioned',
    POSTS_RELEVANCE_SCORE: 'Posts Relevance Score',
    POSTS_RELEVANCE_STATUS: 'Posts Relevance Status'
  };

  // Load leads with empty Posts Actioned and Posts Relevance Status = "Relevant"
  const loadTopScoringPosts = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Get client from URL parameters
      const urlParams = new URLSearchParams(window.location.search);
      const client = urlParams.get('client') || 'Guy-Wilson';
      
      // API call to get leads with Posts Actioned empty and Posts Relevance Status = "Relevant"
      // Sorted by First Name, Last Name
      const response = await fetch(`https://pb-webhook-server.onrender.com/api/linkedin/leads/top-scoring-posts?client=${client}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // Filter client-side as backup for API filtering
      const filteredLeads = (data || []).filter(lead => 
        !lead[FIELD_NAMES.POSTS_ACTIONED] && 
        lead[FIELD_NAMES.POSTS_RELEVANCE_STATUS] === 'Relevant'
      );
      
      // Sort by First Name, Last Name as per spec
      filteredLeads.sort((a, b) => {
        const firstNameA = a[FIELD_NAMES.FIRST_NAME] || '';
        const firstNameB = b[FIELD_NAMES.FIRST_NAME] || '';
        const lastNameA = a[FIELD_NAMES.LAST_NAME] || '';
        const lastNameB = b[FIELD_NAMES.LAST_NAME] || '';
        
        if (firstNameA !== firstNameB) {
          return firstNameA.localeCompare(firstNameB);
        }
        return lastNameA.localeCompare(lastNameB);
      });
      
      setLeads(filteredLeads);
      
      // Auto-select first lead if any
      if (filteredLeads.length > 0) {
        setSelectedLead(filteredLeads[0]);
      }
      
    } catch (err) {
      setError(`Failed to load top scoring posts: ${err.message}`);
      console.error('TopScoringPosts load error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Handle Posts Actioned checkbox change
  const handlePostsActioned = async (leadId, checked) => {
    try {
      const response = await fetch(`https://pb-webhook-server.onrender.com/api/linkedin/leads/${leadId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          [FIELD_NAMES.POSTS_ACTIONED]: checked
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to update Posts Actioned: ${response.statusText}`);
      }

      // Remove lead from list immediately when Posts Actioned is checked
      if (checked) {
        const updatedLeads = leads.filter(lead => lead.id !== leadId);
        setLeads(updatedLeads);
        
        // If removed lead was selected, select next one
        if (selectedLead?.id === leadId) {
          if (updatedLeads.length > 0) {
            const currentIndex = leads.findIndex(lead => lead.id === leadId);
            const nextIndex = Math.min(currentIndex, updatedLeads.length - 1);
            setSelectedLead(updatedLeads[nextIndex]);
          } else {
            setSelectedLead(null);
          }
        }
      }
      
    } catch (err) {
      setError(`Failed to update Posts Actioned: ${err.message}`);
      console.error('Posts Actioned update error:', err);
    }
  };

  // Handle Notes update
  const handleNotesUpdate = async (leadId, notes) => {
    try {
      const response = await fetch(`https://pb-webhook-server.onrender.com/api/linkedin/leads/${leadId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          [FIELD_NAMES.NOTES]: notes
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to update Notes: ${response.statusText}`);
      }

      // Update the selected lead
      const updatedLead = { ...selectedLead, [FIELD_NAMES.NOTES]: notes };
      setSelectedLead(updatedLead);
      
      // Update in leads list
      setLeads(leads.map(l => l.id === leadId ? updatedLead : l));
      
    } catch (err) {
      setError(`Failed to update Notes: ${err.message}`);
      console.error('Notes update error:', err);
    }
  };

  // Load data on component mount
  useEffect(() => {
    loadTopScoringPosts();
  }, [client]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading top scoring posts...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4">
        <div className="text-red-800">{error}</div>
        <button 
          onClick={loadTopScoringPosts}
          className="mt-2 bg-red-600 text-white px-3 py-1 rounded text-sm hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Left Panel - Posts List (styled like Follow-ups Due) */}
      <div className="w-80 bg-white border-r border-gray-200">
        {/* Header */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center">
            <div className="w-6 h-6 bg-blue-100 rounded flex items-center justify-center mr-3">
              <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-medium text-gray-900">Top Scoring Posts</h3>
              <div className="text-sm text-blue-600 font-medium">{leads.length}</div>
            </div>
          </div>
        </div>

        {/* Posts List */}
        <div className="overflow-y-auto" style={{ height: 'calc(100vh - 140px)' }}>
          {leads.length === 0 ? (
            <div className="p-4 text-center text-gray-500">
              No relevant posts found
            </div>
          ) : (
            leads.map((lead) => (
              <div
                key={lead.id || lead.recordId}
                className="p-4 border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                onClick={() => setSelectedLead(lead)}
              >
                <div className="flex items-start">
                  <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center mr-3 flex-shrink-0">
                    <span className="text-sm font-medium text-gray-600">
                      {(lead[FIELD_NAMES.FIRST_NAME] || '').charAt(0)}
                      {(lead[FIELD_NAMES.LAST_NAME] || '').charAt(0)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900">
                      {lead[FIELD_NAMES.FIRST_NAME]} {lead[FIELD_NAMES.LAST_NAME]}
                    </div>
                    <div className="text-sm text-gray-600">
                      In Process • Score: {lead[FIELD_NAMES.AI_SCORE] || 0}
                    </div>
                    <div className="text-sm text-green-600 mt-1">
                      Posts Relevance: {lead[FIELD_NAMES.POSTS_RELEVANCE_SCORE] || 0}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right Panel - Lead Details */}
      <div className="flex-1 bg-gray-50 overflow-y-auto">
        {selectedLead ? (
          <div className="p-6">
            {/* Lead Name with AI Score and Posts Relevance */}
            <div className="mb-4">
              <h2 className="text-2xl font-bold text-gray-900">
                {selectedLead[FIELD_NAMES.FIRST_NAME]} {selectedLead[FIELD_NAMES.LAST_NAME]}
              </h2>
              <div className="text-sm text-gray-600 mt-1">
                AI Score: {selectedLead[FIELD_NAMES.AI_SCORE] || 0}% • 
                Posts Relevance: {selectedLead[FIELD_NAMES.POSTS_RELEVANCE_PERCENTAGE] || 0}%
              </div>
            </div>

            {/* LinkedIn Profile URL */}
            <div className="mb-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                LinkedIn Profile
              </label>
              {selectedLead[FIELD_NAMES.LINKEDIN_PROFILE_URL] ? (
                <a 
                  href={selectedLead[FIELD_NAMES.LINKEDIN_PROFILE_URL]} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 underline"
                >
                  {selectedLead[FIELD_NAMES.LINKEDIN_PROFILE_URL]}
                </a>
              ) : (
                <span className="text-gray-500">No LinkedIn URL</span>
              )}
            </div>

            {/* Sales Navigator URL */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                View in Sales Navigator
              </label>
              {(selectedLead[FIELD_NAMES.SALES_NAVIGATOR_URL] || 
                selectedLead[FIELD_NAMES.SALES_NAV_URL] || 
                selectedLead[FIELD_NAMES.LINKEDIN_SALES_NAVIGATOR]) ? (
                <a 
                  href={selectedLead[FIELD_NAMES.SALES_NAVIGATOR_URL] || 
                        selectedLead[FIELD_NAMES.SALES_NAV_URL] || 
                        selectedLead[FIELD_NAMES.LINKEDIN_SALES_NAVIGATOR]} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 underline"
                >
                  Open in Sales Navigator
                </a>
              ) : (
                <span className="text-gray-500">No Sales Navigator URL</span>
              )}
            </div>

            {/* Posts Actioned Checkbox */}
            <div className="mb-4">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={selectedLead[FIELD_NAMES.POSTS_ACTIONED] || false}
                  onChange={(e) => handlePostsActioned(selectedLead.id, e.target.checked)}
                  className="mr-2 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <span className="text-sm font-medium text-gray-700">
                  Mark Posts as Actioned
                </span>
              </label>
              <p className="text-xs text-gray-500 mt-1 ml-6">
                Check this box when you've taken action on this lead's posts. 
                The lead will be removed from this list.
              </p>
            </div>

            {/* LinkedIn Connection Status - Display Only */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                LinkedIn Connection Status
              </label>
              <div className="p-2 bg-gray-100 border border-gray-300 rounded-md text-gray-700">
                {selectedLead[FIELD_NAMES.LINKEDIN_CONNECTION_STATUS] || 'Not specified'}
              </div>
            </div>

            {/* Notes - Editable */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes
              </label>
              <textarea
                value={selectedLead[FIELD_NAMES.NOTES] || ''}
                onChange={(e) => {
                  // Update local state immediately for responsive UI
                  const updatedLead = { ...selectedLead, [FIELD_NAMES.NOTES]: e.target.value };
                  setSelectedLead(updatedLead);
                }}
                onBlur={(e) => {
                  // Save to backend when user finishes editing
                  handleNotesUpdate(selectedLead.id, e.target.value);
                }}
                className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                rows="4"
                placeholder="Add notes about this lead..."
              />
            </div>

            {/* AI Profile Assessment */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                AI Profile Assessment
              </label>
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                <div className="text-sm text-blue-900">
                  {selectedLead[FIELD_NAMES.AI_PROFILE_ASSESSMENT] || 'No AI assessment available'}
                </div>
              </div>
            </div>

            {/* Top Scoring Post */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Top Scoring Post
              </label>
              <div className="p-3 bg-green-50 border border-green-200 rounded-md">
                <div className="text-sm text-green-900 whitespace-pre-wrap">
                  {selectedLead[FIELD_NAMES.TOP_SCORING_POST] || 'No top scoring post available'}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
                </svg>
              </div>
              <div className="text-gray-500">Select a lead to view details</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const TopScoringPosts = () => {
  return (
    <Suspense fallback={<div>Loading Top Scoring Posts...</div>}>
      <TopScoringPostsWithParams />
    </Suspense>
  );
};

export default TopScoringPosts;

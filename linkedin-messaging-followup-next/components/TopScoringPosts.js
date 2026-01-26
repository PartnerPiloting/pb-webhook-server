"use client";
import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { updateLead, getTopScoringPosts } from '../services/api';
import LeadDetailForm from './LeadDetailForm';
import HelpButton from './HelpButton';
import { getCurrentClientId } from '../utils/clientUtils.js';

// Component that uses useSearchParams wrapped in Suspense
const TopScoringPostsWithParams = () => {
  const [leads, setLeads] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [minPerc, setMinPerc] = useState('');
  const [selectedLead, setSelectedLead] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isMarkingActioned, setIsMarkingActioned] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  
  const searchParams = useSearchParams();
  const client = searchParams.get('client') || getCurrentClientId();

  // Field names from master field list - single source of truth
  const FIELD_NAMES = {
    FIRST_NAME: 'First Name',
    LAST_NAME: 'Last Name',
    LINKEDIN_PROFILE_URL: 'LinkedIn Profile URL',
    VIEW_IN_SALES_NAVIGATOR: 'View In Sales Navigator', // Correct field name
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
      console.log('🎯 Loading top scoring posts');
      const eff = Number.isFinite(Number(minPerc)) && minPerc !== '' ? Number(minPerc) : undefined;
      const results = await getTopScoringPosts(eff !== undefined ? { minPerc: eff } : {});
      
      // Handle new response format with total count
      const leadsArray = results.leads || results; // Support both old and new format
      const total = results.total || (Array.isArray(leadsArray) ? leadsArray.length : 0);
      
      // Filter client-side as backup for API filtering
      const filteredLeads = (Array.isArray(leadsArray) ? leadsArray : []).filter(lead => {
        const okActioned = !lead[FIELD_NAMES.POSTS_ACTIONED];
        if (!okActioned) return false;
        if (eff === undefined) return true;
        const perc = Number(
          lead.computedPostsRelevancePercentage ?? lead[FIELD_NAMES.POSTS_RELEVANCE_PERCENTAGE] ?? lead.postsRelevancePercentage ?? 0
        );
        return Number.isFinite(perc) ? perc >= eff : true;
      });
      
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
      setTotalCount(total);
      console.log(`🎯 Loaded ${filteredLeads.length} top scoring posts (${total} total matching)`);
      
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

  // Handle Posts Actioned button click
  // Handle Posts Actioned update using shared API service
  const handlePostsActioned = async (leadId) => {
    setIsMarkingActioned(true);
    setError(null);
    
    try {
      // Use shared updateLead function with proper field mapping
      await updateLead(leadId, {
        postsActioned: true  // This will be mapped to "Posts Actioned" by the API service
      });

      // Show success feedback
      setShowSuccess(true);
      
      // Wait 2 seconds, then remove lead and advance
      setTimeout(() => {
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
        
        // Reset states
        setIsMarkingActioned(false);
        setShowSuccess(false);
      }, 2000);
      
    } catch (err) {
      setError(`Failed to update Posts Actioned: ${err.message}`);
      console.error('Posts Actioned update error:', err);
      setIsMarkingActioned(false);
      setShowSuccess(false);
    }
  };

  // Handle Notes update using shared API service
  const handleNotesUpdate = async (leadId, notes) => {
    try {
      // Use shared updateLead function with proper field mapping
      const updatedLead = await updateLead(leadId, {
        notes: notes  // This will be mapped to "Notes" by the API service
      });

      // Update the selected lead with the response from API
      setSelectedLead({ ...selectedLead, [FIELD_NAMES.NOTES]: notes });
      
      // Update in leads list
      setLeads(leads.map(l => l.id === leadId ? { ...l, [FIELD_NAMES.NOTES]: notes } : l));
      
    } catch (err) {
      setError(`Failed to update Notes: ${err.message}`);
      console.error('Notes update error:', err);
    }
  };

  // Load data on component mount
  useEffect(() => {
    loadTopScoringPosts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <div className="w-6 h-6 bg-blue-100 rounded flex items-center justify-center mr-3">
                <svg className="w-4 h-4 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-medium text-gray-900">Top Scoring Posts</h3>
                <div className="text-sm text-blue-600 font-medium">
                  {leads.length}{totalCount > leads.length ? `/${totalCount}` : ''}
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <div className="flex items-center space-x-2">
                <label className="text-sm text-gray-700">Min %</label>
                <input
                  type="number"
                  value={minPerc}
                  onChange={(e) => setMinPerc(e.target.value)}
                  onBlur={() => loadTopScoringPosts()}
                  placeholder="e.g. 70"
                  className="w-20 px-2 py-1 border border-gray-300 rounded text-sm focus:ring-blue-500 focus:border-blue-500"
                  min={0}
                  max={100}
                  step={1}
                />
              </div>
              <button
                onClick={loadTopScoringPosts}
                className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
              >Apply</button>
              <HelpButton area="top_scoring_posts" title="Help: Top Scoring Posts" />
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
                      Posts Relevance: {Math.round((lead.computedPostsRelevancePercentage ?? lead[FIELD_NAMES.POSTS_RELEVANCE_PERCENTAGE] ?? 0))}%
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
                Posts Relevance: {Math.round((selectedLead.computedPostsRelevancePercentage ?? selectedLead[FIELD_NAMES.POSTS_RELEVANCE_PERCENTAGE] ?? 0))}%
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
              {selectedLead[FIELD_NAMES.VIEW_IN_SALES_NAVIGATOR] ? (
                <a 
                  href={selectedLead[FIELD_NAMES.VIEW_IN_SALES_NAVIGATOR]} 
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

            {/* Posts Actioned Button */}
            <div className="mb-4">
              {showSuccess ? (
                <div className="flex items-center p-3 bg-green-50 border border-green-200 rounded-lg">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <svg className="h-5 w-5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="ml-2">
                      <p className="text-sm font-medium text-green-800">
                        Posts marked as actioned! Moving to next lead...
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <button
                    onClick={() => handlePostsActioned(selectedLead.id)}
                    disabled={isMarkingActioned}
                    className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                  >
                    {isMarkingActioned ? (
                      <>
                        <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full mr-2"></div>
                        Processing...
                      </>
                    ) : (
                      <>
                        <svg className="h-4 w-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Mark Posts as Actioned
                      </>
                    )}
                  </button>
                  <p className="text-xs text-gray-500 mt-2">
                    Click when you've taken action on this lead's posts. The lead will be removed from this list.
                  </p>
                </div>
              )}
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
              <div className="flex justify-between items-center mb-1">
                <label className="block text-sm font-medium text-gray-700">
                  Notes
                </label>
                <div className="flex gap-2">
                  <a
                    href={`/quick-update?lead=${selectedLead?.id || ''}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200 inline-flex items-center gap-1"
                  >
                    + Add Note
                  </a>
                  <a
                    href={`/calendar-booking?lead=${selectedLead?.id || ''}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded hover:bg-purple-200 inline-flex items-center gap-1"
                  >
                    Book Meeting
                  </a>
                </div>
              </div>
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

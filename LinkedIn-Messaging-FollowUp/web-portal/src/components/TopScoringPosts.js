import React, { useState, useEffect } from 'react';
import LeadDetailForm from './LeadDetailForm';

const TopScoringPosts = () => {
  const [leads, setLeads] = useState([]);
  const [selectedLead, setSelectedLead] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Field names from master field list - single source of truth
  const FIELD_NAMES = {
    FIRST_NAME: 'First Name',
    LAST_NAME: 'Last Name',
    LINKEDIN_PROFILE_URL: 'LinkedIn Profile URL',
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

      // Remove lead from list immediately (as per spec)
      if (checked) {
        const updatedLeads = leads.filter(lead => lead.id !== leadId);
        setLeads(updatedLeads);
        
        // Select next lead in list
        if (updatedLeads.length > 0) {
          const currentIndex = leads.findIndex(lead => lead.id === leadId);
          const nextIndex = Math.min(currentIndex, updatedLeads.length - 1);
          setSelectedLead(updatedLeads[nextIndex]);
        } else {
          setSelectedLead(null);
        }
      }
      
    } catch (err) {
      setError(`Failed to update Posts Actioned: ${err.message}`);
      console.error('Posts Actioned update error:', err);
    }
  };

  // Load data on component mount
  useEffect(() => {
    loadTopScoringPosts();
  }, []);

  // Handle lead selection from list
  const handleLeadSelect = (lead) => {
    setSelectedLead(lead);
  };

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
      {/* Left Panel - Leads List */}
      <div className="w-1/3 border-r border-gray-200 bg-white">
        <div className="p-4 border-b border-gray-200">
          <h3 className="text-lg font-medium text-gray-900">
            Top Scoring Posts
            <span className="ml-2 text-sm text-gray-500">({leads.length})</span>
          </h3>
          <p className="text-sm text-gray-600 mt-1">
            Leads with relevant posts ready for action
          </p>
        </div>
        
        <div className="overflow-y-auto" style={{ height: 'calc(100vh - 200px)' }}>
          {leads.length === 0 ? (
            <div className="p-4 text-center text-gray-500">
              No leads with relevant posts found
            </div>
          ) : (
            leads.map((lead) => (
              <div
                key={lead.id || lead.recordId}
                className={`p-3 border-b border-gray-100 cursor-pointer hover:bg-blue-50 ${
                  selectedLead?.id === lead.id ? 'bg-blue-100 border-blue-300' : ''
                }`}
                onClick={() => handleLeadSelect(lead)}
              >
                <div className="font-medium text-gray-900">
                  {lead[FIELD_NAMES.FIRST_NAME]} {lead[FIELD_NAMES.LAST_NAME]}
                </div>
                <div className="text-sm text-gray-600 mt-1">
                  AI Score: {lead[FIELD_NAMES.AI_SCORE]}% • 
                  Posts Relevance: {lead[FIELD_NAMES.POSTS_RELEVANCE_PERCENTAGE]}%
                </div>
                {lead[FIELD_NAMES.TOP_SCORING_POST] && (
                  <div className="text-xs text-gray-500 mt-1 truncate">
                    {lead[FIELD_NAMES.TOP_SCORING_POST].substring(0, 80)}...
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right Panel - Lead Details */}
      <div className="flex-1 bg-gray-50">
        {selectedLead ? (
          <div className="h-full">
            {/* Posts Actioned Checkbox */}
            <div className="bg-yellow-50 border-b border-yellow-200 p-4">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={selectedLead[FIELD_NAMES.POSTS_ACTIONED] || false}
                  onChange={(e) => handlePostsActioned(selectedLead.id, e.target.checked)}
                  className="mr-2 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <span className="text-sm font-medium text-yellow-800">
                  Mark Posts as Actioned
                </span>
              </label>
              <p className="text-xs text-yellow-700 mt-1">
                Check this box when you've taken action on this lead's posts. 
                The lead will be removed from this list.
              </p>
            </div>
            
            {/* Lead Detail Form */}
            <LeadDetailForm 
              lead={selectedLead}
              onUpdate={(updatedLead) => {
                setSelectedLead(updatedLead);
                // Update in leads list
                setLeads(leads.map(l => l.id === updatedLead.id ? updatedLead : l));
              }}
              showPostScoringFields={true}
            />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-gray-500">Select a lead to view details</div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TopScoringPosts;

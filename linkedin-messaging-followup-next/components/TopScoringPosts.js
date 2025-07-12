"use client";
import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import LeadDetailForm from './LeadDetailForm';

// Component that uses useSearchParams wrapped in Suspense
const TopScoringPostsWithParams = () => {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedLead, setSelectedLead] = useState(null);
  const [updating, setUpdating] = useState(false);
  
  const searchParams = useSearchParams();
  const clientId = searchParams.get('client') || 'guy-wilson';

  // Load top scoring posts on component mount
  useEffect(() => {
    loadTopScoringPosts();
  }, [clientId]);

  const loadTopScoringPosts = async () => {
    setLoading(true);
    setError('');
    
    try {
      console.log('🔍 Loading top scoring posts for client:', clientId);
      
      const response = await fetch(`/api/linkedin/leads/top-scoring-posts?client=${clientId}`);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || 'Failed to load top scoring posts');
      }
      
      console.log('✅ Top scoring posts loaded:', data.length, 'leads');
      setLeads(data);
      
    } catch (err) {
      console.error('❌ Error loading top scoring posts:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePostsActioned = async (leadId, isChecked) => {
    setUpdating(true);
    
    try {
      console.log('🔄 Updating Posts Actioned for lead:', leadId, 'to:', isChecked);
      
      const response = await fetch(`/api/linkedin/leads/${leadId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          'Posts Actioned': isChecked,
          client: clientId
        }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to update Posts Actioned');
      }
      
      // Update local state
      setLeads(prevLeads => 
        prevLeads.map(lead => 
          lead.id === leadId 
            ? { ...lead, 'Posts Actioned': isChecked, postsActioned: isChecked }
            : lead
        )
      );
      
      // If checked, remove from list (since filter is Posts Actioned empty)
      if (isChecked) {
        setLeads(prevLeads => prevLeads.filter(lead => lead.id !== leadId));
      }
      
      console.log('✅ Posts Actioned updated successfully');
      
    } catch (err) {
      console.error('❌ Error updating Posts Actioned:', err);
      setError(err.message);
    } finally {
      setUpdating(false);
    }
  };

  const openLeadDetail = (lead) => {
    setSelectedLead(lead);
  };

  const closeLeadDetail = () => {
    setSelectedLead(null);
  };

  const handleLeadUpdate = (updatedLead) => {
    // Update the lead in our list
    setLeads(prevLeads => 
      prevLeads.map(lead => 
        lead.id === updatedLead.id ? { ...lead, ...updatedLead } : lead
      )
    );
    closeLeadDetail();
    // Optionally reload the list to ensure consistency
    // loadTopScoringPosts();
  };

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4">
        <h3 className="text-sm font-medium text-red-800">Error Loading Top Scoring Posts</h3>
        <p className="mt-1 text-sm text-red-700">{error}</p>
        <button 
          onClick={loadTopScoringPosts}
          className="mt-2 text-sm text-red-600 hover:text-red-800 underline"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Top Scoring Posts</h2>
            <p className="mt-1 text-sm text-gray-500">
              Leads with high-relevance posts ready for action (Posts Actioned empty, Posts Relevance Score {'>'} 0)
            </p>
          </div>
          <button
            onClick={loadTopScoringPosts}
            disabled={loading}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
        
        {/* Stats */}
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="bg-blue-50 p-4 rounded-lg">
            <div className="text-2xl font-bold text-blue-600">{leads.length}</div>
            <div className="text-sm text-blue-600">Ready for Action</div>
          </div>
          <div className="bg-green-50 p-4 rounded-lg">
            <div className="text-2xl font-bold text-green-600">
              {leads.filter(lead => (lead['Posts Relevance Score'] || 0) >= 50).length}
            </div>
            <div className="text-sm text-green-600">High Score (≥50)</div>
          </div>
          <div className="bg-yellow-50 p-4 rounded-lg">
            <div className="text-2xl font-bold text-yellow-600">
              {leads.filter(lead => (lead['Top Scoring Post'] || '').length > 0).length}
            </div>
            <div className="text-sm text-yellow-600">With Post Content</div>
          </div>
        </div>
      </div>

      {/* Lead List */}
      {loading ? (
        <div className="bg-white shadow rounded-lg p-6">
          <div className="flex items-center justify-center">
            <div className="text-gray-500">Loading top scoring posts...</div>
          </div>
        </div>
      ) : leads.length === 0 ? (
        <div className="bg-white shadow rounded-lg p-6">
          <div className="text-center">
            <div className="text-gray-500 mb-2">No leads with actionable posts found</div>
            <div className="text-sm text-gray-400">
              Looking for leads where Posts Actioned is empty and Posts Relevance Score {'>'} 0
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Lead
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  AI Score
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Posts Relevance
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Top Post Preview
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Posts Actioned
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {leads.map((lead) => (
                <tr key={lead.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {lead['First Name']} {lead['Last Name']}
                        </div>
                        {lead['LinkedIn Profile URL'] && (
                          <a
                            href={lead['LinkedIn Profile URL']}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-blue-600 hover:text-blue-800"
                          >
                            View LinkedIn Profile
                          </a>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      (lead['AI Score'] || 0) >= 75 ? 'bg-green-100 text-green-800' :
                      (lead['AI Score'] || 0) >= 50 ? 'bg-yellow-100 text-yellow-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {lead['AI Score'] || 0}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-gray-900">
                        {lead['Posts Relevance Score'] || 0}
                      </span>
                      <span className="text-xs text-gray-500">
                        {lead['Posts Relevance Percentage'] || 0}%
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-gray-900 max-w-xs truncate">
                      {(lead['Top Scoring Post'] || '').substring(0, 100)}
                      {(lead['Top Scoring Post'] || '').length > 100 ? '...' : ''}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={Boolean(lead['Posts Actioned'] || lead.postsActioned)}
                      onChange={(e) => handlePostsActioned(lead.id, e.target.checked)}
                      disabled={updating}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
                    />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <button
                      onClick={() => openLeadDetail(lead)}
                      className="text-blue-600 hover:text-blue-900"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Lead Detail Modal */}
      {selectedLead && (
        <LeadDetailForm
          lead={selectedLead}
          onClose={closeLeadDetail}
          onUpdate={handleLeadUpdate}
        />
      )}
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

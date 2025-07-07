"use client";
import React, { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import { MagnifyingGlassIcon, UserIcon, ExternalLinkIcon } from '@heroicons/react/24/outline';
import { debounce } from '../utils/helpers';
import { searchLeads, getLeadById, updateLead } from '../services/api';
import LeadDetailForm from './LeadDetailForm';

// ErrorBoundary wrapper (assume you have or will create this component)
// import ErrorBoundary from './ErrorBoundary';

const LeadSearchUpdate = () => {
  const [search, setSearch] = useState('');
  const [leads, setLeads] = useState([]);
  const [selectedLead, setSelectedLead] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  // Fetch initial leads on component mount
  useEffect(() => {
    fetchInitialLeads();
  }, []);

  const fetchInitialLeads = async () => {
    setIsLoading(true);
    try {
      // Fetch all leads or recent leads
      const results = await searchLeads('');
      setLeads(results || []);
    } catch (error) {
      console.error('Failed to fetch initial leads:', error);
      setMessage({ type: 'error', text: 'Failed to load leads. Please refresh the page.' });
    } finally {
      setIsLoading(false);
    }
  };

  // Debounced search function
  const debouncedSearch = useCallback(
    debounce(async (query) => {
      setIsLoading(true);
      try {
        const results = await searchLeads(query);
        setLeads(results || []);
      } catch (error) {
        console.error('Search error:', error);
        setMessage({ type: 'error', text: 'Search failed. Please try again.' });
      } finally {
        setIsLoading(false);
      }
    }, 500),
    []
  );

  // Effect to trigger search when query changes
  useEffect(() => {
    if (search.trim()) {
      debouncedSearch(search);
    } else {
      // If search is empty, fetch all leads again
      fetchInitialLeads();
    }
  }, [search, debouncedSearch]);

  // Handle lead selection - fetch full details
  const handleLeadSelect = async (lead) => {
    setIsLoading(true);
    try {
      // Fetch full lead details
      const fullLead = await getLeadById(lead['Profile Key']);
      setSelectedLead(fullLead);
    } catch (error) {
      console.error('Failed to load lead details:', error);
      setMessage({ type: 'error', text: 'Failed to load lead details. Please try again.' });
    } finally {
      setIsLoading(false);
    }
  };

  // Handle lead update
  const handleLeadUpdate = async (updatedData) => {
    if (!selectedLead) return;

    setIsUpdating(true);
    try {
      const updated = await updateLead(selectedLead.id, updatedData);
      setSelectedLead(updated);
      setMessage({ type: 'success', text: 'Lead updated successfully!' });
      
      // Update the lead in the search results too
      setLeads(prevLeads => 
        prevLeads.map(lead => 
          lead['Profile Key'] === updated.id ? {
            ...lead,
            'First Name': updated['First Name'],
            'Last Name': updated['Last Name'],
            'Status': updated['Status']
          } : lead
        )
      );
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        setMessage({ type: '', text: '' });
      }, 3000);
    } catch (error) {
      console.error('Update error:', error);
      setMessage({ type: 'error', text: 'Failed to update lead. Please try again.' });
    } finally {
      setIsUpdating(false);
    }
  };

  // Wrap the return in an ErrorBoundary if you have one
  // return (
  //   <ErrorBoundary>
  //     ...existing JSX...
  //   </ErrorBoundary>
  // );

  // For now, just return the existing JSX
  return (
    <div className="w-full flex flex-col md:flex-row gap-6">
      {/* Message display */}
      {message.text && (
        <div className={`fixed top-4 right-4 p-4 rounded-lg shadow-lg ${
          message.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
        }`}>
          {message.text}
        </div>
      )}
      
      <div className="md:w-1/3 w-full">
        <div className="relative">
          <MagnifyingGlassIcon className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
          <input
            type="text"
            className="search-input pl-10 mb-4"
            placeholder="Search by first or last name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        
        <div className="search-results">
          {isLoading && leads.length === 0 ? (
            <div className="text-center py-4">
              <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto"></div>
              <p className="text-gray-500 mt-2">Loading leads...</p>
            </div>
          ) : (
            <>
              {leads.map(lead => (
                <div
                  key={lead['Profile Key']}
                  className={`lead-result-item${selectedLead && selectedLead.id === lead['Profile Key'] ? ' selected' : ''}`}
                  onClick={() => handleLeadSelect(lead)}
                >
                  <div className="flex items-center">
                    <UserIcon className="h-5 w-5 mr-2 text-gray-400" />
                    <div>
                      <div className="font-bold">{lead['First Name']} {lead['Last Name']}</div>
                      <div className="text-xs text-gray-500">
                        {lead['Status'] || 'No status'} • Score: {lead['AI Score'] || 'N/A'}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {leads.length === 0 && !isLoading && (
                <div className="no-results">No leads found.</div>
              )}
            </>
          )}
        </div>
      </div>
      
      <div className="md:w-2/3 w-full">
        {selectedLead ? (
          <div className="lead-card">
            <div className="mb-4 pb-4 border-b">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-gray-800">
                  {selectedLead['First Name']} {selectedLead['Last Name']}
                </h2>
                {selectedLead['LinkedIn Profile URL'] && (
                  <a
                    href={selectedLead['LinkedIn Profile URL']}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800"
                  >
                    <ExternalLinkIcon className="h-5 w-5" />
                  </a>
                )}
              </div>
              <div className="text-sm text-gray-600 mt-1">
                Profile Key: {selectedLead.id || selectedLead['Profile Key']}
              </div>
            </div>
            
            <LeadDetailForm
              lead={{
                ...selectedLead,
                // Map the fields to the expected format
                id: selectedLead.id || selectedLead['Profile Key'],
                profileKey: selectedLead['Profile Key'],
                firstName: selectedLead['First Name'],
                lastName: selectedLead['Last Name'],
                linkedinProfileUrl: selectedLead['LinkedIn Profile URL'],
                viewInSalesNavigator: selectedLead['View In Sales Navigator'],
                email: selectedLead['Email'],
                aiScore: selectedLead['AI Score'],
                postsRelevancePercentage: selectedLead['Posts Relevance Percentage'],
                source: selectedLead['Source'],
                status: selectedLead['Status'],
                priority: selectedLead['Priority'],
                linkedinConnectionStatus: selectedLead['LinkedIn Connection Status'],
                followUpDate: selectedLead['Follow Up Date'],
                followUpNotes: selectedLead['Follow Up Notes'],
                notes: selectedLead['Notes'],
                lastMessageDate: selectedLead['Last Message Date']
              }}
              onUpdate={handleLeadUpdate}
              isUpdating={isUpdating}
            />
          </div>
        ) : (
          <div className="lead-card">
            <div className="text-center text-gray-400 py-12">
              <UserIcon className="h-16 w-16 mx-auto mb-4" />
              <p className="text-lg">Select a lead to view details</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LeadSearchUpdate;

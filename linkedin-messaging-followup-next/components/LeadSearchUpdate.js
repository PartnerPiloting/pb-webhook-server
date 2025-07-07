"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { debounce } from '../utils/helpers';
import { searchLeads, getLeadById, updateLead } from '../services/api';
import LeadDetailForm from './LeadDetailForm';

// Import icons using require to avoid Next.js issues
let MagnifyingGlassIcon, UserIcon, ExternalLinkIcon;
try {
  const icons = require('@heroicons/react/24/outline');
  MagnifyingGlassIcon = icons.MagnifyingGlassIcon;
  UserIcon = icons.UserIcon;
  ExternalLinkIcon = icons.ExternalLinkIcon;
} catch (error) {
  console.error('Failed to import icons:', error);
}

// Safe rendering helper
const safeRender = (value, fallback = '') => {
  if (value === null || value === undefined) return fallback;
  return value;
};

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
      fetchInitialLeads();
    }
  }, [search, debouncedSearch]);

  // Handle lead selection - fetch full details
  const handleLeadSelect = async (lead) => {
    if (!lead || !lead['Profile Key']) {
      console.error('Invalid lead selected:', lead);
      return;
    }
    
    setIsLoading(true);
    try {
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
      const updated = await updateLead(selectedLead.id || selectedLead['Profile Key'], updatedData);
      setSelectedLead(updated);
      setMessage({ type: 'success', text: 'Lead updated successfully!' });
      
      // Update the lead in the search results too
      setLeads(prevLeads => 
        prevLeads.map(lead => 
          lead['Profile Key'] === (updated.id || updated['Profile Key']) ? {
            ...lead,
            'First Name': updated['First Name'] || '',
            'Last Name': updated['Last Name'] || '',
            'Status': updated['Status'] || ''
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

  return (
    <div className="w-full flex flex-col lg:flex-row gap-6">
      {/* Message display */}
      {message && message.text && (
        <div className={`fixed top-4 right-4 p-4 rounded-lg shadow-lg ${
          message.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
        }`}>
          {safeRender(message.text)}
        </div>
      )}
      
      <div className="lg:w-1/4 w-full">
        <div className="relative mb-4">
          {MagnifyingGlassIcon && (
            <MagnifyingGlassIcon className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
          )}
          <input
            type="text"
            className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none shadow-sm"
            placeholder="Search by first or last name..."
            value={search || ''}
            onChange={e => setSearch(e.target.value || '')}
          />
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 max-h-96 overflow-y-auto">
          {isLoading && (!leads || leads.length === 0) ? (
            <div className="text-center py-6">
              <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto"></div>
              <p className="text-gray-500 mt-3">Loading leads...</p>
            </div>
          ) : (
            <>
              {leads && Array.isArray(leads) && leads.map(lead => {
                if (!lead || !lead['Profile Key']) return null;
                
                return (
                  <div
                    key={lead['Profile Key']}
                    className={`p-3 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0 transition-colors ${
                      selectedLead && (selectedLead.id || selectedLead['Profile Key']) === lead['Profile Key'] 
                        ? 'bg-blue-50 border-blue-200' 
                        : ''
                    }`}
                    onClick={() => handleLeadSelect(lead)}
                  >
                    <div className="flex items-center">
                      {UserIcon && <UserIcon className="h-5 w-5 mr-3 text-gray-400 flex-shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-gray-900 truncate">
                          {safeRender(lead['First Name'])} {safeRender(lead['Last Name'])}
                        </div>
                        <div className="text-xs text-gray-500 truncate">
                          {safeRender(lead['Status'], 'No status')} • Score: {safeRender(lead['AI Score'], 'N/A')}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {(!leads || leads.length === 0) && !isLoading && (
                <div className="p-6 text-center text-gray-500 italic">No leads found.</div>
              )}
            </>
          )}
        </div>
      </div>
      
      <div className="lg:w-3/4 w-full">
        {selectedLead ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
            <div className="mb-6 pb-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-semibold text-gray-900">
                  {safeRender(selectedLead['First Name'])} {safeRender(selectedLead['Last Name'])}
                </h2>
                {selectedLead['LinkedIn Profile URL'] && ExternalLinkIcon && (
                  <a
                    href={selectedLead['LinkedIn Profile URL']}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 transition-colors"
                  >
                    <ExternalLinkIcon className="h-6 w-6" />
                  </a>
                )}
              </div>
              <div className="text-sm text-gray-500 mt-2">
                Profile Key: {safeRender(selectedLead.id || selectedLead['Profile Key'])}
              </div>
            </div>
            
            <LeadDetailForm
              lead={{
                ...selectedLead,
                // Map the fields to the expected format with safety
                id: safeRender(selectedLead.id || selectedLead['Profile Key']),
                profileKey: safeRender(selectedLead['Profile Key']),
                firstName: safeRender(selectedLead['First Name']),
                lastName: safeRender(selectedLead['Last Name']),
                linkedinProfileUrl: safeRender(selectedLead['LinkedIn Profile URL']),
                viewInSalesNavigator: safeRender(selectedLead['View In Sales Navigator']),
                email: safeRender(selectedLead['Email']),
                aiScore: selectedLead['AI Score'],
                postsRelevancePercentage: selectedLead['Posts Relevance Percentage'],
                source: safeRender(selectedLead['Source']),
                status: safeRender(selectedLead['Status']),
                priority: safeRender(selectedLead['Priority']),
                linkedinConnectionStatus: safeRender(selectedLead['LinkedIn Connection Status']),
                followUpDate: safeRender(selectedLead['Follow Up Date']),
                followUpNotes: safeRender(selectedLead['Follow Up Notes']),
                notes: safeRender(selectedLead['Notes']),
                lastMessageDate: safeRender(selectedLead['Last Message Date'])
              }}
              onUpdate={handleLeadUpdate}
              isUpdating={isUpdating}
            />
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
            <div className="text-center text-gray-400 py-16">
              {UserIcon && <UserIcon className="h-20 w-20 mx-auto mb-6 text-gray-300" />}
              <p className="text-xl text-gray-500">Select a lead to view details</p>
              <p className="text-sm text-gray-400 mt-2">Choose a lead from the search results to view and edit their information</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LeadSearchUpdate;

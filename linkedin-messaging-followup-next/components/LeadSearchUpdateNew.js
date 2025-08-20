"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { debounce } from '../utils/helpers';
import { searchLeads, getLeadById, updateLead } from '../services/api';
import LeadDetailForm from './LeadDetailForm';
import LeadSearchEnhanced from './LeadSearchEnhanced';

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
  const [priority, setPriority] = useState('all');
  const [searchTerms, setSearchTerms] = useState('');
  const [leads, setLeads] = useState([]);
  const [selectedLead, setSelectedLead] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  // Use ref to track current search request and prevent race conditions
  const currentSearchRef = useRef(0);

  // Single search function that handles both search and initial load
  const performSearch = useCallback(async (query, currentPriority, currentSearchTerms, requestId) => {
    // Check if this is still the current search request
    if (requestId !== currentSearchRef.current) {
      console.log(`🔍 Search cancelled: "${query}" priority: "${currentPriority}" terms: "${currentSearchTerms}" (ID: ${requestId})`);
      return;
    }
    
    setIsLoading(true);
    console.log(`🔍 Starting search: "${query}" priority: "${currentPriority}" terms: "${currentSearchTerms}" (ID: ${requestId})`);
    
    try {
      // Use backend search with the query, priority, and search terms
      const results = await searchLeads(query, currentPriority, currentSearchTerms);
      
      // Check again after async operation
      if (requestId !== currentSearchRef.current) {
        console.log(`🔍 Search results ignored: "${query}" (ID: ${requestId}) - newer request active`);
        return;
      }
      
      // Filter out Multi-Tenant related entries (backend now handles priority filtering)
      const filteredAndSorted = (results || [])
        .filter(lead => {
          const firstName = (lead['First Name'] || '').toLowerCase();
          const lastName = (lead['Last Name'] || '').toLowerCase();
          
          // Filter out Multi-Tenant related entries
          return !firstName.includes('multi') && 
                 !lastName.includes('multi') &&
                 !firstName.includes('tenant') && 
                 !lastName.includes('tenant');
        })
        .slice(0, 25); // Limit to 25 results
      
      setLeads(filteredAndSorted);
      console.log(`🔍 Search completed: "${query}" (ID: ${requestId}) - ${filteredAndSorted.length} results`);
    } catch (error) {
      console.error('Search error:', error);
      if (requestId === currentSearchRef.current) {
        setMessage({ type: 'error', text: 'Search failed. Please try again.' });
      }
    } finally {
      if (requestId === currentSearchRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  // Debounced version of search for user typing
  const debouncedSearch = useCallback(
    debounce((query, currentPriority, currentSearchTerms, requestId) => {
      performSearch(query, currentPriority, currentSearchTerms, requestId);
    }, 500),
    [performSearch]
  );

  // Load initial results on component mount
  // Now safe with 50-record backend limit
  useEffect(() => {
    // Trigger initial search with empty query to show 50 default leads
    currentSearchRef.current += 1;
    performSearch('', priority, searchTerms, currentSearchRef.current);
  }, [performSearch, priority, searchTerms]);

  // Effect to trigger search when query, priority, or searchTerms changes
  useEffect(() => {
    // Increment request ID to cancel any pending searches
    currentSearchRef.current += 1;
    const requestId = currentSearchRef.current;
    
    console.log(`🔍 Search triggered: "${search}" priority: "${priority}" terms: "${searchTerms}" (ID: ${requestId})`);
    
    // Use debounced search for user typing (or immediate for empty search)
    if (!search.trim()) {
      // For empty search, get default leads immediately (no debounce needed)
      performSearch('', priority, searchTerms, requestId);
    } else {
      // Use debounced search for user typing
      debouncedSearch(search, priority, searchTerms, requestId);
    }
  }, [search, priority, searchTerms, debouncedSearch, performSearch]);

  // Handle lead selection - fetch full details
  const handleLeadSelect = async (lead) => {
    if (!lead || !lead['Profile Key']) {
      console.error('Invalid lead selected:', lead);
      return;
    }

    try {
      // Fetch full lead details by ID
      const fullLead = await getLeadById(lead['Profile Key']);
      setSelectedLead(fullLead);
      console.log('✅ Lead selected and details loaded:', fullLead);
    } catch (error) {
      console.error('Error fetching lead details:', error);
      // Fallback to the basic lead data from search
      setSelectedLead(lead);
      setMessage({ type: 'error', text: 'Could not load full lead details. Using basic information.' });
      setTimeout(() => setMessage({ type: '', text: '' }), 3000);
    }
  };

  // Handle lead updates
  const handleLeadUpdate = async (updatedData) => {
    if (!selectedLead) return;

    setIsUpdating(true);
    
    try {
      // Update the lead
      await updateLead(selectedLead.id || selectedLead['Profile Key'], updatedData);
      
      // Update the selected lead with new data
      setSelectedLead(prevLead => ({
        ...prevLead,
        ...updatedData
      }));
      
      // Update the lead in the search results
      setLeads(prevLeads => 
        prevLeads.map(lead => {
          if ((lead.id || lead['Profile Key']) === (selectedLead.id || selectedLead['Profile Key'])) {
            return { ...lead, ...updatedData };
          }
          return lead;
        })
      );
      
      setMessage({ type: 'success', text: 'Lead updated successfully!' });
      
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

  // Handle lead deletion
  const handleLeadDelete = (deletedLead) => {
    if (!deletedLead) return;

    // Remove the lead from the search results
    setLeads(prevLeads => 
      prevLeads.filter(lead => 
        lead['Profile Key'] !== (deletedLead.id || deletedLead['Profile Key'])
      )
    );
    
    // Clear the selected lead
    setSelectedLead(null);
    
    // Show success message
    setMessage({ 
      type: 'success', 
      text: `${deletedLead.firstName || ''} ${deletedLead.lastName || ''} has been deleted successfully.` 
    });
    
    // Clear success message after 5 seconds
    setTimeout(() => {
      setMessage({ type: '', text: '' });
    }, 5000);
  };

  // Handle enhanced search from the new search component
  const handleEnhancedSearch = ({ nameQuery, priority, searchTerms }) => {
    // Update state to trigger search
    setSearch(nameQuery || '');
    setPriority(priority || 'all');
    setSearchTerms(searchTerms || '');
  };

  return (
    <div className="w-full space-y-6">
      {/* Message display */}
      {message && message.text && (
        <div className={`fixed top-4 right-4 p-4 rounded-lg shadow-lg z-50 ${
          message.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
        }`}>
          {safeRender(message.text)}
        </div>
      )}
      
      {/* Enhanced Search and Table View */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Search and Table */}
        <div className="lg:col-span-2">
          <LeadSearchEnhanced
            leads={leads}
            onLeadSelect={handleLeadSelect}
            selectedLead={selectedLead}
            isLoading={isLoading}
            onSearch={handleEnhancedSearch}
          />
        </div>
        
        {/* Right: Lead Details */}
        <div>
          {selectedLead ? (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="mb-6 pb-6 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-gray-900">
                    {safeRender(selectedLead['First Name'])} {safeRender(selectedLead['Last Name'])}
                  </h2>
                  {selectedLead['LinkedIn Profile URL'] && ExternalLinkIcon && (
                    <a
                      href={selectedLead['LinkedIn Profile URL']}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 transition-colors"
                    >
                      <ExternalLinkIcon className="h-5 w-5" />
                    </a>
                  )}
                </div>
                <div className="text-sm text-gray-500 mt-2">
                  Profile Key: {safeRender(selectedLead.id || selectedLead['Profile Key'])}
                </div>
              </div>
              
              <LeadDetailForm
                lead={{
                  id: selectedLead.id || selectedLead['Profile Key'],
                  firstName: safeRender(selectedLead['First Name']),
                  lastName: safeRender(selectedLead['Last Name']),
                  linkedinProfileUrl: safeRender(selectedLead['LinkedIn Profile URL']),
                  status: safeRender(selectedLead['Status']),
                  priority: safeRender(selectedLead['Priority']),
                  linkedinConnectionStatus: safeRender(selectedLead['LinkedIn Connection Status']),
                  followUpDate: safeRender(selectedLead.followUpDate),
                  notes: safeRender(selectedLead['Notes']),
                  lastMessageDate: safeRender(selectedLead['Last Message Date']),
                  searchTerms: safeRender(selectedLead['Search Terms']),
                  searchTokensCanonical: safeRender(selectedLead['Search Tokens (canonical)'])
                }}
                onUpdate={handleLeadUpdate}
                onDelete={handleLeadDelete}
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
    </div>
  );
};

export default LeadSearchUpdate;

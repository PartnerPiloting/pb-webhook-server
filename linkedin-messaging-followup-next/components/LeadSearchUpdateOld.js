"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  const [priority, setPriority] = useState('all');
  const [leads, setLeads] = useState([]);
  const [selectedLead, setSelectedLead] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  // Use ref to track current search request and prevent race conditions
  const currentSearchRef = useRef(0);

  // Single search function that handles both search and initial load
  const performSearch = useCallback(async (query, currentPriority, requestId) => {
    // Check if this is still the current search request
    if (requestId !== currentSearchRef.current) {
      console.log(`🔍 Search cancelled: "${query}" priority: "${currentPriority}" (ID: ${requestId})`);
      return;
    }
    
    setIsLoading(true);
    console.log(`🔍 Starting search: "${query}" priority: "${currentPriority}" (ID: ${requestId})`);
    
    try {
      // Use backend search with the query and priority - backend handles filtering properly
      const results = await searchLeads(query, currentPriority);
      
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
    debounce((query, currentPriority, requestId) => {
      performSearch(query, currentPriority, requestId);
    }, 500),
    [performSearch]
  );

  // Load initial results on component mount
  // Now safe with 50-record backend limit
  useEffect(() => {
    // Trigger initial search with empty query to show 50 default leads
    currentSearchRef.current += 1;
    performSearch('', priority, currentSearchRef.current);
  }, [performSearch, priority]);

  // Effect to trigger search when query or priority changes
  useEffect(() => {
    // Increment request ID to cancel any pending searches
    currentSearchRef.current += 1;
    const requestId = currentSearchRef.current;
    
    console.log(`🔍 Search triggered: "${search}" priority: "${priority}" (ID: ${requestId})`);
    
    // Use debounced search for user typing (or immediate for empty search)
    if (!search.trim()) {
      // For empty search, get default leads immediately (no debounce needed)
      performSearch('', priority, requestId);
    } else {
      // Use debounced search for user typing
      debouncedSearch(search, priority, requestId);
    }
  }, [search, priority, debouncedSearch, performSearch]);

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
      
      // Check if lead was removed due to priority change
      const leadStillInList = priority === 'all' || updated['Priority'] === priority;
      if (!leadStillInList) {
        setSelectedLead(null); // Clear selection since lead was removed
        setMessage({ type: 'success', text: `Lead updated successfully! Moved to Priority: ${updated['Priority'] || 'None'}` });
      } else {
        setMessage({ type: 'success', text: 'Lead updated successfully!' });
      }
      
      // Update the lead in the search results, but remove it if priority changed
      setLeads(prevLeads => {
        const updatedLeads = prevLeads.map(lead => 
          lead['Profile Key'] === (updated.id || updated['Profile Key']) ? {
            ...lead,
            'First Name': updated['First Name'] || '',
            'Last Name': updated['Last Name'] || '',
            'Status': updated['Status'] || '',
            'Priority': updated['Priority'] || ''
          } : lead
        );
        
        // If priority filter is active and updated lead doesn't match, remove it
        if (priority !== 'all') {
          return updatedLeads.filter(lead => 
            lead['Profile Key'] !== (updated.id || updated['Profile Key']) || 
            lead['Priority'] === priority
          );
        }
        
        return updatedLeads;
      });
      
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
        
        {/* Priority Filter */}
        <div className="mb-4">
          <select
            value={priority}
            onChange={e => setPriority(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none shadow-sm bg-white"
          >
            <option value="all">All Priorities</option>
            <option value="One">Priority One</option>
            <option value="Two">Priority Two</option>
            <option value="Three">Priority Three</option>
          </select>
        </div>
        
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 max-h-[600px] overflow-y-auto">
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
                          {safeRender(lead['Status'], 'No status')} • Score: {safeRender(lead['AI Score'], 'N/A')} • Priority: {safeRender(lead['Priority'], 'None')}
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
                phone: safeRender(selectedLead['Phone']),
                ashWorkshopEmail: Boolean(selectedLead['ASH Workshop Email']),
                aiScore: selectedLead['AI Score'],
                postsRelevancePercentage: selectedLead['Posts Relevance Percentage'],
                source: safeRender(selectedLead['Source']),
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
  );
};

export default LeadSearchUpdate;

import React, { useState, useEffect, useCallback } from 'react';
import { MagnifyingGlassIcon, ExternalLinkIcon, UserIcon } from '@heroicons/react/24/outline';
import { debounce } from '../utils/helpers';
import { searchLeads, getLeadById, updateLead } from '../services/api';
import LeadDetailForm from './LeadDetailForm';

const LeadSearchUpdate = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedLead, setSelectedLead] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  // Debounced search function
  const debouncedSearch = useCallback(
    debounce(async (query) => {
      if (query.trim().length < 2) {
        setSearchResults([]);
        return;
      }

      setIsLoading(true);
      try {
        const results = await searchLeads(query);
        setSearchResults(results);
      } catch (error) {
        console.error('Search error:', error);
        setMessage({ type: 'error', text: 'Search failed. Please try again.' });
      } finally {
        setIsLoading(false);
      }
    }, 300),
    []
  );

  // Effect to trigger search when query changes
  useEffect(() => {
    debouncedSearch(searchQuery);
  }, [searchQuery, debouncedSearch]);

  // Handle lead selection from search results
  const handleLeadSelect = async (leadId) => {
    try {
      setIsLoading(true);
      const leadData = await getLeadById(leadId);
      setSelectedLead(leadData);
      setMessage({ type: '', text: '' });
    } catch (error) {
      console.error('Error loading lead:', error);
      setMessage({ type: 'error', text: 'Failed to load lead details.' });
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
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Lead Search & Update</h2>
        <p className="mt-1 text-sm text-gray-600">
          Find and update existing leads. Search by name to locate records.
        </p>
      </div>

      {/* Message Display */}
      {message.text && (
        <div className={`rounded-md p-4 ${
          message.type === 'success' 
            ? 'bg-green-50 text-green-800 border border-green-200'
            : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {message.text}
        </div>
      )}

      {/* Search Section */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" />
          </div>
          <input
            type="text"
            placeholder="Search by first name or last name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input pl-10"
          />
        </div>

        {/* Search Results */}
        {searchQuery.trim().length >= 2 && (
          <div className="mt-4">
            {isLoading ? (
              <div className="text-center py-4">
                <div className="inline-flex items-center">
                  <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full mr-2"></div>
                  Searching...
                </div>
              </div>
            ) : searchResults.length > 0 ? (
              <div className="search-results">
                {searchResults.map((lead) => (
                  <div
                    key={lead.id}
                    onClick={() => handleLeadSelect(lead.id)}
                    className={`lead-result-item ${
                      selectedLead?.id === lead.id ? 'selected' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <UserIcon className="h-5 w-5 text-gray-400 mr-3" />
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {lead.firstName} {lead.lastName}
                          </div>
                          <div className="text-xs text-gray-500 truncate max-w-md">
                            {lead.linkedinProfileUrl}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center text-xs text-gray-400">
                        {lead.aiScore && (
                          <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded-full mr-2">
                            Score: {lead.aiScore}
                          </span>
                        )}
                        <ExternalLinkIcon className="h-4 w-4" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="no-results">
                No leads found matching "{searchQuery}"
              </div>
            )}
          </div>
        )}
      </div>

      {/* Selected Lead Details */}
      {selectedLead && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">
              Lead Details: {selectedLead.firstName} {selectedLead.lastName}
            </h3>
            <p className="text-sm text-gray-600 mt-1">
              Update lead information and add notes below
            </p>
          </div>
          <div className="p-6">
            <LeadDetailForm
              lead={selectedLead}
              onUpdate={handleLeadUpdate}
              isUpdating={isUpdating}
            />
          </div>
        </div>
      )}

      {/* Help Text */}
      {!selectedLead && searchQuery.trim().length < 2 && (
        <div className="text-center py-12">
          <UserIcon className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">Search for leads</h3>
          <p className="mt-1 text-sm text-gray-500">
            Type at least 2 characters to search by first name or last name
          </p>
        </div>
      )}
    </div>
  );
};

export default LeadSearchUpdate;

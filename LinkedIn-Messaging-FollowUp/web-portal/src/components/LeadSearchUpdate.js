import React, { useState, useEffect, useCallback } from 'react';
import { MagnifyingGlassIcon, ExternalLinkIcon, UserIcon } from '@heroicons/react/24/outline';
import { debounce } from '../utils/helpers';
import { searchLeads, getLeadById, updateLead } from '../services/api';
import LeadDetailForm from './LeadDetailForm';

const LeadSearchUpdate = ({ leads = [] }) => {
  const safeLeads = leads || [];
  const [search, setSearch] = useState('');
  const [selectedLead, setSelectedLead] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  // Filter and sort leads by first name
  const filteredLeads = safeLeads
    .filter(lead => {
      const searchLower = search.toLowerCase();
      return (
        lead['First Name']?.toLowerCase().includes(searchLower) ||
        lead['Last Name']?.toLowerCase().includes(searchLower)
      );
    })
    .sort((a, b) => (a['First Name'] || '').localeCompare(b['First Name'] || ''));

  // Debounced search function
  const debouncedSearch = useCallback(
    debounce(async (query) => {
      if (query.trim().length < 2) {
        setSelectedLead(null);
        return;
      }

      setIsLoading(true);
      try {
        const results = await searchLeads(query);
        setSelectedLead(results[0]);
      } catch (error) {
        console.error('Search error:', error);
        setMessage({ type: 'error', text: 'Search failed. Please try again.' });
      } finally {
        setIsLoading(false);
      }
    }, []),
    []
  );

  // Effect to trigger search when query changes
  useEffect(() => {
    debouncedSearch(search);
  }, [search, debouncedSearch]);

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
    <div className="w-full flex flex-col md:flex-row gap-6">
      <div className="md:w-1/3 w-full">
        <input
          type="text"
          className="search-input mb-4"
          placeholder="Search by first or last name..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="search-results">
          {filteredLeads.map(lead => (
            <div
              key={lead['Profile Key']}
              className={`lead-result-item${selectedLead && selectedLead['Profile Key'] === lead['Profile Key'] ? ' selected' : ''}`}
              onClick={() => setSelectedLead(lead)}
            >
              <div className="font-bold">{lead['First Name']} {lead['Last Name']}</div>
              <div className="text-xs text-gray-500">{lead['Profile Key']}</div>
            </div>
          ))}
          {filteredLeads.length === 0 && (
            <div className="no-results">No leads found.</div>
          )}
        </div>
      </div>
      <div className="md:w-2/3 w-full">
        {selectedLead ? (
          <div className="lead-card">
            <div className="mb-4">
              <div className="text-lg font-bold text-blue-700 break-all">{selectedLead['Profile Key']}</div>
              <div className="flex gap-2 mt-2">
                <div className="font-semibold">First Name:</div>
                <div>{selectedLead['First Name']}</div>
                <div className="font-semibold ml-4">Last Name:</div>
                <div>{selectedLead['Last Name']}</div>
              </div>
            </div>
            <LeadDetailForm
              lead={selectedLead}
              onUpdate={handleLeadUpdate}
              isUpdating={isUpdating}
            />
          </div>
        ) : (
          <div className="lead-card text-center text-gray-400">Select a lead to view details</div>
        )}
      </div>
    </div>
  );
};

export default LeadSearchUpdate;

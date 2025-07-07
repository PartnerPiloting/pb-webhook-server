"use client";
import React, { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import { MagnifyingGlassIcon, ExternalLinkIcon, UserIcon } from '@heroicons/react/24/outline';
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

  // Wrap the return in an ErrorBoundary if you have one
  // return (
  //   <ErrorBoundary>
  //     ...existing JSX...
  //   </ErrorBoundary>
  // );

  // For now, just return the existing JSX
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
          {leads.map(lead => (
            <div
              key={lead['Profile Key']}
              className={`lead-result-item${selectedLead && selectedLead['Profile Key'] === lead['Profile Key'] ? ' selected' : ''}`}
              onClick={() => setSelectedLead(lead)}
            >
              <div className="font-bold">{lead['First Name']} {lead['Last Name']}</div>
              <div className="text-xs text-gray-500">{lead['Profile Key']}</div>
            </div>
          ))}
          {leads.length === 0 && (
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

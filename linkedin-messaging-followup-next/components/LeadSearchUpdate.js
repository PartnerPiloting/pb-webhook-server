"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { debounce } from '../utils/helpers';
import { searchLeads, getLeadById, getLeadByLinkedInUrl, updateLead } from '../services/api';
import LeadDetailForm from './LeadDetailForm';
import LeadSearchEnhanced from './LeadSearchEnhanced';
import LeadDetailModal from './LeadDetailModal';
import PaginationSummary from './PaginationSummary';

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
  const [allLeads, setAllLeads] = useState([]); // Store all search results
  const [leads, setLeads] = useState([]); // Display leads (paginated subset)
  const [totalLeads, setTotalLeads] = useState(null); // Total matching records (null when no filters)
  const [currentPage, setCurrentPage] = useState(1);
  const [leadsPerPage] = useState(25); // Show 25 leads per page
  const [selectedLead, setSelectedLead] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Use ref to track current search request and prevent race conditions
  const currentSearchRef = useRef(0);

  // Single search function that handles both search and pagination
  const performSearch = useCallback(async (query, currentPriority, currentSearchTerms, requestId, page = 1) => {
    // Check if this is still the current search request
    if (requestId !== currentSearchRef.current) {
      console.log(`🔍 Search cancelled: "${query}" priority: "${currentPriority}" terms: "${currentSearchTerms}" (ID: ${requestId})`);
      return;
    }
    
    // Check if query is a LinkedIn URL
    const linkedinUrlRegex = /linkedin\.com\/in\/[\w-]+/i;
    if (query && linkedinUrlRegex.test(query)) {
      console.log(`🔗 Detected LinkedIn URL: ${query}`);
      setIsLoading(true);
      
      try {
        // Look up lead by LinkedIn URL
        const lead = await getLeadByLinkedInUrl(query);
        
        // Check if request is still current
        if (requestId !== currentSearchRef.current) {
          console.log(`🔍 LinkedIn URL lookup ignored: "${query}" (ID: ${requestId}) - newer request active`);
          return;
        }
        
        // Open lead detail modal directly
        setSelectedLead(lead);
        setIsModalOpen(true);
        setIsLoading(false);
        console.log(`✅ Lead found by LinkedIn URL and opened:`, lead);
        return;
      } catch (error) {
        console.error('LinkedIn URL lookup error:', error);
        if (requestId === currentSearchRef.current) {
          setMessage({ type: 'error', text: error.message || 'Lead not found with that LinkedIn URL' });
          setTimeout(() => setMessage({ type: '', text: '' }), 5000);
          setIsLoading(false);
        }
        return;
      }
    }
    
    setIsLoading(true);
    console.log(`🔍 Starting search: "${query}" priority: "${currentPriority}" terms: "${currentSearchTerms}" page: ${page} (ID: ${requestId})`);
    
    try {
      // Calculate offset from page number
      const offset = (page - 1) * leadsPerPage;
      
      // Use backend search with pagination
      const response = await searchLeads(query, currentPriority, currentSearchTerms, leadsPerPage, offset);
      
      // Handle new response structure: { leads: [...], total: number|null }
      const results = response.leads || response; // Support both old and new format
      const total = response.total || null;
      
      // Check again after async operation
      if (requestId !== currentSearchRef.current) {
        console.log(`🔍 Search results ignored: "${query}" (ID: ${requestId}) - newer request active`);
        return;
      }
      
      // Filter out Multi-Tenant related entries (redundant safety - backend should handle this)
      const filteredResults = (results || [])
        .filter(lead => {
          const firstName = (lead['First Name'] || '').toLowerCase();
          const lastName = (lead['Last Name'] || '').toLowerCase();
          
          // Filter out Multi-Tenant related entries
          return !firstName.includes('multi') && 
                 !lastName.includes('multi') &&
                 !firstName.includes('tenant') && 
                 !lastName.includes('tenant');
        });

      // With API pagination, we only get the current page
      setLeads(filteredResults);
      setTotalLeads(total); // Set total from API (null when no filters, number when filtered)
      setCurrentPage(page);
      
      // For now, assume we have more data if we get a full page (we'll improve this later)
      setAllLeads(filteredResults);
      
      console.log(`🔍 Search completed: "${query}" page ${page} (ID: ${requestId}) - ${filteredResults.length} results on this page, total: ${total || 'unknown'}`);
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
  }, [leadsPerPage]);

  // Debounced version of search for user typing
  const debouncedSearch = useCallback(
    debounce((query, currentPriority, currentSearchTerms, requestId, page = 1) => {
      performSearch(query, currentPriority, currentSearchTerms, requestId, page);
    }, 500),
    [performSearch]
  );

  // Load initial results on component mount
  // Now safe with 25-record API pagination
  useEffect(() => {
    // Trigger initial search with empty query to show first page of leads
    currentSearchRef.current += 1;
    performSearch('', priority, searchTerms, currentSearchRef.current, 1);
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
      performSearch('', priority, searchTerms, requestId, 1);
    } else {
      // Use debounced search for user typing
      debouncedSearch(search, priority, searchTerms, requestId, 1);
    }
  }, [search, priority, searchTerms, debouncedSearch, performSearch]);

  // Handle lead selection - fetch full details and open modal
  const handleLeadSelect = async (lead) => {
    // Use the record ID instead of Profile Key for API calls
    const leadId = lead.id || lead.recordId || lead['Profile Key'];
    
    if (!lead || !leadId) {
      console.error('Invalid lead selected:', lead);
      return;
    }

    try {
      // Fetch full lead details by record ID
      const fullLead = await getLeadById(leadId);
      setSelectedLead(fullLead);
      setIsModalOpen(true);
      console.log('✅ Lead selected and details loaded:', fullLead);
    } catch (error) {
      console.error('Error fetching lead details:', error);
      // Fallback to the basic lead data from search
      setSelectedLead(lead);
      setIsModalOpen(true);
      setMessage({ type: 'error', text: 'Could not load full lead details. Using basic information.' });
      setTimeout(() => setMessage({ type: '', text: '' }), 3000);
    }
  };

  // Handle pagination with API calls
  const handlePageChange = (newPage) => {
    if (newPage < 1) return;
    
    // Trigger a new search for the requested page
    currentSearchRef.current += 1;
    const requestId = currentSearchRef.current;
    
    console.log(`📄 Loading page ${newPage} with search: "${search}" priority: "${priority}" terms: "${searchTerms}"`);
    
    // Use the current search parameters with the new page
    performSearch(search, priority, searchTerms, requestId, newPage);
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
    
    // Clear the selected lead and close modal
    setSelectedLead(null);
    setIsModalOpen(false);
    
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

  // Handle enhanced search from LeadSearchEnhanced component
  const handleEnhancedSearch = ({ nameQuery, priority: newPriority, searchTerms: newSearchTerms }) => {
    console.log('🔍 Enhanced search triggered:', { nameQuery, priority: newPriority, searchTerms: newSearchTerms });
    
    // Update all search states
    setSearch(nameQuery || '');
    setPriority(newPriority || 'all');
    setSearchTerms(newSearchTerms || '');
    
    // Only clear selected lead if modal is not open (don't interfere with modal viewing)
    if (!isModalOpen) {
      setSelectedLead(null);
    }
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
      
      {/* Enhanced Search and Table View - Full Width */}
      <LeadSearchEnhanced
        leads={leads}
        totalLeads={totalLeads}
        currentPage={currentPage}
        leadsPerPage={leadsPerPage}
        onLeadSelect={handleLeadSelect}
        selectedLead={selectedLead}
        isLoading={isLoading}
        onSearch={handleEnhancedSearch}
      />

      <PaginationSummary
        currentPage={currentPage}
        pageItemCount={leads.length}
        pageSize={leadsPerPage}
        // Pass total from API (null when no filters, number when filtered)
        knownTotal={totalLeads}
        onPageChange={handlePageChange}
        isLoading={isLoading}
        disableNext={leads.length < leadsPerPage}
      />

      {/* Modal for Lead Details */}
      <LeadDetailModal
        lead={selectedLead}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onUpdate={handleLeadUpdate}
        onDelete={handleLeadDelete}
        isUpdating={isUpdating}
      />
    </div>
  );
};

export default LeadSearchUpdate;

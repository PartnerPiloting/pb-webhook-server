"use client";
import React, { useState, useEffect } from 'react';
import SearchTermsField from './SearchTermsField';
import LeadSearchTableDirect from './LeadSearchTableDirect';

const LeadSearchEnhanced = ({ 
  leads = [], 
  totalLeads = 0,
  currentPage = 1,
  leadsPerPage = 25,
  onLeadSelect, 
  selectedLead = null, 
  isLoading = false,
  onSearch
}) => {
  // Search states
  const [nameSearch, setNameSearch] = useState('');
  const [priority, setPriority] = useState('all');
  const [searchTerms, setSearchTerms] = useState('');

  // Handle name search change
  const handleNameSearchChange = (e) => {
    const value = e.target.value;
    setNameSearch(value);
    
    // Trigger search with current filters
    if (onSearch) {
      onSearch({
        nameQuery: value,
        priority,
        searchTerms
      });
    }
  };

  // Handle priority change
  const handlePriorityChange = (e) => {
    const value = e.target.value;
    setPriority(value);
    
    // Trigger search with current filters
    if (onSearch) {
      onSearch({
        nameQuery: nameSearch,
        priority: value,
        searchTerms
      });
    }
  };

  // Handle search terms change (from SearchTermsField)
  // SearchTermsField calls onTermsChange(displayTerms, canonicalCsv)
  const handleSearchTermsChange = (displayTerms /* string */, canonicalCsv /* string */) => {
    const termsString = displayTerms || '';
    setSearchTerms(termsString);

    if (onSearch) {
      onSearch({
        nameQuery: nameSearch,
        priority,
        searchTerms: termsString
      });
    }
  };

  // Handle bulk export - gets all matching leads, not just current page
  const handleExport = async (type) => {
    try {
      // Create API call to get ALL matching leads
      const params = new URLSearchParams();
      if (nameSearch) params.set('name', nameSearch);
      if (priority !== 'all') params.set('priority', priority);
      if (searchTerms) params.set('searchTerms', searchTerms);
      params.set('limit', '1000'); // Get up to 1000 leads
      params.set('testClient', 'Guy-Wilson');

      // Build API base robustly: if env includes /api/linkedin already, don't duplicate it
      const rawBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001/api/linkedin';
      const apiBase = rawBase.endsWith('/api/linkedin') || /\/api\/linkedin\/?$/.test(rawBase)
        ? rawBase.replace(/\/$/, '')
        : `${rawBase.replace(/\/$/, '')}/api/linkedin`;
      const response = await fetch(`${apiBase}/leads/search?${params}`);
      const allLeads = await response.json();

      if (!Array.isArray(allLeads)) {
        throw new Error('Failed to fetch leads');
      }

      let values = [];
      let fieldName = '';

      switch (type) {
        case 'emails':
          fieldName = 'Email';
          values = allLeads
            .map(lead => lead[fieldName] || lead['email'])
            .filter(email => email && email.trim())
            .filter((email, index, arr) => arr.indexOf(email) === index); // Remove duplicates
          break;
        
        case 'phones':
          fieldName = 'Phone Number';
          values = allLeads
            .map(lead => lead[fieldName] || lead['phone'])
            .filter(phone => phone && phone.trim())
            .filter((phone, index, arr) => arr.indexOf(phone) === index);
          break;
        
        case 'linkedin':
          fieldName = 'LinkedIn Profile URL';
          values = allLeads
            .map(lead => lead[fieldName] || lead['linkedinProfileUrl'])
            .filter(url => url && url.trim())
            .filter((url, index, arr) => arr.indexOf(url) === index);
          break;
      }

      if (values.length === 0) {
        alert(`No ${type} found in the matching leads.`);
        return;
      }

      // Copy to clipboard
      const textToCopy = values.join('\n');
      await navigator.clipboard.writeText(textToCopy);
      
      alert(`Copied ${values.length} ${type} to clipboard!\n\nYou can now paste them into any program.`);

    } catch (error) {
      console.error('Export failed:', error);
      alert('Failed to export data. Please try again.');
    }
  };

  return (
    <div className="space-y-6">
      {(() => {
        try {
          // eslint-disable-next-line no-console
          console.debug('[LeadSearchEnhanced] Component types', {
            LeadSearchTableType: 'client-wrapper',
            SearchTermsFieldType: typeof SearchTermsField,
          });
        } catch {}
        return null;
      })()}
      {/* Search Controls */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Search & Filter</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
          {/* Name Search - narrower, 1 column */}
          <div className="md:col-span-1">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Search by Name
            </label>
            <div className="relative">
              <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                placeholder="Name..."
                value={nameSearch}
                onChange={handleNameSearchChange}
              />
            </div>
          </div>

          {/* Priority Filter - narrow, 1 column */}
          <div className="md:col-span-1">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Priority
            </label>
            <select
              value={priority}
              onChange={handlePriorityChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
            >
              <option value="all">All</option>
              <option value="One">One</option>
              <option value="Two">Two</option>
              <option value="Three">Three</option>
            </select>
          </div>

          {/* Search Terms Filter - more space, 4 columns */}
          <div className="md:col-span-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <svg className="inline h-4 w-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
              Search Terms
            </label>
            <div className="border border-gray-300 rounded-lg p-2 bg-white">
              {typeof SearchTermsField === 'function' ? (
                <SearchTermsField
                  initialTerms={searchTerms}
                  onTermsChange={handleSearchTermsChange}
                  placeholder="Type terms (use quotes for phrases, e.g. &quot;Mindset Mastery&quot;) and press Enter or comma..."
                />
              ) : (
                <div className="text-sm text-red-600">
                  SearchTermsField failed to load (type: {String(typeof SearchTermsField)}).
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Active Filters */}
        <div className="mt-4 flex flex-wrap gap-2">
          <div className="text-sm text-gray-600">Active filters:</div>
          {nameSearch && (
            <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs">
              Name: "{nameSearch}"
            </span>
          )}
          {priority !== 'all' && (
            <span className="px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs">
              Priority: {priority}
            </span>
          )}
        </div>
      </div>

      {/* Results Table */}
      <div className="space-y-4">
        {/* Bulk Export Actions */}
        {leads && leads.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className="text-sm font-medium text-gray-700">Export All Matching Leads:</span>
                <span className="text-xs text-gray-500">({totalLeads} total found)</span>
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={() => handleExport('emails')}
                  className="inline-flex items-center px-3 py-1.5 border border-gray-300 rounded-md text-xs font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                  </svg>
                  Copy Emails
                </button>
                <button
                  onClick={() => handleExport('phones')}
                  className="inline-flex items-center px-3 py-1.5 border border-gray-300 rounded-md text-xs font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                  Copy Phones
                </button>
                <button
                  onClick={() => handleExport('linkedin')}
                  className="inline-flex items-center px-3 py-1.5 border border-gray-300 rounded-md text-xs font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                  </svg>
                  Copy LinkedIn URLs
                </button>
              </div>
            </div>
          </div>
        )}

  <LeadSearchTableDirect
          leads={leads}
          totalLeads={totalLeads}
          currentPage={currentPage}
          leadsPerPage={leadsPerPage}
          onLeadSelect={onLeadSelect}
          selectedLead={selectedLead}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
};

export default LeadSearchEnhanced;

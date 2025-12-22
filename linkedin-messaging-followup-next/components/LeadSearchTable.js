"use client";
import React, { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';

// Lazy load the editor to keep initial bundle small
const InlineSearchTermsEditor = dynamic(() => import('./InlineSearchTermsEditor'), { ssr: false, loading: () => <span className="text-xs text-gray-400">…</span> });

export default function LeadSearchTable({ 
  leads = [], 
  totalLeads = 0,
  currentPage = 1,
  leadsPerPage = 25,
  onLeadSelect, 
  selectedLead = null, 
  isLoading = false 
}) {
  // Table sorting state
  const [sortKey, setSortKey] = useState('AI Score');
  const [sortDir, setSortDir] = useState('desc');

  // Define table columns and their labels
  const columns = [
    { key: 'fullName', label: 'Name', sortable: true },
    { key: 'Company', label: 'Company', sortable: true },
    { key: 'AI Score', label: 'Score', sortable: true, isNumeric: true },
    { key: 'Priority', label: 'Priority', sortable: true },
    { key: 'Status', label: 'Status', sortable: true },
    { key: 'searchTerms', label: 'Search Terms', sortable: false },
    { key: 'linkedinProfileUrl', label: 'LinkedIn', sortable: false },
    { key: 'email', label: 'Email', sortable: false },
    { key: 'phone', label: 'Phone', sortable: false }
  ];

  // Get cell value with safe rendering
  const getCellValue = (lead, key) => {
    if (key === 'fullName') {
      const firstName = lead['First Name'] || '';
      const lastName = lead['Last Name'] || '';
      return `${firstName} ${lastName}`.trim() || 'Unnamed';
    }
    
    const value = lead[key];
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return '';
    return String(value);
  };

  // Sort leads based on current sort settings
  const sortedLeads = useMemo(() => {
    if (!leads || leads.length === 0) return [];
    
    return [...leads].sort((a, b) => {
      const aVal = getCellValue(a, sortKey);
      const bVal = getCellValue(b, sortKey);
      
      // Check if column is numeric
      const column = columns.find(col => col.key === sortKey);
      if (column?.isNumeric) {
        const aNum = parseFloat(aVal) || 0;
        const bNum = parseFloat(bVal) || 0;
        return sortDir === 'asc' ? aNum - bNum : bNum - aNum;
      }
      
      // String comparison
      const comparison = aVal.localeCompare(bVal, undefined, { 
        numeric: true, 
        sensitivity: 'base' 
      });
      return sortDir === 'asc' ? comparison : -comparison;
    });
  }, [leads, sortKey, sortDir]);

  // Handle header click for sorting
  const handleHeaderClick = (columnKey) => {
    const column = columns.find(col => col.key === columnKey);
    if (!column?.sortable) return;

    if (sortKey === columnKey) {
      // Toggle direction if same column
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      // Set new column and default direction
      setSortKey(columnKey);
      setSortDir(column.isNumeric ? 'desc' : 'asc');
    }
  };

  // Render search terms as chips
  const renderSearchTerms = (lead) => {
    // Get search terms from multiple possible fields
    let terms = [];
    
    // Check various field names
    const searchTermsField = lead['Search Terms'] || lead['searchTerms'] || '';
    const canonicalField = lead['Search Tokens (canonical)'] || '';
    
    // Combine terms from both fields
    const allTermsStr = [searchTermsField, canonicalField].join(', ');
    
    if (allTermsStr) {
      terms = allTermsStr
        .split(',')
        .map(term => term.trim())
        .filter(term => term && term.length > 0);
      
      // Remove duplicates
      terms = [...new Set(terms)];
    }

  // Provide inline editor
  return <InlineSearchTermsEditor lead={lead} />;
  };

  // Render LinkedIn URL as a chip
  const renderLinkedIn = (lead) => {
    const url = lead['LinkedIn Profile URL'] || lead['linkedinProfileUrl'] || '';
    if (!url) return <span className="text-gray-400 text-sm">-</span>;
    
    return (
      <a 
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center px-2 py-1 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded text-xs text-blue-700 transition-colors"
        title="Open LinkedIn Profile"
      >
        <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 24 24">
          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
        </svg>
        Profile
      </a>
    );
  };

  // Render cell content based on column
  const renderCell = (lead, column) => {
    const { key } = column;
    
    // Special rendering for certain columns
    if (key === 'searchTerms') {
      return renderSearchTerms(lead);
    }
    
    if (key === 'linkedinProfileUrl') {
      return renderLinkedIn(lead);
    }

    if (key === 'AI Score') {
      const score = lead[key];
      if (!score) return <span className="text-gray-400">-</span>;
      
      const numScore = parseFloat(score);
      const colorClass = numScore >= 75 ? 'text-green-600' : 
                        numScore >= 50 ? 'text-yellow-600' : 'text-red-600';
      
      return <span className={`font-medium ${colorClass}`}>{score}</span>;
    }

    if (key === 'Status') {
      const status = lead[key];
      if (!status) return <span className="text-gray-400">-</span>;
      
      const colorMap = {
        'In Progress': 'bg-blue-100 text-blue-800',
        'Completed': 'bg-green-100 text-green-800',
        'Pending': 'bg-yellow-100 text-yellow-800',
        'Failed': 'bg-red-100 text-red-800'
      };
      
      const colorClass = colorMap[status] || 'bg-gray-100 text-gray-800';
      
      return (
        <span className={`px-2 py-1 rounded-full text-xs ${colorClass}`}>
          {status}
        </span>
      );
    }

    const value = getCellValue(lead, key);
    return value || <span className="text-gray-400 text-sm">-</span>;
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gray-200 rounded w-1/4"></div>
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-4 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!sortedLeads || sortedLeads.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">
          Search Results (showing 0)
          <span className="ml-2 text-sm font-normal text-gray-500">
            Sorted by Score (descending)
          </span>
        </h3>
        <div className="text-center py-8">
          <div className="text-gray-500">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900">No leads found</h3>
            <p className="mt-1 text-sm text-gray-500">Try adjusting your search criteria</p>
          </div>
        </div>
      </div>
    );
  }

  const startIndex = (currentPage - 1) * leadsPerPage + 1;
  const endIndex = Math.min(startIndex + sortedLeads.length - 1, totalLeads);

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-6 py-4 border-b border-gray-200">
        <h3 className="text-lg font-medium text-gray-900">
          Search Results (showing {sortedLeads.length} of {totalLeads})
          <span className="ml-2 text-sm font-normal text-gray-500">
            Sorted by {columns.find(col => col.key === sortKey)?.label || sortKey} ({sortDir === 'asc' ? 'ascending' : 'descending'})
          </span>
        </h3>
      </div>
      
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  onClick={() => handleHeaderClick(column.key)}
                  className={`px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider ${
                    column.sortable ? 'cursor-pointer hover:bg-gray-100' : ''
                  }`}
                >
                  <div className="flex items-center space-x-1">
                    <span>{column.label}</span>
                    {column.sortable && (
                      <div className="flex flex-col">
                        <svg
                          className={`w-3 h-3 ${
                            sortKey === column.key && sortDir === 'asc' 
                              ? 'text-gray-900' 
                              : 'text-gray-400'
                          }`}
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
                        </svg>
                        <svg
                          className={`w-3 h-3 -mt-1 ${
                            sortKey === column.key && sortDir === 'desc' 
                              ? 'text-gray-900' 
                              : 'text-gray-400'
                          }`}
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {sortedLeads.map((lead, index) => (
              <tr
                key={lead.id || index}
                onClick={() => onLeadSelect && onLeadSelect(lead)}
                className={`
                  ${onLeadSelect ? 'cursor-pointer hover:bg-gray-50' : ''}
                  ${selectedLead?.id === lead.id ? 'bg-blue-50' : ''}
                `}
              >
                {columns.map((column) => (
                  <td key={column.key} className="px-6 py-4 whitespace-nowrap text-sm align-top relative" style={{overflow: 'visible'}}>
                    {renderCell(lead, column)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {/* Pagination info */}
      <div className="px-6 py-3 bg-gray-50 border-t border-gray-200">
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-700">
            Page {currentPage} - Showing {sortedLeads.length} leads (up to {leadsPerPage} per page)
          </div>
        </div>
      </div>
    </div>
  );
}

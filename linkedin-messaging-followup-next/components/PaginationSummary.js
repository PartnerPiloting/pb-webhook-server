"use client";
import React from 'react';

export default function PaginationSummary({
  currentPage = 1,
  pageItemCount = 0,
  pageSize = 25,
  knownTotal = null, // if null we only know current page size
  onPageChange,
  isLoading = false,
  disableNext = false,
  className = ''
}) {
  // Derive range (optimistic – we only know what we fetched)
  const start = pageItemCount === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const end = pageItemCount === 0 ? 0 : start + pageItemCount - 1;
  const plural = pageItemCount === 1 ? 'lead' : 'leads';
  const totalLabel = knownTotal != null ? `of ${knownTotal}` : '';
  return (
    <div className={`flex items-center justify-between bg-white px-4 py-3 border rounded-lg ${className}`}>
      <div className="flex items-center text-sm text-gray-700" aria-live="polite">
        {isLoading ? (
          <span>Loading…</span>
        ) : pageItemCount === 0 ? (
          <span>No leads found</span>
        ) : (
          <span>
            Page {currentPage} · Showing {start}–{end} ({pageItemCount} {plural} {totalLabel})
          </span>
        )}
      </div>
      <div className="flex items-center space-x-2">
        <button
          onClick={() => onPageChange && onPageChange(currentPage - 1)}
          disabled={isLoading || currentPage === 1}
          className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
            currentPage === 1 || isLoading
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
          aria-label="Previous page"
        >
          Previous
        </button>
        <span className="px-3 py-1 rounded text-sm font-medium bg-blue-600 text-white" aria-current="page">{currentPage}</span>
        <button
          onClick={() => onPageChange && onPageChange(currentPage + 1)}
          disabled={isLoading || disableNext}
          className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
            isLoading || disableNext
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
          aria-label="Next page"
        >
          Next
        </button>
      </div>
    </div>
  );
}
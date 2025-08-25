import { useState, useMemo } from 'react';

// Import icons (assuming Heroicons are available in the project)
const XMarkIcon = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const MagnifyingGlassIcon = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
  </svg>
);

const TrashIcon = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
  </svg>
);

const DocumentArrowDownIcon = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-4.5A1.125 1.125 0 0 1 10.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H6A1.125 1.125 0 0 0 4.875 3.5v9.75A1.125 1.125 0 0 0 6 14.625h2.25M19.5 14.25l-2.625 2.625M19.5 14.25l-2.625-2.625M10.5 7.125H4.875c-.621 0-1.125.504-1.125 1.125v9.75c0 .621.504 1.125 1.125 1.125h4.125c.621 0 1.125-.504 1.125-1.125V8.25A1.125 1.125 0 0 0 8.875 7.125Z" />
  </svg>
);

const DocumentArrowUpIcon = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-4.5A1.125 1.125 0 0 1 10.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H6A1.125 1.125 0 0 0 4.875 3.5v9.75A1.125 1.125 0 0 0 6 14.625h2.25M19.5 14.25l-2.625-2.625M19.5 14.25l-2.625 2.625m0-7.875 2.625-2.625m-2.625 2.625L16.875 9" />
  </svg>
);

const ManageTermsModal = ({ isOpen, onClose, terms = [], onTermsChange, disabled = false }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTerms, setSelectedTerms] = useState(new Set());
  const [importText, setImportText] = useState('');
  const [sortBy, setSortBy] = useState('alphabetical'); // 'alphabetical' | 'dateAdded' | 'frequency'
  
  // Filter and sort terms based on search and sort preferences
  const filteredAndSortedTerms = useMemo(() => {
    let filtered = terms.filter(term => 
      term.toLowerCase().includes(searchQuery.toLowerCase())
    );
    
    switch (sortBy) {
      case 'alphabetical':
        return filtered.sort((a, b) => a.localeCompare(b));
      case 'length':
        return filtered.sort((a, b) => a.length - b.length);
      default:
        return filtered;
    }
  }, [terms, searchQuery, sortBy]);

  const handleSelectAll = () => {
    if (selectedTerms.size === filteredAndSortedTerms.length) {
      setSelectedTerms(new Set());
    } else {
      setSelectedTerms(new Set(filteredAndSortedTerms));
    }
  };

  const handleTermSelect = (term) => {
    const newSelected = new Set(selectedTerms);
    if (newSelected.has(term)) {
      newSelected.delete(term);
    } else {
      newSelected.add(term);
    }
    setSelectedTerms(newSelected);
  };

  const handleDeleteSelected = () => {
    const newTerms = terms.filter(term => !selectedTerms.has(term));
    onTermsChange(newTerms);
    setSelectedTerms(new Set());
  };

  const handleImport = () => {
    if (!importText.trim()) return;
    
    // Simple tokenization for import - split by commas, newlines, or semicolons
    const importedTerms = importText
      .split(/[,;\n]/)
      .map(term => term.trim().toLowerCase())
      .filter(Boolean)
      .filter(term => term.length <= 40); // Apply same length limit
    
    // Merge with existing terms, dedupe
    const mergedSet = new Set([...terms, ...importedTerms]);
    const merged = Array.from(mergedSet).slice(0, 25); // Apply same 25 limit
    
    onTermsChange(merged);
    setImportText('');
  };

  const handleExport = () => {
    const exportText = terms.join(', ');
    navigator.clipboard.writeText(exportText).then(() => {
      // Could add a toast notification here
      alert('Terms copied to clipboard!');
    }).catch(() => {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = exportText;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      alert('Terms copied to clipboard!');
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black bg-opacity-50 transition-opacity" onClick={onClose} />
      
      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Manage Search Terms</h3>
              <p className="text-sm text-gray-500 mt-1">
                {terms.length} terms • {selectedTerms.size} selected • {25 - terms.length} remaining
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-500 transition-colors"
              disabled={disabled}
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>

          {/* Controls */}
          <div className="p-6 border-b border-gray-200 space-y-4">
            {/* Search and Sort */}
            <div className="flex gap-4">
              <div className="flex-1 relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search terms..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={disabled}
                />
              </div>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                disabled={disabled}
              >
                <option value="alphabetical">A-Z</option>
                <option value="length">By Length</option>
              </select>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleSelectAll}
                className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors"
                disabled={disabled || filteredAndSortedTerms.length === 0}
              >
                {selectedTerms.size === filteredAndSortedTerms.length ? 'Deselect All' : 'Select All'}
              </button>
              
              <button
                onClick={handleDeleteSelected}
                className="px-3 py-1 text-sm bg-red-100 hover:bg-red-200 text-red-700 rounded transition-colors flex items-center gap-1"
                disabled={disabled || selectedTerms.size === 0}
              >
                <TrashIcon className="h-4 w-4" />
                Delete Selected ({selectedTerms.size})
              </button>

              <button
                onClick={handleExport}
                className="px-3 py-1 text-sm bg-blue-100 hover:bg-blue-200 text-blue-700 rounded transition-colors flex items-center gap-1"
                disabled={disabled || terms.length === 0}
              >
                <DocumentArrowDownIcon className="h-4 w-4" />
                Export
              </button>
            </div>
          </div>

          {/* Terms List */}
          <div className="flex-1 overflow-y-auto p-6">
            {filteredAndSortedTerms.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                {terms.length === 0 ? 'No search terms added yet.' : 'No terms match your search.'}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {filteredAndSortedTerms.map((term, index) => (
                  <div
                    key={`${term}-${index}`}
                    className={`
                      flex items-center p-3 rounded-lg border cursor-pointer transition-colors
                      ${selectedTerms.has(term) 
                        ? 'bg-blue-50 border-blue-200' 
                        : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                      }
                      ${disabled ? 'cursor-not-allowed opacity-50' : ''}
                    `}
                    onClick={() => !disabled && handleTermSelect(term)}
                  >
                    <input
                      type="checkbox"
                      checked={selectedTerms.has(term)}
                      onChange={() => handleTermSelect(term)}
                      className="mr-3 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      disabled={disabled}
                    />
                    <span className="flex-1 text-sm text-gray-900 break-words">{term}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Import Section */}
          <div className="p-6 border-t border-gray-200">
            <div className="space-y-3">
              <label className="block text-sm font-medium text-gray-700">
                Import Terms (comma, semicolon, or newline separated)
              </label>
              <div className="flex gap-2">
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder="coaching, leadership, mindset&#10;business development&#10;team building"
                  rows={3}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                  disabled={disabled}
                />
                <button
                  onClick={handleImport}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-md transition-colors flex items-center gap-2 self-start"
                  disabled={disabled || !importText.trim() || terms.length >= 25}
                >
                  <DocumentArrowUpIcon className="h-4 w-4" />
                  Import
                </button>
              </div>
              <p className="text-xs text-gray-500">
                Terms will be automatically cleaned, lowercased, and deduplicated. Limit: 25 terms total, 40 characters each.
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 p-6 border-t border-gray-200">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
              disabled={disabled}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ManageTermsModal;

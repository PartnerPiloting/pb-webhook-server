"use client";
import React, { useState } from 'react';
import { XMarkIcon, SparklesIcon, ArrowPathIcon } from '@heroicons/react/24/outline';

const AIEditModal = ({ isOpen, onClose, attribute, onSave }) => {
  const [userRequest, setUserRequest] = useState('');
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  const handleGenerateAISuggestion = async () => {
    if (!userRequest.trim()) {
      setError('Please describe what you want to change');
      return;
    }

    setIsGenerating(true);
    setError(null);
    
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/attributes/${attribute.id}/ai-edit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userRequest: userRequest.trim()
        })
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }

      const result = await response.json();
      setAiSuggestion(result.suggestion);
    } catch (err) {
      console.error('Error generating AI suggestion:', err);
      setError(`Failed to generate suggestion: ${err.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAcceptSuggestion = async () => {
    if (!aiSuggestion) return;

    try {
      await onSave(attribute.id, aiSuggestion);
      onClose();
      // Reset state
      setUserRequest('');
      setAiSuggestion(null);
      setError(null);
    } catch (err) {
      setError(`Failed to save changes: ${err.message}`);
    }
  };

  const handleClose = () => {
    onClose();
    // Reset state
    setUserRequest('');
    setAiSuggestion(null);
    setError(null);
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-20 mx-auto p-5 border w-11/12 max-w-4xl shadow-lg rounded-md bg-white">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b">
          <div className="flex items-center space-x-2">
            <SparklesIcon className="h-6 w-6 text-blue-600" />
            <h3 className="text-lg font-medium text-gray-900">
              AI-Powered Attribute Editor
            </h3>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        {/* Current Attribute Display */}
        <div className="mt-6">
          <h4 className="text-sm font-medium text-gray-700 mb-3">Current Attribute:</h4>
          <div className="bg-gray-50 rounded-lg p-4">
            <h5 className="font-medium text-gray-900">{attribute.heading}</h5>
            <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Max Points:</span>
                <span className="ml-2 font-medium">{attribute.maxPoints}</span>
              </div>
              <div>
                <span className="text-gray-500">Min to Qualify:</span>
                <span className="ml-2 font-medium">{attribute.minToQualify}</span>
              </div>
              <div>
                <span className="text-gray-500">Penalty:</span>
                <span className="ml-2 font-medium">{attribute.penalty || 0}</span>
              </div>
              <div>
                <span className="text-gray-500">Status:</span>
                <span className={`ml-2 font-medium ${attribute.active ? 'text-green-600' : 'text-gray-600'}`}>
                  {attribute.active ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
            {attribute.instructions && (
              <div className="mt-3">
                <span className="text-gray-500 text-sm">Instructions:</span>
                <p className="text-gray-700 text-sm mt-1">{attribute.instructions}</p>
              </div>
            )}
          </div>
        </div>

        {/* User Input */}
        <div className="mt-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Describe what you want to change:
          </label>
          <textarea
            value={userRequest}
            onChange={(e) => setUserRequest(e.target.value)}
            placeholder="e.g., 'Change the heading to Growth Mindset and increase max points to 20. Add examples about online courses.'"
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            rows={3}
          />
          
          <div className="mt-3 flex justify-between items-center">
            <button
              onClick={handleGenerateAISuggestion}
              disabled={isGenerating || !userRequest.trim()}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isGenerating ? (
                <>
                  <ArrowPathIcon className="animate-spin h-4 w-4 mr-2" />
                  Generating...
                </>
              ) : (
                <>
                  <SparklesIcon className="h-4 w-4 mr-2" />
                  Generate AI Suggestion
                </>
              )}
            </button>
            
            {error && (
              <div className="text-red-600 text-sm">{error}</div>
            )}
          </div>
        </div>

        {/* AI Suggestion Display */}
        {aiSuggestion && (
          <div className="mt-6">
            <h4 className="text-sm font-medium text-gray-700 mb-3">AI Suggestion:</h4>
            <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
              <h5 className="font-medium text-gray-900">{aiSuggestion.heading}</h5>
              <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">Max Points:</span>
                  <span className="ml-2 font-medium">{aiSuggestion.maxPoints}</span>
                </div>
                <div>
                  <span className="text-gray-500">Min to Qualify:</span>
                  <span className="ml-2 font-medium">{aiSuggestion.minToQualify}</span>
                </div>
                <div>
                  <span className="text-gray-500">Penalty:</span>
                  <span className="ml-2 font-medium">{aiSuggestion.penalty || 0}</span>
                </div>
              </div>
              {aiSuggestion.instructionsMarkdown && (
                <div className="mt-3">
                  <span className="text-gray-500 text-sm">Updated Instructions:</span>
                  <p className="text-gray-700 text-sm mt-1">{aiSuggestion.instructionsMarkdown}</p>
                </div>
              )}
            </div>
            
            <div className="mt-4 flex space-x-3">
              <button
                onClick={handleAcceptSuggestion}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
              >
                Accept & Save Changes
              </button>
              <button
                onClick={() => setAiSuggestion(null)}
                className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md shadow-sm text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Try Again
              </button>
            </div>
          </div>
        )}

        {/* Close button if no suggestion */}
        {!aiSuggestion && (
          <div className="mt-6 flex justify-end">
            <button
              onClick={handleClose}
              className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md shadow-sm text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AIEditModal;

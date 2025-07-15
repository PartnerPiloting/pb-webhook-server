"use client";
import React, { useState } from 'react';
import { XMarkIcon, SparklesIcon, ArrowPathIcon, InformationCircleIcon } from '@heroicons/react/24/outline';

const FieldTooltip = ({ title, description, children }) => {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div className="relative">
      <div className="flex items-center space-x-2">
        {children}
        <button
          type="button"
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
          className="text-gray-400 hover:text-gray-600"
        >
          <InformationCircleIcon className="h-4 w-4" />
        </button>
      </div>
      {showTooltip && (
        <div className="absolute z-50 bottom-full left-0 mb-2 w-80 p-3 bg-gray-900 text-white text-sm rounded-lg shadow-lg">
          <div className="font-medium mb-1">{title}</div>
          <div className="text-gray-300">{description}</div>
        </div>
      )}
    </div>
  );
};

const AIEditModal = ({ isOpen, onClose, attribute, onSave }) => {
  const [userRequest, setUserRequest] = useState('');
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [editMode, setEditMode] = useState('ai'); // 'ai' or 'direct'

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

  const renderFieldComparison = (fieldName, currentValue, suggestedValue, tooltip) => {
    const hasChanged = currentValue !== suggestedValue;
    
    return (
      <div className="border-b border-gray-200 py-3">
        <FieldTooltip title={tooltip.title} description={tooltip.description}>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {fieldName}
          </label>
        </FieldTooltip>
        
        <div className="grid grid-cols-2 gap-4">
          {/* Current Value */}
          <div>
            <div className="text-xs text-gray-500 mb-1">Current</div>
            <div className={`p-2 rounded border ${hasChanged ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
              {typeof currentValue === 'boolean' ? (currentValue ? 'Active' : 'Inactive') : (currentValue || 'Not set')}
            </div>
          </div>
          
          {/* Suggested Value */}
          <div>
            <div className="text-xs text-gray-500 mb-1">AI Suggestion</div>
            <div className={`p-2 rounded border ${hasChanged ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
              {typeof suggestedValue === 'boolean' ? (suggestedValue ? 'Active' : 'Inactive') : (suggestedValue || 'Not set')}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const fieldTooltips = {
    heading: {
      title: "Attribute Display Name",
      description: "The human-readable name shown in the scoring interface and reports. Keep it concise and descriptive."
    },
    instructions: {
      title: "Scoring Instructions (Core Rubric)",
      description: "The detailed criteria sent to AI for scoring. Should include clear point ranges (e.g., 0-3 pts = minimal, 4-7 pts = moderate, 8-15 pts = strong). This is the most important field."
    },
    maxPoints: {
      title: "Maximum Points",
      description: "The highest score this attribute can award. Only used for positive attributes. Typically 3-20 points based on importance."
    },
    minToQualify: {
      title: "Minimum to Qualify",
      description: "Threshold score required to pass this attribute. Used for early elimination. Set to 0 if no minimum required."
    },
    penalty: {
      title: "Penalty Points",
      description: "Points deducted when this negative attribute is triggered. Should be 0 for positive attributes, negative for negative attributes (e.g., -5, -10)."
    },
    signals: {
      title: "Detection Keywords",
      description: "Keywords and phrases that help AI identify when this attribute applies. Examples: 'AI, machine learning, startup, founder, side project'"
    },
    examples: {
      title: "Scoring Examples",
      description: "Concrete scenarios showing how points are awarded. Helps AI understand edge cases and nuanced scoring situations."
    },
    active: {
      title: "Attribute Status",
      description: "Whether this attribute is currently used in scoring. Inactive attributes are ignored by the AI scoring system."
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-10 mx-auto p-5 border w-11/12 max-w-5xl shadow-lg rounded-md bg-white max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b">
          <div className="flex items-center space-x-3">
            <SparklesIcon className="h-6 w-6 text-blue-600" />
            <div>
              <h3 className="text-lg font-medium text-gray-900">Edit Attribute</h3>
              <p className="text-sm text-gray-500">"{attribute.heading}"</p>
            </div>
          </div>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600">
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        {/* Mode Selector */}
        <div className="mt-6">
          <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg w-fit">
            <button
              onClick={() => setEditMode('ai')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                editMode === 'ai'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              🤖 AI Assistant
            </button>
            <button
              onClick={() => setEditMode('direct')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                editMode === 'direct'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              ✏️ Direct Edit
            </button>
          </div>
        </div>

        {/* AI Mode */}
        {editMode === 'ai' && !aiSuggestion && (
          <div className="mt-8">
            <h4 className="text-lg font-medium text-gray-900 mb-4">
              What would you like to improve?
            </h4>
            
            {/* Quick Actions */}
            <div className="mb-6">
              <div className="text-sm text-gray-600 mb-3">✨ Popular improvements:</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <button
                  onClick={() => setUserRequest(`Improve the scoring instructions with specific point ranges and clearer criteria.`)}
                  className="p-4 text-left border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-colors"
                >
                  <div className="font-medium text-gray-900">📝 Better Instructions</div>
                  <div className="text-sm text-gray-600">Add point ranges and clearer criteria</div>
                </button>
                <button
                  onClick={() => setUserRequest(`Add concrete examples showing how different profiles would be scored.`)}
                  className="p-4 text-left border border-gray-200 rounded-lg hover:border-green-300 hover:bg-green-50 transition-colors"
                >
                  <div className="font-medium text-gray-900">💡 Add Examples</div>
                  <div className="text-sm text-gray-600">Concrete scoring scenarios</div>
                </button>
                <button
                  onClick={() => setUserRequest(`Expand the detection keywords to help AI better identify this attribute.`)}
                  className="p-4 text-left border border-gray-200 rounded-lg hover:border-purple-300 hover:bg-purple-50 transition-colors"
                >
                  <div className="font-medium text-gray-900">🔍 Better Detection</div>
                  <div className="text-sm text-gray-600">Improve keyword signals</div>
                </button>
                <button
                  onClick={() => setUserRequest(`Review and optimize the overall scoring approach for this attribute.`)}
                  className="p-4 text-left border border-gray-200 rounded-lg hover:border-orange-300 hover:bg-orange-50 transition-colors"
                >
                  <div className="font-medium text-gray-900">⚡ General Improvement</div>
                  <div className="text-sm text-gray-600">Overall optimization</div>
                </button>
              </div>
            </div>

            {/* Custom Request */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Or describe your specific request:
              </label>
              <textarea
                value={userRequest}
                onChange={(e) => setUserRequest(e.target.value)}
                placeholder="e.g., 'Make the instructions more specific for software engineers' or 'Add examples for e-commerce experience'"
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                rows={3}
              />
            </div>

            <div className="mt-6 flex justify-between items-center">
              <button
                onClick={handleGenerateAISuggestion}
                disabled={isGenerating || !userRequest.trim()}
                className="inline-flex items-center px-6 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {isGenerating ? (
                  <>
                    <ArrowPathIcon className="animate-spin h-4 w-4 mr-2" />
                    Generating...
                  </>
                ) : (
                  <>
                    <SparklesIcon className="h-4 w-4 mr-2" />
                    Generate AI Suggestions
                  </>
                )}
              </button>
              
              {error && (
                <div className="text-red-600 text-sm">{error}</div>
              )}
            </div>
          </div>
        )}

        {/* AI Suggestions */}
        {aiSuggestion && (
          <div className="mt-8">
            <h4 className="text-lg font-medium text-gray-900 mb-6 flex items-center">
              <SparklesIcon className="h-5 w-5 mr-2 text-green-600" />
              AI Suggestions
            </h4>
            
            <div className="space-y-6">
              {/* Only show fields that actually changed */}
              {aiSuggestion.instructions !== attribute.instructions && (
                <div className="border border-gray-200 rounded-lg p-4">
                  <h5 className="font-medium text-gray-900 mb-3">Instructions</h5>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs text-gray-500 mb-2">Current</div>
                      <div className="p-3 bg-red-50 border border-red-200 rounded text-sm">
                        {attribute.instructions || 'No instructions set'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 mb-2">AI Suggestion</div>
                      <div className="p-3 bg-green-50 border border-green-200 rounded text-sm">
                        {aiSuggestion.instructions}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Similar pattern for other changed fields */}
              {aiSuggestion.signals !== attribute.signals && (
                <div className="border border-gray-200 rounded-lg p-4">
                  <h5 className="font-medium text-gray-900 mb-3">Detection Keywords</h5>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs text-gray-500 mb-2">Current</div>
                      <div className="p-3 bg-red-50 border border-red-200 rounded text-sm">
                        {attribute.signals || 'No signals set'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 mb-2">AI Suggestion</div>
                      <div className="p-3 bg-green-50 border border-green-200 rounded text-sm">
                        {aiSuggestion.signals}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {aiSuggestion.examples !== attribute.examples && (
                <div className="border border-gray-200 rounded-lg p-4">
                  <h5 className="font-medium text-gray-900 mb-3">Examples</h5>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs text-gray-500 mb-2">Current</div>
                      <div className="p-3 bg-red-50 border border-red-200 rounded text-sm">
                        {attribute.examples || 'No examples set'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 mb-2">AI Suggestion</div>
                      <div className="p-3 bg-green-50 border border-green-200 rounded text-sm">
                        {aiSuggestion.examples}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            
            <div className="mt-8 flex space-x-3">
              <button
                onClick={handleAcceptSuggestion}
                className="inline-flex items-center px-6 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
              >
                Accept & Save Changes
              </button>
              <button
                onClick={() => setAiSuggestion(null)}
                className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md shadow-sm text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Try Different Request
              </button>
            </div>
          </div>
        )}

        {/* Direct Edit Mode */}
        {editMode === 'direct' && (
          <div className="mt-8">
            <h4 className="text-lg font-medium text-gray-900 mb-6">Direct Edit</h4>
            <div className="text-gray-600 mb-6">
              Quick edits for points, thresholds, and status. For complex text changes, use AI Assistant.
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Max Points</label>
                <input
                  type="number"
                  defaultValue={attribute.maxPoints || ''}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Min to Qualify</label>
                <input
                  type="number"
                  defaultValue={attribute.minToQualify || ''}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Penalty</label>
                <input
                  type="number"
                  defaultValue={attribute.penalty || ''}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                <select
                  defaultValue={attribute.active ? 'active' : 'inactive'}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>

            <div className="mt-8">
              <button className="inline-flex items-center px-6 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
                Save Changes
              </button>
            </div>
          </div>
        )}

        {/* Close button */}
        {!aiSuggestion && editMode === 'ai' && (
          <div className="mt-8 flex justify-end">
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

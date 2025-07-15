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
      <div className="relative top-10 mx-auto p-5 border w-11/12 max-w-6xl shadow-lg rounded-md bg-white max-h-[90vh] overflow-y-auto">
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
          <h4 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
            📊 Current Attribute: "{attribute.heading}"
          </h4>
          
          <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 space-y-4 mb-8">
            {/* Basic Info Row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <FieldTooltip title={fieldTooltips.maxPoints.title} description={fieldTooltips.maxPoints.description}>
                  <div className="text-xs text-gray-500 mb-1">Max Points</div>
                </FieldTooltip>
                <div className="font-medium text-gray-900">{attribute.maxPoints || 'Not set'}</div>
              </div>
              <div>
                <FieldTooltip title={fieldTooltips.minToQualify.title} description={fieldTooltips.minToQualify.description}>
                  <div className="text-xs text-gray-500 mb-1">Min to Qualify</div>
                </FieldTooltip>
                <div className="font-medium text-gray-900">{attribute.minToQualify || 'Not set'}</div>
              </div>
              <div>
                <FieldTooltip title={fieldTooltips.penalty.title} description={fieldTooltips.penalty.description}>
                  <div className="text-xs text-gray-500 mb-1">Penalty</div>
                </FieldTooltip>
                <div className="font-medium text-gray-900">{attribute.penalty || '0'}</div>
              </div>
              <div>
                <FieldTooltip title={fieldTooltips.active.title} description={fieldTooltips.active.description}>
                  <div className="text-xs text-gray-500 mb-1">Status</div>
                </FieldTooltip>
                <div className={`font-medium ${attribute.active ? 'text-green-600' : 'text-gray-600'}`}>
                  {attribute.active ? 'Active' : 'Inactive'}
                </div>
              </div>
            </div>

            {/* Instructions */}
            {attribute.instructions && (
              <div>
                <FieldTooltip title={fieldTooltips.instructions.title} description={fieldTooltips.instructions.description}>
                  <div className="text-xs text-gray-500 mb-1">Current Instructions (Core Rubric)</div>
                </FieldTooltip>
                <div className="text-gray-700 text-sm bg-white p-3 rounded border">
                  {attribute.instructions}
                </div>
              </div>
            )}

            {/* Signals */}
            {attribute.signals && (
              <div>
                <FieldTooltip title={fieldTooltips.signals.title} description={fieldTooltips.signals.description}>
                  <div className="text-xs text-gray-500 mb-1">Detection Keywords</div>
                </FieldTooltip>
                <div className="text-gray-700 text-sm bg-white p-3 rounded border">
                  {attribute.signals}
                </div>
              </div>
            )}

            {/* Examples */}
            {attribute.examples && (
              <div>
                <FieldTooltip title={fieldTooltips.examples.title} description={fieldTooltips.examples.description}>
                  <div className="text-xs text-gray-500 mb-1">Scoring Examples</div>
                </FieldTooltip>
                <div className="text-gray-700 text-sm bg-white p-3 rounded border">
                  {attribute.examples}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* User Input Section */}
        <div className="mt-6">
          <FieldTooltip 
            title="Describe Your Changes" 
            description="Use natural language to describe what you want to improve. Examples: 'Add scoring examples for online courses', 'Increase max points to 20', 'Make the instructions more specific'"
          >
            <label className="block text-sm font-medium text-gray-700 mb-2">
              What would you like to improve about this attribute?
            </label>
          </FieldTooltip>
          
          <textarea
            value={userRequest}
            onChange={(e) => setUserRequest(e.target.value)}
            placeholder="e.g., 'Make the instructions more specific by adding scoring ranges. Add examples about online courses and certifications. Increase max points to 20.'"
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            rows={4}
          />
          
          {/* Quick Edit Suggestions */}
          <div className="mt-3 mb-4">
            <div className="text-xs text-gray-500 mb-2">💡 Common requests you can make:</div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setUserRequest(`Make the current instructions more specific with clear point ranges.

CURRENT INSTRUCTIONS:
${attribute.instructions || 'No instructions set'}

Please improve these by adding specific point ranges (e.g., 0-3 pts = minimal, 4-7 pts = moderate, 8-15 pts = strong).`)}
                className="px-3 py-1 text-xs bg-blue-50 text-blue-700 rounded-full hover:bg-blue-100 border border-blue-200"
              >
                Improve instructions
              </button>
              <button
                type="button"
                onClick={() => setUserRequest(`Add specific examples and scenarios for scoring this attribute.

CURRENT EXAMPLES:
${attribute.examples || 'No examples set'}

Please add concrete examples showing how different profiles would be scored for this attribute.`)}
                className="px-3 py-1 text-xs bg-green-50 text-green-700 rounded-full hover:bg-green-100 border border-green-200"
              >
                Add examples
              </button>
              <button
                type="button"
                onClick={() => setUserRequest(`Add more detection keywords and signals to help AI identify this attribute.

CURRENT SIGNALS:
${attribute.signals || 'No signals set'}

Please expand these keywords to help AI better detect when this attribute applies.`)}
                className="px-3 py-1 text-xs bg-purple-50 text-purple-700 rounded-full hover:bg-purple-100 border border-purple-200"
              >
                Improve signals
              </button>
              <button
                type="button"
                onClick={() => setUserRequest(`Adjust the scoring points for this attribute.

CURRENT SETTINGS:
- Max Points: ${attribute.maxPoints || 'Not set'}
- Min to Qualify: ${attribute.minToQualify || 'Not set'}
- Penalty: ${attribute.penalty || '0'}

Please suggest appropriate changes to make this attribute more/less important in scoring.`)}
                className="px-3 py-1 text-xs bg-orange-50 text-orange-700 rounded-full hover:bg-orange-100 border border-orange-200"
              >
                Adjust points
              </button>
            </div>
          </div>
          
          <div className="mt-3 flex justify-between items-center">
            <button
              onClick={handleGenerateAISuggestion}
              disabled={isGenerating || !userRequest.trim()}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isGenerating ? (
                <>
                  <ArrowPathIcon className="animate-spin h-4 w-4 mr-2" />
                  Generating Suggestions...
                </>
              ) : (
                <>
                  <SparklesIcon className="h-4 w-4 mr-2" />
                  Generate AI Suggestions
                </>
              )}
            </button>
            
            {error && (
              <div className="text-red-600 text-sm max-w-md">{error}</div>
            )}
          </div>
        </div>

        {/* AI Suggestions Display */}
        {aiSuggestion && (
          <div className="mt-8">
            <h4 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
              <SparklesIcon className="h-5 w-5 mr-2 text-green-600" />
              AI Suggestions for "{attribute.heading}"
            </h4>
            
            <div className="bg-blue-50 rounded-lg p-4 border border-blue-200 space-y-4">
              {renderFieldComparison("Heading", attribute.heading, aiSuggestion.heading, fieldTooltips.heading)}
              {renderFieldComparison("Instructions", attribute.instructions, aiSuggestion.instructions, fieldTooltips.instructions)}
              {renderFieldComparison("Max Points", attribute.maxPoints, aiSuggestion.maxPoints, fieldTooltips.maxPoints)}
              {renderFieldComparison("Min To Qualify", attribute.minToQualify, aiSuggestion.minToQualify, fieldTooltips.minToQualify)}
              {renderFieldComparison("Penalty", attribute.penalty, aiSuggestion.penalty, fieldTooltips.penalty)}
              {renderFieldComparison("Signals", attribute.signals, aiSuggestion.signals, fieldTooltips.signals)}
              {renderFieldComparison("Examples", attribute.examples, aiSuggestion.examples, fieldTooltips.examples)}
              {renderFieldComparison("Status", attribute.active, aiSuggestion.active, fieldTooltips.active)}
            </div>
            
            <div className="mt-6 flex space-x-3">
              <button
                onClick={handleAcceptSuggestion}
                className="inline-flex items-center px-6 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
              >
                Accept All Changes & Save
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

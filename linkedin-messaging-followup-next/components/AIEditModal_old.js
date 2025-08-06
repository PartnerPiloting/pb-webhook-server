"use client";
import React, { useState, useEffect } from 'react';
import { XMarkIcon, SparklesIcon, ArrowPathIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import { getCurrentClientId } from '../utils/clientUtils';

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
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showAIPrompt, setShowAIPrompt] = useState(false);
  const [userRequest, setUserRequest] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Proposed changes form state (starts as copy of current)
  const [proposedForm, setProposedForm] = useState({
    heading: '',
    instructions: '',
    maxPoints: '',
    minToQualify: '',
    penalty: '',
    signals: '',
    examples: '',
    disqualifying: '',
    active: true
  });

  // Helper function to clean and format text for display only
  const formatTextForDisplay = (text) => {
    if (!text) return 'Not set';
    
    return text
      .replace(/\\n/g, '\n')  // Convert \n to actual line breaks
      .replace(/\*\*(.*?)\*\*/g, '$1')  // Remove markdown bold
      .replace(/\*(.*?)\*/g, '$1')  // Remove markdown italic
      .trim();
  };

  // Helper function to get raw text for editing (no "Not set" replacement)
  const getRawTextForEditing = (text) => {
    if (!text) return '';
    
    return text
      .replace(/\\n/g, '\n')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .trim();
  };

  // Helper function to validate scoring ranges against maxPoints
  const validateScoringRanges = (instructions, maxPoints) => {
    if (!instructions || !maxPoints) return true;
    
    // Look for point ranges in the format "X-Y pts" or "X pts"
    const rangeMatches = instructions.match(/(\d+)[-–]?(\d+)?\s*pts?/gi);
    if (!rangeMatches) return true;
    
    const highestRange = Math.max(...rangeMatches.map(match => {
      const nums = match.match(/\d+/g);
      return Math.max(...nums.map(Number));
    }));
    
    return highestRange <= maxPoints;
  };

  // Initialize proposed form when attribute changes
  useEffect(() => {
    if (attribute) {
      setProposedForm({
        heading: attribute.heading || '',
        instructions: getRawTextForEditing(attribute.instructions),
        maxPoints: attribute.maxPoints || '',
        minToQualify: attribute.minToQualify || '',
        penalty: attribute.penalty || '',
        signals: getRawTextForEditing(attribute.signals),
        examples: getRawTextForEditing(attribute.examples),
        disqualifying: attribute.disqualifying || '',
        active: attribute.active !== false
      });
    }
  }, [attribute]);

  // Handle save proposed changes
  const handleSaveChanges = async () => {
    setIsSaving(true);
    setError(null);

    try {
      // Validation
      if (!proposedForm.heading.trim()) {
        throw new Error('Attribute name is required');
      }
      
      if (proposedForm.maxPoints && proposedForm.minToQualify) {
        if (Number(proposedForm.maxPoints) < Number(proposedForm.minToQualify)) {
          throw new Error('Max points must be greater than min to qualify');
        }
      }

      // Clean up the data
      const cleanedData = {
        ...proposedForm,
        maxPoints: proposedForm.maxPoints ? Number(proposedForm.maxPoints) : null,
        minToQualify: proposedForm.minToQualify ? Number(proposedForm.minToQualify) : null,
        penalty: proposedForm.penalty ? Number(proposedForm.penalty) : null,
        // Remove any remaining markdown formatting before saving
        instructions: proposedForm.instructions.replace(/\*/g, ''),
        signals: proposedForm.signals.replace(/\*/g, ''),
        examples: proposedForm.examples.replace(/\*/g, '')
      };

      await onSave(attribute.id, cleanedData);
      handleClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  // Update proposed form field handler
  const updateProposedField = (field, value) => {
    setProposedForm(prev => ({
      ...prev,
      [field]: value
    }));
  };

  // Handle AI assistance
  const handleAIAssist = async () => {
    if (!userRequest.trim()) {
      setError('Please describe what you want to improve');
      return;
    }

    setIsGenerating(true);
    setError(null);
    
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/attributes/${attribute.id}/ai-edit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-client-id': getCurrentClientId(),
        },
        body: JSON.stringify({
          userRequest: userRequest.trim()
        })
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }

      const result = await response.json();
      
      // Apply AI suggestions to proposed form
      if (result.suggestion) {
        setProposedForm(prev => ({
          ...prev,
          ...result.suggestion
        }));
      }
      
      setShowAIPrompt(false);
      setUserRequest('');
    } catch (err) {
      console.error('Error generating AI suggestion:', err);
      setError(`Failed to generate suggestion: ${err.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleClose = () => {
    onClose();
    // Reset state
    setUserRequest('');
    setError(null);
    setShowAIPrompt(false);
    setIsSaving(false);
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
        <div className="flex items-center justify-between pb-6 border-b">
          <div className="flex items-center space-x-4">
            <SparklesIcon className="h-8 w-8 text-blue-600" />
            <div>
              <h3 className="text-xl font-semibold text-gray-900">Edit Attribute</h3>
              <div className="mt-1 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-lg font-medium text-blue-900">"{attribute.heading}"</p>
                <p className="text-sm text-blue-700 mt-1">
                  Max: {attribute.maxPoints || 'Not set'} pts • 
                  Status: {attribute.active ? 'Active' : 'Inactive'}
                </p>
              </div>
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
        {editMode === 'ai' && !aiSuggestion && !isGenerating && (
          <div className="mt-8">
            <h4 className="text-lg font-medium text-gray-900 mb-4">
              What would you like to improve?
            </h4>
            
            {/* Quick Actions */}
            <div className="mb-6">
              <div className="text-sm text-gray-600 mb-4">Choose an improvement to get instant AI suggestions:</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <button
                  onClick={() => handleQuickAction('instructions', `Improve the scoring instructions with specific point ranges and clearer criteria. The maximum points available is ${attribute.maxPoints || 'not set'} points. Format the instructions with clear point ranges (e.g., "0-3 pts = minimal, 4-7 pts = moderate, 8-${attribute.maxPoints || 15} pts = strong") and use proper line breaks without markdown formatting.`)}
                  className="p-5 text-left border border-gray-200 rounded-xl hover:border-blue-300 hover:bg-blue-50 hover:shadow-md transition-all duration-200"
                >
                  <div className="font-semibold text-gray-900 text-lg mb-2">📝 Instructions for AI scoring</div>
                  <div className="text-sm text-gray-600">Add point ranges and clearer criteria for more consistent scoring</div>
                </button>
                <button
                  onClick={() => handleQuickAction('examples', 'Add concrete examples showing how different profiles would be scored. Include specific point awards that align with the scoring ranges. Use clear, readable formatting without markdown.')}
                  className="p-5 text-left border border-gray-200 rounded-xl hover:border-green-300 hover:bg-green-50 hover:shadow-md transition-all duration-200"
                >
                  <div className="font-semibold text-gray-900 text-lg mb-2">💡 Add Examples</div>
                  <div className="text-sm text-gray-600">Concrete scoring scenarios to guide AI decisions</div>
                </button>
                <button
                  onClick={() => handleQuickAction('signals', 'Expand the detection keywords to help AI better identify this attribute. Provide a clean list of comma-separated keywords without markdown formatting.')}
                  className="p-5 text-left border border-gray-200 rounded-xl hover:border-purple-300 hover:bg-purple-50 hover:shadow-md transition-all duration-200"
                >
                  <div className="font-semibold text-gray-900 text-lg mb-2">🔍 Keyword Signals</div>
                  <div className="text-sm text-gray-600">Improve keyword signals for more accurate identification</div>
                </button>
              </div>
            </div>

            {/* Custom Request - Initially Hidden */}
            <details className="mt-6">
              <summary className="cursor-pointer text-blue-600 hover:text-blue-800 font-medium">
                ✏️ Or write a custom request
              </summary>
              <div className="mt-4 p-4 border border-gray-200 rounded-lg">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Describe your specific request:
                </label>
                <textarea
                  value={userRequest}
                  onChange={(e) => setUserRequest(e.target.value)}
                  placeholder="e.g., 'Make the instructions more specific for software engineers' or 'Add examples for e-commerce experience'"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  rows={3}
                />
                <div className="mt-3">
                  <button
                    onClick={handleGenerateAISuggestion}
                    disabled={isGenerating || !userRequest.trim()}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    <SparklesIcon className="h-4 w-4 mr-2" />
                    Generate Custom Suggestions
                  </button>
                </div>
              </div>
            </details>

            {/* Error Display */}
            {error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
                <div className="text-red-800 text-sm">{error}</div>
              </div>
            )}
          </div>
        )}

        {/* Loading State */}
        {isGenerating && (
          <div className="mt-8 text-center py-12">
            <ArrowPathIcon className="animate-spin h-8 w-8 mx-auto text-blue-600 mb-4" />
            <h4 className="text-lg font-medium text-gray-900 mb-2">
              {quickActionMode ? 'Analyzing current content...' : 'Generating AI suggestions...'}
            </h4>
            <p className="text-gray-600">
              {quickActionMode ? 'Preparing comparison view' : 'This may take a few seconds'}
            </p>
          </div>
        )}

        {/* AI Suggestions */}
        {aiSuggestion && (
          <div className="mt-8">
            <div className="flex items-center justify-between mb-6">
              <h4 className="text-lg font-medium text-gray-900 flex items-center">
                <SparklesIcon className="h-5 w-5 mr-2 text-green-600" />
                AI Suggestions
              </h4>
              {quickActionMode && (
                <div className="text-sm text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
                  {quickActionMode === 'instructions' && '📝 Instructions for AI scoring'}
                  {quickActionMode === 'examples' && '💡 Add Examples'}
                  {quickActionMode === 'signals' && '🔍 Keyword Signals'}
                </div>
              )}
            </div>
            
            <div className="space-y-6">
              {/* Only show fields that actually changed */}
              {aiSuggestion.heading !== attribute.heading && (
                <div className="border border-gray-200 rounded-lg p-4">
                  <h5 className="font-medium text-gray-900 mb-3">Attribute Name</h5>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs text-gray-500 mb-2">Current</div>
                      <div className="p-3 bg-red-50 border border-red-200 rounded text-sm">
                        {attribute.heading || 'No name set'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 mb-2">AI Suggestion</div>
                      <div className="p-3 bg-green-50 border border-green-200 rounded text-sm">
                        {aiSuggestion.heading}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {aiSuggestion.instructions !== attribute.instructions && (
                <div className="border border-gray-200 rounded-lg p-4">
                  <h5 className="font-medium text-gray-900 mb-3">Instructions for AI Scoring</h5>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs text-gray-500 mb-2">Current</div>
                      <div className="p-3 bg-red-50 border border-red-200 rounded text-sm whitespace-pre-wrap">
                        {formatTextForDisplay(attribute.instructions)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 mb-2">AI Suggestion</div>
                      <div className="p-3 bg-green-50 border border-green-200 rounded text-sm whitespace-pre-wrap">
                        {formatTextForDisplay(aiSuggestion.instructions)}
                      </div>
                      {/* Validation warning */}
                      {!validateScoringRanges(aiSuggestion.instructions, aiSuggestion.maxPoints || attribute.maxPoints) && (
                        <div className="mt-2 text-xs text-orange-600 bg-orange-50 p-2 rounded">
                          ⚠️ Warning: Scoring ranges may exceed max points ({aiSuggestion.maxPoints || attribute.maxPoints})
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {aiSuggestion.maxPoints !== attribute.maxPoints && (
                <div className="border border-gray-200 rounded-lg p-4">
                  <h5 className="font-medium text-gray-900 mb-3">Maximum Points</h5>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs text-gray-500 mb-2">Current</div>
                      <div className="p-3 bg-red-50 border border-red-200 rounded text-sm">
                        {attribute.maxPoints || 'Not set'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 mb-2">AI Suggestion</div>
                      <div className="p-3 bg-green-50 border border-green-200 rounded text-sm">
                        {aiSuggestion.maxPoints}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {aiSuggestion.minToQualify !== attribute.minToQualify && (
                <div className="border border-gray-200 rounded-lg p-4">
                  <h5 className="font-medium text-gray-900 mb-3">Minimum to Qualify</h5>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs text-gray-500 mb-2">Current</div>
                      <div className="p-3 bg-red-50 border border-red-200 rounded text-sm">
                        {attribute.minToQualify || 'Not set'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 mb-2">AI Suggestion</div>
                      <div className="p-3 bg-green-50 border border-green-200 rounded text-sm">
                        {aiSuggestion.minToQualify}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {aiSuggestion.penalty !== attribute.penalty && (
                <div className="border border-gray-200 rounded-lg p-4">
                  <h5 className="font-medium text-gray-900 mb-3">Penalty Points</h5>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs text-gray-500 mb-2">Current</div>
                      <div className="p-3 bg-red-50 border border-red-200 rounded text-sm">
                        {attribute.penalty || 'Not set'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 mb-2">AI Suggestion</div>
                      <div className="p-3 bg-green-50 border border-green-200 rounded text-sm">
                        {aiSuggestion.penalty}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {aiSuggestion.signals !== attribute.signals && (
                <div className="border border-gray-200 rounded-lg p-4">
                  <h5 className="font-medium text-gray-900 mb-3">Detection Keywords</h5>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs text-gray-500 mb-2">Current</div>
                      <div className="p-3 bg-red-50 border border-red-200 rounded text-sm whitespace-pre-wrap">
                        {formatTextForDisplay(attribute.signals)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 mb-2">AI Suggestion</div>
                      <div className="p-3 bg-green-50 border border-green-200 rounded text-sm whitespace-pre-wrap">
                        {formatTextForDisplay(aiSuggestion.signals)}
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
                      <div className="p-3 bg-red-50 border border-red-200 rounded text-sm whitespace-pre-wrap">
                        {formatTextForDisplay(attribute.examples)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 mb-2">AI Suggestion</div>
                      <div className="p-3 bg-green-50 border border-green-200 rounded text-sm whitespace-pre-wrap">
                        {formatTextForDisplay(aiSuggestion.examples)}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {aiSuggestion.disqualifying !== attribute.disqualifying && (
                <div className="border border-gray-200 rounded-lg p-4">
                  <h5 className="font-medium text-gray-900 mb-3">Disqualifying Criteria</h5>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs text-gray-500 mb-2">Current</div>
                      <div className="p-3 bg-red-50 border border-red-200 rounded text-sm">
                        {attribute.disqualifying || 'No disqualifying criteria set'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 mb-2">AI Suggestion</div>
                      <div className="p-3 bg-green-50 border border-green-200 rounded text-sm">
                        {aiSuggestion.disqualifying}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {aiSuggestion.active !== attribute.active && (
                <div className="border border-gray-200 rounded-lg p-4">
                  <h5 className="font-medium text-gray-900 mb-3">Status</h5>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs text-gray-500 mb-2">Current</div>
                      <div className="p-3 bg-red-50 border border-red-200 rounded text-sm">
                        {attribute.active ? 'Active' : 'Inactive'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 mb-2">AI Suggestion</div>
                      <div className="p-3 bg-green-50 border border-green-200 rounded text-sm">
                        {aiSuggestion.active ? 'Active' : 'Inactive'}
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
                onClick={() => {
                  setAiSuggestion(null);
                  setQuickActionMode(null);
                  setUserRequest('');
                }}
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
              Quick edits for all attribute fields. For AI-powered improvements, use AI Assistant mode.
            </div>
            
            <div className="space-y-6">
              {/* Attribute Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Attribute Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={directEditForm.heading}
                  onChange={(e) => updateDirectEditField('heading', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="e.g., Software Development Experience"
                  required
                />
              </div>

              {/* Instructions */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Instructions for AI Scoring</label>
                <div className="mb-2 text-xs text-gray-600">
                  Max points: {directEditForm.maxPoints || 'Not set'} - Ensure scoring ranges don't exceed this limit
                </div>
                <textarea
                  value={directEditForm.instructions}
                  onChange={(e) => updateDirectEditField('instructions', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  rows={6}
                  placeholder={`Detailed scoring criteria with point ranges:

0-${Math.floor((directEditForm.maxPoints || 15) * 0.2)} pts = Minimal/No evidence
${Math.floor((directEditForm.maxPoints || 15) * 0.2) + 1}-${Math.floor((directEditForm.maxPoints || 15) * 0.6)} pts = Some evidence  
${Math.floor((directEditForm.maxPoints || 15) * 0.6) + 1}-${directEditForm.maxPoints || 15} pts = Strong evidence

Describe specific criteria for each range...`}
                />
              </div>

              {/* Points and Thresholds */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Max Points</label>
                  <input
                    type="number"
                    value={directEditForm.maxPoints}
                    onChange={(e) => updateDirectEditField('maxPoints', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    placeholder="e.g., 15"
                    min="0"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Min to Qualify</label>
                  <input
                    type="number"
                    value={directEditForm.minToQualify}
                    onChange={(e) => updateDirectEditField('minToQualify', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    placeholder="e.g., 3"
                    min="0"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Penalty Points</label>
                  <input
                    type="number"
                    value={directEditForm.penalty}
                    onChange={(e) => updateDirectEditField('penalty', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    placeholder="e.g., -5"
                    max="0"
                  />
                </div>
                {/* Validation warnings */}
                {directEditForm.maxPoints && directEditForm.minToQualify && 
                 Number(directEditForm.maxPoints) < Number(directEditForm.minToQualify) && (
                  <div className="text-xs text-red-600 bg-red-50 p-2 rounded">
                    ⚠️ Max points must be greater than min to qualify
                  </div>
                )}
              </div>

              {/* Keywords and Examples */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Detection Keywords</label>
                  <textarea
                    value={directEditForm.signals}
                    onChange={(e) => updateDirectEditField('signals', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    rows={3}
                    placeholder="software, programming, coding, developer..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Examples</label>
                  <textarea
                    value={directEditForm.examples}
                    onChange={(e) => updateDirectEditField('examples', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    rows={3}
                    placeholder="Concrete scoring scenarios..."
                  />
                </div>
              </div>

              {/* Disqualifying Criteria */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Disqualifying Criteria</label>
                <textarea
                  value={directEditForm.disqualifying}
                  onChange={(e) => updateDirectEditField('disqualifying', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  rows={2}
                  placeholder="Criteria that would disqualify a candidate..."
                />
              </div>

              {/* Status */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                <select
                  value={directEditForm.active ? 'active' : 'inactive'}
                  onChange={(e) => updateDirectEditField('active', e.target.value === 'active')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>

            <div className="mt-8 flex space-x-3">
              <button 
                onClick={handleDirectEditSave}
                disabled={isSaving}
                className="inline-flex items-center px-6 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {isSaving ? (
                  <>
                    <ArrowPathIcon className="animate-spin h-4 w-4 mr-2" />
                    Saving...
                  </>
                ) : (
                  'Save Changes'
                )}
              </button>
              <button
                onClick={handleClose}
                disabled={isSaving}
                className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md shadow-sm text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Close button */}
        {!aiSuggestion && !isGenerating && editMode === 'ai' && (
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

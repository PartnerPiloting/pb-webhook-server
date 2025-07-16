"use client";
import React, { useState, useEffect } from 'react';
import { XMarkIcon, SparklesIcon, ArrowPathIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import { getAISuggestions } from '../services/api';

const FieldAIHelper = ({ field, isOpen, onToggle, currentValue, onAIAssist, isGenerating, userRequest, onRequestChange, history, guidanceText }) => {
  if (!isOpen) {
    return (
      <div className="flex justify-center mt-2">
        <button
          onClick={onToggle}
          className="inline-flex items-center px-3 py-1 text-xs font-medium text-purple-600 bg-purple-50 border border-purple-200 rounded-full hover:bg-purple-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
        >
          <SparklesIcon className="h-3 w-3 mr-1" />
          Get AI Help
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <SparklesIcon className="h-4 w-4 text-purple-600" />
          <span className="text-sm font-medium text-purple-900">AI Helper</span>
        </div>
        <button
          onClick={onToggle}
          className="text-xs text-purple-600 hover:text-purple-800"
        >
          Hide
        </button>
      </div>
      
      <div className="mb-3 p-2 bg-blue-100 border border-blue-200 rounded text-xs text-blue-800">
        {guidanceText}
      </div>
      
      {/* Current Value Display */}
      <div className="mb-3 p-2 bg-gray-50 border border-gray-200 rounded">
        <div className="text-xs font-medium text-gray-700 mb-1">Current Value:</div>
        <div className="text-sm text-gray-900">{currentValue || 'Not set'}</div>
      </div>
      
      {/* Chat History */}
      {history && history.length > 0 && (
        <div className="mb-3 max-h-32 overflow-y-auto space-y-2 p-2 bg-white border border-gray-200 rounded">
          {history.map((msg, index) => (
            <div key={index} className={`text-xs ${msg.type === 'user' ? 'text-purple-800' : 'text-gray-700'}`}>
              <div className="flex items-center space-x-1 mb-1">
                <strong>{msg.type === 'user' ? 'You' : 'AI'}:</strong>
                <span className="text-gray-500">
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <div className="whitespace-pre-wrap">{msg.message}</div>
            </div>
          ))}
        </div>
      )}
      
      {/* AI Input */}
      <div>
        <textarea
          value={userRequest || ''}
          onChange={(e) => onRequestChange(e.target.value)}
          placeholder={`How would you like to improve this ${field}?`}
          className="w-full h-16 px-2 py-1 text-sm border border-purple-300 rounded focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
        <div className="flex justify-end mt-2">
          <button
            onClick={onAIAssist}
            disabled={isGenerating || !userRequest?.trim()}
            className="inline-flex items-center px-3 py-1 text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 rounded disabled:opacity-50"
          >
            {isGenerating ? (
              <>
                <ArrowPathIcon className="h-3 w-3 mr-1 animate-spin" />
                Thinking...
              </>
            ) : (
              <>
                <SparklesIcon className="h-3 w-3 mr-1" />
                Ask AI
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
const FieldTooltip = ({ title, description, children }) => {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div className="relative">
      <div className="flex items-center space-x-2">
        {children}
        <button
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
          className="text-gray-400 hover:text-gray-600"
        >
          <InformationCircleIcon className="h-4 w-4" />
        </button>
      </div>
      
      {showTooltip && (
        <div className="absolute z-10 w-64 p-2 mt-1 text-sm bg-gray-900 text-white rounded-lg shadow-lg">
          <div className="font-medium">{title}</div>
          <div className="text-gray-300 text-xs mt-1">{description}</div>
        </div>
      )}
    </div>
  );
};
  console.log('AIEditModal: Component rendered, isOpen:', isOpen, 'attribute:', attribute);
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [fieldAIHelpers, setFieldAIHelpers] = useState({}); // Track AI helper state per field
  const [fieldAIRequests, setFieldAIRequests] = useState({}); // Track AI requests per field
  const [fieldAIGenerating, setFieldAIGenerating] = useState({}); // Track AI generation per field
  const [fieldAIHistory, setFieldAIHistory] = useState({}); // Track AI history per field
  const [focusedField, setFocusedField] = useState(null);
  
  // Form state for current values
  const [formData, setFormData] = useState({
    heading: '',
    maxPoints: '',
    instructions: '',
    minToQualify: '',
    signals: '',
    examples: '',
    active: true
  });

  // Track which fields have pending changes
  const [pendingChanges, setPendingChanges] = useState({});

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

  // Initialize form when attribute changes
  useEffect(() => {
    if (attribute) {
      console.log('AIEditModal: Initializing with attribute:', attribute);
      console.log('AIEditModal: attribute.instructions raw:', attribute.instructions);
      console.log('AIEditModal: getRawTextForEditing result:', getRawTextForEditing(attribute.instructions));
      
      setFormData({
        heading: attribute.heading || '',
        maxPoints: attribute.maxPoints || '',
        instructions: getRawTextForEditing(attribute.instructions),
        minToQualify: attribute.minToQualify || '',
        signals: getRawTextForEditing(attribute.signals),
        examples: getRawTextForEditing(attribute.examples),
        active: attribute.active !== false
      });
      setPendingChanges({});
      
      // Initialize chat with current values summary
      const currentValues = [];
      if (attribute.heading) currentValues.push(`**Attribute Name:** ${attribute.heading}`);
      if (attribute.maxPoints) currentValues.push(`**Max Points:** ${attribute.maxPoints}`);
      if (attribute.instructions) currentValues.push(`**Instructions:** ${formatTextForDisplay(attribute.instructions)}`);
      if (attribute.minToQualify) currentValues.push(`**Min to Qualify:** ${attribute.minToQualify}`);
      if (attribute.signals) currentValues.push(`**Detection Keywords:** ${formatTextForDisplay(attribute.signals)}`);
      if (attribute.examples) currentValues.push(`**Examples:** ${formatTextForDisplay(attribute.examples)}`);
      currentValues.push(`**Status:** ${attribute.active ? 'Active' : 'Inactive'}`);
      
  // Initialize field AI helpers
  useEffect(() => {
    if (attribute) {
      const fieldHelpers = {};
      const fieldHistory = {};
      
      // Initialize AI helpers for each field
      const fields = ['heading', 'maxPoints', 'instructions', 'minToQualify', 'signals', 'examples', 'active'];
      fields.forEach(field => {
        fieldHelpers[field] = false; // Start collapsed
        fieldHistory[field] = []; // Empty history
      });
      
      setFieldAIHelpers(fieldHelpers);
      setFieldAIHistory(fieldHistory);
      setFieldAIRequests({});
      setFieldAIGenerating({});
    }
  }, [attribute]);

  // Toggle AI helper for specific field
  const toggleFieldAIHelper = (field) => {
    setFieldAIHelpers(prev => ({
      ...prev,
      [field]: !prev[field]
    }));
  };

  // Update field AI request
  const updateFieldAIRequest = (field, value) => {
    setFieldAIRequests(prev => ({
      ...prev,
      [field]: value
    }));
  };

  // Handle field-specific AI assistance
  const handleFieldAIAssist = async (field) => {
    const request = fieldAIRequests[field];
    if (!request || !request.trim()) {
      setError(`Please describe what you need help with for ${field}`);
      return;
    }

    setFieldAIGenerating(prev => ({ ...prev, [field]: true }));
    setError(null);
    
    try {
      // Build field-specific context
      const fieldContext = {
        heading: `Here's your current Attribute Name: "${formData.heading || 'Not set'}"`,
        maxPoints: `Here's your current Max Points: ${formData.maxPoints || 'Not set'}`,
        instructions: `Here's your current Instructions: "${formData.instructions || 'Not set'}"`,
        minToQualify: `Here's your current Min to Qualify: ${formData.minToQualify || 'Not set'}`,
        signals: `Here's your current Detection Keywords: "${formData.signals || 'Not set'}"`,
        examples: `Here's your current Examples: "${formData.examples || 'Not set'}"`,
        active: `Here's your current Status: ${formData.active ? 'Active' : 'Inactive'}`
      };

      const fieldPrompt = `${fieldContext[field]}\n\nUser request: ${request.trim()}`;
      const result = await getAISuggestions(attribute.id, fieldPrompt);
      
      // Add to field-specific chat history
      setFieldAIHistory(prev => ({
        ...prev,
        [field]: [...(prev[field] || []), {
          type: 'user',
          message: request.trim(),
          timestamp: new Date().toISOString()
        }, {
          type: 'ai',
          message: result.response || 'Suggestions applied to form',
          timestamp: new Date().toISOString()
        }]
      }));
      
      // Apply AI suggestions to form (only the relevant field)
      if (result.suggestion) {
        if (field in result.suggestion) {
          setFormData(prev => ({
            ...prev,
            [field]: result.suggestion[field]
          }));
        } else {
          // Apply all suggestions if field-specific not available
          setFormData(prev => ({
            ...prev,
            ...result.suggestion
          }));
        }
      }
      
      // Clear the field request
      setFieldAIRequests(prev => ({
        ...prev,
        [field]: ''
      }));
      
    } catch (err) {
      console.error(`Error generating AI suggestion for ${field}:`, err);
      setError(`Failed to generate suggestion for ${field}: ${err.message}`);
    } finally {
      setFieldAIGenerating(prev => ({ ...prev, [field]: false }));
    }
  };
    }
  }, [attribute]);

  // Update field value
  const updateField = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  // Mark field as ready to save
  const markFieldReady = (field) => {
    setPendingChanges(prev => ({
      ...prev,
      [field]: true
    }));
  };

  // Revert field to original value
  const revertField = (field) => {
    const originalValue = field === 'heading' ? (attribute.heading || '') :
                         field === 'maxPoints' ? (attribute.maxPoints || '') :
                         field === 'instructions' ? getRawTextForEditing(attribute.instructions) :
                         field === 'minToQualify' ? (attribute.minToQualify || '') :
                         field === 'signals' ? getRawTextForEditing(attribute.signals) :
                         field === 'examples' ? getRawTextForEditing(attribute.examples) :
                         field === 'active' ? (attribute.active !== false) : '';
    
    setFormData(prev => ({
      ...prev,
      [field]: originalValue
    }));
    setPendingChanges(prev => {
      const newChanges = { ...prev };
      delete newChanges[field];
      return newChanges;
    });
  };

  // Check if field value changed from original
  const isFieldChanged = (field) => {
    const originalValue = field === 'heading' ? (attribute.heading || '') :
                         field === 'maxPoints' ? (attribute.maxPoints || '') :
                         field === 'instructions' ? getRawTextForEditing(attribute.instructions) :
                         field === 'minToQualify' ? (attribute.minToQualify || '') :
                         field === 'signals' ? getRawTextForEditing(attribute.signals) :
                         field === 'examples' ? getRawTextForEditing(attribute.examples) :
                         field === 'active' ? (attribute.active !== false) : '';
    
    return formData[field] !== originalValue;
  };

  // Check if field has validation errors
  const getFieldError = (field) => {
    if (field === 'heading' && !formData.heading.trim()) {
      return 'Required';
    }
    if (field === 'maxPoints' && formData.maxPoints && formData.minToQualify) {
      if (Number(formData.maxPoints) < Number(formData.minToQualify)) {
        return 'Must be ≥ min to qualify';
      }
    }
    if (field === 'minToQualify' && formData.maxPoints && formData.minToQualify) {
      if (Number(formData.maxPoints) < Number(formData.minToQualify)) {
        return 'Must be ≤ max points';
      }
    }
    if (field === 'instructions' && formData.instructions && formData.maxPoints) {
      if (!validateScoringRanges(formData.instructions, formData.maxPoints)) {
        return 'Point ranges exceed max points';
      }
    }
    return null;
  };

  // Get field-specific AI guidance
  const getFieldAIGuidance = (field) => {
    const guidanceMap = {
      heading: "I can help you create a clear, descriptive name for this attribute. Tell me what you'd like to change or improve.",
      maxPoints: "I can help you set appropriate point values based on the attribute's importance. What scoring range are you considering?",
      instructions: "I can help you write clear scoring criteria with point ranges. What specific improvements do you need?",
      minToQualify: "I can help you set the right threshold for this attribute. What minimum score makes sense?",
      signals: "I can help you identify the best keywords for AI detection. What terms should trigger this attribute?",
      examples: "I can help you create concrete scoring examples. What scenarios should I include?",
      active: "I can help you decide whether this attribute should be active in scoring. What's your use case?"
    };
    return guidanceMap[field] || "I can help you improve this field. What would you like to change?";
  };

  // Handle save all pending changes
  const handleSaveChanges = async () => {
    setIsSaving(true);
    setError(null);

    try {
      // Validation
      if (!formData.heading.trim()) {
        throw new Error('Attribute name is required');
      }
      
      if (formData.maxPoints && formData.minToQualify) {
        if (Number(formData.maxPoints) < Number(formData.minToQualify)) {
          throw new Error('Max points must be greater than min to qualify');
        }
      }

      // Clean up the data - only save fields that have pending changes
      const cleanedData = {
        heading: formData.heading,
        maxPoints: formData.maxPoints ? Number(formData.maxPoints) : null,
        instructions: formData.instructions.replace(/\*/g, ''),
        minToQualify: formData.minToQualify ? Number(formData.minToQualify) : null,
        signals: formData.signals.replace(/\*/g, ''),
        examples: formData.examples.replace(/\*/g, ''),
        active: formData.active
      };

      await onSave(attribute.id, cleanedData);
      handleClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  // Handle AI assistance (kept for backward compatibility, but not used in new UI)
  const handleAIAssist = async () => {
    // This function is kept for backward compatibility but not used in the new field-specific UI
    return;
  };

  const handleClose = () => {
    onClose();
    // Reset state
    setError(null);
    setIsSaving(false);
    setFocusedField(null);
    setPendingChanges({});
    setFieldAIHelpers({});
    setFieldAIRequests({});
    setFieldAIGenerating({});
    setFieldAIHistory({});
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-10 mx-auto p-5 border w-11/12 max-w-6xl shadow-lg rounded-md bg-white max-h-[90vh] overflow-y-auto">
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
          <button 
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mt-4 p-3 bg-red-100 border border-red-300 rounded-md">
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        )}

        {/* Main Content */}
        <div className="mt-6">
          <div className="mb-6">
            <h4 className="text-lg font-medium text-gray-900 mb-2">Edit Attribute Fields</h4>
            <p className="text-sm text-gray-600">
              Edit each field individually and use the "Get AI Help" button for field-specific assistance.
              Click "Update" to mark fields ready for saving.
            </p>
          </div>

          {/* Single Column Form Fields */}
          <div className="space-y-6">
            
            {/* Attribute Name */}
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <FieldTooltip title="Attribute Name" description="The human-readable name shown in the scoring interface">
                  <label className="block text-sm font-medium text-gray-700">
                    Attribute Name
                  </label>
                </FieldTooltip>
                <div className="flex items-center space-x-2">
                  {pendingChanges.heading && (
                    <span className="text-xs text-blue-600 bg-blue-100 px-2 py-1 rounded">
                      Ready to save
                    </span>
                  )}
                  {isFieldChanged('heading') && (
                    <span className="text-xs text-amber-600 bg-amber-100 px-2 py-1 rounded">
                      Modified
                    </span>
                  )}
                </div>
              </div>
              <input
                type="text"
                value={formData.heading}
                onChange={(e) => updateField('heading', e.target.value)}
                onFocus={() => setFocusedField('heading')}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Enter attribute name"
              />
              {getFieldError('heading') && (
                <p className="mt-1 text-sm text-red-600">{getFieldError('heading')}</p>
              )}
              <div className="flex justify-end mt-3 space-x-2">
                <button
                  onClick={() => revertField('heading')}
                  disabled={!isFieldChanged('heading')}
                  className="px-3 py-1 text-sm border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Revert
                </button>
                <button
                  onClick={() => markFieldReady('heading')}
                  disabled={!isFieldChanged('heading') || getFieldError('heading')}
                  className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Update
                </button>
              </div>
              
              {/* Field-specific AI Helper */}
              <FieldAIHelper
                field="heading"
                isOpen={fieldAIHelpers.heading}
                onToggle={() => toggleFieldAIHelper('heading')}
                currentValue={formData.heading}
                onAIAssist={() => handleFieldAIAssist('heading')}
                isGenerating={fieldAIGenerating.heading}
                userRequest={fieldAIRequests.heading}
                onRequestChange={(value) => updateFieldAIRequest('heading', value)}
                history={fieldAIHistory.heading}
                guidanceText={getFieldAIGuidance('heading')}
              />
            </div>

            {/* Max Points */}
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <FieldTooltip title="Max Points" description="The highest score this attribute can award">
                  <label className="block text-sm font-medium text-gray-700">
                    Max Points
                  </label>
                </FieldTooltip>
                <div className="flex items-center space-x-2">
                  {pendingChanges.maxPoints && (
                    <span className="text-xs text-blue-600 bg-blue-100 px-2 py-1 rounded">
                      Ready to save
                    </span>
                  )}
                  {isFieldChanged('maxPoints') && (
                    <span className="text-xs text-amber-600 bg-amber-100 px-2 py-1 rounded">
                      Modified
                    </span>
                  )}
                </div>
              </div>
              <input
                type="number"
                value={formData.maxPoints}
                onChange={(e) => updateField('maxPoints', e.target.value)}
                onFocus={() => setFocusedField('maxPoints')}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="15"
              />
              {getFieldError('maxPoints') && (
                <p className="mt-1 text-sm text-red-600">{getFieldError('maxPoints')}</p>
              )}
              <div className="flex justify-end mt-3 space-x-2">
                <button
                  onClick={() => revertField('maxPoints')}
                  disabled={!isFieldChanged('maxPoints')}
                  className="px-3 py-1 text-sm border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Revert
                </button>
                <button
                  onClick={() => markFieldReady('maxPoints')}
                  disabled={!isFieldChanged('maxPoints') || getFieldError('maxPoints')}
                  className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Update
                </button>
              </div>
              
              {/* Field-specific AI Helper */}
              <FieldAIHelper
                field="maxPoints"
                isOpen={fieldAIHelpers.maxPoints}
                onToggle={() => toggleFieldAIHelper('maxPoints')}
                currentValue={formData.maxPoints || 'Not set'}
                onAIAssist={() => handleFieldAIAssist('maxPoints')}
                isGenerating={fieldAIGenerating.maxPoints}
                userRequest={fieldAIRequests.maxPoints}
                onRequestChange={(value) => updateFieldAIRequest('maxPoints', value)}
                history={fieldAIHistory.maxPoints}
                guidanceText={getFieldAIGuidance('maxPoints')}
              />
            </div>

            {/* Instructions */}
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <FieldTooltip title="Instructions for AI Scoring" description="The detailed criteria sent to AI for scoring. Include clear point ranges (e.g., 0-3 pts = minimal, 4-7 pts = moderate, 8-15 pts = strong)">
                  <label className="block text-sm font-medium text-gray-700">
                    Instructions for AI Scoring
                    <span className="ml-2 text-xs text-blue-600 cursor-help" title="Use point ranges like '0-3 pts = minimal experience'">
                      ⓘ Point Range Guide
                    </span>
                  </label>
                </FieldTooltip>
                <div className="flex items-center space-x-2">
                  {pendingChanges.instructions && (
                    <span className="text-xs text-blue-600 bg-blue-100 px-2 py-1 rounded">
                      Ready to save
                    </span>
                  )}
                  {isFieldChanged('instructions') && (
                    <span className="text-xs text-amber-600 bg-amber-100 px-2 py-1 rounded">
                      Modified
                    </span>
                  )}
                </div>
              </div>
              <textarea
                value={formData.instructions}
                onChange={(e) => updateField('instructions', e.target.value)}
                onFocus={() => setFocusedField('instructions')}
                className="w-full h-32 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Enter scoring instructions with point ranges (e.g., 0-3 pts = minimal, 4-7 pts = moderate, 8-15 pts = strong)"
              />
              {getFieldError('instructions') && (
                <p className="mt-1 text-sm text-red-600">{getFieldError('instructions')}</p>
              )}
              <div className="flex justify-end mt-3 space-x-2">
                <button
                  onClick={() => revertField('instructions')}
                  disabled={!isFieldChanged('instructions')}
                  className="px-3 py-1 text-sm border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Revert
                </button>
                <button
                  onClick={() => markFieldReady('instructions')}
                  disabled={!isFieldChanged('instructions') || getFieldError('instructions')}
                  className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Update
                </button>
              </div>
              
              {/* Field-specific AI Helper */}
              <FieldAIHelper
                field="instructions"
                isOpen={fieldAIHelpers.instructions}
                onToggle={() => toggleFieldAIHelper('instructions')}
                currentValue={formData.instructions}
                onAIAssist={() => handleFieldAIAssist('instructions')}
                isGenerating={fieldAIGenerating.instructions}
                userRequest={fieldAIRequests.instructions}
                onRequestChange={(value) => updateFieldAIRequest('instructions', value)}
                history={fieldAIHistory.instructions}
                guidanceText={getFieldAIGuidance('instructions')}
              />
            </div>

            {/* Min to Qualify */}
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <FieldTooltip title="Min to Qualify" description="Threshold score required to pass this attribute">
                  <label className="block text-sm font-medium text-gray-700">
                    Min to Qualify
                  </label>
                </FieldTooltip>
                <div className="flex items-center space-x-2">
                  {pendingChanges.minToQualify && (
                    <span className="text-xs text-blue-600 bg-blue-100 px-2 py-1 rounded">
                      Ready to save
                    </span>
                  )}
                  {isFieldChanged('minToQualify') && (
                    <span className="text-xs text-amber-600 bg-amber-100 px-2 py-1 rounded">
                      Modified
                    </span>
                  )}
                </div>
              </div>
              <input
                type="number"
                value={formData.minToQualify}
                onChange={(e) => updateField('minToQualify', e.target.value)}
                onFocus={() => setFocusedField('minToQualify')}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="0"
              />
              {getFieldError('minToQualify') && (
                <p className="mt-1 text-sm text-red-600">{getFieldError('minToQualify')}</p>
              )}
              <div className="flex justify-end mt-3 space-x-2">
                <button
                  onClick={() => revertField('minToQualify')}
                  disabled={!isFieldChanged('minToQualify')}
                  className="px-3 py-1 text-sm border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Revert
                </button>
                <button
                  onClick={() => markFieldReady('minToQualify')}
                  disabled={!isFieldChanged('minToQualify') || getFieldError('minToQualify')}
                  className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Update
                </button>
              </div>
              
              {/* Field-specific AI Helper */}
              <FieldAIHelper
                field="minToQualify"
                isOpen={fieldAIHelpers.minToQualify}
                onToggle={() => toggleFieldAIHelper('minToQualify')}
                currentValue={formData.minToQualify || 'Not set'}
                onAIAssist={() => handleFieldAIAssist('minToQualify')}
                isGenerating={fieldAIGenerating.minToQualify}
                userRequest={fieldAIRequests.minToQualify}
                onRequestChange={(value) => updateFieldAIRequest('minToQualify', value)}
                history={fieldAIHistory.minToQualify}
                guidanceText={getFieldAIGuidance('minToQualify')}
              />
            </div>

            {/* Detection Keywords */}
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <FieldTooltip title="Detection Keywords" description="Keywords and phrases that help AI identify when this attribute applies">
                  <label className="block text-sm font-medium text-gray-700">
                    Detection Keywords
                  </label>
                </FieldTooltip>
                <div className="flex items-center space-x-2">
                  {pendingChanges.signals && (
                    <span className="text-xs text-blue-600 bg-blue-100 px-2 py-1 rounded">
                      Ready to save
                    </span>
                  )}
                  {isFieldChanged('signals') && (
                    <span className="text-xs text-amber-600 bg-amber-100 px-2 py-1 rounded">
                      Modified
                    </span>
                  )}
                </div>
              </div>
              <textarea
                value={formData.signals}
                onChange={(e) => updateField('signals', e.target.value)}
                onFocus={() => setFocusedField('signals')}
                className="w-full h-24 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="AI, machine learning, startup, founder, side project"
              />
              {getFieldError('signals') && (
                <p className="mt-1 text-sm text-red-600">{getFieldError('signals')}</p>
              )}
              <div className="flex justify-end mt-3 space-x-2">
                <button
                  onClick={() => revertField('signals')}
                  disabled={!isFieldChanged('signals')}
                  className="px-3 py-1 text-sm border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Revert
                </button>
                <button
                  onClick={() => markFieldReady('signals')}
                  disabled={!isFieldChanged('signals') || getFieldError('signals')}
                  className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Update
                </button>
              </div>
              
              {/* Field-specific AI Helper */}
              <FieldAIHelper
                field="signals"
                isOpen={fieldAIHelpers.signals}
                onToggle={() => toggleFieldAIHelper('signals')}
                currentValue={formData.signals}
                onAIAssist={() => handleFieldAIAssist('signals')}
                isGenerating={fieldAIGenerating.signals}
                userRequest={fieldAIRequests.signals}
                onRequestChange={(value) => updateFieldAIRequest('signals', value)}
                history={fieldAIHistory.signals}
                guidanceText={getFieldAIGuidance('signals')}
              />
            </div>

            {/* Examples */}
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <FieldTooltip title="Examples" description="Concrete scenarios showing how points are awarded">
                  <label className="block text-sm font-medium text-gray-700">
                    Examples
                  </label>
                </FieldTooltip>
                <div className="flex items-center space-x-2">
                  {pendingChanges.examples && (
                    <span className="text-xs text-blue-600 bg-blue-100 px-2 py-1 rounded">
                      Ready to save
                    </span>
                  )}
                  {isFieldChanged('examples') && (
                    <span className="text-xs text-amber-600 bg-amber-100 px-2 py-1 rounded">
                      Modified
                    </span>
                  )}
                </div>
              </div>
              <textarea
                value={formData.examples}
                onChange={(e) => updateField('examples', e.target.value)}
                onFocus={() => setFocusedField('examples')}
                className="w-full h-24 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Example: Senior developer with 8+ years = 12-15 pts"
              />
              {getFieldError('examples') && (
                <p className="mt-1 text-sm text-red-600">{getFieldError('examples')}</p>
              )}
              <div className="flex justify-end mt-3 space-x-2">
                <button
                  onClick={() => revertField('examples')}
                  disabled={!isFieldChanged('examples')}
                  className="px-3 py-1 text-sm border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Revert
                </button>
                <button
                  onClick={() => markFieldReady('examples')}
                  disabled={!isFieldChanged('examples') || getFieldError('examples')}
                  className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Update
                </button>
              </div>
              
              {/* Field-specific AI Helper */}
              <FieldAIHelper
                field="examples"
                isOpen={fieldAIHelpers.examples}
                onToggle={() => toggleFieldAIHelper('examples')}
                currentValue={formData.examples}
                onAIAssist={() => handleFieldAIAssist('examples')}
                isGenerating={fieldAIGenerating.examples}
                userRequest={fieldAIRequests.examples}
                onRequestChange={(value) => updateFieldAIRequest('examples', value)}
                history={fieldAIHistory.examples}
                guidanceText={getFieldAIGuidance('examples')}
              />
            </div>

            {/* Status */}
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <FieldTooltip title="Status" description="Whether this attribute should be used in scoring">
                  <label className="block text-sm font-medium text-gray-700">
                    Status
                  </label>
                </FieldTooltip>
                <div className="flex items-center space-x-2">
                  {pendingChanges.active && (
                    <span className="text-xs text-blue-600 bg-blue-100 px-2 py-1 rounded">
                      Ready to save
                    </span>
                  )}
                  {isFieldChanged('active') && (
                    <span className="text-xs text-amber-600 bg-amber-100 px-2 py-1 rounded">
                      Modified
                    </span>
                  )}
                </div>
              </div>
              <select
                value={formData.active}
                onChange={(e) => updateField('active', e.target.value === 'true')}
                onFocus={() => setFocusedField('active')}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
              {getFieldError('active') && (
                <p className="mt-1 text-sm text-red-600">{getFieldError('active')}</p>
              )}
              <div className="flex justify-end mt-3 space-x-2">
                <button
                  onClick={() => revertField('active')}
                  disabled={!isFieldChanged('active')}
                  className="px-3 py-1 text-sm border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Revert
                </button>
                <button
                  onClick={() => markFieldReady('active')}
                  disabled={!isFieldChanged('active') || getFieldError('active')}
                  className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Update
                </button>
              </div>
              
              {/* Field-specific AI Helper */}
              <FieldAIHelper
                field="active"
                isOpen={fieldAIHelpers.active}
                onToggle={() => toggleFieldAIHelper('active')}
                currentValue={formData.active ? 'Active' : 'Inactive'}
                onAIAssist={() => handleFieldAIAssist('active')}
                isGenerating={fieldAIGenerating.active}
                userRequest={fieldAIRequests.active}
                onRequestChange={(value) => updateFieldAIRequest('active', value)}
                history={fieldAIHistory.active}
                guidanceText={getFieldAIGuidance('active')}
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="mt-8 flex justify-between items-center pt-6 border-t">
            <div className="text-sm text-gray-600">
              {Object.keys(pendingChanges).length > 0 && (
                <span className="text-blue-600">
                  {Object.keys(pendingChanges).length} field{Object.keys(pendingChanges).length === 1 ? '' : 's'} ready to save
                </span>
              )}
            </div>
            <div className="flex space-x-4">
              <button
                onClick={handleClose}
                className="px-6 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveChanges}
                disabled={isSaving || Object.keys(pendingChanges).length === 0}
                className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? 'Saving...' : `Save ${Object.keys(pendingChanges).length > 0 ? `${Object.keys(pendingChanges).length} Changes` : 'Changes'}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AIEditModal;

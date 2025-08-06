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
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h4 className="text-lg font-medium text-gray-900">Direct Edit</h4>
              <p className="text-sm text-gray-600">Compare current values with your proposed changes. AI Assist available on demand.</p>
            </div>
            <button
              onClick={() => setShowAIPrompt(!showAIPrompt)}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-blue-700 bg-blue-100 hover:bg-blue-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              <SparklesIcon className="h-4 w-4 mr-2" />
              AI Assist
            </button>
          </div>

          {/* AI Prompt Box */}
          {showAIPrompt && (
            <div className="mb-6 p-4 bg-purple-50 border border-purple-200 rounded-lg">
              <div className="mb-3">
                <label className="block text-sm font-medium text-purple-900 mb-2">
                  Tell AI how to improve your proposed changes:
                </label>
                <textarea
                  value={userRequest}
                  onChange={(e) => setUserRequest(e.target.value)}
                  placeholder="e.g., 'Make the scoring instructions more specific with clearer point ranges' or 'Add better examples for senior-level candidates'"
                  className="w-full h-20 px-3 py-2 border border-purple-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
              <div className="flex space-x-3">
                <button
                  onClick={handleAIAssist}
                  disabled={isGenerating || !userRequest.trim()}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:opacity-50"
                >
                  {isGenerating ? (
                    <>
                      <ArrowPathIcon className="h-4 w-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <SparklesIcon className="h-4 w-4 mr-2" />
                      Improve
                    </>
                  )}
                </button>
                <button
                  onClick={() => setShowAIPrompt(false)}
                  className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Point Range Guide */}
          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <h5 className="text-sm font-medium text-yellow-800 mb-2">📝 Point Range Guide for Instructions</h5>
            <div className="text-sm text-yellow-700">
              <p className="mb-2"><strong>Format:</strong> Use "X-Y pts" or "X pts" to define point ranges</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                <div>
                  <strong>Examples:</strong>
                  <ul className="ml-4 mt-1">
                    <li>• "0-3 pts = minimal experience"</li>
                    <li>• "4-7 pts = moderate background"</li>
                    <li>• "8-15 pts = strong expertise"</li>
                  </ul>
                </div>
                <div>
                  <strong>Tips:</strong>
                  <ul className="ml-4 mt-1">
                    <li>• Keep ranges within Max Points limit</li>
                    <li>• Be specific about criteria</li>
                    <li>• Use consistent point gaps</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {/* Two-Column Layout */}
          <div className="space-y-6">
            {/* Attribute Name */}
            <div className="grid grid-cols-2 gap-6">
              <div>
                <FieldTooltip title="Current Attribute Name" description="The current display name for this attribute">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Current
                  </label>
                </FieldTooltip>
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-md">
                  {attribute.heading || 'Not set'}
                </div>
              </div>
              <div>
                <FieldTooltip title="Proposed Attribute Name" description="The human-readable name shown in the scoring interface">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Proposed
                  </label>
                </FieldTooltip>
                <input
                  type="text"
                  value={proposedForm.heading}
                  onChange={(e) => updateProposedField('heading', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter attribute name"
                />
              </div>
            </div>

            {/* Instructions */}
            <div className="grid grid-cols-2 gap-6">
              <div>
                <FieldTooltip title="Current Instructions" description="Current scoring criteria">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Current
                  </label>
                </FieldTooltip>
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-md h-32 overflow-y-auto whitespace-pre-wrap">
                  {formatTextForDisplay(attribute.instructions)}
                </div>
              </div>
              <div>
                <FieldTooltip title="Proposed Instructions" description="The detailed criteria sent to AI for scoring. Include clear point ranges (e.g., 0-3 pts = minimal, 4-7 pts = moderate, 8-15 pts = strong)">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Proposed
                    <span className="ml-2 text-xs text-blue-600 cursor-help" title="Tip: Use point ranges like '0-3 pts = minimal experience' or '8-15 pts = strong background'">
                      ⓘ Point Range Guide
                    </span>
                  </label>
                </FieldTooltip>
                <textarea
                  value={proposedForm.instructions}
                  onChange={(e) => updateProposedField('instructions', e.target.value)}
                  className="w-full h-32 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter scoring instructions with point ranges (e.g., 0-3 pts = minimal, 4-7 pts = moderate, 8-15 pts = strong)"
                />
                {proposedForm.instructions && proposedForm.maxPoints && !validateScoringRanges(proposedForm.instructions, proposedForm.maxPoints) && (
                  <p className="mt-1 text-sm text-amber-600">⚠️ Instructions contain point ranges higher than Max Points ({proposedForm.maxPoints})</p>
                )}
              </div>
            </div>

            {/* Numeric Fields Row */}
            <div className="grid grid-cols-3 gap-6">
              {/* Max Points */}
              <div>
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <FieldTooltip title="Current Max Points" description="Current maximum score">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Current Max
                      </label>
                    </FieldTooltip>
                    <div className="p-2 bg-gray-50 border border-gray-200 rounded-md text-center">
                      {attribute.maxPoints || 'Not set'}
                    </div>
                  </div>
                  <div>
                    <FieldTooltip title="Proposed Max Points" description="The highest score this attribute can award">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Proposed Max
                      </label>
                    </FieldTooltip>
                    <input
                      type="number"
                      value={proposedForm.maxPoints}
                      onChange={(e) => updateProposedField('maxPoints', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="15"
                    />
                  </div>
                </div>
              </div>

              {/* Min to Qualify */}
              <div>
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <FieldTooltip title="Current Min to Qualify" description="Current minimum threshold">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Current Min
                      </label>
                    </FieldTooltip>
                    <div className="p-2 bg-gray-50 border border-gray-200 rounded-md text-center">
                      {attribute.minToQualify || 'Not set'}
                    </div>
                  </div>
                  <div>
                    <FieldTooltip title="Proposed Min to Qualify" description="Threshold score required to pass this attribute">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Proposed Min
                      </label>
                    </FieldTooltip>
                    <input
                      type="number"
                      value={proposedForm.minToQualify}
                      onChange={(e) => updateProposedField('minToQualify', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="0"
                    />
                    {proposedForm.maxPoints && proposedForm.minToQualify && Number(proposedForm.maxPoints) < Number(proposedForm.minToQualify) && (
                      <p className="mt-1 text-sm text-red-600">⚠️ Min to qualify cannot be higher than max points</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Penalty Points */}
              <div>
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <FieldTooltip title="Current Penalty" description="Current penalty points">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Current Penalty
                      </label>
                    </FieldTooltip>
                    <div className="p-2 bg-gray-50 border border-gray-200 rounded-md text-center">
                      {attribute.penalty || 'Not set'}
                    </div>
                  </div>
                  <div>
                    <FieldTooltip title="Proposed Penalty" description="Points deducted when this negative attribute is triggered">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Proposed Penalty
                      </label>
                    </FieldTooltip>
                    <input
                      type="number"
                      value={proposedForm.penalty}
                      onChange={(e) => updateProposedField('penalty', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="0 or negative number"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Detection Keywords */}
            <div className="grid grid-cols-2 gap-6">
              <div>
                <FieldTooltip title="Current Detection Keywords" description="Current keywords for AI detection">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Current
                  </label>
                </FieldTooltip>
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-md h-24 overflow-y-auto whitespace-pre-wrap">
                  {formatTextForDisplay(attribute.signals)}
                </div>
              </div>
              <div>
                <FieldTooltip title="Proposed Detection Keywords" description="Keywords and phrases that help AI identify when this attribute applies">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Proposed
                  </label>
                </FieldTooltip>
                <textarea
                  value={proposedForm.signals}
                  onChange={(e) => updateProposedField('signals', e.target.value)}
                  className="w-full h-24 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="AI, machine learning, startup, founder, side project"
                />
              </div>
            </div>

            {/* Examples */}
            <div className="grid grid-cols-2 gap-6">
              <div>
                <FieldTooltip title="Current Examples" description="Current scoring examples">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Current
                  </label>
                </FieldTooltip>
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-md h-24 overflow-y-auto whitespace-pre-wrap">
                  {formatTextForDisplay(attribute.examples)}
                </div>
              </div>
              <div>
                <FieldTooltip title="Proposed Examples" description="Concrete scenarios showing how points are awarded">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Proposed
                  </label>
                </FieldTooltip>
                <textarea
                  value={proposedForm.examples}
                  onChange={(e) => updateProposedField('examples', e.target.value)}
                  className="w-full h-24 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Example: Senior developer with 8+ years = 12-15 pts"
                />
              </div>
            </div>

            {/* Status */}
            <div className="grid grid-cols-2 gap-6">
              <div>
                <FieldTooltip title="Current Status" description="Current activation status">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Current
                  </label>
                </FieldTooltip>
                <div className="p-2 bg-gray-50 border border-gray-200 rounded-md text-center">
                  {attribute.active ? 'Active' : 'Inactive'}
                </div>
              </div>
              <div>
                <FieldTooltip title="Proposed Status" description="Whether this attribute should be used in scoring">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Proposed
                  </label>
                </FieldTooltip>
                <select
                  value={proposedForm.active}
                  onChange={(e) => updateProposedField('active', e.target.value === 'true')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="mt-8 flex justify-end space-x-4 pt-6 border-t">
            <button
              onClick={handleClose}
              className="px-6 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveChanges}
              disabled={isSaving || !proposedForm.heading.trim()}
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AIEditModal;

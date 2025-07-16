"use client";
import React, { useState, useEffect } from 'react';
import { XMarkIcon, SparklesIcon, ArrowPathIcon } from '@heroicons/react/24/outline';

const AIEditModalFieldSpecific = ({ isOpen, onClose, attribute, onSave }) => {
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [fieldValues, setFieldValues] = useState({});
  const [fieldAIHelpers, setFieldAIHelpers] = useState({});
  const [activeFieldHelper, setActiveFieldHelper] = useState(null);
  const [aiInput, setAiInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [chatHistory, setChatHistory] = useState({});

  // Field definitions
  const fields = [
    {
      key: 'heading',
      label: 'Attribute Name',
      type: 'text',
      placeholder: 'Enter attribute name',
      description: 'The display name shown in the scoring interface'
    },
    {
      key: 'maxPoints',
      label: 'Max Points',
      type: 'number',
      placeholder: '15',
      description: 'Maximum points this attribute can award'
    },
    {
      key: 'instructions',
      label: 'Instructions for AI Scoring',
      type: 'textarea',
      placeholder: 'Enter scoring instructions with point ranges...',
      description: 'Core rubric content sent to AI for scoring (most important field)',
      rows: 6
    },
    {
      key: 'minToQualify',
      label: 'Min to Qualify',
      type: 'number',
      placeholder: '0',
      description: 'Minimum score required to pass this attribute'
    },
    {
      key: 'signals',
      label: 'Detection Keywords',
      type: 'textarea',
      placeholder: 'AI, machine learning, programming, developer...',
      description: 'Keywords that help AI detect this attribute',
      rows: 3
    },
    {
      key: 'examples',
      label: 'Examples',
      type: 'textarea',
      placeholder: 'Senior developer with 8+ years = 12-15 pts',
      description: 'Concrete scoring scenarios with point values',
      rows: 4
    },
    {
      key: 'active',
      label: 'Status',
      type: 'select',
      options: [
        { value: true, label: 'Active' },
        { value: false, label: 'Inactive' }
      ],
      description: 'Whether this attribute is used in scoring'
    }
  ];

  // Initialize field values when attribute changes
  useEffect(() => {
    if (attribute) {
      setFieldValues({
        heading: attribute.heading || '',
        maxPoints: attribute.maxPoints || '',
        instructions: attribute.instructions || '',
        minToQualify: attribute.minToQualify || '',
        signals: attribute.signals || '',
        examples: attribute.examples || '',
        active: attribute.active !== false
      });
      
      // Initialize chat history for each field
      const initialChatHistory = {};
      fields.forEach(field => {
        initialChatHistory[field.key] = [];
      });
      setChatHistory(initialChatHistory);
    }
  }, [attribute]);

  const handleFieldChange = (fieldKey, value) => {
    setFieldValues(prev => ({
      ...prev,
      [fieldKey]: value
    }));
  };

  const handleRevert = (fieldKey) => {
    setFieldValues(prev => ({
      ...prev,
      [fieldKey]: attribute[fieldKey] || ''
    }));
  };

  const handleFieldUpdate = async (fieldKey) => {
    try {
      setError(null);
      setIsSaving(true);
      
      const updatedData = {
        ...fieldValues,
        maxPoints: fieldValues.maxPoints ? Number(fieldValues.maxPoints) : null,
        minToQualify: fieldValues.minToQualify ? Number(fieldValues.minToQualify) : null
      };
      
      await onSave(attribute.id, updatedData);
      
      // Add success message to chat history
      setChatHistory(prev => ({
        ...prev,
        [fieldKey]: [
          ...prev[fieldKey],
          {
            type: 'system',
            message: `✅ Field updated successfully`,
            timestamp: new Date().toLocaleTimeString()
          }
        ]
      }));
      
    } catch (err) {
      setError(err.message);
      setChatHistory(prev => ({
        ...prev,
        [fieldKey]: [
          ...prev[fieldKey],
          {
            type: 'error',
            message: `❌ Error: ${err.message}`,
            timestamp: new Date().toLocaleTimeString()
          }
        ]
      }));
    } finally {
      setIsSaving(false);
    }
  };

  const handleAIHelp = async () => {
    if (!aiInput.trim() || !activeFieldHelper) return;
    
    setIsGenerating(true);
    setError(null);
    
    try {
      // Add user message to chat history
      setChatHistory(prev => ({
        ...prev,
        [activeFieldHelper]: [
          ...prev[activeFieldHelper],
          {
            type: 'user',
            message: aiInput.trim(),
            timestamp: new Date().toLocaleTimeString()
          }
        ]
      }));
      
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/api/attributes/${attribute.id}/ai-field-help`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fieldKey: activeFieldHelper,
          userRequest: aiInput.trim(),
          currentValue: fieldValues[activeFieldHelper],
          currentAttribute: attribute
        })
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }

      const result = await response.json();
      
      // Add AI response to chat history
      setChatHistory(prev => ({
        ...prev,
        [activeFieldHelper]: [
          ...prev[activeFieldHelper],
          {
            type: 'ai',
            message: result.suggestion,
            timestamp: new Date().toLocaleTimeString()
          }
        ]
      }));
      
      // If AI provided a specific value suggestion, update the field
      if (result.suggestedValue !== undefined) {
        handleFieldChange(activeFieldHelper, result.suggestedValue);
      }
      
      setAiInput('');
      
    } catch (err) {
      console.error('Error getting AI help:', err);
      setChatHistory(prev => ({
        ...prev,
        [activeFieldHelper]: [
          ...prev[activeFieldHelper],
          {
            type: 'error',
            message: `❌ Failed to get AI help: ${err.message}`,
            timestamp: new Date().toLocaleTimeString()
          }
        ]
      }));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleClose = () => {
    onClose();
    setActiveFieldHelper(null);
    setAiInput('');
    setError(null);
  };

  const renderField = (field) => {
    const currentValue = fieldValues[field.key];
    const originalValue = attribute[field.key];
    const hasChanged = currentValue !== originalValue;

    return (
      <div key={field.key} className="border border-gray-200 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              {field.label}
            </label>
            <p className="text-xs text-gray-500 mt-1">{field.description}</p>
          </div>
          <div className="flex space-x-2">
            <button
              onClick={() => handleRevert(field.key)}
              disabled={!hasChanged}
              className="px-3 py-1 text-xs border border-gray-300 rounded text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Revert
            </button>
            <button
              onClick={() => handleFieldUpdate(field.key)}
              disabled={!hasChanged || isSaving}
              className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? 'Saving...' : 'Update'}
            </button>
          </div>
        </div>

        {field.type === 'text' && (
          <input
            type="text"
            value={currentValue}
            onChange={(e) => handleFieldChange(field.key, e.target.value)}
            placeholder={field.placeholder}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        )}

        {field.type === 'number' && (
          <input
            type="number"
            value={currentValue}
            onChange={(e) => handleFieldChange(field.key, e.target.value)}
            placeholder={field.placeholder}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        )}

        {field.type === 'textarea' && (
          <textarea
            value={currentValue}
            onChange={(e) => handleFieldChange(field.key, e.target.value)}
            placeholder={field.placeholder}
            rows={field.rows || 3}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        )}

        {field.type === 'select' && (
          <select
            value={currentValue}
            onChange={(e) => handleFieldChange(field.key, e.target.value === 'true')}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {field.options.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )}

        {hasChanged && (
          <div className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded">
            ✏️ Modified from original
          </div>
        )}
      </div>
    );
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
                <p className="text-lg font-medium text-blue-900">"{attribute?.heading || 'Untitled Attribute'}"</p>
                <p className="text-sm text-blue-700 mt-1">
                  Max: {attribute?.maxPoints || 'Not set'} pts • 
                  Status: {attribute?.active ? 'Active' : 'Inactive'}
                </p>
              </div>
            </div>
          </div>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600">
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
            <div className="text-red-800 text-sm">{error}</div>
          </div>
        )}

        {/* Edit Attribute Fields */}
        <div className="mt-6">
          <div className="mb-4">
            <h4 className="text-lg font-medium text-gray-900">Edit Attribute Fields</h4>
            <p className="text-sm text-gray-600">
              Click into a field and then use AI (see below) to gain suggestions or help improve. Then use Update to mark them ready for saving.
            </p>
          </div>

          <div className="space-y-4">
            {fields.map(field => renderField(field))}
          </div>
        </div>

        {/* AI Helper Section */}
        <div className="mt-8 border-t pt-6">
          <div className="flex items-center space-x-2 mb-4">
            <SparklesIcon className="h-5 w-5 text-purple-600" />
            <h4 className="text-lg font-medium text-gray-900">AI Helper</h4>
            <button
              onClick={() => setActiveFieldHelper(null)}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Hide
            </button>
          </div>
          
          <p className="text-sm text-gray-600 mb-4">
            Get field-specific guidance or chat about your attribute
          </p>

          {/* Field Selection */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select field for AI help:
            </label>
            <select
              value={activeFieldHelper || ''}
              onChange={(e) => setActiveFieldHelper(e.target.value || null)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            >
              <option value="">Choose a field...</option>
              {fields.map(field => (
                <option key={field.key} value={field.key}>
                  {field.label}
                </option>
              ))}
            </select>
          </div>

          {/* Chat History */}
          {activeFieldHelper && chatHistory[activeFieldHelper] && chatHistory[activeFieldHelper].length > 0 && (
            <div className="mb-4 bg-gray-50 rounded-lg p-3 max-h-40 overflow-y-auto">
              <div className="text-sm text-gray-600 mb-2">
                Chat history for {fields.find(f => f.key === activeFieldHelper)?.label}:
              </div>
              {chatHistory[activeFieldHelper].map((msg, index) => (
                <div key={index} className={`mb-2 text-sm ${
                  msg.type === 'user' ? 'text-blue-700' : 
                  msg.type === 'ai' ? 'text-green-700' : 
                  msg.type === 'error' ? 'text-red-700' : 'text-gray-700'
                }`}>
                  <span className="text-xs text-gray-500">{msg.timestamp}</span> {msg.message}
                </div>
              ))}
            </div>
          )}

          {/* AI Input */}
          {activeFieldHelper && (
            <div className="space-y-3">
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="text-sm text-gray-600 mb-1">
                  AI: {new Date().toLocaleTimeString()}
                </div>
                <div className="text-sm text-gray-800">
                  Here's what we currently have for "{fields.find(f => f.key === activeFieldHelper)?.label}":
                </div>
                <div className="text-sm bg-white p-2 rounded mt-2 border">
                  {fieldValues[activeFieldHelper] || '(empty)'}
                </div>
              </div>

              <div className="flex space-x-2">
                <input
                  type="text"
                  value={aiInput}
                  onChange={(e) => setAiInput(e.target.value)}
                  placeholder={`Ask AI about ${fields.find(f => f.key === activeFieldHelper)?.label.toLowerCase()}...`}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  onKeyPress={(e) => e.key === 'Enter' && handleAIHelp()}
                />
                <button
                  onClick={handleAIHelp}
                  disabled={!aiInput.trim() || isGenerating}
                  className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isGenerating ? (
                    <ArrowPathIcon className="h-4 w-4 animate-spin" />
                  ) : (
                    'Ask AI'
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Save Changes Button */}
        <div className="mt-8 flex justify-end space-x-3 pt-6 border-t">
          <button
            onClick={handleClose}
            className="px-6 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={async () => {
              await handleFieldUpdate('all');
              handleClose();
            }}
            disabled={isSaving}
            className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIEditModalFieldSpecific;

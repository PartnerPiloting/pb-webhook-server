"use client";
import React, { useState, useEffect } from 'react';
import { XMarkIcon, SparklesIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { getCurrentClientId } from '../utils/clientUtils';

const AIEditModalFieldSpecific = ({ isOpen, onClose, attribute, onSave }) => {
  console.log('=== MODAL DEBUG ===');
  console.log('Modal rendering with:', { isOpen, attribute });
  
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [fieldValues, setFieldValues] = useState({});
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
      description: 'Minimum points required to qualify for scoring'
    },
    {
      key: 'signals',
      label: 'Detection Keywords',
      type: 'textarea',
      placeholder: 'AI, machine learning, programming, developer...',
      description: 'Keywords that help AI identify when this attribute applies',
      rows: 3
    },
    {
      key: 'examples',
      label: 'Examples',
      type: 'textarea',
      placeholder: 'Example scenarios with point values...',
      description: 'Concrete scoring scenarios that help AI understand nuances',
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
      // Defensive conversion to prevent rendering objects - same fix as Settings.js
      setFieldValues({
        heading: String(attribute.heading || ''),
        maxPoints: String(attribute.maxPoints || ''),
        instructions: String(attribute.instructions || ''),
        minToQualify: String(attribute.minToQualify || ''),
        signals: String(attribute.signals || ''),
        examples: String(attribute.examples || ''),
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

  const handleOpenFieldAI = (fieldKey) => {
    setActiveFieldHelper(fieldKey);
    setAiInput('');
    setError(null);
    
    // Initialize chat history for this field if not exists
    if (!chatHistory[fieldKey]) {
      setChatHistory(prev => ({
        ...prev,
        [fieldKey]: []
      }));
    }
  };

  const handleRevert = (fieldKey) => {
    const originalValue = attribute[fieldKey];
    // Defensive conversion to prevent object rendering
    const revertedValue = fieldKey === 'active' 
      ? originalValue !== false 
      : String(originalValue || '');

    setFieldValues(prev => ({
      ...prev,
      [fieldKey]: revertedValue
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
    
    // Add user message to chat history
    setChatHistory(prev => ({
      ...prev,
      [activeFieldHelper]: [
        ...prev[activeFieldHelper],
        {
          type: 'user',
          message: aiInput,
          timestamp: new Date().toLocaleTimeString()
        }
      ]
    }));
    
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/api/attributes/${attribute.id}/ai-field-help`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-client-id': getCurrentClientId(),
        },
        body: JSON.stringify({
          fieldKey: activeFieldHelper,
          userRequest: aiInput,
          currentValue: fieldValues[activeFieldHelper],
          currentAttribute: fieldValues
        }),
      });
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to get AI help');
      }
      
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
            <div className="flex items-center space-x-2">
              <label className="block text-sm font-medium text-gray-700">
                {field.label}
              </label>
              <button
                onClick={() => handleOpenFieldAI(field.key)}
                className="text-blue-600 hover:text-blue-800 transition-colors"
                title={`Get AI help for ${field.label}`}
              >
                <SparklesIcon className="h-4 w-4" />
              </button>
            </div>
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

        {/* Field-Specific AI Helper */}
        {activeFieldHelper === field.key && (
          <div className="mt-4 p-4 bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-lg">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2">
                <SparklesIcon className="h-5 w-5 text-purple-600" />
                <h4 className="text-lg font-medium text-gray-900">
                  AI Helper for {field.label}
                </h4>
              </div>
              <button
                onClick={() => setActiveFieldHelper(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            
            <p className="text-sm text-gray-600 mb-4">
              Get specific guidance for the "{field.label}" field
            </p>

            {/* Current Field Value Display */}
            <div className="mb-4 p-3 bg-white rounded-lg border">
              <div className="text-sm text-gray-600 mb-1">Current value:</div>
              <div className="text-sm text-gray-800">
                {fieldValues[field.key] || '(empty)'}
              </div>
            </div>

            {/* Chat History */}
            {chatHistory[field.key] && chatHistory[field.key].length > 0 && (
              <div className="mb-4 bg-white rounded-lg p-3 max-h-40 overflow-y-auto border">
                <div className="text-sm text-gray-600 mb-2">Chat history:</div>
                {chatHistory[field.key].map((msg, index) => (
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
            <div className="flex space-x-2">
              <input
                type="text"
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                placeholder={`Ask AI about ${field.label.toLowerCase()}...`}
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
                <p className="text-lg font-medium text-blue-900">"{String(attribute?.heading || 'Untitled Attribute')}"</p>
                <p className="text-sm text-blue-700 mt-1">
                  Max: {String(attribute?.maxPoints || 'Not set')} pts • 
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
              Click the sparkle icon next to any field to get AI help for that specific field.
            </p>
          </div>

          <div className="space-y-4">
            {fields.map(field => renderField(field))}
          </div>
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

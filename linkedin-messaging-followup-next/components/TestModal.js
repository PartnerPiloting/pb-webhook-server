"use client";
import React, { useState, useEffect } from 'react';
import { XMarkIcon, SparklesIcon } from '@heroicons/react/24/outline';
import { getCurrentClientId, getCurrentPortalToken, getCurrentDevKey } from '../utils/clientUtils';

const AIEditModal = ({ isOpen, onClose, attribute, onSave }) => {
  const [fieldValues, setFieldValues] = useState({});
  const [chatHistory, setChatHistory] = useState([]);
  const [activeFieldHelper, setActiveFieldHelper] = useState(null);
  const [aiInput, setAiInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  // Step 3: Add field-specific handlers (sparkle icon logic)
  const handleOpenFieldAI = (fieldKey) => {
    console.log('TestModal: Opening AI help for field:', fieldKey);
    setActiveFieldHelper(fieldKey);
    
    // Step 5: Initialize chat history for this field like the complex modal
    if (!chatHistory[fieldKey]) {
      setChatHistory(prev => ({
        ...prev,
        [fieldKey]: []
      }));
    }
  };

  const handleFieldChange = (fieldKey, value) => {
    console.log('TestModal: Field change:', fieldKey, 'value:', value, 'type:', typeof value);
    setFieldValues(prev => ({
      ...prev,
      [fieldKey]: value
    }));
  };

  // Step 5: Add AI chat functionality
  const handleAIHelp = async () => {
    if (!aiInput.trim() || !activeFieldHelper) return;
    
    console.log('TestModal: Sending AI help request:', aiInput);
    setIsGenerating(true);
    
    // Add user message to chat history (like the complex modal)
    const userMessage = {
      type: 'user',
      message: aiInput,
      timestamp: new Date().toLocaleTimeString()
    };
    
    setChatHistory(prev => ({
      ...prev,
      [activeFieldHelper]: [
        ...(prev[activeFieldHelper] || []),
        userMessage
      ]
    }));
    
    // Step 6: Try actual API call instead of simulation
    try {
      console.log('TestModal: Making real API call...');
      
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/api/attributes/${attribute.id}/ai-field-help`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-client-id': getCurrentClientId(),
          ...(getCurrentPortalToken() && { 'x-portal-token': getCurrentPortalToken() }),
          ...(getCurrentDevKey() && { 'x-dev-key': getCurrentDevKey() }),
        },
        body: JSON.stringify({
          fieldKey: activeFieldHelper,
          userRequest: aiInput,
          currentValue: fieldValues[activeFieldHelper],
          currentAttribute: fieldValues
        }),
      });
      
      const result = await response.json();
      console.log('TestModal: API response:', result);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to get AI help');
      }
      
      // Add AI response to chat history - THIS IS WHERE THE BUG MIGHT BE!
      const aiResponse = {
        type: 'ai',
        message: result.suggestion, // <-- THIS MIGHT BE AN OBJECT!
        timestamp: new Date().toLocaleTimeString()
      };
      
      console.log('TestModal: AI response message:', result.suggestion, 'type:', typeof result.suggestion);
      
      setChatHistory(prev => ({
        ...prev,
        [activeFieldHelper]: [
          ...(prev[activeFieldHelper] || []),
          aiResponse
        ]
      }));
      
      // If AI provided a specific value suggestion, update the field
      if (result.suggestedValue !== undefined) {
        handleFieldChange(activeFieldHelper, result.suggestedValue);
      }
      
      setAiInput('');
      
    } catch (err) {
      console.error('TestModal: Error getting AI help:', err);
      
      // Add error message to chat history
      const errorMessage = {
        type: 'error',
        message: `❌ Failed to get AI help: ${err.message}`,
        timestamp: new Date().toLocaleTimeString()
      };
      
      setChatHistory(prev => ({
        ...prev,
        [activeFieldHelper]: [
          ...(prev[activeFieldHelper] || []),
          errorMessage
        ]
      }));
    } finally {
      setIsGenerating(false);
    }
  };

  // Add the useEffect from complex modal
  useEffect(() => {
    if (attribute) {
      console.log('TestModal: Setting field values for attribute:', attribute);
      setFieldValues({
        heading: String(attribute.heading || ''),
        maxPoints: String(attribute.maxPoints || ''),
        instructions: String(attribute.instructions || ''),
        minToQualify: String(attribute.minToQualify || ''),
        signals: String(attribute.signals || ''),
        examples: String(attribute.examples || ''),
        active: attribute.active !== false
      });
    }
  }, [attribute]);

  // Step 2: Add chatHistory state management from complex modal
  useEffect(() => {
    if (isOpen && attribute) {
      console.log('TestModal: Setting up chatHistory for attribute:', attribute.id);
      
      // Initialize with system message like the complex modal - but as OBJECT not array!
      const systemMessage = {
        role: 'system',
        content: `You are helping to configure a lead scoring attribute: ${String(attribute.heading || 'Unnamed Attribute')}`
      };
      
      // Initialize as object with field keys, not array
      const initialChatHistory = {
        heading: [systemMessage],
        maxPoints: [],
        instructions: [],
        minToQualify: [],
        signals: [],
        examples: [],
        active: []
      };
      
      console.log('TestModal: Initial chat history:', initialChatHistory);
      setChatHistory(initialChatHistory);
    }
  }, [isOpen, attribute]);

  const handleSave = async () => {
    try {
      setIsSaving(true);
      setError(null);
      
      // Convert fields to proper types
      const updatedData = {
        ...fieldValues,
        maxPoints: fieldValues.maxPoints ? Number(fieldValues.maxPoints) : null,
        minToQualify: fieldValues.minToQualify ? Number(fieldValues.minToQualify) : null
      };
      
      console.log('AIEditModal: Saving data:', updatedData);
      
      if (onSave) {
        await onSave(attribute.id, updatedData);
      }
      
      onClose();
      
    } catch (err) {
      console.error('AIEditModal: Save error:', err);
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 z-50">
      <div className="relative top-10 mx-auto p-5 border w-full max-w-4xl shadow-lg rounded-md bg-white max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">Edit Attribute: {String(attribute?.heading || 'Unnamed')}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>
        
        {error && (
          <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
            {error}
          </div>
        )}
        
        <div className="space-y-4">{/* Fields will be rendered here */}</div>
            </div>
            
            <div>
              <label className="block text-xs font-medium">Max Points:</label>
              <input 
                type="number" 
                value={fieldValues.maxPoints || ''}
                onChange={(e) => handleFieldChange('maxPoints', e.target.value)}
                className="w-full px-2 py-1 border rounded text-xs"
              />
            </div>
            
            <div>
              <label className="block text-xs font-medium">Instructions:</label>
              <textarea 
                value={fieldValues.instructions || ''}
                onChange={(e) => handleFieldChange('instructions', e.target.value)}
                className="w-full px-2 py-1 border rounded text-xs"
                rows="3"
                placeholder="Enter AI scoring instructions..."
              />
            </div>
            
            <div>
              <label className="block text-xs font-medium">Signals:</label>
              <textarea 
                value={fieldValues.signals || ''}
                onChange={(e) => handleFieldChange('signals', e.target.value)}
                className="w-full px-2 py-1 border rounded text-xs"
                rows="2"
                placeholder="Keywords that help AI identify when this applies..."
              />
            </div>
            
            <div>
              <label className="block text-xs font-medium">Examples:</label>
              <textarea 
                value={fieldValues.examples || ''}
                onChange={(e) => handleFieldChange('examples', e.target.value)}
                className="w-full px-2 py-1 border rounded text-xs"
                rows="3"
                placeholder="Example scenarios with point values..."
              />
            </div>
            
            <div>
              <label className="block text-xs font-medium">Active:</label>
              <select 
                value={fieldValues.active}
                onChange={(e) => handleFieldChange('active', e.target.value === 'true')}
                className="w-full px-2 py-1 border rounded text-xs"
              >
                <option value={true}>Active</option>
                <option value={false}>Inactive</option>
              </select>
            </div>
          </div>
        </div>
        
        <div className="mt-4 p-2 bg-blue-100 rounded">
          <h4 className="font-medium">Chat History: {Object.keys(chatHistory).length} fields</h4>
          <p>Active Field Helper: {activeFieldHelper || 'None'}</p>
          <button 
            onClick={() => handleOpenFieldAI('heading')}
            className="mt-2 px-2 py-1 bg-purple-500 text-white rounded text-xs"
          >
            ✨ Open AI Helper (Heading)
          </button>
        </div>
        
        {/* Step 5: AI Chat Interface */}
        {activeFieldHelper && (
          <div className="mt-4 p-3 bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-lg">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-gray-900">
                AI Helper for {activeFieldHelper}
              </h4>
              <button
                onClick={() => setActiveFieldHelper(null)}
                className="text-gray-400 hover:text-gray-600 text-xs"
              >
                ✕
              </button>
            </div>
            
            {/* Current Field Value Display */}
            <div className="mb-3 p-2 bg-white rounded border">
              <div className="text-xs text-gray-600 mb-1">Current value:</div>
              <div className="text-xs text-gray-800">
                {fieldValues[activeFieldHelper] || '(empty)'}
              </div>
            </div>

            {/* Chat History Display */}
            {chatHistory[activeFieldHelper] && chatHistory[activeFieldHelper].length > 0 && (
              <div className="mb-3 bg-white rounded p-2 max-h-32 overflow-y-auto border">
                <div className="text-xs text-gray-600 mb-2">Chat history:</div>
                {chatHistory[activeFieldHelper].map((msg, index) => (
                  <div key={index} className={`mb-1 text-xs ${
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
                placeholder="Ask AI for help..."
                className="flex-1 px-2 py-1 border rounded text-xs"
                onKeyPress={(e) => e.key === 'Enter' && handleAIHelp()}
              />
              <button
                onClick={handleAIHelp}
                disabled={!aiInput.trim() || isGenerating}
                className="px-3 py-1 bg-purple-600 text-white rounded text-xs disabled:opacity-50"
              >
                {isGenerating ? '...' : 'Ask AI'}
              </button>
            </div>
          </div>
        )}
        
        {/* Step 7: Save and Close Buttons */}
        <div className="mt-4 flex justify-end space-x-2">
          <button 
            onClick={onClose}
            className="px-4 py-2 bg-gray-500 text-white rounded text-sm"
          >
            Close
          </button>
          
          <button 
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 bg-blue-600 text-white rounded text-sm flex items-center"
          >
            {isSaving ? (
              <svg className="animate-spin h-5 w-5 mr-3 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4zm16 0a8 8 0 01-8 8v-8h8z"></path>
              </svg>
            ) : 'Save'}
          </button>
        </div>
        
        {/* Error Message Display */}
        {error && (
          <div className="mt-4 p-2 bg-red-100 text-red-700 text-sm rounded">
            {error}
          </div>
        )}
      </div>
    </div>
  );
};

export default AIEditModal;

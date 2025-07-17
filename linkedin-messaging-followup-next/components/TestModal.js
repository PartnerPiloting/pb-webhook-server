"use client";
import React, { useState, useEffect } from 'react';

const TestModal = ({ isOpen, onClose, attribute }) => {
  const [fieldValues, setFieldValues] = useState({});
  const [chatHistory, setChatHistory] = useState([]);
  const [activeFieldHelper, setActiveFieldHelper] = useState(null);
  const [aiInput, setAiInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

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
    
    // Simulate AI response
    setTimeout(() => {
      const aiResponse = {
        type: 'ai',
        message: `AI suggestion for ${activeFieldHelper}: ${aiInput}`,
        timestamp: new Date().toLocaleTimeString()
      };
      
      setChatHistory(prev => ({
        ...prev,
        [activeFieldHelper]: [
          ...(prev[activeFieldHelper] || []),
          aiResponse
        ]
      }));
      
      setAiInput('');
      setIsGenerating(false);
    }, 1000);
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
      
      // Initialize with system message like the complex modal
      const systemMessage = {
        role: 'system',
        content: `You are helping to configure a lead scoring attribute: ${String(attribute.heading || 'Unnamed Attribute')}`
      };
      
      console.log('TestModal: Initial chat history:', [systemMessage]);
      setChatHistory([systemMessage]);
    }
  }, [isOpen, attribute]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 z-50">
      <div className="relative top-10 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
        <h3 className="text-lg font-semibold">Test Modal - Step 5: Add AI chat interface</h3>
        <p>ID: {String(attribute?.id || 'N/A')}</p>
        <p>Name: {String(attribute?.heading || 'N/A')}</p>
        <p>Max Points: {String(attribute?.maxPoints || 'N/A')}</p>
        
        <div className="mt-4 p-2 bg-gray-100 rounded">
          <h4 className="font-medium">Field Values State:</h4>
          <p>Heading: {fieldValues.heading}</p>
          <p>Max Points: {fieldValues.maxPoints}</p>
          <p>Active: {String(fieldValues.active)}</p>
        </div>
        
        <div className="mt-4 p-2 bg-green-100 rounded">
          <h4 className="font-medium">Step 4: Test Real Field Rendering:</h4>
          
          <div className="mt-2 space-y-2">
            <div>
              <label className="block text-xs font-medium">Heading:</label>
              <input 
                type="text" 
                value={fieldValues.heading || ''}
                onChange={(e) => handleFieldChange('heading', e.target.value)}
                className="w-full px-2 py-1 border rounded text-xs"
              />
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
        
        <button 
          onClick={onClose}
          className="mt-4 px-4 py-2 bg-gray-500 text-white rounded"
        >
          Close
        </button>
      </div>
    </div>
  );
};

export default TestModal;

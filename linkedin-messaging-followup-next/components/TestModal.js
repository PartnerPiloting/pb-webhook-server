"use client";
import React, { useState, useEffect } from 'react';

const TestModal = ({ isOpen, onClose, attribute }) => {
  const [fieldValues, setFieldValues] = useState({});
  const [chatHistory, setChatHistory] = useState([]);
  const [activeFieldHelper, setActiveFieldHelper] = useState(null);

  // Step 3: Add field-specific handlers (sparkle icon logic)
  const handleOpenFieldAI = (fieldKey) => {
    console.log('TestModal: Opening AI help for field:', fieldKey);
    setActiveFieldHelper(fieldKey);
  };

  const handleFieldChange = (fieldKey, value) => {
    console.log('TestModal: Field change:', fieldKey, 'value:', value, 'type:', typeof value);
    setFieldValues(prev => ({
      ...prev,
      [fieldKey]: value
    }));
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
        <h3 className="text-lg font-semibold">Test Modal - Step 4: Add actual field rendering</h3>
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
          <h4 className="font-medium">Chat History: {chatHistory.length} messages</h4>
          <p>Active Field Helper: {activeFieldHelper || 'None'}</p>
        </div>
        
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

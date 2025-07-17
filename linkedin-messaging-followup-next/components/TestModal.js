"use client";
import React, { useState, useEffect } from 'react';

const TestModal = ({ isOpen, onClose, attribute }) => {
  const [fieldValues, setFieldValues] = useState({});

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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 z-50">
      <div className="relative top-10 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
        <h3 className="text-lg font-semibold">Test Modal - Step 1: useEffect + fieldValues</h3>
        <p>ID: {String(attribute?.id || 'N/A')}</p>
        <p>Name: {String(attribute?.heading || 'N/A')}</p>
        <p>Max Points: {String(attribute?.maxPoints || 'N/A')}</p>
        
        <div className="mt-4 p-2 bg-gray-100 rounded">
          <h4 className="font-medium">Field Values State:</h4>
          <p>Heading: {fieldValues.heading}</p>
          <p>Max Points: {fieldValues.maxPoints}</p>
          <p>Active: {String(fieldValues.active)}</p>
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

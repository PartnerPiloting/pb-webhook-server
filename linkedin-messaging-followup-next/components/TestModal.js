"use client";
import React from 'react';

const TestModal = ({ isOpen, onClose, attribute }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 z-50">
      <div className="relative top-10 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
        <h3 className="text-lg font-semibold">Test Modal</h3>
        <p>ID: {String(attribute?.id || 'N/A')}</p>
        <p>Name: {String(attribute?.heading || 'N/A')}</p>
        <p>Max Points: {String(attribute?.maxPoints || 'N/A')}</p>
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

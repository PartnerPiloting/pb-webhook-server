"use client";
import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { CogIcon, AcademicCapIcon, DocumentTextIcon } from '@heroicons/react/24/outline';
import { getAttributes, saveAttribute } from '../services/api';
import AIEditModal from './AIEditModal';

const Settings = () => {
  const searchParams = useSearchParams();
  const serviceLevel = parseInt(searchParams.get('level') || '2');
  const [activeSection, setActiveSection] = useState('lead-scoring');
  const [attributes, setAttributes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isAIModalOpen, setIsAIModalOpen] = useState(false);
  const [selectedAttribute, setSelectedAttribute] = useState(null);

  // Available settings sections based on service level
  const settingsSections = [
    {
      id: 'lead-scoring',
      name: 'Lead Scoring Setup',
      icon: AcademicCapIcon,
      description: 'Configure AI-powered lead scoring attributes',
      minLevel: 1
    },
    {
      id: 'post-scoring',
      name: 'Post Scoring Setup',
      icon: DocumentTextIcon,
      description: 'Configure AI-powered post scoring attributes',
      minLevel: 2
    }
  ];

  const availableSections = settingsSections.filter(section => section.minLevel <= serviceLevel);

  const handleOpenAIEdit = (attribute) => {
    setSelectedAttribute(attribute);
    setIsAIModalOpen(true);
  };

  const handleCloseAIModal = () => {
    setIsAIModalOpen(false);
    setSelectedAttribute(null);
  };

  const handleSaveAttribute = async (attributeId, updatedData) => {
    try {
      await saveAttribute(attributeId, updatedData);
      // Reload attributes to show changes
      const data = await getAttributes();
      setAttributes(data.attributes || []);
    } catch (err) {
      console.error('Error saving attribute:', err);
      throw err;
    }
  };

  // Load attributes from your backend
  useEffect(() => {
    const loadAttributes = async () => {
      try {
        setLoading(true);
        const data = await getAttributes();
        setAttributes(data.attributes || []);
      } catch (err) {
        console.error('Error loading attributes:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    if (activeSection === 'lead-scoring') {
      loadAttributes();
    }
  }, [activeSection]);

  const renderLeadScoringSection = () => {
    if (loading) {
      return (
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      );
    }

    if (error) {
      return (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <h3 className="text-red-800 font-medium mb-2">Error Loading Attributes</h3>
          <p className="text-red-600">{error}</p>
          <button 
            onClick={() => window.location.reload()} 
            className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="text-blue-800 font-medium mb-2">AI-Powered Attribute Editing</h3>
          <p className="text-blue-600 mb-4">
            Use artificial intelligence to improve your lead scoring criteria. Our AI can help refine 
            attribute descriptions, adjust point values, and optimize scoring rules based on best practices.
          </p>
          <div className="text-sm text-blue-500">
            💡 Click "Edit with AI" on any attribute to get intelligent suggestions
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">Lead Scoring Attributes</h3>
            <p className="text-sm text-gray-500 mt-1">
              {attributes.length} attributes configured • AI editing available
            </p>
          </div>
          
          <div className="divide-y divide-gray-200 max-w-4xl">
            {attributes.map((attribute) => (
              <div key={attribute.id} className="px-6 py-4 hover:bg-gray-50">
                <div className="flex items-start space-x-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-3 mb-2">
                      <h4 className="text-sm font-medium text-gray-900">
                        {attribute.heading || '[Unnamed Attribute]'}
                      </h4>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        attribute.active !== false 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {attribute.active !== false ? 'Active' : 'Inactive'}
                      </span>
                      {attribute.isEmpty && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                          Needs Setup
                        </span>
                      )}
                    </div>
                    <div className="flex items-center space-x-4 text-sm text-gray-500">
                      <span>Max Points: {attribute.maxPoints}</span>
                      <span>Min to Qualify: {attribute.minToQualify}</span>
                      {attribute.penalty && <span>Penalty: {attribute.penalty}</span>}
                      <span className="capitalize">{attribute.category}</span>
                    </div>
                  </div>
                  <div className="flex-shrink-0">
                    <button 
                      className="inline-flex items-center px-3 py-1.5 border border-gray-300 shadow-sm text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50"
                      onClick={() => handleOpenAIEdit(attribute)}
                    >
                      <CogIcon className="h-3 w-3 mr-1" />
                      Edit with AI
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderPostScoringSection = () => {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
        <h3 className="text-yellow-800 font-medium mb-2">Post Scoring Setup</h3>
        <p className="text-yellow-600 mb-4">
          Configure AI-powered post scoring attributes to identify high-relevance LinkedIn posts 
          from your leads that are ready for engagement.
        </p>
        <div className="text-sm text-yellow-500">
          🚧 Post scoring attribute editor coming soon!
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Settings Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Settings</h2>
        <p className="mt-1 text-sm text-gray-500">
          Configure your lead scoring system and AI-powered tools
        </p>
      </div>

      {/* Settings Navigation */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {availableSections.map((section) => {
            const Icon = section.icon;
            const isActive = activeSection === section.id;
            
            return (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={`${
                  isActive
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                } whitespace-nowrap flex items-center py-2 px-1 border-b-2 font-medium text-sm transition-colors duration-200`}
              >
                <Icon className="h-5 w-5 mr-2" />
                <div>
                  <div>{section.name}</div>
                  <div className="text-xs text-gray-400 font-normal">
                    {section.description}
                  </div>
                </div>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Settings Content */}
      <div className="mt-6">
        {activeSection === 'lead-scoring' && renderLeadScoringSection()}
        {activeSection === 'post-scoring' && renderPostScoringSection()}
      </div>

      {/* AI Edit Modal */}
      <AIEditModal
        isOpen={isAIModalOpen}
        onClose={handleCloseAIModal}
        attribute={selectedAttribute}
        onSave={handleSaveAttribute}
      />
    </div>
  );
};

export default Settings;

"use client";
import React, { useState, useEffect } from 'react';
import { searchLeads } from '../services/api';

const LeadSearchUpdate = () => {
  const [leads, setLeads] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Fetch leads on mount
  useEffect(() => {
    fetchLeads();
  }, []);

  const fetchLeads = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const results = await searchLeads('');
      console.log('Fetched leads:', results);
      setLeads(results || []);
    } catch (err) {
      console.error('Error fetching leads:', err);
      setError('Failed to load leads');
    } finally {
      setIsLoading(false);
    }
  };

  // Super simple render - just names
  return (
    <div style={{ padding: '20px' }}>
      <h1>Lead List (Simple Version)</h1>
      
      {isLoading && <p>Loading...</p>}
      
      {error && <p style={{ color: 'red' }}>{error}</p>}
      
      {!isLoading && !error && (
        <div>
          <p>Found {leads.length} leads</p>
          <ul>
            {leads.map((lead, index) => (
              <li key={index}>
                {lead['First Name'] || 'No first name'} {lead['Last Name'] || 'No last name'}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default LeadSearchUpdate;

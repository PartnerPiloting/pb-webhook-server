"use client";
import React from 'react';
import Layout from '../../components/Layout';
import NewLeadForm from '../../components/NewLeadForm';

export default function NewLeadsPage() {
  const handleLeadCreated = (newLead) => {
    // Optional: Add any specific actions after lead creation
    // For example, you could show a toast notification or redirect
    console.log('New lead created:', newLead);
  };

  return (
    <Layout>
      <div className="p-8">
        <NewLeadForm onLeadCreated={handleLeadCreated} />
      </div>
    </Layout>
  );
} 
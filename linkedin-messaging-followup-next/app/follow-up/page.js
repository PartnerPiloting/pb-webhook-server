'use client';
import React from 'react';
import Layout from '../../components/Layout';
import FollowUpManager from '../../components/FollowUpManager';

export default function FollowUpPage() {
  return (
    <Layout>
      <div className="p-8">
        <FollowUpManager />
      </div>
    </Layout>
  );
} 
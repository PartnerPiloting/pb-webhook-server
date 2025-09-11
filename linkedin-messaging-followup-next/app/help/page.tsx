"use client";
import React from 'react';
import Layout from '../../components/Layout';
import ErrorBoundary from '../../components/ErrorBoundary';
import EnvironmentValidator from '../../components/EnvironmentValidator';

export const dynamic = 'force-dynamic';

export default function HelpPage() {
  return (
    <EnvironmentValidator>
      <ErrorBoundary>
        <Layout>
          <div className="bg-white p-6 rounded border border-gray-200 shadow-sm">
            <h2 className="text-xl font-semibold mb-3">Help Center (Coming Soon)</h2>
            <p className="text-sm text-gray-600 mb-4">This is a placeholder. The Start Here section is live. The full help center with search, topic bodies, related links, and contextual panels will arrive in later phases.</p>
            <ul className="list-disc ml-5 text-sm text-gray-700 space-y-1">
              <li>Phase 1 (now): Start Here hierarchical browsing</li>
              <li>Phase 2: Topic bodies & rich formatting</li>
              <li>Phase 3: Contextual in-app help panels</li>
              <li>Phase 4: Search & related recommendations</li>
            </ul>
          </div>
        </Layout>
      </ErrorBoundary>
    </EnvironmentValidator>
  );
}

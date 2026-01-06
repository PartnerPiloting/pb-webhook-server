"use client";
import React, { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentClientId } from '../../utils/clientUtils';
import { getBackendBase } from '../../services/api';
import { CogIcon, ArrowTopRightOnSquareIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';

const OWNER_CLIENT_ID = 'Guy-Wilson';

// Function to get owner resources with dynamic backend URL
const getOwnerSections = (backendBase) => [
  {
    title: '➕ Create & Onboard',
    links: [
      { label: 'Onboard New Client', url: 'https://airtable.com/appYLxKgtTYFPxQG1/tblkHNxMf47DFQY1r', description: 'Add to Clients table' },
      { label: 'Task Templates', url: 'https://airtable.com/appYLxKgtTYFPxQG1/tblm59cOhCPiX9fK3', description: 'Edit onboarding tasks' },
      { label: 'Client Tasks', url: 'https://airtable.com/appYLxKgtTYFPxQG1/tblpf05eBs4lxjEQv', description: 'View/add client tasks' }
    ]
  },
  {
    title: '📊 Settings & Config',
    links: [
      { label: 'System Settings', url: 'https://airtable.com/appYLxKgtTYFPxQG1/tblLZgxZVp6AnbkCl', description: 'Global config' },
      { label: 'Master Clients Base', url: 'https://airtable.com/appYLxKgtTYFPxQG1', description: 'Full base view' }
    ]
  },
  {
    title: '🛠️ Dev Tools',
    links: [
      { label: 'API Explorer', url: `${backendBase}/api-explorer`, description: 'Test all endpoints' },
      { label: 'Render Dashboard', url: 'https://dashboard.render.com/web/srv-cso4l1rv2p9s73dhnl0g', description: 'Logs & deploys' },
      { label: 'GitHub Repo', url: 'https://github.com/PartnerPiloting/pb-webhook-server', description: 'Source code' }
    ]
  }
];

const getOwnerQuickActions = (backendBase) => [
  { label: '🆕 New Client', url: 'https://airtable.com/appYLxKgtTYFPxQG1/tblkHNxMf47DFQY1r', primary: true },
  { label: '📋 Templates', url: 'https://airtable.com/appYLxKgtTYFPxQG1/tblm59cOhCPiX9fK3', primary: false },
  { label: '👥 Coached Clients', url: '/coached-clients', primary: false, internal: true }
];

export default function OwnerDashboardPage() {
  const router = useRouter();
  const currentClientId = getCurrentClientId();
  const isOwner = currentClientId === OWNER_CLIENT_ID;

  // Get dynamic URLs based on current environment
  const backendBase = getBackendBase();
  const ownerSections = useMemo(() => getOwnerSections(backendBase), [backendBase]);
  const ownerQuickActions = useMemo(() => getOwnerQuickActions(backendBase), [backendBase]);

  // Not owner - show access denied
  if (!isOwner) {
    return (
      <div className="max-w-2xl mx-auto mt-16">
        <div className="bg-red-50 border border-red-200 rounded-lg p-8 text-center">
          <ExclamationTriangleIcon className="h-16 w-16 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-red-800 mb-2">Access Denied</h2>
          <p className="text-red-600">
            The Owner Dashboard is only available to system administrators.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CogIcon className="h-8 w-8 text-amber-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Owner Dashboard</h1>
            <p className="text-gray-600">Admin tools and resources</p>
          </div>
        </div>
        
        {/* Quick Actions */}
        <div className="flex gap-2">
          {ownerQuickActions.map((action, idx) => (
            action.internal ? (
              <button
                key={idx}
                onClick={() => router.push(action.url)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  action.primary 
                    ? 'bg-amber-600 text-white hover:bg-amber-700' 
                    : 'bg-white text-amber-700 border border-amber-300 hover:bg-amber-50'
                }`}
              >
                {action.label}
              </button>
            ) : (
              <a
                key={idx}
                href={action.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  action.primary 
                    ? 'bg-amber-600 text-white hover:bg-amber-700' 
                    : 'bg-white text-amber-700 border border-amber-300 hover:bg-amber-50'
                }`}
              >
                {action.label}
              </a>
            )
          ))}
        </div>
      </div>

      {/* Main Dashboard Panel */}
      <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-lg p-6">
        {/* Organized Sections */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {ownerSections.map((section, sectionIdx) => (
            <div key={sectionIdx} className="bg-white/80 rounded-lg p-4 border border-amber-100 shadow-sm">
              <h3 className="text-base font-semibold text-amber-800 mb-3">{section.title}</h3>
              <div className="space-y-2">
                {section.links.map((link, linkIdx) => (
                  <a
                    key={linkIdx}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between p-3 rounded-lg hover:bg-amber-50 transition-colors group border border-transparent hover:border-amber-200"
                  >
                    <div>
                      <span className="text-sm font-medium text-gray-700 group-hover:text-amber-800">{link.label}</span>
                      <p className="text-xs text-gray-400 mt-0.5">{link.description}</p>
                    </div>
                    <ArrowTopRightOnSquareIcon className="h-4 w-4 text-gray-300 group-hover:text-amber-500 flex-shrink-0" />
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Info */}
      <div className="mt-6 p-4 bg-amber-50 border border-amber-100 rounded-lg">
        <h4 className="text-sm font-medium text-amber-800 mb-2">Quick Reference</h4>
        <ul className="text-sm text-amber-700 space-y-1">
          <li>• <strong>Sync Tasks:</strong> Click "Sync" on any client card in Coached Clients to add new templates</li>
          <li>• <strong>New Templates:</strong> Add to Task Templates table - they auto-copy to new clients on onboard</li>
          <li>• <strong>API Explorer:</strong> {backendBase}/api-explorer</li>
        </ul>
      </div>
    </div>
  );
}

import React from 'react';
import { UserPlusIcon } from '@heroicons/react/24/outline';

const NewLeads = () => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">New Leads</h2>
        <p className="mt-1 text-sm text-gray-600">
          Review and process recently added leads.
        </p>
      </div>

      <div className="text-center py-12">
        <UserPlusIcon className="mx-auto h-12 w-12 text-gray-400" />
        <h3 className="mt-2 text-sm font-medium text-gray-900">New Leads Processing</h3>
        <p className="mt-1 text-sm text-gray-500">
          This screen will show recently added leads that need initial processing.
        </p>
        <div className="mt-4 text-xs text-gray-400">
          Coming in Phase 2 implementation
        </div>
      </div>
    </div>
  );
};

export default NewLeads;

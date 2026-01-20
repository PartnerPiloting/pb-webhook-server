"use client";

export default function ClientCodeEntry({ error = null }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
        <div className="text-center mb-6">
          <div className="text-blue-600 mb-4">
            <svg className="h-16 w-16 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Required</h2>
          <p className="text-gray-600">
            Please use the secure link your coach sent you to access this portal.
          </p>
        </div>

        {error && (
          <div className="bg-amber-50 border border-amber-200 rounded-md p-4 mb-6">
            <p className="text-sm text-amber-800">{error}</p>
          </div>
        )}

        <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
          <h3 className="font-medium text-blue-900 mb-2">How to access:</h3>
          <ul className="text-sm text-blue-800 space-y-2">
            <li>• Check your email for a link from your coach</li>
            <li>• Bookmark that link for easy access in the future</li>
            <li>• If you can't find it, contact your coach for a new link</li>
          </ul>
        </div>

        <div className="mt-6 pt-6 border-t border-gray-200">
          <p className="text-xs text-gray-500 text-center">
            Need help? Contact your Australian Side Hustles coach.
          </p>
        </div>
      </div>
    </div>
  );
}


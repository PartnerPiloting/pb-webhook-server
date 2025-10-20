import Link from 'next/link';

export default function MembershipRequired() {
  const benefitsUrl = process.env.NEXT_PUBLIC_PORTAL_BENEFITS_URL || 'https://australiansidehustles.com.au/portal-benefits/';
  
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            Membership Required
          </h1>
          
          <div className="mb-6">
            <svg 
              className="mx-auto h-16 w-16 text-blue-500" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={2} 
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" 
              />
            </svg>
          </div>
          
          <p className="text-gray-600 mb-8">
            You need an active Australian Side Hustles membership to access the LinkedIn Lead Workspace.
          </p>
          
          <div className="space-y-4">
            <a
              href={benefitsUrl}
              className="block w-full bg-blue-600 text-white font-semibold py-3 px-6 rounded-lg hover:bg-blue-700 transition-colors"
            >
              Learn About Membership Benefits
            </a>
            
            <a
              href="https://australiansidehustles.com.au/contact/"
              className="block w-full bg-gray-200 text-gray-700 font-semibold py-3 px-6 rounded-lg hover:bg-gray-300 transition-colors"
            >
              Contact Support
            </a>
          </div>
          
          <p className="text-sm text-gray-500 mt-8">
            Already a member? Contact your coach to get your access link.
          </p>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import ClientIdPrompt from '../../components/ClientIdPrompt';
import { setCurrentClientId, getCurrentClientId } from '../../utils/clientUtils';

// Lazy-load the Quick Update modal
const QuickUpdateModal = dynamic(() => import('../../components/QuickUpdateModal'), { ssr: false });

function QuickUpdateContent() {
  const searchParams = useSearchParams();
  const [clientId, setClientId] = useState<string | null>(null);
  const [showClientPrompt, setShowClientPrompt] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Check for client from URL params first
    const urlClient = searchParams.get('client') || searchParams.get('testClient');
    
    if (urlClient) {
      setCurrentClientId(urlClient);
      setClientId(urlClient);
      setIsReady(true);
    } else {
      // Check localStorage
      const storedClient = getCurrentClientId();
      if (storedClient) {
        setClientId(storedClient);
        setIsReady(true);
      } else {
        setShowClientPrompt(true);
      }
    }
  }, [searchParams]);

  // Show client selection prompt if needed
  if (showClientPrompt) {
    return <ClientIdPrompt />;
  }

  // Loading state
  if (!isReady || !clientId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  // Render the Quick Update as a standalone page (not modal)
  return (
    <QuickUpdateModal
      isOpen={true}
      onClose={() => {
        // In standalone mode, this shouldn't be called but just in case
        window.location.href = `/?client=${clientId}`;
      }}
      clientId={clientId as unknown as null}
      standalone={true}
    />
  );
}

export default function QuickUpdatePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500">Loading Quick Update...</div>
      </div>
    }>
      <QuickUpdateContent />
    </Suspense>
  );
}

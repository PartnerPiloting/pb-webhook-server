import { Metadata } from 'next';

export const metadata: Metadata = {
  title: '🆕 New Leads',
};

export default function NewLeadsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

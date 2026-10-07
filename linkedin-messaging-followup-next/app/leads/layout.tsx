import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Leads',
};

export default function LeadsPageLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

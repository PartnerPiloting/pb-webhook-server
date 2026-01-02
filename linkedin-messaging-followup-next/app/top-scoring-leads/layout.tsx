import { Metadata } from 'next';

export const metadata: Metadata = {
  title: '⭐ Top Leads',
};

export default function TopScoringLeadsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

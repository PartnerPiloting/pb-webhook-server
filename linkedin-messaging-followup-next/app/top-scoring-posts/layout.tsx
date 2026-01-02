import { Metadata } from 'next';

export const metadata: Metadata = {
  title: '📊 Top Posts',
};

export default function TopScoringPostsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

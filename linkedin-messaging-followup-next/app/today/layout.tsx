import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Today',
};

export default function TodayPageLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

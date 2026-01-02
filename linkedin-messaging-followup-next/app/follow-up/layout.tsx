import { Metadata } from 'next';

export const metadata: Metadata = {
  title: '💬 Follow Up',
};

export default function FollowUpLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

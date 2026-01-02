import { Metadata } from 'next';

export const metadata: Metadata = {
  title: '❓ Help',
};

export default function HelpLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Setup and help',
};

export default function SetupPageLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

import { Metadata } from 'next';

export const metadata: Metadata = {
  title: '🎯 Start Here',
};

export default function StartHereLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

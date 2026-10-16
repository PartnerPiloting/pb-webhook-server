import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Where Wingguy lives',
};

export default function StartHereLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

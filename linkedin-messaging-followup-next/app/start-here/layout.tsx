import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'What Wingguy can do',
};

export default function StartHereLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

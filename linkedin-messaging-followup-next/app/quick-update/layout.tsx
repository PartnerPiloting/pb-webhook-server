import { Metadata } from 'next';

export const metadata: Metadata = {
  title: '✏️ Quick Update',
};

export default function QuickUpdateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

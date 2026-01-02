import { Metadata } from 'next';

export const metadata: Metadata = {
  title: '✏️ Quick Update',
  icons: {
    icon: '/favicon-quick-update.svg',
  },
};

export default function QuickUpdateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

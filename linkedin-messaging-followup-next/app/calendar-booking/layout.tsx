import { Metadata } from 'next';

export const metadata: Metadata = {
  title: '📅 Book',
  icons: {
    icon: '/favicon-calendar.svg',
  },
};

export default function CalendarBookingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

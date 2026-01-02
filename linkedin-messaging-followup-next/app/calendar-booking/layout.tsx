import { Metadata } from 'next';

export const metadata: Metadata = {
  title: '📅 Book',
};

export default function CalendarBookingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

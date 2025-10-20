import "./globals.css";
import MembershipGate from "@/components/MembershipGate";
import { Suspense } from "react";

export const metadata = {
  title: "LinkedIn Lead Workspace",
  description: "Find the right people. Start the right conversations.",
};

// Force dynamic rendering for all pages since we use searchParams
export const dynamic = 'force-dynamic';

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <Suspense fallback={<div>Loading...</div>}>
          <MembershipGate>
            {children}
          </MembershipGate>
        </Suspense>
      </body>
    </html>
  );
}

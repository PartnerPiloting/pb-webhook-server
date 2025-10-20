import "./globals.css";
import MembershipGate from "@/components/MembershipGate";

export const metadata = {
  title: "LinkedIn Follow-Up Portal",
  description: "Multi-Tenant Lead Management System",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <MembershipGate>
          {children}
        </MembershipGate>
      </body>
    </html>
  );
}

import "./globals.css";
import MembershipGate from "@/components/MembershipGate";

export const metadata = {
  title: "LinkedIn Lead Workspace",
  description: "Find the right people. Start the right conversations.",
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

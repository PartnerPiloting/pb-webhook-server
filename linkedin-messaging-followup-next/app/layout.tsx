import "./globals.css";

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
        {children}
      </body>
    </html>
  );
}

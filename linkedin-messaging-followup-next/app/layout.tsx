import "./globals.css";
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: "🚀 Wingguy Network Accelerator",
  description: "Score leads — Start conversations — Close deals",
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

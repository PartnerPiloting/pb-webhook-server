import "./globals.css";

export const metadata = {
  title: "LinkedIn Lead Workspace",
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

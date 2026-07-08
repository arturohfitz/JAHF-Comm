import type { Metadata } from "next";
import { APP_NAME } from "@jahf-comm/shared";

import "./globals.css";

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Multi-tenant communication operations foundation"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

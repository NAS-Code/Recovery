import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Vendelux Concierge",
  description: "No-show recovery and meeting management"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}

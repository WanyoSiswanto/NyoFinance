import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NyoFinance — Keuangan Keluarga",
  description:
    "Aplikasi keuangan keluarga: kelola keuangan rumah tangga bersama pasangan.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id" className="h-full antialiased">
      <body className="min-h-full bg-stone-50 text-stone-900 antialiased">
        {children}
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import AssistantWidget from "@/components/AssistantWidget";
import SupportCenter from "@/components/SupportCenter";

export const metadata: Metadata = {
  title: "AgentAd Audit & Bidding Platform",
  description: "Web3 Ad Audit, Creative Analysis & Bidding Simulation",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <AuthProvider>
          <Sidebar>{children}</Sidebar>
          <AssistantWidget />
          <SupportCenter />
        </AuthProvider>
      </body>
    </html>
  );
}

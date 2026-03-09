import type { ReactNode } from "react";
import { buildPrivateMetadata } from "@/lib/seo";

export const metadata = buildPrivateMetadata("Extension Authentication", "/auth");

export default function AuthLayout({ children }: { children: ReactNode }) {
  return children;
}

import type { ReactNode } from "react";
import { buildPrivateMetadata } from "@/lib/seo";

export const metadata = buildPrivateMetadata("Legacy Onboarding", "/legacy-onboarding");

export default function LegacyOnboardingLayout({ children }: { children: ReactNode }) {
  return children;
}

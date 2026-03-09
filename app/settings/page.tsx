import { redirect } from "next/navigation";
import { buildPrivateMetadata } from "@/lib/seo";

export const metadata = buildPrivateMetadata("Settings", "/settings");

export default function SettingsPage() {
  redirect("/settings/profile");
}

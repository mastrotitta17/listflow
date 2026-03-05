import { redirect } from "next/navigation";

export default function AdminExtensionLogsRedirectPage() {
  redirect("/admin/listings?tab=logs");
}


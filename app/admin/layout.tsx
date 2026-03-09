import type { Metadata } from "next";
import { assertAdminPageAccess } from "@/lib/auth/admin";
import AdminLayoutShell from "@/components/admin/AdminLayoutShell";
import type { AdminNavItem } from "@/components/admin/AdminNav";

export const metadata: Metadata = {
  title: "Admin | listflow.pro",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

const NAV_ITEMS: AdminNavItem[] = [
  { href: "/admin", label: "Genel", icon: "home" },
  { href: "/admin/categories", label: "Kategoriler", icon: "categories" },
  { href: "/admin/users", label: "Kullanıcılar", icon: "users" },
  { href: "/admin/stores", label: "Mağazalar", icon: "stores" },
  { href: "/admin/listings", label: "Listing Takibi", icon: "listings" },
  { href: "/admin/learn-guides", label: "Learn İçerikleri", icon: "learn" },
  { href: "/admin/payments", label: "Ödemeler", icon: "payments" },
  { href: "/admin/subscriptions", label: "Abonelikler", icon: "subscriptions" },
  { href: "/admin/webhooks", label: "Webhook Console", icon: "webhooks" },
  { href: "/admin/push", label: "Mobil Bildirim", icon: "push" },
  { href: "/admin/stripe", label: "Stripe", icon: "stripe" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await assertAdminPageAccess();

  return <AdminLayoutShell items={NAV_ITEMS}>{children}</AdminLayoutShell>;
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  BadgeDollarSign,
  BellRing,
  BookOpen,
  CreditCard,
  FolderTree,
  Home,
  ListChecks,
  Store,
  Users,
  WalletCards,
  Webhook,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type AdminNavIcon =
  | "home"
  | "categories"
  | "users"
  | "stores"
  | "listings"
  | "learn"
  | "payments"
  | "subscriptions"
  | "webhooks"
  | "push"
  | "stripe";

export type AdminNavItem = {
  href: string;
  label: string;
  icon: AdminNavIcon;
};

const ICON_BY_KEY: Record<AdminNavIcon, LucideIcon> = {
  home: Home,
  categories: FolderTree,
  users: Users,
  stores: Store,
  listings: ListChecks,
  learn: BookOpen,
  payments: WalletCards,
  subscriptions: CreditCard,
  webhooks: Webhook,
  push: BellRing,
  stripe: BadgeDollarSign,
};

export default function AdminNav({
  items,
  collapsed = false,
  onNavigate,
}: {
  items: AdminNavItem[];
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav className="grid gap-2">
      {items.map((item) => {
        const Icon = ICON_BY_KEY[item.icon];
        const isRootItem = item.href === "/admin";
        const active = isRootItem
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            title={collapsed ? item.label : undefined}
            className={cn(
              "rounded-xl border py-2 text-[11px] font-black uppercase tracking-widest transition-colors flex items-center gap-2",
              collapsed ? "justify-center px-2" : "px-3",
              active
                ? "border-indigo-500/40 bg-indigo-500/20 text-white"
                : "border-transparent text-slate-400 hover:border-white/10 hover:bg-white/5 hover:text-slate-100"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className={cn(collapsed ? "sr-only" : "inline")}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

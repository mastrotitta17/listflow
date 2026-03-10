"use client";

import Link from "next/link";
import { Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import AdminNav, { type AdminNavItem } from "@/components/admin/AdminNav";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useState } from "react";

type AdminLayoutShellProps = {
  items: AdminNavItem[];
  children: React.ReactNode;
};

export default function AdminLayoutShell({ items, children }: AdminLayoutShellProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 hidden border-r border-indigo-500/10 bg-[#0b0d14] md:flex md:flex-col",
          "transition-[width] duration-300",
          collapsed ? "md:w-20" : "md:w-72"
        )}
      >
        <div className={cn("flex items-center border-b border-white/10 p-3", collapsed ? "justify-center" : "justify-between")}>
          {!collapsed ? (
            <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-300">Admin Menu</p>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 cursor-pointer text-slate-300 hover:text-white"
            onClick={() => setCollapsed((prev) => !prev)}
            aria-label={collapsed ? "Sidebar genişlet" : "Sidebar daralt"}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <AdminNav items={items} collapsed={collapsed} />
        </div>
      </aside>

      <div className={cn("min-h-screen transition-[margin-left] duration-300", collapsed ? "md:ml-20" : "md:ml-72")}>
        <header className="sticky top-0 z-30 flex h-20 items-center justify-between border-b border-indigo-500/10 glass-pro px-4 sm:px-6 lg:px-10">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 cursor-pointer md:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Menüyü aç"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <h1 className="text-xl font-black tracking-tight uppercase">Admin Paneli</h1>
          </div>

          <Button asChild variant="secondary" size="sm" className="cursor-pointer">
            <Link href="/">Uygulamaya Dön</Link>
          </Button>
        </header>

        <main className="w-full px-3 py-6 sm:px-6 sm:py-8">{children}</main>
      </div>

      <div
        className={cn(
          "fixed inset-0 z-50 md:hidden",
          mobileOpen ? "pointer-events-auto" : "pointer-events-none"
        )}
        aria-hidden={!mobileOpen}
      >
        <div
          className={cn(
            "absolute inset-0 bg-black/65 transition-opacity duration-200",
            mobileOpen ? "opacity-100" : "opacity-0"
          )}
          onClick={() => setMobileOpen(false)}
        />

        <aside
          className={cn(
            "absolute inset-y-0 left-0 w-72 border-r border-indigo-500/20 bg-[#0b0d14] shadow-2xl",
            "transition-transform duration-300",
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <div className="flex items-center justify-between border-b border-white/10 p-3">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-300">Admin Menu</p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 cursor-pointer text-slate-300 hover:text-white"
              onClick={() => setMobileOpen(false)}
              aria-label="Menüyü kapat"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="p-3">
            <AdminNav
              items={items}
              collapsed={false}
              onNavigate={() => setMobileOpen(false)}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}


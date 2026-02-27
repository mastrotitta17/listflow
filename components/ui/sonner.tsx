"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group z-[99999]"
      style={{ zIndex: 99999 }}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:border-white/20 group-[.toaster]:bg-[#141824] group-[.toaster]:text-white group-[.toaster]:shadow-2xl",
          description: "group-[.toast]:text-slate-300",
          actionButton:
            "group-[.toast]:bg-indigo-600 group-[.toast]:text-white group-[.toast]:cursor-pointer",
          cancelButton:
            "group-[.toast]:bg-white/5 group-[.toast]:text-slate-200 group-[.toast]:cursor-pointer",
          success:
            "group-[.toaster]:!border-emerald-400/60 group-[.toaster]:!bg-[rgba(6,95,70,0.96)] group-[.toaster]:!text-emerald-100",
          error:
            "group-[.toaster]:!border-red-400/60 group-[.toaster]:!bg-[rgba(127,29,29,0.96)] group-[.toaster]:!text-red-100",
          warning:
            "group-[.toaster]:!border-amber-400/60 group-[.toaster]:!bg-[rgba(120,53,15,0.96)] group-[.toaster]:!text-amber-100",
          info:
            "group-[.toaster]:!border-indigo-400/60 group-[.toaster]:!bg-[rgba(55,48,163,0.96)] group-[.toaster]:!text-indigo-100",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };

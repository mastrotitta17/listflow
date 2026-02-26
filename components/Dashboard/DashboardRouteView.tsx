"use client";

import React from "react";
import Dashboard from "./Dashboard";
import CrispChat from "@/components/CrispChat";
import { DashboardSection } from "@/types";

type DashboardRouteViewProps = {
  section: DashboardSection;
  categorySlug?: string | null;
};

const DashboardRouteView: React.FC<DashboardRouteViewProps> = ({ section, categorySlug = null }) => {
  return (
    <>
      <Dashboard routeSection={section} routeCategorySlug={categorySlug} disableTour />
      <CrispChat />
    </>
  );
};

export default DashboardRouteView;

"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import { hideCrispChat, pushCrisp, syncCrispVisitorIdentity } from "@/lib/crisp";

export default function CrispChat() {
  useEffect(() => {
    let mounted = true;

    const syncVisitorIdentity = async () => {
      if (!mounted) {
        return;
      }

      const result = await syncCrispVisitorIdentity({
        source: "dashboard",
        section: "dashboard",
      });

      if (!mounted) {
        return;
      }

      if (!result.authenticated) {
        hideCrispChat(true);
        return;
      }

      pushCrisp(["do", "chat:show"]);
    };

    void syncVisitorIdentity();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void syncVisitorIdentity();
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return null;
}

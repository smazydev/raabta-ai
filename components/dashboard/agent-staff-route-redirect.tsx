"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { isAgentStaffAllowedPath } from "@/lib/auth/agent-staff-routes";

/**
 * Bank-employee accounts may only use staff routes (chat + voice). Keeps bookmarked admin URLs
 * from showing the full console.
 */
export function AgentStaffRouteRedirect({ isAgentStaff }: { isAgentStaff: boolean }) {
  const pathname = usePathname();
  const router = useRouter();

  React.useEffect(() => {
    if (!isAgentStaff) return;
    if (!isAgentStaffAllowedPath(pathname)) {
      router.replace("/assistant");
    }
  }, [isAgentStaff, pathname, router]);

  return null;
}

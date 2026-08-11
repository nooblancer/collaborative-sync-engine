"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * The /demo route previously rendered a V1 demo interface using legacy hooks
 * (use-websocket, use-presence, use-inventory). That interface is no longer
 * functional under the V2 protocol. This page now redirects visitors to the
 * /#demos section on the landing page where all interactive demos live.
 */
export default function DemoRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/#demos");
  }, [router]);

  return null;
}

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getOpsToken } from "@/lib/ops-api";

export default function OpsIndexPage() {
  const router = useRouter();
  useEffect(() => {
    if (getOpsToken()) {
      router.replace("/ops/queue");
    } else {
      router.replace("/ops/login");
    }
  }, [router]);
  return null;
}

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getPublisherToken } from "@/lib/publisher-api";

export default function PublisherIndexPage() {
  const router = useRouter();
  useEffect(() => {
    if (getPublisherToken()) {
      router.replace("/publisher/dashboard");
    } else {
      router.replace("/publisher/login");
    }
  }, [router]);
  return null;
}

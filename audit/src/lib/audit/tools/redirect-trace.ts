export interface RedirectHop {
  url: string;
  statusCode: number;
}

export interface RedirectTraceResult {
  hops: RedirectHop[];
  finalUrl: string;
  totalRedirects: number;
  suspicious: boolean;
}

export async function traceRedirects(
  url: string,
  maxRedirects = 10
): Promise<RedirectTraceResult> {
  const hops: RedirectHop[] = [];
  let current = url;

  for (let i = 0; i < maxRedirects; i++) {
    try {
      const res = await fetch(current, {
        redirect: "manual",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; AgentAdAuditBot/1.0)",
        },
      });

      hops.push({ url: current, statusCode: res.status });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) break;
        current = location.startsWith("http")
          ? location
          : new URL(location, current).toString();
      } else {
        break;
      }
    } catch {
      hops.push({ url: current, statusCode: 0 });
      break;
    }
  }

  const finalUrl = hops.length > 0 ? hops[hops.length - 1].url : url;

  // Suspicious if too many redirects or final domain differs greatly from first
  const suspicious =
    hops.length > 3 ||
    (hops.length > 1 &&
      new URL(hops[0].url).hostname !== new URL(finalUrl).hostname);

  return {
    hops,
    finalUrl,
    totalRedirects: hops.length - 1,
    suspicious,
  };
}

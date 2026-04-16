export interface CanonicalizedUrl {
  original: string;
  canonical: string;
  domain: string;
  path: string;
  params: Record<string, string>;
  isShortLink: boolean;
}

const SHORT_LINK_DOMAINS = [
  "bit.ly",
  "t.co",
  "goo.gl",
  "tinyurl.com",
  "ow.ly",
  "is.gd",
  "buff.ly",
  "rebrand.ly",
  "bl.ink",
  "short.io",
];

export function canonicalizeUrl(raw: string): CanonicalizedUrl {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return {
      original: raw,
      canonical: raw,
      domain: "",
      path: "",
      params: {},
      isShortLink: false,
    };
  }

  // Normalize: lowercase host, remove trailing slash, sort params
  const canonical = `${url.protocol}//${url.hostname.toLowerCase()}${
    url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "")
  }`;

  const params: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    params[k] = v;
  });

  const isShortLink = SHORT_LINK_DOMAINS.some(
    (d) => url.hostname.toLowerCase() === d
  );

  return {
    original: raw,
    canonical,
    domain: url.hostname.toLowerCase(),
    path: url.pathname,
    params,
    isShortLink,
  };
}

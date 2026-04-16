export interface DomainReputationResult {
  domain: string;
  registrationAgeDays: number | null;
  hasSSL: boolean;
  riskLevel: "low" | "medium" | "high";
  flags: string[];
}

const KNOWN_SAFE_DOMAINS = [
  "ethereum.org",
  "uniswap.org",
  "aave.com",
  "opensea.io",
  "coinbase.com",
  "binance.com",
];

const SUSPICIOUS_TLDS = [".xyz", ".top", ".click", ".buzz", ".icu", ".fun"];

export async function checkDomainReputation(
  domain: string
): Promise<DomainReputationResult> {
  const flags: string[] = [];

  // Check TLD
  const isSuspiciousTld = SUSPICIOUS_TLDS.some((tld) =>
    domain.toLowerCase().endsWith(tld)
  );
  if (isSuspiciousTld) {
    flags.push("suspicious_tld");
  }

  // Check if it's a known safe domain
  const isSafe = KNOWN_SAFE_DOMAINS.some(
    (safe) => domain.toLowerCase() === safe
  );

  // Check SSL by trying HTTPS
  let hasSSL = false;
  try {
    const res = await fetch(`https://${domain}`, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
    });
    hasSSL = res.ok || res.status < 500;
  } catch {
    hasSSL = false;
    flags.push("no_ssl_or_unreachable");
  }

  // Determine risk level
  let riskLevel: "low" | "medium" | "high" = "low";
  if (isSafe) {
    riskLevel = "low";
  } else if (flags.length >= 2) {
    riskLevel = "high";
  } else if (flags.length >= 1 || isSuspiciousTld) {
    riskLevel = "medium";
  }

  return {
    domain,
    registrationAgeDays: null, // Would use WHOIS API in production
    hasSSL,
    riskLevel,
    flags,
  };
}

import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/db";

export interface AttestationInput {
  auditCaseId: string;
  creativeHash: string;
  destinationUrl: string;
  placementDomains: string[];
  policyVersion: string;
  expiresInDays?: number;
}

export interface AttestationOutput {
  attestationId: string;
  creativeHash: string;
  destinationHash: string;
  placementDomainHash: string;
  policyVersionHash: string;
  issuedAt: number;
  expiresAt: number;
}

function sha256(data: string): string {
  return "0x" + createHash("sha256").update(data).digest("hex");
}

export async function issueAttestation(
  input: AttestationInput
): Promise<AttestationOutput> {
  const attestationId =
    "0x" + randomBytes(32).toString("hex");
  const now = Math.floor(Date.now() / 1000);
  const expiresAt =
    now + (input.expiresInDays ?? 30) * 24 * 60 * 60;

  const destinationHash = sha256(input.destinationUrl);
  const placementDomainHash = sha256(
    input.placementDomains.sort().join(",")
  );
  const policyVersionHash = sha256(input.policyVersion);

  // Save to database
  await prisma.attestation.create({
    data: {
      auditCaseId: input.auditCaseId,
      attestationId,
      chainId: 84532, // Base Sepolia
      status: "ACTIVE",
      issuedAt: new Date(now * 1000),
      expiresAt: new Date(expiresAt * 1000),
    },
  });

  // TODO: In production, call the on-chain contract here
  // const tx = await registryContract.issueAttestation(...)

  return {
    attestationId,
    creativeHash: input.creativeHash,
    destinationHash,
    placementDomainHash,
    policyVersionHash,
    issuedAt: now,
    expiresAt,
  };
}

export async function generateManifest(
  creativeId: string,
  attestation: AttestationOutput,
  creative: {
    projectName: string;
    imageUrl: string;
    clickUrl: string | null;
    landingUrl: string;
  }
) {
  const manifestJson = {
    manifestId: `mf_${randomBytes(8).toString("hex")}`,
    creativeId,
    projectName: creative.projectName,
    creativeUrl: creative.imageUrl,
    clickUrl: creative.clickUrl || creative.landingUrl,
    declaredLandingUrl: creative.landingUrl,
    chainId: 84532,
    registryAddress: process.env.REGISTRY_ADDRESS || "0x0000000000000000000000000000000000000000",
    attestationId: attestation.attestationId,
    creativeHash: attestation.creativeHash,
    destinationHash: attestation.destinationHash,
    policyVersion: "v1.0",
    issuedAt: attestation.issuedAt,
    expiresAt: attestation.expiresAt,
    issuer: process.env.ISSUER_ADDRESS || "0x0000000000000000000000000000000000000000",
    reportUrl: `/api/reports/${attestation.attestationId}`,
  };

  const manifest = await prisma.manifest.create({
    data: {
      creativeId,
      attestationId: attestation.attestationId,
      manifestJson,
    },
  });

  return manifest;
}

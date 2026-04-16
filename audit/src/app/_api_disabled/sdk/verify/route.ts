import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { attestationId, creativeHash, destinationHash, hostname } = body;

  if (!attestationId) {
    return NextResponse.json(
      { error: "attestationId is required" },
      { status: 400 }
    );
  }

  const attestation = await prisma.attestation.findUnique({
    where: { attestationId },
    include: {
      auditCase: {
        include: {
          creative: true,
        },
      },
    },
  });

  if (!attestation) {
    return NextResponse.json({
      status: "unknown",
      attestationStatus: "not_found",
      creativeMatched: false,
      destinationMatched: false,
      domainMatched: false,
    });
  }

  // Check attestation status
  const now = new Date();
  let attestationStatus = attestation.status;
  if (attestationStatus === "ACTIVE" && attestation.expiresAt && attestation.expiresAt < now) {
    attestationStatus = "EXPIRED";
  }

  // Check creative hash match
  const creative = attestation.auditCase.creative;
  const creativeMatched = creativeHash
    ? creative.creativeHash === creativeHash
    : true;

  // Check destination hash (simplified for MVP)
  const destinationMatched = destinationHash ? true : true;

  // Check domain match
  const domainMatched = hostname
    ? creative.placementDomains.length === 0 ||
      creative.placementDomains.includes(hostname)
    : true;

  // Determine overall status
  let status = "verified";
  if (attestationStatus !== "ACTIVE") {
    status = attestationStatus.toLowerCase();
  } else if (!creativeMatched) {
    status = "mismatch_creative";
  } else if (!destinationMatched) {
    status = "mismatch_destination";
  } else if (!domainMatched) {
    status = "mismatch_destination";
  }

  return NextResponse.json({
    status,
    attestationStatus: attestationStatus.toLowerCase(),
    creativeMatched,
    destinationMatched,
    domainMatched,
    issuedAt: attestation.issuedAt
      ? Math.floor(attestation.issuedAt.getTime() / 1000)
      : null,
    expiresAt: attestation.expiresAt
      ? Math.floor(attestation.expiresAt.getTime() / 1000)
      : null,
    explorerUrl: attestation.txHash
      ? `https://sepolia.basescan.org/tx/${attestation.txHash}`
      : null,
  });
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auditCase = await prisma.auditCase.findUnique({
    where: { id: params.id },
    include: {
      creative: true,
      evidences: { orderBy: { createdAt: "asc" } },
      attestation: true,
    },
  });

  if (!auditCase) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(auditCase);
}

// PATCH - manual review decision
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json();
  const { decision, reviewNotes } = body;

  if (!["PASS", "REJECT"].includes(decision)) {
    return NextResponse.json(
      { error: "Decision must be PASS or REJECT" },
      { status: 400 }
    );
  }

  const auditCase = await prisma.auditCase.update({
    where: { id: params.id },
    data: {
      decision,
      status: "COMPLETED",
      summary: reviewNotes
        ? `Manual review: ${reviewNotes}`
        : undefined,
      completedAt: new Date(),
    },
    include: { creative: true },
  });

  await prisma.creative.update({
    where: { id: auditCase.creativeId },
    data: {
      status: decision === "PASS" ? "APPROVED" : "REJECTED",
    },
  });

  return NextResponse.json(auditCase);
}

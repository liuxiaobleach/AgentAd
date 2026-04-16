import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const creative = await prisma.creative.findUnique({
    where: { id: params.id },
    include: {
      auditCases: {
        include: {
          evidences: true,
          attestation: true,
        },
        orderBy: { submittedAt: "desc" },
      },
      manifests: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!creative) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(creative);
}

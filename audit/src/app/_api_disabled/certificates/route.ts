import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const attestations = await prisma.attestation.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      auditCase: {
        include: {
          creative: {
            select: {
              id: true,
              creativeName: true,
              projectName: true,
            },
          },
        },
      },
    },
  });

  return NextResponse.json(attestations);
}

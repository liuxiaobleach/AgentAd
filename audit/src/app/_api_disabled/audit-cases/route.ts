import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const cases = await prisma.auditCase.findMany({
    orderBy: { submittedAt: "desc" },
    include: {
      creative: {
        select: {
          id: true,
          creativeName: true,
          projectName: true,
          imageUrl: true,
        },
      },
      attestation: true,
    },
  });
  return NextResponse.json(cases);
}

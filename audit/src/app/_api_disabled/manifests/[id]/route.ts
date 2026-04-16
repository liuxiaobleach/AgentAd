import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const manifest = await prisma.manifest.findUnique({
    where: { id: params.id },
  });

  if (!manifest) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(manifest.manifestJson);
}

import { connection } from "next/server";
import { getBlockchainInfo } from "@/lib/rpc";

export async function GET() {
  await connection();
  const result = await getBlockchainInfo();

  return Response.json(result, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

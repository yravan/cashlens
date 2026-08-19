import { databaseHealthy } from "@/lib/data/health";

export async function GET() {
  const ok = await databaseHealthy();
  const state = ok ? "ok" : "error";
  return Response.json(
    { status: state, db: state },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}

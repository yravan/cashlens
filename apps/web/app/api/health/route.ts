import { databaseHealthy } from "@/lib/data/health";

export async function GET() {
  const db = await databaseHealthy();
  const state = db ? "ok" : "error";
  return Response.json(
    { status: state, db: state },
    { status: db ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}

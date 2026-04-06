import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};

  try {
    body = await req.json();
  } catch {
    // Malformed JSON -- continue with empty body
  }

  try {
    // Forward request to the Python backend
    const backendRes = await fetch(`${BACKEND_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (backendRes.ok) {
      const data = await backendRes.json();
      return NextResponse.json(data);
    }

    // Backend returned an error -- fall through to placeholder
  } catch {
    // Backend unreachable -- fall through to placeholder
  }

  // -----------------------------------------------------------------------
  // Placeholder response when the backend /api/chat is not available
  // -----------------------------------------------------------------------
  const messages: { role: string; content: string }[] =
    (body?.messages as { role: string; content: string }[]) ?? [];
  const lastUserMsg =
    messages
      .filter((m) => m.role === "user")
      .pop()?.content ?? "";

  let content =
    "I'm CashLens AI. The chat backend is not connected yet, but here's what I'll be able to help you with:\n\n" +
    "- Summarise your spending by category or time period\n" +
    "- Compare months and spot trends\n" +
    "- Answer questions about specific merchants or transactions\n\n" +
    "Start the CashLens API server to enable live responses.";

  if (lastUserMsg) {
    content =
      `You asked: "${lastUserMsg}"\n\n` +
      "The AI backend is not connected yet. Once the CashLens API is running, " +
      "I'll be able to answer questions about your spending, categories, trends, and more.";
  }

  return NextResponse.json({ role: "assistant", content });
}

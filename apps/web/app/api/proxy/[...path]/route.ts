import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { API_BASE_URL, DEMO_USER_EMAIL, clerkEnabled } from "@/lib/runtime";

async function handleProxy(request: Request) {
  const url = new URL(request.url);
  const backendPath = url.pathname.replace("/api/proxy", "");
  const headers = new Headers();
  const contentType = request.headers.get("content-type");

  if (contentType) {
    headers.set("content-type", contentType);
  }
  headers.set("accept", "application/json");

  if (clerkEnabled) {
    const session = await auth();
    if (!session.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const token = await session.getToken();
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    headers.set("authorization", `Bearer ${token}`);
  } else {
    headers.set("x-demo-user-email", DEMO_USER_EMAIL);
  }

  const body =
    request.method === "GET" || request.method === "HEAD" ? undefined : await request.text();

  const response = await fetch(`${API_BASE_URL}${backendPath}${url.search}`, {
    method: request.method,
    headers,
    body,
    cache: "no-store",
  });

  const responseText = await response.text();
  return new Response(responseText, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json",
    },
  });
}

export async function GET(request: Request) {
  return handleProxy(request);
}

export async function POST(request: Request) {
  return handleProxy(request);
}

export async function PATCH(request: Request) {
  return handleProxy(request);
}

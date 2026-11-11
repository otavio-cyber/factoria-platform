import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";

// Endpoints do Better Auth (/api/auth/sign-in/email, /api/auth/sign-out, ...).
export async function GET(request: Request) {
  return toNextJsHandler(getAuth()).GET(request);
}

export async function POST(request: Request) {
  return toNextJsHandler(getAuth()).POST(request);
}

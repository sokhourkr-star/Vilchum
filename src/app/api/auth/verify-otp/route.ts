import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { sign } from "@/lib/auth";
import { verifyOtp } from "@/lib/otp";
import { rateLimitOtpVerify } from "@/lib/rate-limiter";
const schema = z.object({ phone: z.string().regex(/^\+855[0-9]{8,9}$/), code: z.string().regex(/^[0-9]{6}$/) });
export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? "unknown";
  const body: unknown = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Enter your 6-digit code and try again." }, { status: 400 });
  const { allowed, remaining, resetAt } = rateLimitOtpVerify(parsed.data.phone);
  if (!allowed) {
    const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
    return NextResponse.json({ error: "Too many failed attempts. Please wait before trying again." }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }
  if (!verifyOtp(parsed.data.phone, parsed.data.code)) return NextResponse.json({ error: "That code is incorrect or expired. Request a new code and try again." }, { status: 400 });
  const user = await db.user.upsert({ where: { phone: parsed.data.phone }, update: {}, create: { phone: parsed.data.phone } });
  const response = NextResponse.json({ ok: true, rateLimit: { remaining } });
  response.cookies.set("vilchum_session", sign(user.id), { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return response;
}

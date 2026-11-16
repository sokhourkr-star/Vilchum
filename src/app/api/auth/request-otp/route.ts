import { NextResponse } from "next/server";
import { z } from "zod";
import { sendOtp } from "@/lib/otp";
import { rateLimitOtpRequest } from "@/lib/rate-limiter";
const schema = z.object({
  phone: z.string().regex(/^\+855[0-9]{8,9}$/, "Enter a valid Cambodian phone number."),
  telegramChatId: z.string().optional() // Optional Telegram chat ID for OTP delivery
});
export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? "unknown";
  const body: unknown = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the phone number and try again." }, { status: 400 });
  const { allowed, remaining, resetAt } = rateLimitOtpRequest(parsed.data.phone, ip);
  if (!allowed) {
    const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }
  await sendOtp(parsed.data.phone, parsed.data.telegramChatId);
  return NextResponse.json({ ok: true, rateLimit: { remaining } });
}

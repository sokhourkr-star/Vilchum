import { randomInt, timingSafeEqual } from "node:crypto";
import { demoOtpEnabled } from "@/lib/env";
const codes = new Map<string, { code: string; expires: number }>();

/** Send OTP via Telegram bot. Falls back to in-memory storage for demo. */
export async function sendOtp(phone: string, telegramChatId?: string) {
  const code = demoOtpEnabled() ? "123456" : String(randomInt(100000, 1000000));
  codes.set(phone, { code, expires: Date.now() + 5 * 60_000 });

  if (process.env.NODE_ENV !== "production") {
    console.info(`[VilChum demo OTP] ${phone}: ${code}`);
  }

  // Send via Telegram if configured and user has linked their Telegram
  if (telegramChatId && process.env.TELEGRAM_BOT_TOKEN) {
    try {
      await sendTelegramOtp(telegramChatId, code);
    } catch (error) {
      console.error(`[Telegram] Failed to send OTP to ${telegramChatId}:`, error);
      // Don't throw - the OTP is still stored in memory for verification
    }
  }
  // TODO: connect an SMS provider here when available.
}

async function sendTelegramOtp(chatId: string, code: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN!;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const text = `Your VilChum verification code is: <b>${code}</b>\n\nThis code expires in 5 minutes.`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Telegram API error: ${error.description ?? response.status}`);
  }
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyOtp(phone: string, code: string) {
  const saved = codes.get(phone);
  // The fixed demo code is ignored in production even if DEV_OTP is set (startup also refuses it).
  if (demoOtpEnabled() && safeEqual(code, "123456")) return true;
  return !!saved && safeEqual(saved.code, code) && saved.expires > Date.now();
}

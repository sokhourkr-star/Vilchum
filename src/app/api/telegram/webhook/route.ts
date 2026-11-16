import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { timingSafeEqual } from "node:crypto";

// Telegram webhook secret for validating incoming requests
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";

/** Validate the Telegram webhook request using the secret token in the URL path. */
function validateWebhook(request: Request) {
  if (!WEBHOOK_SECRET) return false;
  const url = new URL(request.url);
  const pathParts = url.pathname.split("/");
  // Expected: /api/telegram/webhook/<secret>
  const secretFromPath = pathParts[pathParts.length - 1];
  if (!secretFromPath) return false;
  const a = Buffer.from(secretFromPath);
  const b = Buffer.from(WEBHOOK_SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Handle incoming Telegram messages. */
export async function POST(request: Request) {
  // Validate webhook secret
  if (!validateWebhook(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let update: {
    message?: {
      chat: { id: string | number };
      from: { id: string | number; username?: string };
      text?: string;
      contact?: { phone_number: string };
    };
  } = {};

  try {
    update = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const message = update.message;
  if (!message) return NextResponse.json({ ok: true }); // Ignore non-message updates

  const chatId = String(message.chat.id);
  const telegramUserId = String(message.from.id);
  const username = message.from.username;

  // Handle /start command - prompt user to share their phone number
  if (message.text === "/start") {
    await sendTelegramMessage(chatId, `
Welcome to <b>VilChum</b>! 🌱

To receive OTP codes via Telegram for signing in, please share your phone number with me.

Click the button below to send your phone number:
    `.trim(), {
      reply_markup: {
        keyboard: [[{ text: "📱 Share my phone number", request_contact: true }]],
        one_time_keyboard: true,
        resize_keyboard: true,
      },
    });
    return NextResponse.json({ ok: true });
  }

  // Handle contact sharing - link Telegram account to phone number
  if (message.contact?.phone_number) {
    // Normalize phone number: ensure it starts with +855
    let phone = message.contact.phone_number.trim();
    if (phone.startsWith("0")) phone = "+855" + phone.slice(1);
    else if (!phone.startsWith("+855")) phone = "+855" + phone.replace(/^\+?/, "");

    // Validate Cambodian phone format
    if (!/^\+855[0-9]{8,9}$/.test(phone)) {
      await sendTelegramMessage(chatId, "❌ Invalid phone number format. Please share a valid Cambodian phone number (e.g., +85512345678).");
      return NextResponse.json({ ok: true });
    }

    // Find user by phone number and update their telegramChatId
    const user = await db.user.findUnique({ where: { phone } });
    if (!user) {
      await sendTelegramMessage(chatId, `❌ No VilChum account found with phone number <b>${phone}</b>. Please sign up on the web app first, then try linking again.`);
      return NextResponse.json({ ok: true });
    }

    // Check if this Telegram account is already linked to another user
    const existingLink = await db.user.findUnique({ where: { telegramChatId: chatId } });
    if (existingLink && existingLink.id !== user.id) {
      await sendTelegramMessage(chatId, "❌ This Telegram account is already linked to another VilChum user. Please contact support if you need help.");
      return NextResponse.json({ ok: true });
    }

    // Link the Telegram account
    await db.user.update({
      where: { id: user.id },
      data: { telegramChatId: chatId },
    });

    await sendTelegramMessage(chatId, `✅ Successfully linked your Telegram account to VilChum!\n\nPhone: <b>${phone}</b>\n\nYou will now receive OTP codes here when you sign in on the web app.`);
    return NextResponse.json({ ok: true });
  }

  // Handle /help command
  if (message.text === "/help") {
    await sendTelegramMessage(chatId, `
<b>VilChum Bot Commands</b>

/start - Link your Telegram account to receive OTP codes
/help - Show this help message
/unlink - Unlink your Telegram account

To link your account:
1. Sign up on the VilChum web app with your phone number
2. Send /start here
3. Share your phone number when prompted
    `.trim());
    return NextResponse.json({ ok: true });
  }

  // Handle /unlink command
  if (message.text === "/unlink") {
    const user = await db.user.findUnique({ where: { telegramChatId: chatId } });
    if (!user) {
      await sendTelegramMessage(chatId, "ℹ️ Your Telegram account is not linked to any VilChum user.");
      return NextResponse.json({ ok: true });
    }

    await db.user.update({
      where: { id: user.id },
      data: { telegramChatId: null },
    });

    await sendTelegramMessage(chatId, "✅ Your Telegram account has been unlinked from VilChum.");
    return NextResponse.json({ ok: true });
  }

  // Default response for unrecognized messages
  await sendTelegramMessage(chatId, "🤖 I didn't understand that. Send /help for available commands.");
  return NextResponse.json({ ok: true });
}

/** Send a message via Telegram Bot API. */
async function sendTelegramMessage(chatId: string, text: string, options?: { reply_markup?: object }) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not configured");

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", ...options }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Telegram API error: ${error.description ?? response.status}`);
  }
}
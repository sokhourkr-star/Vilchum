// Startup configuration checks. In production any error stops the server from starting, so a
// demo setting (fixed sign-in code, placeholder secret, localhost URL) can never reach real users.
// Messages name the variable and the rule, never its value.

type Env = Record<string, string | undefined>;
export type EnvCheck = { errors: string[]; warnings: string[] };

const PLACEHOLDER_SECRETS = new Set(["replace-with-a-long-random-value", "vilchum-local-session-secret-change-before-deploy", "change-me"]);
const MIN_SECRET_LENGTH = 32;
const MIN_ADMIN_PASSWORD_LENGTH = 16;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);

export function checkEnv(env: Env, mode: string | undefined): EnvCheck {
  const production = mode === "production";
  const errors: string[] = [];
  const warnings: string[] = [];
  // In production a weak setting is an error; in development it is a warning so local demos still run.
  const weak = (message: string) => (production ? errors : warnings).push(message);

  if (!env.DATABASE_URL) errors.push("DATABASE_URL is not set.");
  // SQLite is a single local file: no backups, no concurrency, gone on redeploy. Never in production.
  else if (production && !/^postgres(ql)?:\/\//.test(env.DATABASE_URL)) errors.push("DATABASE_URL must be a Postgres URL (postgresql://...) in production. SQLite is for local development only.");

  const secret = env.SESSION_SECRET;
  if (!secret) errors.push("SESSION_SECRET is not set. Generate one with: openssl rand -hex 32");
  else if (PLACEHOLDER_SECRETS.has(secret) || secret.length < MIN_SECRET_LENGTH) weak(`SESSION_SECRET is a placeholder or shorter than ${MIN_SECRET_LENGTH} characters. Generate one with: openssl rand -hex 32`);

  if (env.DEV_OTP === "true") {
    if (production) errors.push("DEV_OTP=true enables the fixed sign-in code 123456 for every phone number. Remove it in production.");
    else warnings.push("DEV_OTP=true: the fixed sign-in code 123456 works for every phone number (development only).");
  }

  const admin = env.ADMIN_PASSWORD;
  if (!admin) weak("ADMIN_PASSWORD is not set, so /admin is unusable.");
  else if (PLACEHOLDER_SECRETS.has(admin) || admin.length < MIN_ADMIN_PASSWORD_LENGTH) weak(`ADMIN_PASSWORD is a default or shorter than ${MIN_ADMIN_PASSWORD_LENGTH} characters.`);

  const estimatorUrl = env.ESTIMATOR_URL;
  if (estimatorUrl) {
    let url: URL | null = null;
    try { url = new URL(estimatorUrl); } catch { errors.push("ESTIMATOR_URL is not a valid URL."); }
    if (url && production && (url.protocol !== "https:" || LOCAL_HOSTS.has(url.hostname))) errors.push("ESTIMATOR_URL must be the https Cloudflare Tunnel hostname in production, not localhost or http.");
    if (!env.ESTIMATOR_API_KEY || env.ESTIMATOR_API_KEY.length < MIN_SECRET_LENGTH) errors.push(`ESTIMATOR_API_KEY must match the detection service's API_KEY (at least ${MIN_SECRET_LENGTH} characters).`);
  } else if (!env.GEMINI_API_KEY) {
    if (production) errors.push("Set ESTIMATOR_URL or GEMINI_API_KEY. Photo checking cannot run in production without one.");
    else warnings.push("Neither ESTIMATOR_URL nor GEMINI_API_KEY is set: photo checks use the labelled MOCK verifier (development only).");
  }

  const redirect = env.GOOGLE_REDIRECT_URI;
  if (redirect) {
    let url: URL | null = null;
    try { url = new URL(redirect); } catch { errors.push("GOOGLE_REDIRECT_URI is not a valid URL."); }
    if (url && production && (url.protocol !== "https:" || LOCAL_HOSTS.has(url.hostname))) errors.push("GOOGLE_REDIRECT_URI must be an https URL on the public domain in production, not localhost or http.");
  }

  // Telegram Bot validation (optional but recommended for production OTP delivery)
  const telegramToken = env.TELEGRAM_BOT_TOKEN;
  const telegramWebhookSecret = env.TELEGRAM_WEBHOOK_SECRET;
  const telegramWebhookUrl = env.TELEGRAM_WEBHOOK_URL;
  if (telegramToken || telegramWebhookSecret || telegramWebhookUrl) {
    if (!telegramToken) errors.push("TELEGRAM_BOT_TOKEN is required when using Telegram integration.");
    else if (telegramToken.length < 10 || !telegramToken.includes(":")) weak("TELEGRAM_BOT_TOKEN format looks incorrect (should be like 123456789:ABCDefGhIJKlmNoPQRsTUVwxyZ).");
    if (!telegramWebhookSecret) errors.push("TELEGRAM_WEBHOOK_SECRET is required when using Telegram integration. Generate with: openssl rand -hex 32");
    else if (telegramWebhookSecret.length < MIN_SECRET_LENGTH) weak(`TELEGRAM_WEBHOOK_SECRET is shorter than ${MIN_SECRET_LENGTH} characters.`);
    if (!telegramWebhookUrl) errors.push("TELEGRAM_WEBHOOK_URL is required when using Telegram integration (e.g., https://your-domain.vercel.app/api/telegram/webhook).");
    else {
      let url: URL | null = null;
      try { url = new URL(telegramWebhookUrl); } catch { errors.push("TELEGRAM_WEBHOOK_URL is not a valid URL."); }
      if (url && production && (url.protocol !== "https:" || LOCAL_HOSTS.has(url.hostname))) errors.push("TELEGRAM_WEBHOOK_URL must be an https URL on the public domain in production, not localhost or http.");
    }
  } else if (production) {
    warnings.push("Telegram integration not configured: OTP delivery will rely on SMS provider (not yet implemented) or DEV_OTP demo mode.");
  }

  return { errors, warnings };
}

/** Runs once at server start (see src/instrumentation.ts). Throws in production when anything is wrong. */
export function assertEnv(env: Env = process.env, mode: string | undefined = process.env.NODE_ENV) {
  const { errors, warnings } = checkEnv(env, mode);
  for (const warning of warnings) console.warn(`[VilChum config] ${warning}`);
  if (errors.length === 0) return;
  const message = `[VilChum config] Refusing to start:\n- ${errors.join("\n- ")}`;
  if (mode === "production") throw new Error(message);
  console.error(message);
}

/** The session signing secret. Never falls back to a built-in value. */
export function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set.");
  return secret;
}

/** The fixed demo sign-in code is only ever honoured outside production. */
export function demoOtpEnabled() {
  return process.env.DEV_OTP === "true" && process.env.NODE_ENV !== "production";
}

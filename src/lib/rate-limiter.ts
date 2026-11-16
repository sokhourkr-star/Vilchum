// Simple in-memory rate limiter for auth endpoints.
// For production with multiple instances, replace with Redis-backed implementation.

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const limits = new Map<string, RateLimitEntry>();
const CLEANUP_INTERVAL_MS = 60_000;

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of limits.entries()) {
    if (entry.resetAt < now) limits.delete(key);
  }
}, CLEANUP_INTERVAL_MS);

/**
 * Check and increment rate limit for a key.
 * @param key - Unique identifier (e.g., "otp-request:+85512345678" or "otp-verify:+85512345678")
 * @param maxRequests - Maximum requests allowed in the window
 * @param windowMs - Time window in milliseconds
 * @returns { allowed: boolean, remaining: number, resetAt: number }
 */
export function rateLimit(key: string, maxRequests: number, windowMs: number) {
  const now = Date.now();
  const entry = limits.get(key);

  if (!entry || entry.resetAt < now) {
    limits.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1, resetAt: now + windowMs };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return { allowed: true, remaining: maxRequests - entry.count, resetAt: entry.resetAt };
}

/**
 * Rate limit for OTP requests: 3 per phone per hour, 10 per IP per hour
 */
export function rateLimitOtpRequest(phone: string, ip: string) {
  const phoneResult = rateLimit(`otp-request:${phone}`, 3, 60 * 60 * 1000);
  const ipResult = rateLimit(`otp-request-ip:${ip}`, 10, 60 * 60 * 1000);
  return phoneResult.allowed && ipResult.allowed ? phoneResult : phoneResult.allowed ? ipResult : phoneResult;
}

/**
 * Rate limit for OTP verification: 5 failed attempts per phone, then 15 min lockout
 */
export function rateLimitOtpVerify(phone: string) {
  return rateLimit(`otp-verify:${phone}`, 5, 15 * 60 * 1000);
}

/**
 * Rate limit for admin actions (optional extra protection)
 */
export function rateLimitAdmin(ip: string) {
  return rateLimit(`admin:${ip}`, 30, 60 * 1000);
}
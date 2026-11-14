import crypto from "node:crypto";
import tls from "node:tls";

export const runtime = "nodejs";

const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const VERIFY_OTP_TTL_MS = 15 * 60 * 1000;

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const otpHash = (userId: string, otp: string) => sha256(`otp:${userId}:${otp}`);

function getBackendApiUrl(): string {
  return (process.env.NEXT_PUBLIC_API_URL || "https://merchant-machine.onrender.com/api/v1").replace(/\/+$/, "");
}

function getAppUrl(reqUrl: string): string {
  try {
    const u = new URL(reqUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "https://merchant-machine.vercel.app";
  }
}

async function neonSql<T = any>(query: string, params: any[] = []): Promise<T[]> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL is not configured");
  const parsed = new URL(dbUrl);
  const endpoint = `https://${parsed.hostname}/sql`;
  const cleanConn = `postgresql://${parsed.username}:${parsed.password}@${parsed.host}${parsed.pathname}?sslmode=require`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Neon-Connection-String": cleanConn,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, params }),
    signal: AbortSignal.timeout(8000),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.message || `Neon SQL HTTP ${res.status}`);
  }
  return (data?.rows ?? []) as T[];
}

function extractEmail(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim();
}

function chunkBase64(b64: string): string {
  return b64.replace(/(.{76})/g, "$1\r\n");
}

async function sendVerificationViaTls(to: string, otp: string, link: string): Promise<void> {
  const host = (process.env.SMTP_HOST || "smtp.gmail.com").trim();
  const user = (process.env.SMTP_USER || "").trim();
  const pass = (process.env.SMTP_PASS || "").replace(/\s+/g, "");
  if (!user || !pass) {
    throw new Error("SMTP credentials are not configured");
  }

  const fromHeader = process.env.MAIL_FROM?.trim() || `"Merchant Machine" <${user}>`;
  const fromAddr = extractEmail(fromHeader) || user;
  const rcpt = extractEmail(to);
  const subject = `${otp} is your Merchant Machine verification code`;

  const textBody = [
    "Welcome to Merchant Machine.",
    "",
    `Your 6-digit verification code (valid for 15 minutes): ${otp}`,
    "",
    "Or verify by opening this link (valid for 24 hours):",
    link,
    "",
    "If you did not create an account, ignore this email.",
  ].join("\n");

  const htmlBody = `
    <div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;padding:24px;background:#0e0f11;color:#f4f4f5;border-radius:14px">
      <h2 style="margin:0 0 12px">Verify your email</h2>
      <p style="color:#9a9da6">Enter this 6-digit verification code in the app to activate your Merchant Machine account:</p>
      <div style="margin:20px 0;padding:16px;background:#181a1f;border:1px solid #2a2d35;border-radius:12px;text-align:center;font-size:32px;font-weight:700;letter-spacing:8px;color:#ff7a1a">
        ${otp}
      </div>
      <p style="color:#9a9da6;font-size:13px">This code expires in 15 minutes. You can also verify by clicking the button below:</p>
      <p style="margin:20px 0">
        <a href="${link}" style="background:#ff7a1a;color:#190d02;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600;display:inline-block">Verify email</a>
      </p>
      <p style="color:#9a9da6;font-size:13px">If you did not create an account, ignore this email.</p>
    </div>`;

  const boundary = `alt_${crypto.randomBytes(12).toString("hex")}`;
  const rawMime = [
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@merchant-machine.vercel.app>`,
    `From: ${fromHeader}`,
    `To: ${rcpt}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    chunkBase64(Buffer.from(textBody, "utf8").toString("base64")),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    chunkBase64(Buffer.from(htmlBody, "utf8").toString("base64")),
    `--${boundary}--`,
  ]
    .join("\r\n")
    .replace(/\r\n\./g, "\r\n..");

  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port: 465, servername: host, timeout: 10000 });
    let buffer = "";
    let settled = false;
    let waiter: ((code: number, line: string) => void) | null = null;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {}
      if (err) reject(err);
      else resolve();
    };

    socket.setTimeout(12000, () => finish(new Error("SMTP TLS timed out")));
    socket.on("error", (err) => finish(err));
    socket.on("close", () => {
      if (!settled) finish(new Error("SMTP connection closed unexpectedly"));
    });

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
          const code = Number(line.slice(0, 3));
          const cb = waiter;
          waiter = null;
          if (cb) cb(code, line);
        }
      }
    });

    const expectCode = (expected: number[]): Promise<string> =>
      new Promise((res, rej) => {
        waiter = (code, line) => {
          if (expected.includes(code)) res(line);
          else rej(new Error(`SMTP error (${code}): ${line}`));
        };
      });

    const cmd = async (line: string, expected: number[]) => {
      const p = expectCode(expected);
      socket.write(`${line}\r\n`);
      return p;
    };

    (async () => {
      try {
        await expectCode([220]);
        await cmd("EHLO merchant-machine.vercel.app", [250]);
        const authPlain = Buffer.from(`\u0000${user}\u0000${pass}`, "utf8").toString("base64");
        await cmd(`AUTH PLAIN ${authPlain}`, [235]);
        await cmd(`MAIL FROM:<${fromAddr}>`, [250]);
        await cmd(`RCPT TO:<${rcpt}>`, [250]);
        await cmd("DATA", [354]);
        await cmd(`${rawMime}\r\n.`, [250]);
        try {
          socket.write("QUIT\r\n");
        } catch {}
        finish();
      } catch (err: any) {
        finish(err instanceof Error ? err : new Error(String(err)));
      }
    })();
  });
}

async function issueOtpAndSendEmail(userId: string, email: string, appUrl: string) {
  const token = crypto.randomBytes(32).toString("base64url");
  const otp = String(crypto.randomInt(100000, 1000000));
  const now = Date.now();
  const linkExp = new Date(now + VERIFY_TOKEN_TTL_MS).toISOString();
  const otpExp = new Date(now + VERIFY_OTP_TTL_MS).toISOString();

  await neonSql(
    `INSERT INTO "EmailVerificationToken" ("id", "userId", "tokenHash", "expiresAt", "createdAt")
     VALUES ($1, $2, $3, $4::timestamptz, NOW()), ($5, $2, $6, $7::timestamptz, NOW())`,
    [
      crypto.randomUUID(),
      userId,
      sha256(token),
      linkExp,
      crypto.randomUUID(),
      otpHash(userId, otp),
      otpExp,
    ],
  );

  const link = `${appUrl}/verify-email?token=${encodeURIComponent(token)}`;
  try {
    await sendVerificationViaTls(email, otp, link);
    return {
      message: "We sent a 6-digit verification code to your email.",
      emailDelivered: true,
    };
  } catch (err: any) {
    console.error("[auth-register] SMTP failed:", err?.message || err);
    return {
      message: "Email delivery was delayed — your 6-digit verification code is provided below.",
      emailDelivered: false,
      fallbackOtp: otp,
    };
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      firstName?: string;
      lastName?: string;
      email?: string;
      password?: string;
      resend?: boolean;
    };
    const email = body?.email?.trim().toLowerCase();
    const firstName = body?.firstName?.trim() || "Customer";
    const lastName = body?.lastName?.trim() || "User";
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: "Please enter a valid email address." }, { status: 400 });
    }

    const appUrl = getAppUrl(request.url);
    const backendApi = getBackendApiUrl();
    const dbUrl = process.env.DATABASE_URL || "";
    const isNeon = dbUrl.includes("neon.tech");

    if (!isNeon) {
      const targetPath = body.resend ? "/auth/resend-verification" : "/auth/register";
      const targetBody = body.resend
        ? { email }
        : { firstName, lastName, email, password: body?.password ?? "" };
      const res = await fetch(`${backendApi}${targetPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(targetBody),
      });
      const data = await res.json().catch(() => ({}));
      return Response.json(data?.data ?? data, { status: res.status });
    }

    if (!body.resend) {
      const password = body?.password ?? "";
      if (password.length < 8) {
        return Response.json({ error: "Password must be at least 8 characters." }, { status: 400 });
      }

      // Check if user already exists in Neon first
      const existingRows = await neonSql<{ id: string; emailVerifiedAt: string | null }>(
        `SELECT "id", "emailVerifiedAt" FROM "User" WHERE "email" = $1 LIMIT 1`,
        [email],
      );

      if (existingRows.length > 0) {
        const existing = existingRows[0];
        if (existing.emailVerifiedAt) {
          return Response.json({
            message: "We sent a 6-digit verification code to your email.",
            emailDelivered: true,
          });
        }
        await neonSql(
          `UPDATE "User" SET "firstName" = $1, "lastName" = $2, "updatedAt" = NOW() WHERE "id" = $3`,
          [firstName, lastName, existing.id],
        ).catch(() => undefined);
        const res = await issueOtpAndSendEmail(existing.id, email, appUrl);
        return Response.json(res, { status: 201 });
      }

      // User does not exist yet: trigger backend /auth/register so backend hashes password with bcrypt & creates User row.
      // Use a 2.5s timeout in case backend is still on an old Render deploy that hangs on outbound SMTP.
      try {
        const backendRes = await fetch(`${backendApi}/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ firstName, lastName, email, password }),
          signal: AbortSignal.timeout(2500),
        });
        const payload = await backendRes.json().catch(() => ({}));
        const unwrapped = payload?.data ?? payload;
        if (!backendRes.ok && backendRes.status < 500) {
          return Response.json(unwrapped, { status: backendRes.status });
        }
        if (backendRes.ok && unwrapped?.emailDelivered) {
          return Response.json(unwrapped, { status: backendRes.status });
        }
      } catch {
        // Backend timed out while trying direct SMTP on Render after inserting the User row in Neon
      }

      // Poll Neon briefly (up to 2s) for the newly inserted User row from backend
      let newUser: { id: string; emailVerifiedAt: string | null } | undefined;
      for (let i = 0; i < 6; i++) {
        const rows = await neonSql<{ id: string; emailVerifiedAt: string | null }>(
          `SELECT "id", "emailVerifiedAt" FROM "User" WHERE "email" = $1 LIMIT 1`,
          [email],
        );
        if (rows.length > 0) {
          newUser = rows[0];
          break;
        }
        await new Promise((r) => setTimeout(r, 350));
      }

      if (!newUser) {
        return Response.json(
          { error: "Backend server is waking up — please click Create account once more." },
          { status: 503 },
        );
      }

      await neonSql(
        `UPDATE "User" SET "firstName" = $1, "lastName" = $2, "updatedAt" = NOW() WHERE "id" = $3`,
        [firstName, lastName, newUser.id],
      ).catch(() => undefined);

      const res = await issueOtpAndSendEmail(newUser.id, email, appUrl);
      return Response.json(res, { status: 201 });
    }

    // Resend / checkUnverified flow
    const rows = await neonSql<{ id: string; emailVerifiedAt: string | null }>(
      `SELECT "id", "emailVerifiedAt" FROM "User" WHERE "email" = $1 LIMIT 1`,
      [email],
    );
    if (rows.length > 0 && !rows[0].emailVerifiedAt) {
      const res = await issueOtpAndSendEmail(rows[0].id, email, appUrl);
      return Response.json({ ...res, unverified: true });
    }
    return Response.json({
      message: "We sent a 6-digit verification code to your email.",
      emailDelivered: true,
      unverified: false,
    });
  } catch (err: any) {
    console.error("[auth-register] error:", err?.message || err);
    return Response.json(
      { error: err?.message || "Could not complete registration" },
      { status: 500 },
    );
  }
}

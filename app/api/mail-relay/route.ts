import tls from "node:tls";
import crypto from "node:crypto";

export const runtime = "nodejs";

interface RelayAttachment {
  filename: string;
  contentBase64: string;
  contentType: string;
}

interface RelayPayload {
  to: string;
  from?: string;
  subject: string;
  text: string;
  html: string;
  smtpHost?: string;
  smtpUser: string;
  smtpPass: string;
  attachments?: RelayAttachment[];
}

function extractEmail(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim();
}

function encodeHeader(value: string): string {
  const clean = value.replace(/[\r\n]+/g, " ").trim();
  if (/^[\x20-\x7E]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

function chunkBase64(b64: string): string {
  return b64.replace(/(.{76})/g, "$1\r\n");
}

function buildMimeMessage(payload: RelayPayload, fromHeader: string): string {
  const altBoundary = `alt_${crypto.randomBytes(12).toString("hex")}`;
  const mixedBoundary = `mix_${crypto.randomBytes(12).toString("hex")}`;
  const msgId = `<${crypto.randomUUID()}@merchant-machine.vercel.app>`;
  const dateHeader = new Date().toUTCString();
  const textB64 = chunkBase64(Buffer.from(payload.text || "", "utf8").toString("base64"));
  const htmlB64 = chunkBase64(Buffer.from(payload.html || payload.text || "", "utf8").toString("base64"));
  const hasAttachments = Array.isArray(payload.attachments) && payload.attachments.length > 0;

  const headers = [
    `Date: ${dateHeader}`,
    `Message-ID: ${msgId}`,
    `From: ${fromHeader}`,
    `To: ${payload.to.replace(/[\r\n]+/g, "").trim()}`,
    `Subject: ${encodeHeader(payload.subject)}`,
    "MIME-Version: 1.0",
  ];

  const altPart = [
    `--${altBoundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    textB64,
    `--${altBoundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    htmlB64,
    `--${altBoundary}--`,
  ].join("\r\n");

  if (!hasAttachments) {
    return [
      ...headers,
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      "",
      altPart,
    ].join("\r\n");
  }

  const attachmentParts = payload.attachments!.map((att) => {
    const safeName = att.filename.replace(/["\r\n]/g, "_");
    return [
      `--${mixedBoundary}`,
      `Content-Type: ${att.contentType || "application/octet-stream"}; name="${safeName}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${safeName}"`,
      "",
      chunkBase64(att.contentBase64.replace(/\s+/g, "")),
    ].join("\r\n");
  });

  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    "",
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    "",
    altPart,
    ...attachmentParts,
    `--${mixedBoundary}--`,
  ].join("\r\n");
}

async function sendViaGmailTls(payload: RelayPayload): Promise<{ messageId: string }> {
  const host = (payload.smtpHost || "smtp.gmail.com").trim();
  const user = payload.smtpUser.trim();
  const pass = payload.smtpPass.replace(/\s+/g, "");
  const fromHeader = payload.from?.trim() || `"Merchant Machine" <${user}>`;
  const fromAddr = extractEmail(fromHeader) || user;
  const recipients = payload.to
    .split(",")
    .map((r) => extractEmail(r))
    .filter(Boolean);

  const rawMime = buildMimeMessage(payload, fromHeader);
  // Dot-stuff lines starting with "." per RFC 5321
  const dotStuffed = rawMime.replace(/\r\n\./g, "\r\n..");

  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        host,
        port: 465,
        servername: host,
        timeout: 10000,
      },
      () => {
        // Connected; wait for 220 banner
      },
    );

    let buffer = "";
    let settled = false;
    let waiter: ((code: number, text: string) => void) | null = null;

    const finish = (err?: Error, res?: { messageId: string }) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {}
      if (err) reject(err);
      else resolve(res!);
    };

    socket.setTimeout(12000, () => {
      finish(new Error("SMTP TLS socket timed out"));
    });

    socket.on("error", (err) => finish(err));
    socket.on("close", () => {
      if (!settled) finish(new Error("SMTP connection closed unexpectedly"));
    });

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        // Final line of an SMTP response has a space at index 3 (e.g. "250 OK"), whereas continuation lines have "-"
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

    const cmd = async (line: string, expected: number[]): Promise<string> => {
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
        for (const rcpt of recipients) {
          await cmd(`RCPT TO:<${rcpt}>`, [250]);
        }
        await cmd("DATA", [354]);
        const resp = await cmd(`${dotStuffed}\r\n.`, [250]);
        try {
          socket.write("QUIT\r\n");
        } catch {}
        finish(undefined, { messageId: resp });
      } catch (err: any) {
        finish(err instanceof Error ? err : new Error(String(err)));
      }
    })();
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RelayPayload;
    if (!body?.to || !body?.subject || !body?.smtpUser || !body?.smtpPass) {
      return Response.json({ error: "Missing required mail relay fields" }, { status: 400 });
    }
    const result = await sendViaGmailTls(body);
    return Response.json({ ok: true, messageId: result.messageId });
  } catch (err: any) {
    console.error("[mail-relay] failed:", err?.message || err);
    return Response.json(
      { error: err?.message || "Mail relay failed" },
      { status: 502 },
    );
  }
}

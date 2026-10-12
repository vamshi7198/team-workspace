import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { emailEnabled, env } from "./env";
import { logger } from "./logger";

let transport: Transporter | undefined;

function getTransport() {
  if (!transport) {
    const e = env();
    transport = nodemailer.createTransport({
      host: e.SMTP_HOST,
      port: e.SMTP_PORT,
      secure: e.SMTP_PORT === 465,
      auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASSWORD } : undefined,
    });
  }
  return transport;
}

/** Returns true if the email was handed to the SMTP server. Never throws. */
export async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  if (!emailEnabled()) return false;
  try {
    await getTransport().sendMail({ from: env().MAIL_FROM, to, subject, text });
    return true;
  } catch (err) {
    logger.error({ err: (err as Error).message, subject }, "email send failed");
    return false;
  }
}

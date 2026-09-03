import nodemailer from 'nodemailer'
import { span } from './tracing.js'

const escapeHtml = value =>
  String(value).replace(
    /[&<>"']/g,
    character =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character],
  )

export function createMailer({ from, transport }) {
  if (!from) throw new Error('SMTP_FROM is required')
  if (!transport?.sendMail) throw new Error('An SMTP transport is required')
  return {
    async send({ to, appUrl, tripTitle }) {
      const title = String(tripTitle || 'a Off We Go trip')
      const safeTitle = escapeHtml(title),
        safeUrl = escapeHtml(appUrl)
      // SMTP gets a span of its own: latency always, and on refusal the
      // failure lands on it via span()'s own catch — the address does not.
      await span('send invitation', {}, () =>
        transport.sendMail({
          from,
          to,
          subject: `You're invited to ${title}`,
          text: `You've been invited to ${title} in Off We Go.\n\nOpen Off We Go, then sign in or create an account with this email address to review and accept the invitation:\n\n${appUrl}`,
          html: `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;padding:32px">
          <h1 style="font-size:24px">You&apos;re invited to ${safeTitle}</h1>
          <p>Open Off We Go, then sign in or create an account with this email address to review and accept the invitation.</p>
          <p><a href="${safeUrl}" style="display:inline-block;background:#111;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Review invitation</a></p>
        </div>`,
        }),
      )
    },
  }
}

export function createSmtpMailer(config) {
  const port = Number(config.port || 587)
  const transport = nodemailer.createTransport({
    host: config.host,
    port,
    secure: config.secure ?? port === 465,
    auth: config.user ? { user: config.user, pass: config.pass } : undefined,
  })
  return createMailer({ from: config.from, transport })
}

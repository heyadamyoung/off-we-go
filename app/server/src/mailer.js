import nodemailer from 'nodemailer'

const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]))

export function createMailer({ from, transport }) {
  if (!from) throw new Error('SMTP_FROM is required')
  if (!transport?.sendMail) throw new Error('An SMTP transport is required')
  return {
    async send({ to, webUrl, nativeUrl }) {
      const web = escapeHtml(webUrl), native = escapeHtml(nativeUrl)
      await transport.sendMail({
        from, to, subject: 'Sign in to Wayfare',
        text: `Sign in to Wayfare:\n\n${webUrl}\n\nOn an iPhone with Wayfare installed:\n${nativeUrl}\n\nThis link expires in 15 minutes and can be used once.`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;padding:32px">
          <h1 style="font-size:24px">Sign in to Wayfare</h1>
          <p><a href="${web}" style="display:inline-block;background:#111;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Open Wayfare</a></p>
          <p>If Wayfare is installed on your iPhone, <a href="${native}">open it in the app</a>.</p>
          <p style="color:#666">This link expires in 15 minutes and can be used once.</p>
        </div>`,
      })
    },
  }
}

export function createSmtpMailer(config) {
  const port = Number(config.port || 587)
  const transport = nodemailer.createTransport({
    host: config.host, port, secure: config.secure ?? port === 465,
    auth: config.user ? { user: config.user, pass: config.pass } : undefined,
  })
  return createMailer({ from: config.from, transport })
}

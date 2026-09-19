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
    async send({ to, appUrl, tripUrl, tripTitle, role, joined }) {
      const title = String(tripTitle || 'an Off We Go trip')
      const link = String(tripUrl || appUrl)
      const safeTitle = escapeHtml(title),
        safeUrl = escapeHtml(link)
      const as =
        role === 'editor'
          ? 'as a traveller — you can add stops and photos'
          : 'as a follower — you see everything, live'
      /* Two truths, said plainly: an account that exists is on the trip
         already; an address with none is on it the moment an account with
         that address is made. Neither has anything to accept. */
      const how = joined
        ? 'Sign in with this email address and it is there.'
        : 'Sign in or create an account with this email address and it is there — nothing to accept.'
      // SMTP gets a span of its own: latency always, and on refusal the
      // failure lands on it via span()'s own catch — the address does not.
      await span('send trip access', {}, () =>
        transport.sendMail({
          from,
          to,
          subject: `You're on ${title}`,
          text: `You've been added to ${title} in Off We Go, ${as}.\n\n${how}\n\n${link}`,
          html: `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;padding:32px">
          <h1 style="font-size:24px">You&apos;re on ${safeTitle}</h1>
          <p>You&apos;ve been added to ${safeTitle} in Off We Go, ${escapeHtml(as)}.</p>
          <p>${escapeHtml(how)}</p>
          <p><a href="${safeUrl}" style="display:inline-block;background:#111;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Open the trip</a></p>
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

// Cloudflare Worker — Flowmann
// Handles POST /api/contact (sends emails via Resend)
// Everything else falls through to static assets (index.html, favicons, sitemap, etc.)

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/contact' && request.method === 'POST') {
      return handleContact(request, env);
    }

    // Health-check endpoint — useful for testing the worker is alive
    if (url.pathname === '/api/health') {
      return jsonResponse({
        ok: true,
        worker: 'flowmann',
        resend_configured: Boolean(env.RESEND_API_KEY)
      });
    }

    // All other requests → static files
    return env.ASSETS.fetch(request);
  }
};

// ──────────────────────────────────────────────────────────
// Contact form handler
// ──────────────────────────────────────────────────────────
async function handleContact(request, env) {
  let data;
  try {
    data = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_json' }, 400);
  }

  const { name, company, email, sector, msg, website } = data || {};

  // Honeypot — silent OK if a bot filled the hidden field
  if (website && String(website).trim() !== '') {
    return jsonResponse({ ok: true });
  }

  // Validation
  if (!name || !email || !msg) {
    return jsonResponse({ ok: false, error: 'missing_fields' }, 400);
  }
  if (!isValidEmail(email)) {
    return jsonResponse({ ok: false, error: 'invalid_email' }, 400);
  }
  if (String(msg).length < 5 || String(msg).length > 5000) {
    return jsonResponse({ ok: false, error: 'message_length' }, 400);
  }
  if (String(name).length > 200 || (company && String(company).length > 200)) {
    return jsonResponse({ ok: false, error: 'field_too_long' }, 400);
  }

  if (!env.RESEND_API_KEY) {
    return jsonResponse({ ok: false, error: 'config_missing' }, 500);
  }

  // 1) Admin email (to Mike) — MUST succeed
  const admin = await sendViaResend({
    from: 'Flowmann Contact <noreply@flowmann.com>',
    to: ['mike@flowmann.com'],
    reply_to: email,
    subject: `[Flowmann] ${name} — ${company || 'geen organisatie'}`,
    html: adminHtml({ name, company, email, sector, msg })
  }, env.RESEND_API_KEY);

  if (!admin.ok) {
    return jsonResponse({ ok: false, error: 'admin_send_failed', detail: admin.error }, 502);
  }

  // 2) Confirmation to submitter — best-effort (don't fail the whole request if this hiccups)
  await sendViaResend({
    from: 'Flowmann <noreply@flowmann.com>',
    to: [email],
    subject: 'Uw bericht is ontvangen — Flowmann',
    html: confirmationHtml({ name })
  }, env.RESEND_API_KEY);

  return jsonResponse({ ok: true });
}

// ──────────────────────────────────────────────────────────
// Resend
// ──────────────────────────────────────────────────────────
async function sendViaResend(payload, apiKey) {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data.message || `HTTP ${res.status}` };
    }
    return { ok: true, id: data.id };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function isValidEmail(s) {
  return typeof s === 'string'
      && s.length < 255
      && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function esc(s) {
  return String(s ?? '').replace(/[<>&"']/g, c =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// ──────────────────────────────────────────────────────────
// Email templates
// ──────────────────────────────────────────────────────────
function adminHtml({ name, company, email, sector, msg }) {
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f5f1e8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:32px 16px">
  <div style="background:#fff;border-radius:14px;border:1px solid #e5e1d5;overflow:hidden">
    <div style="background:linear-gradient(135deg,#fbbf24,#f59e0b);padding:20px 28px;color:#1a1206">
      <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;font-weight:700;opacity:.85">Flowmann · Nieuwe aanvraag</div>
      <div style="font-family:Georgia,'Times New Roman',serif;font-weight:500;font-size:22px;line-height:1.2;margin-top:6px">${esc(name)}</div>
    </div>
    <div style="padding:28px;color:#0a0d12;line-height:1.55">
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:14px">
        <tr><td style="padding:7px 0;color:#6b7684;font-size:11px;text-transform:uppercase;letter-spacing:.12em;font-weight:600;width:120px">E-mail</td><td style="padding:7px 0"><a href="mailto:${esc(email)}" style="color:#0a0d12;text-decoration:underline">${esc(email)}</a></td></tr>
        <tr><td style="padding:7px 0;color:#6b7684;font-size:11px;text-transform:uppercase;letter-spacing:.12em;font-weight:600">Organisatie</td><td style="padding:7px 0">${esc(company || '—')}</td></tr>
        <tr><td style="padding:7px 0;color:#6b7684;font-size:11px;text-transform:uppercase;letter-spacing:.12em;font-weight:600">Sector</td><td style="padding:7px 0">${esc(sector || '—')}</td></tr>
      </table>
      <div style="padding-top:20px;border-top:1px solid #e5e1d5">
        <div style="font-size:11px;color:#6b7684;letter-spacing:.12em;text-transform:uppercase;font-weight:600;margin-bottom:10px">Bericht</div>
        <div style="font-size:15px;white-space:pre-wrap;color:#1a1d23">${esc(msg)}</div>
      </div>
    </div>
    <div style="background:#fafaf7;padding:16px 28px;font-size:12px;color:#6b7684;border-top:1px solid #e5e1d5">
      💡 Reageer direct op deze e-mail — die gaat naar ${esc(email)}.
    </div>
  </div>
</div>
</body></html>`;
}

function confirmationHtml({ name }) {
  const first = String(name || '').trim().split(/\s+/)[0] || 'daar';
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f5f1e8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:32px 16px">
  <div style="background:#fff;border-radius:14px;border:1px solid #e5e1d5;overflow:hidden">
    <div style="padding:28px 28px 0">
      <table cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>
        <td style="vertical-align:middle"><div style="width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,#fbbf24,#f59e0b)"></div></td>
        <td style="vertical-align:middle;padding-left:10px"><span style="font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:500;color:#0a0d12">Flowmann</span></td>
      </tr></table>
    </div>
    <div style="padding:24px 28px 28px;color:#0a0d12;line-height:1.6">
      <h1 style="font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:28px;line-height:1.15;margin:0 0 16px 0;letter-spacing:-0.01em">Bedankt, ${esc(first)}.</h1>
      <p style="font-size:16px;margin:0 0 14px 0">Uw bericht is goed aangekomen. Ik lees alle aanvragen zelf — geen filter, geen assistent.</p>
      <p style="font-size:16px;margin:0 0 24px 0">U hoort binnen één werkdag van mij. Soms sneller.</p>
      <div style="padding:18px 20px;background:#f5f1e8;border-radius:10px;border-left:3px solid #f59e0b">
        <div style="font-size:11px;color:#8b5a00;letter-spacing:.12em;text-transform:uppercase;font-weight:700;margin-bottom:6px">Tot dan</div>
        <div style="font-size:15px;color:#1a1d23">Op <a href="https://flowmann.com" style="color:#0a0d12;text-decoration:underline">flowmann.com</a> staan de zeven sectoren met praktische voorbeelden per branche.</div>
      </div>
    </div>
    <div style="background:#fafaf7;padding:20px 28px;font-size:13px;color:#6b7684;border-top:1px solid #e5e1d5;line-height:1.5">
      <strong style="color:#1a1d23">Mike Bruchmann</strong> · Flowmann<br>
      <a href="mailto:mike@flowmann.com" style="color:#6b7684;text-decoration:none">mike@flowmann.com</a> · <a href="https://flowmann.com" style="color:#6b7684;text-decoration:none">flowmann.com</a>
    </div>
  </div>
  <div style="text-align:center;font-size:11px;color:#a4afbd;margin-top:20px">
    Deze e-mail is verstuurd omdat u een aanvraag heeft ingediend via flowmann.com.
  </div>
</div>
</body></html>`;
}

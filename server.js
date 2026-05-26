import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

// ── HARDCODED CONFIG ──────────────────────────────────────────────────────────
const IMALI_API_KEY = "sk_live_124c737efaecd05c448e866265d4056be4601fd5";
const IMALI_BASE_URL = "https://app.imali.app/api/imali/v1";
// After deploying to Render, paste your Render URL here:
// e.g. "https://your-app-name.onrender.com"
// Then register  <YOUR_RENDER_URL>/webhooks/imali  in iMali dashboard → Developers → Webhooks
const SERVER_BASE_URL = "https://server-7m9f.onrender.com";
// ─────────────────────────────────────────────────────────────────────────────

// In-memory receipt store (persists while server is running)
const receipts = new Map();

app.use(cors({ origin: "*" }));
app.use((req, res, next) => {
  if (req.path === "/webhooks/imali") {
    express.raw({ type: "*/*" })(req, res, next);
  } else {
    express.json()(req, res, next);
  }
});

// ── iMali API helper ──────────────────────────────────────────────────────────
async function imali(method, path, body) {
  let res;
  try {
    res = await fetch(`${IMALI_BASE_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${IMALI_API_KEY}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (netErr) {
    const err = new Error(
      `Cannot reach iMali API at ${IMALI_BASE_URL}${path} — ${netErr.message}. ` +
      `Check that api.imali.app is accessible from your server.`
    );
    err.status = 503;
    err.type = "imali_unreachable";
    throw err;
  }

  let data;
  try {
    data = await res.json();
  } catch {
    const err = new Error(
      `iMali API returned a non-JSON response (HTTP ${res.status}). The API key may be invalid or the endpoint may have changed.`
    );
    err.status = res.status;
    err.type = "imali_bad_response";
    throw err;
  }

  if (!res.ok) {
    const err = new Error(data?.error?.message ?? `iMali API error (HTTP ${res.status})`);
    err.status = res.status;
    err.type = data?.error?.type ?? "api_error";
    err.raw = data;
    throw err;
  }
  return data;
}

// ── Phone validator (Zambia numbers: +260XXXXXXXXX) ───────────────────────────
function normalizePhone(raw) {
  const digits = String(raw).replace(/\D/g, "");
  // Accept: 260XXXXXXXXX, 0XXXXXXXXX (10 digits), or 9XXXXXXXX (9 digits)
  if (digits.startsWith("260") && digits.length === 12) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 10) return `+260${digits.slice(1)}`;
  if (digits.length === 9) return `+260${digits}`;
  return null;
}

function formatAmount(amount) {
  return Number(amount).toLocaleString("en-ZM", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ── Receipt HTML generator ────────────────────────────────────────────────────
function buildReceiptHTML(data) {
  const {
    id, amount, currency, status, phone, purpose,
    provider, provider_ref, platform_fee, provider_fee,
    momo_country, created_at, note,
  } = data;

  const statusColor = status === "succeeded" ? "#16a34a"
    : status === "processing" ? "#d97706"
    : status === "failed" ? "#dc2626" : "#6b7280";

  const statusLabel = status === "succeeded" ? "PAID"
    : status === "processing" ? "PROCESSING"
    : status === "failed" ? "FAILED" : status?.toUpperCase();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>iMali Receipt – ${id}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', sans-serif; background: #f0fdf4; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
    .card { background: #fff; border-radius: 20px; box-shadow: 0 10px 40px rgba(0,0,0,0.12); max-width: 480px; width: 100%; overflow: hidden; }
    .header { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); padding: 32px 28px 24px; text-align: center; }
    .logo { font-size: 28px; font-weight: 700; color: #fff; letter-spacing: -0.5px; }
    .logo span { opacity: 0.85; font-weight: 400; font-size: 14px; display: block; margin-top: 2px; }
    .status-badge { display: inline-block; margin-top: 16px; background: rgba(255,255,255,0.25); color: #fff; padding: 6px 18px; border-radius: 999px; font-size: 13px; font-weight: 600; letter-spacing: 0.5px; border: 1.5px solid rgba(255,255,255,0.5); }
    .amount-section { background: #fffbeb; border-bottom: 2px dashed #fde68a; padding: 28px; text-align: center; }
    .amount-label { font-size: 12px; color: #92400e; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; }
    .amount-value { font-size: 42px; font-weight: 700; color: #92400e; margin-top: 4px; }
    .amount-currency { font-size: 20px; font-weight: 500; }
    .body { padding: 24px 28px; }
    .row { display: flex; justify-content: space-between; align-items: flex-start; padding: 12px 0; border-bottom: 1px solid #f3f4f6; gap: 12px; }
    .row:last-child { border-bottom: none; }
    .row-label { font-size: 13px; color: #6b7280; font-weight: 500; flex-shrink: 0; }
    .row-value { font-size: 13px; color: #111827; font-weight: 600; text-align: right; word-break: break-all; }
    .row-value.mono { font-family: monospace; font-size: 12px; color: #374151; }
    .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${statusColor}; margin-right: 6px; }
    .fee-box { background: #f9fafb; border-radius: 10px; padding: 14px 16px; margin: 16px 0 8px; }
    .fee-title { font-size: 11px; color: #9ca3af; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; }
    .fee-row { display: flex; justify-content: space-between; font-size: 12px; color: #6b7280; padding: 3px 0; }
    .fee-row.total { color: #111827; font-weight: 600; border-top: 1px solid #e5e7eb; margin-top: 6px; padding-top: 8px; }
    .note-box { background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 0 8px 8px 0; padding: 12px 14px; margin-top: 16px; font-size: 12px; color: #92400e; line-height: 1.5; }
    .note-box strong { display: block; margin-bottom: 2px; }
    .footer { background: #f9fafb; padding: 20px 28px; text-align: center; border-top: 1px solid #f3f4f6; }
    .download-btn { display: inline-block; background: #f59e0b; color: #fff; font-weight: 600; font-size: 14px; padding: 12px 32px; border-radius: 10px; border: none; cursor: pointer; text-decoration: none; margin-bottom: 12px; }
    .download-btn:hover { background: #d97706; }
    .footer-text { font-size: 11px; color: #9ca3af; margin-top: 4px; }
    @media print {
      body { background: #fff; padding: 0; }
      .card { box-shadow: none; max-width: 100%; border-radius: 0; }
      .download-btn { display: none; }
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="logo">iMali <span>Mobile Money Receipt</span></div>
      <div class="status-badge"><span class="status-dot"></span>${statusLabel}</div>
    </div>
    <div class="amount-section">
      <div class="amount-label">Amount Paid</div>
      <div class="amount-value"><span class="amount-currency">${(currency ?? "ZMW").toUpperCase()} </span>${formatAmount(amount)}</div>
    </div>
    <div class="body">
      <div class="row">
        <span class="row-label">Transaction ID</span>
        <span class="row-value mono">${id}</span>
      </div>
      <div class="row">
        <span class="row-label">Status</span>
        <span class="row-value"><span class="status-dot"></span>${statusLabel}</span>
      </div>
      <div class="row">
        <span class="row-label">Phone</span>
        <span class="row-value">${phone ?? "—"}</span>
      </div>
      ${purpose ? `<div class="row"><span class="row-label">Purpose</span><span class="row-value">${purpose}</span></div>` : ""}
      ${provider ? `<div class="row"><span class="row-label">Provider</span><span class="row-value">${provider}</span></div>` : ""}
      ${provider_ref ? `<div class="row"><span class="row-label">Provider Ref</span><span class="row-value mono">${provider_ref}</span></div>` : ""}
      ${momo_country ? `<div class="row"><span class="row-label">Country</span><span class="row-value">${momo_country}</span></div>` : ""}
      <div class="row">
        <span class="row-label">Date</span>
        <span class="row-value">${new Date(created_at ?? Date.now()).toLocaleString("en-ZM", { dateStyle: "medium", timeStyle: "short" })}</span>
      </div>

      ${(platform_fee || provider_fee) ? `
      <div class="fee-box">
        <div class="fee-title">Fee Breakdown</div>
        ${platform_fee ? `<div class="fee-row"><span>Platform fee (${data.platform_fee_percent ?? ""}%)</span><span>${(currency ?? "ZMW").toUpperCase()} ${formatAmount(platform_fee)}</span></div>` : ""}
        ${provider_fee ? `<div class="fee-row"><span>Provider fee (${data.provider_fee_percent ?? ""}%)</span><span>${(currency ?? "ZMW").toUpperCase()} ${formatAmount(provider_fee)}</span></div>` : ""}
        ${(platform_fee && provider_fee) ? `<div class="fee-row total"><span>Total fees</span><span>${(currency ?? "ZMW").toUpperCase()} ${formatAmount((platform_fee ?? 0) + (provider_fee ?? 0))}</span></div>` : ""}
      </div>` : ""}

      ${note ? `<div class="note-box"><strong>Note</strong>${note}</div>` : ""}
    </div>
    <div class="footer">
      <button class="download-btn" onclick="window.print()">Download Receipt (PDF)</button>
      <div class="footer-text">Powered by iMali &bull; Broos Action Inc &bull; &copy; ${new Date().getFullYear()}</div>
    </div>
  </div>
</body>
</html>`;
}

// ── GET /ping ─────────────────────────────────────────────────────────────────
app.get("/ping", async (_req, res) => {
  let imaliOk = false;
  let imaliError = null;
  try {
    const r = await fetch(`${IMALI_BASE_URL}/ping`);
    imaliOk = r.ok;
    if (!r.ok) imaliError = `iMali returned HTTP ${r.status}`;
  } catch (e) {
    imaliError = `Cannot reach iMali API: ${e.message}`;
  }
  res.status(imaliOk ? 200 : 503).json({
    server: "ok",
    imali: imaliOk ? "ok" : "unreachable",
    imali_error: imaliError,
    imali_url: IMALI_BASE_URL,
  });
});

// ── POST /stk-push ────────────────────────────────────────────────────────────
// Accepts: { phone, amount, currency?, purpose?, customer: { name, email } }
// Validates phone, converts to E.164, sends momo intent to iMali
app.post("/stk-push", async (req, res) => {
  const { phone, amount, currency, purpose, customer, country, provider } = req.body;

  // Validate phone
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    return res.status(422).json({
      error: {
        type: "validation_error",
        message: "Invalid phone number. Expected Zambia format e.g. 0977000111 or +260977000111.",
      },
    });
  }

  // Validate amount
  const parsedAmount = parseFloat(amount);
  if (!parsedAmount || parsedAmount <= 0) {
    return res.status(422).json({
      error: {
        type: "validation_error",
        message: "Amount must be a positive number in major units (e.g. 15.00 for ZMW 15.00).",
      },
    });
  }

  // Validate customer
  if (!customer?.name || !customer?.email) {
    return res.status(422).json({
      error: {
        type: "validation_error",
        message: "customer.name and customer.email are required.",
      },
    });
  }

  try {
    const intent = await imali("POST", "/payment_intents", {
      amount: parsedAmount,
      currency: currency ?? "ZMW",
      method: "momo",
      country: country ?? "ZM",
      provider: provider ?? "MTN_MOMO_ZM",
      purpose: purpose ?? "",
      webhook_url: `${SERVER_BASE_URL}/webhooks/imali`,
      customer: {
        name: customer.name,
        email: customer.email,
        phone: normalizedPhone,
      },
    });

    // Build receipt data
    const receiptData = {
      id: intent.id,
      amount: parsedAmount,
      currency: currency ?? "ZMW",
      status: intent.status,
      phone: normalizedPhone,
      purpose: purpose ?? "",
      provider: intent.metadata?.provider ?? "",
      provider_ref: intent.metadata?.provider_ref ?? "",
      provider_code: intent.metadata?.provider_code ?? "",
      momo_country: intent.metadata?.momo_country ?? "ZM",
      platform_fee: intent.metadata?.platform_fee,
      platform_fee_percent: intent.metadata?.platform_fee_percent,
      provider_fee: intent.metadata?.provider_fee,
      provider_fee_percent: intent.metadata?.provider_fee_percent,
      created_at: new Date().toISOString(),
      note: intent.status === "processing"
        ? "An STK push has been sent to the customer's phone. The payment is awaiting handset authorization. Poll /payment-status/{id} or listen for webhook events."
        : null,
    };
    receipts.set(intent.id, receiptData);

    res.json({
      id: intent.id,
      status: intent.status,
      amount: parsedAmount,
      currency: currency ?? "ZMW",
      phone: normalizedPhone,
      receipt_url: `${SERVER_BASE_URL}/receipt/${intent.id}`,
      intent,
    });
  } catch (err) {
    res.status(err.status ?? 500).json({
      error: {
        type: err.type ?? "server_error",
        message: err.message,
      },
    });
  }
});

// ── GET /payment-status/:id ───────────────────────────────────────────────────
app.get("/payment-status/:id", async (req, res) => {
  try {
    const intent = await imali("GET", `/payment_intents/${req.params.id}`);

    // Update receipt if we have one
    if (receipts.has(intent.id)) {
      const r = receipts.get(intent.id);
      r.status = intent.status;
      r.provider = intent.metadata?.provider ?? r.provider;
      r.provider_ref = intent.metadata?.provider_ref ?? r.provider_ref;
      r.platform_fee = intent.metadata?.platform_fee ?? r.platform_fee;
      r.platform_fee_percent = intent.metadata?.platform_fee_percent ?? r.platform_fee_percent;
      r.provider_fee = intent.metadata?.provider_fee ?? r.provider_fee;
      r.provider_fee_percent = intent.metadata?.provider_fee_percent ?? r.provider_fee_percent;
      r.note = intent.status === "failed"
        ? "Payment failed. The customer may have declined or the request timed out."
        : intent.status === "succeeded"
        ? null
        : r.note;
      receipts.set(intent.id, r);
    }

    res.json({
      id: intent.id,
      status: intent.status,
      receipt_url: `${SERVER_BASE_URL}/receipt/${intent.id}`,
      intent,
    });
  } catch (err) {
    res.status(err.status ?? 500).json({
      error: {
        type: err.type ?? "server_error",
        message: err.message,
      },
    });
  }
});

// ── GET /receipt/:id ──────────────────────────────────────────────────────────
// Returns colorful downloadable HTML receipt
app.get("/receipt/:id", async (req, res) => {
  let data = receipts.get(req.params.id);

  // If not in memory, fetch from iMali
  if (!data) {
    try {
      const intent = await imali("GET", `/payment_intents/${req.params.id}`);
      data = {
        id: intent.id,
        amount: intent.amount,
        currency: intent.currency,
        status: intent.status,
        phone: intent.metadata?.momo_phone ?? "—",
        purpose: "",
        provider: intent.metadata?.provider ?? "",
        provider_ref: intent.metadata?.provider_ref ?? "",
        momo_country: intent.metadata?.momo_country ?? "",
        platform_fee: intent.metadata?.platform_fee,
        platform_fee_percent: intent.metadata?.platform_fee_percent,
        provider_fee: intent.metadata?.provider_fee,
        provider_fee_percent: intent.metadata?.provider_fee_percent,
        created_at: new Date().toISOString(),
      };
    } catch (err) {
      return res.status(err.status ?? 404).json({
        error: { type: "not_found", message: "Receipt not found." },
      });
    }
  }

  res.setHeader("Content-Type", "text/html");
  res.send(buildReceiptHTML(data));
});

// ── POST /webhooks/imali ──────────────────────────────────────────────────────
// Register this URL in iMali dashboard → Developers → Webhooks:
//   https://<your-render-app>.onrender.com/webhooks/imali
// Select events: payment_intent.created, payment_intent.succeeded,
//   payment_intent.failed, payment_link.paid,
//   withdrawal.requested, withdrawal.completed, withdrawal.failed
app.post("/webhooks/imali", (req, res) => {
  let body = req.body;
  if (Buffer.isBuffer(body)) body = JSON.parse(body.toString());

  const event = body;
  const pi = event?.data;

  switch (event?.type) {
    case "payment_intent.created":
      console.log(`[webhook] payment_intent.created: ${pi?.id}`);
      break;

    case "payment_intent.succeeded":
      console.log(`[webhook] payment_intent.succeeded: ${pi?.id}`);
      if (pi?.id && receipts.has(pi.id)) {
        const r = receipts.get(pi.id);
        r.status = "succeeded";
        r.note = null;
        r.provider_ref = pi?.metadata?.provider_ref ?? r.provider_ref;
        r.platform_fee = pi?.metadata?.platform_fee ?? r.platform_fee;
        r.provider_fee = pi?.metadata?.provider_fee ?? r.provider_fee;
        receipts.set(pi.id, r);
      }
      break;

    case "payment_intent.failed":
      console.log(`[webhook] payment_intent.failed: ${pi?.id}`);
      if (pi?.id && receipts.has(pi.id)) {
        const r = receipts.get(pi.id);
        r.status = "failed";
        r.note = "Payment failed. The customer may have declined or the request timed out.";
        receipts.set(pi.id, r);
      }
      break;

    case "payment_link.paid":
      console.log(`[webhook] payment_link.paid: ${pi?.id}`);
      break;

    case "withdrawal.requested":
      console.log(`[webhook] withdrawal.requested: ${pi?.id}`);
      break;

    case "withdrawal.completed":
      console.log(`[webhook] withdrawal.completed: ${pi?.id}`);
      break;

    case "withdrawal.failed":
      console.log(`[webhook] withdrawal.failed: ${pi?.id}`);
      break;

    default:
      console.log(`[webhook] unhandled event: ${event?.type}`);
  }

  res.json({ received: true });
});

app.listen(PORT, () => {
  console.log(`iMali STK push server running on port ${PORT}`);
  console.log(`Webhook receiver: POST /webhooks/imali`);
  console.log(`Register in iMali dashboard: ${SERVER_BASE_URL}/webhooks/imali`);
});

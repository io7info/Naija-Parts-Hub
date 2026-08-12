import { createHmac, timingSafeEqual } from 'node:crypto';
import { defineSecret } from 'firebase-functions/params';
import { PAYSTACK_SIGNATURE_HEADER, type Kobo } from '@nph/contracts';

/**
 * The Paystack API surface this project uses, and nothing more.
 *
 * An interface rather than direct `fetch` calls, for two reasons that both
 * showed up before a single key existed:
 *
 *   1. Everything worth testing about payments — replay refusal, amount
 *      mismatch, activation, the webhook signature — is our logic, not
 *      Paystack's. A fake client makes all of it testable with no network, no
 *      sandbox account, and no waiting on a third party's credentials.
 *   2. There are exactly two calls. Isolating them means the day the keys
 *      arrive, the only thing unverified is those two requests.
 *
 * Manual renewal (the client's decision) is why Plans and Subscriptions are
 * absent: every payment is a one-off charge that extends the period, so there
 * is no stored authorization, no recurring schedule, and no failed-renewal
 * retry path to build.
 */

const PAYSTACK_BASE = 'https://api.paystack.co';

/**
 * Secret key, never in any client bundle.
 *
 * `defineSecret` binds it to Secret Manager, so the value is not in source, not
 * in `.env`, and not readable from a deployed function's environment listing.
 * Functions that need it must declare it in their `secrets` option, which makes
 * the dependency explicit at the definition rather than at the call.
 */
export const PAYSTACK_SECRET_KEY = defineSecret('PAYSTACK_SECRET_KEY');

export type InitializeArgs = {
  /** Paystack requires an email; the dealer's, or a per-store fallback. */
  email: string;
  amountKobo: Kobo;
  /** Our reference, so the payment document exists before Paystack replies. */
  reference: string;
  callbackUrl: string;
  /** Card, bank transfer, USSD... omitted means every channel the account has. */
  channels?: string[];
  metadata?: Record<string, unknown>;
};

export type InitializeResult = {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
};

export type VerifyResult = {
  /** Paystack's verbatim status: 'success', 'failed', 'abandoned', ... */
  status: string;
  reference: string;
  /** What was actually charged, in kobo. Compared against what we asked for. */
  amountKobo: Kobo;
  channel: string | null;
  currency: string | null;
  paidAt: string | null;
  raw: Record<string, unknown>;
};

export interface PaystackClient {
  initializeTransaction(args: InitializeArgs): Promise<InitializeResult>;
  verifyTransaction(reference: string): Promise<VerifyResult>;
}

/** Paystack answered, but refused. Distinct from a network or parse failure. */
export class PaystackError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = 'PaystackError';
  }
}

/**
 * Confirms a webhook body really came from Paystack.
 *
 * HMAC-SHA512 of the **raw** request body, keyed with the secret. Raw matters:
 * a parsed body re-serialised with `JSON.stringify` reorders keys and drops
 * whitespace, so the digest will not match and every legitimate webhook is
 * rejected. This is why the handler is an `onRequest` function — a callable
 * gives no access to the unparsed bytes.
 *
 * `timingSafeEqual` rather than `===`: signature comparison is the one place a
 * timing side channel is a real, documented attack, and the cost of doing it
 * properly is one function call.
 */
export function verifyWebhookSignature(
  rawBody: Buffer | string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature) return false;

  const expected = createHmac('sha512', secret)
    .update(typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody)
    .digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // length — so the lengths are compared first and a mismatch simply fails.
  return a.length === b.length && timingSafeEqual(a, b);
}

export { PAYSTACK_SIGNATURE_HEADER };

/** The live client. Two requests, no SDK — Paystack's REST API is two URLs. */
export class HttpPaystackClient implements PaystackClient {
  constructor(private readonly secretKey: string) {
    if (!secretKey) {
      throw new Error('PAYSTACK_SECRET_KEY is not configured.');
    }
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${PAYSTACK_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });

    const body = (await response.json().catch(() => null)) as
      | { status?: boolean; message?: string; data?: T }
      | null;

    // Paystack signals refusal two ways: a non-2xx, or 200 with status:false.
    // Treating only the HTTP code as authoritative would let a declined
    // transaction look like a successful one.
    if (!response.ok || body?.status !== true || !body.data) {
      throw new PaystackError(
        body?.message ?? `Paystack request failed (${response.status}).`,
        response.status,
      );
    }

    return body.data;
  }

  async initializeTransaction(args: InitializeArgs): Promise<InitializeResult> {
    const data = await this.request<{
      authorization_url: string;
      access_code: string;
      reference: string;
    }>('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        email: args.email,
        amount: args.amountKobo,
        reference: args.reference,
        callback_url: args.callbackUrl,
        currency: 'NGN',
        ...(args.channels ? { channels: args.channels } : {}),
        ...(args.metadata ? { metadata: args.metadata } : {}),
      }),
    });

    return {
      authorizationUrl: data.authorization_url,
      accessCode: data.access_code,
      reference: data.reference,
    };
  }

  async verifyTransaction(reference: string): Promise<VerifyResult> {
    const data = await this.request<{
      status: string;
      reference: string;
      amount: number;
      channel: string | null;
      currency: string | null;
      paid_at: string | null;
    }>(`/transaction/verify/${encodeURIComponent(reference)}`, { method: 'GET' });

    return {
      status: data.status,
      reference: data.reference,
      amountKobo: data.amount,
      channel: data.channel ?? null,
      currency: data.currency ?? null,
      paidAt: data.paid_at ?? null,
      raw: data as unknown as Record<string, unknown>,
    };
  }
}

/**
 * Resolves the client the callables use.
 *
 * A factory so tests can substitute a fake without the callables knowing. In
 * the emulator the key comes from the environment instead of Secret Manager,
 * because Secret Manager is not available offline and a test key in a local
 * shell is not a secret worth protecting.
 */
let override: PaystackClient | null = null;

/** Test seam. Pass null to restore the real client. */
export function setPaystackClient(client: PaystackClient | null): void {
  override = client;
}

export function paystackClient(): PaystackClient {
  if (override) return override;

  const key = process.env.FUNCTIONS_EMULATOR === 'true'
    ? (process.env.PAYSTACK_SECRET_KEY ?? '')
    : PAYSTACK_SECRET_KEY.value();

  return new HttpPaystackClient(key);
}

/** The secret as a plain string, for signature verification. */
export function paystackSecret(): string {
  return process.env.FUNCTIONS_EMULATOR === 'true'
    ? (process.env.PAYSTACK_SECRET_KEY ?? '')
    : PAYSTACK_SECRET_KEY.value();
}

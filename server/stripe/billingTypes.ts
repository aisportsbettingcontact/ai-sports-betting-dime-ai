/**
 * server/stripe/billingTypes.ts
 *
 * Output shapes for the read-only billing procedures in server/routers/stripe.ts
 * (getInvoices, getPaymentMethods, getBillingInfo). Kept separate from the
 * procedures themselves so Step 4 (client UI) has a single, stable import for
 * the shapes it renders, independent of tRPC's inference plumbing.
 */

import type Stripe from "stripe";

export interface BillingInvoice {
  /** ms epoch (UTC) — Stripe's `created`, converted from seconds */
  date: number;
  /** amount actually paid (falls back to amount_due for unpaid/open invoices) */
  amountCents: number;
  currency: string;
  status: string;
  hostedInvoiceUrl: string | null;
}

export interface BillingPaymentMethod {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
}

export interface BillingInfo {
  name: string | null;
  email: string | null;
  address: Stripe.Address | null;
}

export type StoreConfig = {
  currency: string;
  taxRateBps: number;
  freeShippingThresholdCents: number | null;
  shippingRates: Record<string, { standardCents: number; expressCents: number }>;
};

export type DiscountCode = {
  code: string;
  type: "percent" | "fixed";
  value: number;
  minSubtotalCents: number;
  startsAt: Date;
  endsAt: Date | null;
  active: boolean;
  usesRemaining: number | null;
};

export type DiscountOutcome =
  | { ok: true; amountCents: number }
  | { ok: false; reason: "not_found" | "inactive" | "not_started" | "expired" | "exhausted" | "min_subtotal" };

export function resolveDiscount(
  code: DiscountCode | null,
  subtotalCents: number,
  now: Date,
): DiscountOutcome {
  if (!code) return { ok: false, reason: "not_found" };
  if (!code.active) return { ok: false, reason: "inactive" };
  if (now < code.startsAt) return { ok: false, reason: "not_started" };
  if (code.endsAt && now > code.endsAt) return { ok: false, reason: "expired" };
  if (code.usesRemaining !== null && code.usesRemaining <= 0) return { ok: false, reason: "exhausted" };
  if (subtotalCents < code.minSubtotalCents) return { ok: false, reason: "min_subtotal" };

  const raw = code.type === "percent"
    ? Math.round((subtotalCents * code.value) / 100)
    : code.value;
  return { ok: true, amountCents: Math.min(raw, subtotalCents) };
}

export type Totals = {
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
};

export function calculateTotals(input: {
  lines: { unitPriceCents: number; quantity: number }[];
  config: StoreConfig;
  region: string;
  method: "standard" | "express";
  discountCents: number;
}): Totals {
  const subtotal = input.lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
  const discount = Math.min(input.discountCents, subtotal);
  const afterDiscount = subtotal - discount;

  const rate = input.config.shippingRates[input.region];
  if (!rate) throw new Error(`Shipping is not available to region ${input.region}`);

  const qualifiesForFree =
    input.method === "standard" &&
    input.config.freeShippingThresholdCents !== null &&
    afterDiscount >= input.config.freeShippingThresholdCents;

  const shipping = qualifiesForFree
    ? 0
    : input.method === "express" ? rate.expressCents : rate.standardCents;

  const taxable = afterDiscount + shipping;
  const tax = Math.round((taxable * input.config.taxRateBps) / 10000);

  return {
    subtotalCents: subtotal,
    discountCents: discount,
    shippingCents: shipping,
    taxCents: tax,
    totalCents: taxable + tax,
  };
}
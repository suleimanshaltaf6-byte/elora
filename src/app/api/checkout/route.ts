import { z } from "zod";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { getStoreConfig } from "@/config/store";
import { calculateTotals, resolveDiscount } from "@/lib/commerce/pricing";
import { getOptionalSession } from "@/lib/auth/session";

const CheckoutInput = z.object({
  idempotencyKey: z.string().uuid(),
  lines: z.array(z.object({
    variantId: z.string().min(1),
    quantity: z.number().int().min(1).max(10),
  })).min(1).max(30),
  email: z.string().email(),
  shippingRegion: z.string().length(2),
  shippingMethod: z.enum(["standard", "express"]),
  discountCode: z.string().trim().max(40).optional(),
});

type CheckoutErrorCode = "UNAVAILABLE" | "OUT_OF_STOCK" | "INVALID_DISCOUNT" | "IDEMPOTENCY_CONFLICT";

class CheckoutError extends Error {
  constructor(
    readonly code: CheckoutErrorCode,
    message: string,
    readonly variantId?: string,
  ) {
    super(message);
    this.name = "CheckoutError";
  }
}

function discountMessage(reason: string): string {
  switch (reason) {
    case "not_started": return "This discount is not available yet.";
    case "expired": return "This discount has expired.";
    case "exhausted": return "This discount has reached its usage limit.";
    case "min_subtotal": return "Your order does not meet the minimum for this discount.";
    case "inactive":
    case "not_found":
    default: return "This discount code is not valid.";
  }
}

function mapTotals(totals: ReturnType<typeof calculateTotals>) {
  return {
    subtotalCents: totals.subtotalCents,
    discountCents: totals.discountCents,
    shippingCents: totals.shippingCents,
    taxCents: totals.taxCents,
    totalCents: totals.totalCents,
  };
}

function orderNumberForKey(idempotencyKey: string): string {
  return `EIL-${idempotencyKey.replaceAll("-", "").toUpperCase()}`;
}

function ownsOrder(
  order: { customerId: string | null; guestEmail: string | null },
  session: Awaited<ReturnType<typeof getOptionalSession>>,
  email: string,
): boolean {
  if (session) return order.customerId === session.user.id;
  return order.customerId === null && order.guestEmail?.toLowerCase() === email.toLowerCase();
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function errorStatus(code: CheckoutErrorCode): number {
  return code === "OUT_OF_STOCK" || code === "UNAVAILABLE" || code === "IDEMPOTENCY_CONFLICT" ? 409 : 400;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "INVALID_INPUT", message: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = CheckoutInput.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "INVALID_INPUT", message: "Checkout details are invalid." }, { status: 400 });
  }

  const input = parsed.data;

  try {
    const session = await getOptionalSession(req);
    const config = getStoreConfig();

    const createOrder = () => db.$transaction(async (tx) => {
      const existing = await tx.order.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) {
        if (!ownsOrder(existing, session, input.email)) {
          throw new CheckoutError("IDEMPOTENCY_CONFLICT", "This checkout request cannot be reused.");
        }
        return existing;
      }

      const ids = input.lines.map((line) => line.variantId);
      const variants = await tx.variant.findMany({
        where: { id: { in: ids }, product: { status: "ACTIVE" } },
        include: { product: true },
      });
      if (variants.length !== new Set(ids).size) {
        throw new CheckoutError("UNAVAILABLE", "Some items are no longer available.");
      }

      for (const line of input.lines) {
        const updated = await tx.variant.updateMany({
          where: { id: line.variantId, stock: { gte: line.quantity } },
          data: { stock: { decrement: line.quantity }, version: { increment: 1 } },
        });
        if (updated.count === 0) {
          throw new CheckoutError(
            "OUT_OF_STOCK",
            "An item in your bag just sold out. Please review your cart.",
            line.variantId,
          );
        }
      }

      const priced = input.lines.map((line) => {
        const variant = variants.find((item) => item.id === line.variantId)!;
        return { variant, quantity: line.quantity, unitPriceCents: variant.priceCents };
      });
      const subtotal = priced.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);

      const storedCode = input.discountCode
        ? await tx.discountCode.findUnique({ where: { code: input.discountCode.toUpperCase() } })
        : null;
      const discount = resolveDiscount(storedCode ? {
        ...storedCode,
        type: storedCode.type === "PERCENT" ? "percent" : "fixed",
      } : null, subtotal, new Date());
      if (input.discountCode && !discount.ok) {
        throw new CheckoutError("INVALID_DISCOUNT", discountMessage(discount.reason));
      }

      const totals = calculateTotals({
        lines: priced,
        config,
        region: input.shippingRegion,
        method: input.shippingMethod,
        discountCents: discount.ok ? discount.amountCents : 0,
      });

      return tx.order.create({
        data: {
          number: orderNumberForKey(input.idempotencyKey),
          status: "PENDING_PAYMENT",
          idempotencyKey: input.idempotencyKey,
          customerId: session?.user.id ?? null,
          guestEmail: session ? null : input.email,
          currency: config.currency,
          ...mapTotals(totals),
          discountCode: discount.ok ? storedCode!.code : null,
          items: { create: priced.map((line) => ({
            variantId: line.variant.id,
            nameSnapshot: `${line.variant.product.nameEn}${line.variant.shadeName ? ` - ${line.variant.shadeName}` : ""}`,
            unitPriceCents: line.unitPriceCents,
            quantity: line.quantity,
          })) },
        },
      });
    });

    let order;
    try {
      order = await createOrder();
    } catch (error) {
      if (error instanceof CheckoutError) throw error;
      if (!isUniqueConstraintError(error)) throw error;

      const existing = await db.order.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (!existing) throw error;
      if (!ownsOrder(existing, session, input.email)) {
        throw new CheckoutError("IDEMPOTENCY_CONFLICT", "This checkout request cannot be reused.");
      }
      order = existing;
    }

    if (order.status !== "PENDING_PAYMENT") {
      return Response.json({ orderNumber: order.number });
    }

    const intent = order.paymentIntentId
      ? await stripe.paymentIntents.retrieve(order.paymentIntentId)
      : await stripe.paymentIntents.create(
        {
          amount: order.totalCents,
          currency: order.currency.toLowerCase(),
          automatic_payment_methods: { enabled: true },
          metadata: { orderId: order.id, orderNumber: order.number },
        },
        { idempotencyKey: `pi-${order.idempotencyKey}` },
      );

    if (!order.paymentIntentId) {
      await db.order.update({ where: { id: order.id }, data: { paymentIntentId: intent.id } });
    }
    if (!intent.client_secret) {
      throw new Error("Stripe did not return a payment client secret.");
    }

    return Response.json({ orderNumber: order.number, clientSecret: intent.client_secret });
  } catch (error) {
    if (error instanceof CheckoutError) {
      return Response.json({
        error: error.code,
        message: error.message,
        ...(error.variantId ? { variantId: error.variantId } : {}),
      }, { status: errorStatus(error.code) });
    }
    return Response.json({ error: "CHECKOUT_FAILED", message: "Unable to start checkout." }, { status: 500 });
  }
}
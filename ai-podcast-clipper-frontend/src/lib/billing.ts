import Stripe from "stripe";
import { env } from "~/env";

export type PriceId = "small" | "medium" | "large";

export function isBillingConfigured() {
  return Boolean(
    env.STRIPE_SECRET_KEY &&
      env.STRIPE_SMALL_CREDIT_PACK &&
      env.STRIPE_MEDIUM_CREDIT_PACK &&
      env.STRIPE_LARGE_CREDIT_PACK,
  );
}

export function getStripeConfig() {
  if (
    !env.STRIPE_SECRET_KEY ||
    !env.STRIPE_SMALL_CREDIT_PACK ||
    !env.STRIPE_MEDIUM_CREDIT_PACK ||
    !env.STRIPE_LARGE_CREDIT_PACK
  ) {
    throw new Error("Billing is not configured for this deployment.");
  }

  return {
    stripe: new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: "2025-04-30.basil",
    }),
    priceIds: {
      small: env.STRIPE_SMALL_CREDIT_PACK,
      medium: env.STRIPE_MEDIUM_CREDIT_PACK,
      large: env.STRIPE_LARGE_CREDIT_PACK,
    } satisfies Record<PriceId, string>,
  };
}

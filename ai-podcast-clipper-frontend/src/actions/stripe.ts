"use server";

import { redirect } from "next/navigation";
import { env } from "~/env";
import { getStripeConfig, type PriceId } from "~/lib/billing";
import { auth } from "~/server/auth";
import { db } from "~/server/db";

export async function createCheckoutSession(priceId: PriceId) {
  const serverSession = await auth();
  const { stripe, priceIds } = getStripeConfig();

  const user = await db.user.findUniqueOrThrow({
    where: {
      id: serverSession?.user.id,
    },
    select: { stripeCustomerId: true },
  });

  if (!user.stripeCustomerId) {
    throw new Error("User has no stripeCustomerId");
  }

  const session = await stripe.checkout.sessions.create({
    line_items: [{ price: priceIds[priceId], quantity: 1 }],
    customer: user.stripeCustomerId,
    mode: "payment",
    success_url: `${env.BASE_URL}/dashboard?success=true`,
  });

  if (!session.url) {
    throw new Error("Failed to create session URL");
  }

  redirect(session.url);
}

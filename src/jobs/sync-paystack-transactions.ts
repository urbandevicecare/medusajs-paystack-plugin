import { MedusaContainer } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";

export default async function syncPaystackTransactions({
  container,
}: {
  container: MedusaContainer;
}) {
  const query = container.resolve("query");
  const paymentModule = container.resolve(Modules.PAYMENT);
  const logger = container.resolve("logger");

  logger.info("Starting Paystack transaction sync job...");

  try {
    // 1. Fetch pending payment sessions for Paystack
    const { data: paymentSessions } = await query.graph({
      entity: "payment_session",
      fields: ["id", "status", "provider_id", "data"],
      filters: {
        status: "pending",
        provider_id: { $like: "%paystack%" },
      },
    });

    if (!paymentSessions || paymentSessions.length === 0) {
      logger.info("No pending Paystack payment sessions found.");
      return;
    }

    logger.info(`Found ${paymentSessions.length} pending Paystack session(s).`);

    let verifiedCount = 0;
    for (const session of paymentSessions) {
      try {
        // Authorize payment session. The Paystack provider will internally verify the transaction
        // via Paystack's API. If successful, it returns status CAPTURED.
        const authorizedSession = await paymentModule.authorizePaymentSession(
          session.id,
          {}
        );

        if (authorizedSession.status === "captured") {
          verifiedCount++;
        }
        
        logger.info(
          `Checked session ${session.id}. New status: ${authorizedSession.status}`
        );
      } catch (err: any) {
        logger.error(`Error verifying session ${session.id}: ${err.message}`);
      }
    }

    logger.info(`Paystack sync complete. Captured ${verifiedCount} previously pending payments.`);
  } catch (error: any) {
    logger.error(`Failed to sync Paystack transactions: ${error.message}`);
  }
}

export const config = {
  name: "sync-paystack-transactions",
  // Runs every 15 minutes
  schedule: "*/15 * * * *",
};

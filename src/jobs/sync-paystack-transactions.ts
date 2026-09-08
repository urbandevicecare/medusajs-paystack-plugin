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
    // 1. Fetch pending/in-flight payment sessions for Paystack
    const { data: paymentSessions } = await query.graph({
      entity: "payment_session",
      fields: ["id", "status", "provider_id", "data", "created_at"],
      filters: {
        status: { $in: ["pending", "pending_authorization", "requires_more"] },
        provider_id: { $like: "%paystack%" },
      },
    });

    if (!paymentSessions || paymentSessions.length === 0) {
      logger.info("No pending Paystack payment sessions found.");
      return;
    }

    logger.info(`Found ${paymentSessions.length} in-flight Paystack session(s).`);

    let verifiedCount = 0;
    const now = Date.now();
    for (const session of paymentSessions) {
      try {
        // Skip sessions created in the last 60 seconds to avoid racing with customer checkout
        const createdAt = session.created_at ? new Date(session.created_at).getTime() : 0;
        if (createdAt && (now - createdAt) < 60000) {
          continue;
        }

        // Authorize payment session. The Paystack provider will internally verify the transaction
        // via Paystack's API. If successful, it returns status CAPTURED.
        const authorizedSession = await paymentModule.authorizePaymentSession(
          session.id,
          {}
        );

        if (authorizedSession && (authorizedSession.captured_at || authorizedSession.id)) {
          verifiedCount++;
          logger.info(
            `[Paystack-Sync] Verified and captured payment for session ${session.id}`
          );
        }
      } catch (err: any) {
        // When a session is not yet approved by customer, Medusa throws NOT_ALLOWED.
        // Log this gracefully as a debug/info note rather than a fatal error.
        logger.debug?.(`[Paystack-Sync] Session ${session.id} pending completion: ${err.message}`);
      }
    }

    logger.info(`Paystack sync complete. Captured ${verifiedCount} payment(s).`);
  } catch (error: any) {
    logger.error(`Failed to sync Paystack transactions: ${error.message}`);
  }
}

export const config = {
  name: "sync-paystack-transactions",
  // Runs every 15 minutes
  schedule: "*/15 * * * *",
};

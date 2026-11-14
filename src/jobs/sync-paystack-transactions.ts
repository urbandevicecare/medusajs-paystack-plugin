import { MedusaContainer } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { reconcileAndCapturePaystackPayment, reconcilePaystackRepairPayment } from "../providers/paystack/utils/reconcile-payment";

export default async function syncPaystackTransactions(
  containerOrArgs: any
) {
  const container: MedusaContainer = containerOrArgs?.resolve
    ? containerOrArgs
    : containerOrArgs?.container;

  if (!container || typeof container.resolve !== "function") {
    return;
  }

  const query = container.resolve("query");
  let paymentModule: any = null;
  try {
    paymentModule = container.resolve(Modules.PAYMENT);
  } catch {
    try {
      paymentModule = container.resolve("payment");
    } catch {}
  }

  const logger = container.resolve("logger");

  logger.info("Starting Paystack transaction sync job...");

  try {
    let verifiedCount = 0;

    // 1. Fetch pending/in-flight payment sessions for Paystack
    const { data: paymentSessions } = await query.graph({
      entity: "payment_session",
      fields: ["id", "status", "provider_id", "data", "created_at"],
      filters: {
        status: { $in: ["pending", "pending_authorization", "requires_more"] },
        provider_id: { $like: "%paystack%" },
      },
    }).catch(() => ({ data: [] }));

    if (paymentSessions && paymentSessions.length > 0) {
      logger.info(`Found ${paymentSessions.length} in-flight Paystack session(s).`);

      const now = Date.now();
      for (const session of paymentSessions) {
        try {
          // Skip sessions created in the last 60 seconds to avoid racing with customer checkout
          const createdAt = session.created_at ? new Date(session.created_at).getTime() : 0;
          if (createdAt && (now - createdAt) < 60000) {
            continue;
          }

          if (!paymentModule) continue;

          // Authorize payment session. The Paystack provider will internally verify the transaction
          // via Paystack's API. If successful, it returns status CAPTURED.
          const authorizedSession = await paymentModule.authorizePaymentSession(
            session.id,
            {}
          );

          if (authorizedSession) {
            // Ensure payment is explicitly captured if returned in authorized state
            if (!authorizedSession.captured_at && typeof paymentModule.capturePayment === "function") {
              try {
                await paymentModule.capturePayment({
                  payment_id: authorizedSession.id,
                  amount: authorizedSession.amount,
                });
              } catch {}
            }

            verifiedCount++;
            logger.info(
              `[Paystack-Sync] Verified and captured payment for session ${session.id}`
            );
          }
        } catch (err: any) {
          // When a session is not yet approved by customer, Medusa throws NOT_ALLOWED.
          logger.debug?.(`[Paystack-Sync] Session ${session.id} pending completion: ${err.message}`);
        }
      }
    } else {
      logger.info("No pending Paystack payment sessions found.");
    }

    // 2. Reconcile unpaid orders with pending Paystack references
    try {
      const { data: unpaidOrders } = await query.graph({
        entity: "order",
        fields: [
          "id",
          "total",
          "currency_code",
          "metadata",
          "payment_collections.id",
          "payment_collections.status",
          "payment_collections.amount",
          "payment_collections.captured_amount",
          "payment_collections.payment_sessions.id",
          "payment_collections.payment_sessions.status",
          "payment_collections.payment_sessions.data",
          "payment_collections.payment_sessions.provider_id",
        ],
        filters: {
          payment_collections: {
            status: { $in: ["not_paid", "partially_paid"] },
          },
        },
      }).catch(() => ({ data: [] }));

      if (unpaidOrders && unpaidOrders.length > 0) {
        for (const order of unpaidOrders) {
          const sessions = order.payment_collections?.[0]?.payment_sessions || [];
          let reconciled = false;
          for (const s of sessions) {
            const ref = s.data?.paystackTxRef || s.data?.reference || (order.metadata as any)?.paystack_reference;
            if (ref && s.provider_id?.includes("paystack") && s.status !== "authorized") {
              try {
                const res = await reconcileAndCapturePaystackPayment({
                  container,
                  orderId: order.id,
                  reference: ref,
                  currency: order.currency_code,
                });
                if (res.captured) {
                  verifiedCount++;
                  reconciled = true;
                  logger.info(`[Paystack-Sync] Reconciled and captured payment for order ${order.id} (ref: ${ref})`);
                }
              } catch (err: any) {
                logger.debug?.(`[Paystack-Sync] Note reconciling order ${order.id}: ${err.message}`);
              }
            }
          }

          if (!reconciled && (order.metadata as any)?.paystack_reference) {
            const orderRef = (order.metadata as any).paystack_reference;
            try {
              const res = await reconcileAndCapturePaystackPayment({
                container,
                orderId: order.id,
                reference: orderRef,
                currency: order.currency_code,
              });
              if (res.captured) {
                verifiedCount++;
                logger.info(`[Paystack-Sync] Reconciled and captured payment for order ${order.id} via metadata ref (${orderRef})`);
              }
            } catch (err: any) {
              logger.debug?.(`[Paystack-Sync] Note reconciling order ${order.id} via metadata: ${err.message}`);
            }
          }
        }
      }
    } catch (orderSyncErr: any) {
      logger.debug?.(`[Paystack-Sync] Order reconciliation scan note: ${orderSyncErr.message}`);
    }

    // 3. Reconcile pending repair tickets with Paystack if repair module is present
    try {
      let repairService: any = null;
      try {
        repairService = container.resolve("repair", { allowUnregistered: true });
      } catch {}

      if (repairService && typeof repairService.listRepairTickets === "function") {
        const pendingTickets = await repairService.listRepairTickets({
          payment_status: "pending",
        }).catch(() => []);

        for (const ticket of (pendingTickets || [])) {
          const ref = (ticket.metadata as any)?.paystack_reference || ticket.payment_collection_id;
          if (ref) {
            try {
              const res = await reconcilePaystackRepairPayment({
                container,
                ticketId: ticket.id,
                reference: ref,
              });
              if (res.captured) {
                verifiedCount++;
                logger.info(`[Paystack-Sync] Reconciled and marked repair ticket ${ticket.ticket_number || ticket.id} as paid (ref: ${ref})`);
              }
            } catch (ticketErr: any) {
              logger.debug?.(`[Paystack-Sync] Note reconciling repair ticket ${ticket.id}: ${ticketErr.message}`);
            }
          }
        }
      }
    } catch (repairSyncErr: any) {
      logger.debug?.(`[Paystack-Sync] Repair ticket scan note: ${repairSyncErr.message}`);
    }

    logger.info(`Paystack sync complete. Captured/reconciled ${verifiedCount} payment(s).`);
  } catch (error: any) {
    logger.error(`Failed to sync Paystack transactions: ${error.message}`);
  }
}

export const config = {
  name: "sync-paystack-transactions",
  // Runs every 15 minutes
  schedule: "*/15 * * * *",
};

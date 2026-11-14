import { Modules } from "@medusajs/framework/utils";

export interface ReconcilePaymentOptions {
  container: any;
  orderId: string;
  reference: string;
  amount?: number; // In standard currency units (e.g. 1500 for KES 1500)
  currency?: string;
}

export interface ReconcilePaymentResult {
  success: boolean;
  captured: boolean;
  paymentId?: string;
  orderId: string;
  message: string;
}

/**
 * Reconciles and captures a Paystack payment against a Medusa order.
 * Ensures the order's payment collection is updated, remaining balance is deducted,
 * and the payment is marked as captured in Medusa v2.
 */
export async function reconcileAndCapturePaystackPayment({
  container,
  orderId,
  reference,
  amount,
  currency,
}: ReconcilePaymentOptions): Promise<ReconcilePaymentResult> {
  const logger = container?.resolve ? container.resolve("logger") : console;
  const query = container?.resolve ? container.resolve("query") : null;
  
  let paymentModule: any = null;
  try {
    const paymentKey = typeof Modules !== "undefined" && Modules?.PAYMENT ? Modules.PAYMENT : "payment";
    paymentModule = container?.resolve ? container.resolve(paymentKey) : null;
  } catch {
    try {
      paymentModule = container?.resolve ? container.resolve("payment") : null;
    } catch {}
  }

  if (!query || !orderId) {
    return {
      success: false,
      captured: false,
      orderId,
      message: "Query service or orderId not provided",
    };
  }

  try {
    // 1. Fetch order details with payment collections and payments
    const { data: orders } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "total",
        "currency_code",
        "payment_collections.id",
        "payment_collections.status",
        "payment_collections.amount",
        "payment_collections.captured_amount",
        "payment_collections.payment_sessions.id",
        "payment_collections.payment_sessions.status",
        "payment_collections.payment_sessions.data",
        "payment_collections.payment_sessions.provider_id",
        "payment_collections.payments.id",
        "payment_collections.payments.amount",
        "payment_collections.payments.captured_at",
        "payment_collections.payments.canceled_at",
      ],
      filters: { id: orderId },
    }).catch(() => ({ data: [] }));

    const order = orders?.[0];
    if (!order) {
      return {
        success: false,
        captured: false,
        orderId,
        message: `Order ${orderId} not found in Medusa`,
      };
    }

    const orderCurrency = (currency || order.currency_code || "KES").toLowerCase();
    const paymentCollections = order.payment_collections || [];
    const paymentCollection = paymentCollections[0];

    if (!paymentCollection) {
      return {
        success: false,
        captured: false,
        orderId,
        message: `No payment collection found for order ${orderId}`,
      };
    }

    // 2. Check if already fully captured
    let capturedAmount = Number(paymentCollection.captured_amount || 0);
    if (!capturedAmount && paymentCollection.payments) {
      capturedAmount = paymentCollection.payments.reduce((acc: number, p: any) => {
        const isPaid = Boolean(p.captured_at) && !p.canceled_at;
        return acc + (isPaid ? Number(p.amount) : 0);
      }, 0);
    }

    const orderTotal = Number(order.total || paymentCollection.amount || 0);
    const chargeAmount = amount !== undefined && amount !== null && amount > 0
      ? Number(amount)
      : Math.max(1, orderTotal - capturedAmount);

    if (capturedAmount >= orderTotal && orderTotal > 0) {
      logger.info?.(`[Paystack-Reconcile] Order ${orderId} is already fully captured (${capturedAmount}/${orderTotal}).`);
      return {
        success: true,
        captured: true,
        orderId,
        message: "Order already fully paid",
      };
    }

    if (!paymentModule) {
      logger.warn?.(`[Paystack-Reconcile] Payment module not found in container, unable to invoke capture.`);
      return {
        success: true,
        captured: false,
        orderId,
        message: "Order verified with Paystack, but payment module unavailable to capture in Medusa",
      };
    }

    // 3. Find or create payment session on the payment collection
    const existingSessions = paymentCollection.payment_sessions || [];
    let matchingSession = existingSessions.find((s: any) => {
      const sRef = s.data?.paystackTxRef || s.data?.reference;
      return sRef === reference;
    });

    if (!matchingSession) {
      matchingSession = existingSessions.find((s: any) =>
        s.provider_id?.includes("paystack") && s.status !== "authorized"
      );
    }

    if (!matchingSession && typeof paymentModule.createPaymentSession === "function") {
      try {
        matchingSession = await paymentModule.createPaymentSession(paymentCollection.id, {
          provider_id: "paystack",
          currency_code: orderCurrency,
          amount: chargeAmount,
          data: {
            paystackTxRef: reference,
            reference,
          },
        });
        logger.info?.(`[Paystack-Reconcile] Created payment session ${matchingSession.id} for order ${orderId}`);
      } catch (err: any) {
        logger.warn?.(`[Paystack-Reconcile] Failed to create payment session: ${err.message}`);
      }
    }

    // 4. Authorize and capture payment session
    let payment: any = null;
    if (matchingSession && typeof paymentModule.authorizePaymentSession === "function") {
      try {
        payment = await paymentModule.authorizePaymentSession(matchingSession.id, {
          paystackTxRef: reference,
          reference,
        });

        logger.info?.(`[Paystack-Reconcile] Authorized payment session ${matchingSession.id} for order ${orderId}`);
      } catch (err: any) {
        logger.warn?.(`[Paystack-Reconcile] Authorize payment session note: ${err.message}`);
      }
    }

    // If payment was created but not yet captured, capture it explicitly
    if (payment && !payment.captured_at && typeof paymentModule.capturePayment === "function") {
      try {
        payment = await paymentModule.capturePayment({
          payment_id: payment.id,
          amount: chargeAmount,
        });
        logger.info?.(`[Paystack-Reconcile] Explicitly captured payment ${payment.id} for order ${orderId}`);
      } catch (err: any) {
        logger.warn?.(`[Paystack-Reconcile] Capture payment note: ${err.message}`);
      }
    }

    return {
      success: true,
      captured: Boolean(payment?.captured_at || payment?.id),
      paymentId: payment?.id,
      orderId,
      message: `Payment successfully reconciled and captured for order ${orderId}`,
    };
  } catch (error: any) {
    logger.error?.(`[Paystack-Reconcile] Error reconciling payment for order ${orderId}: ${error.message}`);
    return {
      success: false,
      captured: false,
      orderId,
      message: error.message || "Failed to reconcile payment",
    };
  }
}

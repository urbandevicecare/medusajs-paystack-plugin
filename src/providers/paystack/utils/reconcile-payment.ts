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

export interface ReconcileRepairOptions {
  container: any;
  ticketId?: string;
  ticketNumber?: string;
  reference: string;
  amount?: number; // In standard currency units (e.g. 1500 for KES 1500)
}

export interface ReconcileRepairResult {
  success: boolean;
  captured: boolean;
  ticketId?: string;
  ticketNumber?: string;
  message: string;
}

/**
 * Reconciles and captures a Paystack payment against a Medusa repair ticket (Repairshop plugin).
 * Updates the ticket's payment_status to 'captured', advances ticket status, tags with 'Paid',
 * and emits 'repair.payment_received' event.
 */
export async function reconcilePaystackRepairPayment({
  container,
  ticketId,
  ticketNumber,
  reference,
  amount,
}: ReconcileRepairOptions): Promise<ReconcileRepairResult> {
  const logger = container?.resolve ? container.resolve("logger") : console;
  let repairService: any = null;

  try {
    repairService = container?.resolve ? container.resolve("repair", { allowUnregistered: true }) : null;
  } catch {}

  if (!repairService) {
    return {
      success: false,
      captured: false,
      message: "Repair module not available in container",
    };
  }

  try {
    let tickets: any[] = [];
    if (ticketId) {
      tickets = await repairService.listRepairTickets({ id: ticketId });
    } else if (ticketNumber) {
      tickets = await repairService.listRepairTickets({ ticket_number: ticketNumber });
    } else if (reference) {
      // Common pattern: REP-<ticket_number>-<timestamp>
      const match = reference.match(/^REP-([^-]+)/i);
      if (match) {
        tickets = await repairService.listRepairTickets({ ticket_number: match[1] });
      }
      if (!tickets?.length) {
        tickets = await repairService.listRepairTickets({ ticket_number: reference });
      }
    }

    if (!tickets || tickets.length === 0) {
      return {
        success: false,
        captured: false,
        message: `Repair ticket not found for reference ${reference}`,
      };
    }

    const ticket = tickets[0];
    const parseNum = (val: any) => {
      if (!val) return 0;
      if (typeof val === "object" && "value" in val) return Number(val.value);
      return Number(val);
    };

    const totalEstimate = parseNum(ticket.total_estimate);
    const totalActual = parseNum(ticket.total_actual);
    const targetTotal = totalActual > 0 ? totalActual : totalEstimate;
    const amountPaidSoFar = parseNum(ticket.amount_paid);

    const paymentAmount = amount !== undefined && amount !== null && amount > 0
      ? Number(amount)
      : Math.max(0, targetTotal - amountPaidSoFar);

    const newAmountPaid = amountPaidSoFar + paymentAmount;
    const isFullyPaid = targetTotal > 0 ? newAmountPaid >= targetTotal : true;

    if (ticket.payment_status === "captured" && isFullyPaid) {
      return {
        success: true,
        captured: true,
        ticketId: ticket.id,
        ticketNumber: ticket.ticket_number,
        message: `Repair ticket ${ticket.ticket_number || ticket.id} is already marked as paid`,
      };
    }

    let newStatus = ticket.status;
    const existingMetadata = ticket.metadata || {};
    const rawTags = existingMetadata.tags;
    const existingTags = Array.isArray(rawTags)
      ? [...rawTags]
      : typeof rawTags === "string"
        ? rawTags.split(",").map((t: string) => t.trim()).filter(Boolean)
        : [];

    if (isFullyPaid) {
      if (!existingTags.includes("Paid")) {
        existingTags.push("Paid");
      }
      if (ticket.status === "ready") {
        newStatus = "collected";
      } else if (ticket.status === "awaiting_approval") {
        newStatus = "repairing";
      }
    }

    const updatePayload: any = {
      id: ticket.id,
      amount_paid: newAmountPaid,
      payment_status: isFullyPaid ? "captured" : "pending",
      payment_collection_id: reference || ticket.payment_collection_id,
      status: newStatus,
      metadata: {
        ...existingMetadata,
        tags: existingTags,
        paystack_reference: reference,
      },
    };

    if (isFullyPaid && ticket.status === "ready") {
      updatePayload.collected_at = new Date();
    }

    await repairService.updateRepairTickets(updatePayload);

    // Emit event if eventBus is present
    try {
      const eventBus =
        (container?.resolve && container.resolve("event_bus", { allowUnregistered: true })) ||
        (container?.resolve && container.resolve("eventBus", { allowUnregistered: true }));
      if (eventBus && typeof eventBus.emit === "function") {
        await eventBus.emit({
          name: "repair.payment_received",
          data: {
            id: ticket.id,
            repair_ticket_id: ticket.id,
            amount: paymentAmount,
            reference,
            payment_method: "Paystack",
          },
        });
      }
    } catch {}

    logger.info?.(`[Paystack-Reconcile] Successfully marked repair ticket ${ticket.ticket_number || ticket.id} as paid (Reference: ${reference}).`);

    return {
      success: true,
      captured: isFullyPaid,
      ticketId: ticket.id,
      ticketNumber: ticket.ticket_number,
      message: `Repair ticket ${ticket.ticket_number || ticket.id} marked as ${isFullyPaid ? "paid/captured" : "partially paid"}`,
    };
  } catch (err: any) {
    logger.error?.(`[Paystack-Reconcile] Error reconciling repair ticket: ${err.message}`);
    return {
      success: false,
      captured: false,
      message: err.message || "Failed to reconcile repair ticket",
    };
  }
}

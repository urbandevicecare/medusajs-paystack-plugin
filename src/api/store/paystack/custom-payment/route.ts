import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { resolvePaystackSecretKey } from "../../../../providers/paystack/utils/currency";

export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const { order_id, amount } = req.body as { order_id: string; amount?: number };

  if (!order_id) {
    return res.status(400).json({ message: "order_id is required" });
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  // 1. Retrieve the Order robustly
  let order: any = null;
  try {
    const orderService = req.scope.resolve(Modules.ORDER);
    order = await orderService.retrieveOrder(order_id).catch(() => null);
  } catch {}

  if (!order) {
    try {
      const { data: orders } = await query.graph({
        entity: "order",
        fields: ["id", "display_id", "currency_code", "email"],
        filters: { id: order_id }
      }).catch(() => ({ data: [] }));
      order = orders?.[0];
    } catch {}
  }

  if (!order) {
    try {
      const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION);
      const rows = await pgConnection("order")
        .where("id", order_id)
        .orWhere("display_id", isNaN(Number(order_id)) ? -1 : Number(order_id))
        .limit(1);
      if (rows && rows[0]) order = rows[0];
    } catch {}
  }

  if (!order) {
    return res.status(404).json({ message: "Order not found" });
  }

  // 2. Resolve Paystack Secret Key
  const { data: stores } = await query.graph({
    entity: "store",
    fields: ["metadata"]
  }).catch(() => ({ data: [] }));
  const dynamicSecret = stores?.[0]?.metadata?.paystack_secret_key as string | undefined;

  const secretKey = resolvePaystackSecretKey(dynamicSecret);
  if (!secretKey) {
    return res.status(500).json({ message: "Paystack is not configured. Please set PAYSTACK_SECRET_KEY." });
  }

  // 3. Resolve amount
  let chargeAmount = amount !== undefined && amount !== null ? Number(amount) : Number(order.total || 0);
  if (!chargeAmount || chargeAmount <= 0) {
    try {
      const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION);
      const summaryRows = await pgConnection("order_summary")
        .where("order_id", order.id)
        .orderBy("version", "desc")
        .limit(1);
      if (summaryRows && summaryRows[0]?.totals) {
        const totals = summaryRows[0].totals;
        chargeAmount = Number(totals.pending_difference || totals.current_order_total || 0);
      }
    } catch {}
  }

  if (chargeAmount < 1) {
    return res.status(400).json({ message: "Amount must be at least 1." });
  }

  const paystackAmount = Math.round(chargeAmount * 100);
  const currency = (order.currency_code || "KES").toUpperCase();
  const reference = `ORD-${order.display_id || order.id.slice(-6)}-${Date.now()}`;

  let customerEmail = order.email;
  if (!customerEmail) {
    customerEmail = `guest-${order.id}@urbandevicecare.co.uk`;
  }

  try {
    const paystackRes = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: customerEmail,
        amount: paystackAmount,
        currency,
        reference,
        metadata: {
          order_id: order.id,
          charge_amount: chargeAmount,
        },
      }),
    });

    const paystackData = await paystackRes.json();

    if (!paystackRes.ok || !paystackData.status) {
      return res.status(400).json({
        message: paystackData.message || "Failed to initialize Paystack transaction",
        data: paystackData,
      });
    }

    res.status(200).json({
      success: true,
      authorization_url: paystackData.data.authorization_url,
      access_code: paystackData.data.access_code,
      reference: paystackData.data.reference,
      paymentSession: {
        access_code: paystackData.data.access_code,
        paystackTxAccessCode: paystackData.data.access_code,
      },
      data: paystackData.data,
    });
  } catch (error: any) {
    console.error("[Paystack Custom Payment Init Error]:", error);
    res.status(500).json({
      message: error?.message || "Failed to initialize custom payment",
    });
  }
}

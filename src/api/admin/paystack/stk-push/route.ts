import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import PaystackClient from "../../../../providers/paystack/services/paystack-client";
import { getPaystackAmount } from "../../../../providers/paystack/utils/currency";


export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const { order_id, phone, amount } = req.body as { order_id: string; phone: string; amount?: number };

  if (!order_id || !phone) {
    return res.status(400).json({ message: "order_id and phone are required" });
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  
  console.log("[stk-push] Looking up order_id:", order_id);
  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "total", "currency_code", "email", "payment_collections.*", "payment_collections.payment_sessions.*"],
    filters: { id: order_id }
  }).catch(err => {
    console.error("[stk-push] query.graph error:", err);
    return { data: [] };
  });

  console.log("[stk-push] Query result orders count:", orders.length);

  const order = orders[0];
  if (!order) {
    console.log("[stk-push] Order not found in query results!");
    return res.status(404).json({ message: "Order not found" });
  }

  const paymentCollection = (order as any).payment_collections?.[0];
  if (!paymentCollection) {
    return res.status(400).json({ message: "No payment collection found for order" });
  }

  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    return res.status(500).json({ message: "PAYSTACK_SECRET_KEY must be set in environment for STK push" });
  }

  // Idempotency / Double-Tap Protection
  const activeSessions = paymentCollection.payment_sessions || [];
  const recentStkSession = activeSessions.find((session: any) => {
    if (session.status !== "pending" || !session.data?.stk_push) return false;
    const createdAt = new Date(session.created_at).getTime();
    const now = Date.now();
    // Block if there is a pending STK push session created in the last 60 seconds
    return (now - createdAt) < 60000;
  });

  if (recentStkSession) {
    return res.status(429).json({ 
      message: "An STK push request is already processing. Please check your phone or wait a minute before trying again." 
    });
  }

  const chargeAmount = amount ? Number(amount) : Number(order.total);

  const authorizedAmount = Number(paymentCollection.authorized_amount) || 0;
  const capturedAmount = Number(paymentCollection.captured_amount) || 0;
  const totalAmount = Number(paymentCollection.amount) || Number(order.total);
  const unpaidBalance = totalAmount - Math.max(authorizedAmount, capturedAmount);

  if (chargeAmount > unpaidBalance) {
    return res.status(400).json({ 
      message: `Overpayment not allowed. The remaining unpaid balance is ${unpaidBalance}` 
    });
  }

  if (chargeAmount < 1) {
    return res.status(400).json({ 
      message: "Amount to pay must be at least 1." 
    });
  }

  const paystackAmount = getPaystackAmount(chargeAmount, order.currency_code);

  let provider = "mpesa";
  if (order.currency_code.toLowerCase() === "ghs") provider = "mtn";
  if (order.currency_code.toLowerCase() === "xof") provider = "mtn";
  if (order.currency_code.toLowerCase() === "rwf") provider = "mtn";

  const client = new PaystackClient(secretKey);

  try {
    const reference = `stk_${Date.now()}_${order.id.slice(-8)}`;

    const paymentModule = req.scope.resolve("payment");
    await paymentModule.createPaymentSession(paymentCollection.id, {
      provider_id: "pp_paystack_paystack",
      currency_code: order.currency_code,
      amount: chargeAmount,
      data: {
        email: order.email as string,
        paystackTxRef: reference,
        session_id: paymentCollection.id,
        stk_push: true,
        phone,
        amount: chargeAmount,
      }
    });

    const chargeResponse = await client.charge.create({
      email: order.email as string,
      amount: paystackAmount,
      mobile_money: {
        phone,
        provider
      }
    });

    if (!chargeResponse.status) {
      return res.status(400).json({ message: chargeResponse.message || "Paystack rejected STK push" });
    }

    res.status(200).json({ 
      success: true, 
      message: "STK push initiated successfully",
      data: chargeResponse.data 
    });
  } catch (error: any) {
    console.error("Storefront STK Push Error:", error.response?.data || error);
    res.status(500).json({ 
      message: error.response?.data?.message || error.message || "Failed to initiate STK Push" 
    });
  }
}

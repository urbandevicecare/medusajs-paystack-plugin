import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import PaystackClient from "../../../../providers/paystack/services/paystack-client";
import { getPaystackAmount, formatMobileMoneyPhone } from "../../../../providers/paystack/utils/currency";

export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const { order_id, phone, amount } = req.body as { order_id: string; phone: string; amount?: number };

  if (!order_id || !phone) {
    return res.status(400).json({ message: "order_id and phone are required" });
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const paymentModule = req.scope.resolve(Modules.PAYMENT);
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.REMOTE_LINK);
  
  console.log("[stk-push] Looking up order_id:", order_id);
  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "display_id",
      "total",
      "currency_code",
      "email",
      "customer_id",
      "shipping_address.phone",
      "billing_address.phone",
      "payment_collections.*",
      "payment_collections.payment_sessions.*"
    ],
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

  const secretKey = process.env.PAYSTACK_SECRET_KEY || process.env.PAYSTACK_TEST_SECRET_KEY;
  if (!secretKey) {
    return res.status(500).json({ message: "PAYSTACK_SECRET_KEY or PAYSTACK_TEST_SECRET_KEY must be set in environment for STK push" });
  }

  // Format phone number according to Paystack mobile money standards
  const formattedPhone = formatMobileMoneyPhone(phone, order.currency_code);

  // 1. Resolve or Create Payment Collection
  let paymentCollection = (order as any).payment_collections?.[0];
  if (!paymentCollection) {
    console.log("[stk-push] No payment collection found on order. Creating a new one...");
    try {
      paymentCollection = await paymentModule.createPaymentCollections({
        currency_code: order.currency_code,
        amount: Number(order.total),
      });

      // Link new payment collection to order
      await remoteLink.create({
        [Modules.ORDER]: { order_id: order.id },
        [Modules.PAYMENT]: { payment_collection_id: paymentCollection.id },
      });
      console.log("[stk-push] Created and linked payment collection:", paymentCollection.id);
    } catch (createErr: any) {
      console.error("[stk-push] Failed to create payment collection for order:", createErr);
      return res.status(500).json({ 
        message: `Failed to initialize payment collection for order: ${createErr.message}` 
      });
    }
  }

  // Idempotency / Double-Tap Protection
  const activeSessions = paymentCollection.payment_sessions || [];
  const recentStkSession = activeSessions.find((session: any) => {
    const isPending = session.status === "pending" || session.status === "pending_authorization";
    if (!isPending || !session.data?.stk_push) return false;
    const createdAt = new Date(session.created_at).getTime();
    const now = Date.now();
    // Block if there is a pending STK push session created in the last 45 seconds
    return (now - createdAt) < 45000;
  });

  if (recentStkSession) {
    return res.status(429).json({ 
      message: "An STK push request is already processing. Please check your phone or wait 45 seconds before trying again." 
    });
  }

  const chargeAmount = amount ? Number(amount) : Number(order.total);

  const authorizedAmount = Number(paymentCollection.authorized_amount) || 0;
  const capturedAmount = Number(paymentCollection.captured_amount) || 0;
  const totalAmount = Number(paymentCollection.amount) || Number(order.total);
  const unpaidBalance = Math.max(0, totalAmount - Math.max(authorizedAmount, capturedAmount));

  if (unpaidBalance > 0 && chargeAmount > unpaidBalance) {
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
  const curr = order.currency_code.toLowerCase();
  if (curr === "ghs" || curr === "xof" || curr === "rwf") {
    provider = "mtn";
  }

  // Resolve Provider ID (defaults to pp_paystack_paystack)
  let providerId = "pp_paystack_paystack";
  try {
    const { data: providers } = await query.graph({
      entity: "payment_provider",
      fields: ["id"],
      filters: { id: { $like: "%paystack%" } }
    }).catch(() => ({ data: [] }));

    if (providers && providers.length > 0) {
      providerId = providers[0].id;
    }
  } catch {
    // Fall back to default
  }

  // Ensure valid email for Paystack charge
  const customerEmail = (order.email as string) || 
    `${formattedPhone.replace(/\+/g, '')}@urbandevicecare.co.uk`;

  const client = new PaystackClient(secretKey);

  try {
    const reference = `stk_${Date.now()}_${order.id.slice(-8)}`;

    // Create session in Medusa Payment Collection
    const session = await paymentModule.createPaymentSession(paymentCollection.id, {
      provider_id: providerId,
      currency_code: order.currency_code,
      amount: chargeAmount,
      data: {
        email: customerEmail,
        paystackTxRef: reference,
        stk_push: true,
        phone: formattedPhone,
        amount: chargeAmount,
      }
    });

    // Initiate STK Push via Paystack Charge API with exact currency, reference, and session metadata
    const chargeResponse = await client.charge.create({
      email: customerEmail,
      amount: paystackAmount,
      currency: order.currency_code.toUpperCase(),
      reference: reference,
      metadata: {
        session_id: session.id,
        order_id: order.id,
        phone: formattedPhone,
        charge_amount: chargeAmount,
      },
      mobile_money: {
        phone: formattedPhone,
        provider
      }
    });

    if (!chargeResponse.status) {
      return res.status(400).json({ 
        message: chargeResponse.message || "Paystack rejected STK push" 
      });
    }

    res.status(200).json({ 
      success: true, 
      message: chargeResponse.data?.display_text || "STK push initiated successfully. Please complete the prompt on your phone.",
      reference,
      data: chargeResponse.data 
    });
  } catch (error: any) {
    console.error("Storefront STK Push Error:", error.response?.data || error);
    res.status(500).json({ 
      message: error.response?.data?.message || error.message || "Failed to initiate STK Push" 
    });
  }
}

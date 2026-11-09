import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { resolvePaystackSecretKey, getMedusaAmount } from "../../../../providers/paystack/utils/currency";
import { reconcileAndCapturePaystackPayment } from "../../../../providers/paystack/utils/reconcile-payment";

export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const { reference } = req.body as { reference: string };

  if (!reference) {
    return res.status(400).json({ message: "Reference is required" });
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  let dynamicSecret = "";

  try {
    const { data: stores } = await query.graph({
      entity: "store",
      fields: ["metadata"]
    }).catch(() => ({ data: [] }));
    dynamicSecret = stores?.[0]?.metadata?.paystack_secret_key as string || "";
  } catch {}

  if (!dynamicSecret) {
    try {
      const storeService = req.scope.resolve(Modules.STORE);
      if (storeService && typeof storeService.listStores === "function") {
        const stores = await storeService.listStores({}, { take: 1 });
        dynamicSecret = stores?.[0]?.metadata?.paystack_secret_key as string || "";
      }
    } catch {}
  }

  const secretKey = resolvePaystackSecretKey(dynamicSecret);
  if (!secretKey) {
    return res.status(500).json({ message: "Paystack secret key is not configured" });
  }

  try {
    const paystackRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
    });

    const paystackData = await paystackRes.json();

    if (!paystackRes.ok || !paystackData.status) {
      return res.status(400).json({
        message: paystackData.message || "Failed to verify transaction with Paystack",
        data: paystackData,
      });
    }

    const txData = paystackData.data;
    const isSuccess = txData.status === "success";

    let reconcileResult: any = null;
    const orderId = txData.metadata?.order_id;
    const medusaAmount = getMedusaAmount(Number(txData.amount || 0), txData.currency);

    if (isSuccess && orderId) {
      try {
        reconcileResult = await reconcileAndCapturePaystackPayment({
          container: req.scope,
          orderId,
          reference: txData.reference,
          amount: medusaAmount,
          currency: txData.currency,
        });
      } catch (err: any) {
        console.warn("[Paystack Verify] Error during auto-reconciliation:", err);
      }
    }

    res.status(200).json({
      success: isSuccess,
      status: txData.status,
      message: isSuccess ? "Payment verified successfully" : `Payment status: ${txData.status}`,
      reference: txData.reference,
      amount: medusaAmount,
      currency: txData.currency,
      captured: Boolean(reconcileResult?.captured),
      data: txData,
    });
  } catch (error: any) {
    console.error("[Paystack Verify Error]:", error);
    res.status(500).json({
      message: error?.message || "Failed to verify payment",
    });
  }
}

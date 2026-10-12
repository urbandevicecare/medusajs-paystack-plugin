import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { resolvePaystackSecretKey } from "../../../../providers/paystack/utils/currency";

export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const { reference } = req.body as { reference: string };

  if (!reference) {
    return res.status(400).json({ message: "Reference is required" });
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data: stores } = await query.graph({
    entity: "store",
    fields: ["metadata"]
  }).catch(() => ({ data: [] }));
  const dynamicSecret = stores?.[0]?.metadata?.paystack_secret_key as string | undefined;

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

    res.status(200).json({
      success: isSuccess,
      status: txData.status,
      message: isSuccess ? "Payment verified successfully" : `Payment status: ${txData.status}`,
      reference: txData.reference,
      amount: txData.amount / 100,
      currency: txData.currency,
      data: txData,
    });
  } catch (error: any) {
    console.error("[Paystack Verify Error]:", error);
    res.status(500).json({
      message: error?.message || "Failed to verify payment",
    });
  }
}

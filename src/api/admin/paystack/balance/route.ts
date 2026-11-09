import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import PaystackClient from "../../../../providers/paystack/services/paystack-client";
import { resolvePaystackSecretKey, normalizePaystackBalances } from "../../../../providers/paystack/utils/currency";

export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

    let dynamicSecret = "";
    let storeCurrency = "KES";

    try {
      const { data: stores } = await query.graph({
        entity: "store",
        fields: ["metadata", "default_currency_code", "supported_currencies.*"]
      }).catch(() => ({ data: [] }));

      if (stores?.[0]) {
        const storeObj = stores[0] as any;
        if (storeObj.metadata?.paystack_secret_key) {
          dynamicSecret = storeObj.metadata.paystack_secret_key as string;
        }
        const defaultCurr =
          storeObj.supported_currencies?.find((c: any) => c.is_default)?.currency_code ||
          storeObj.supported_currencies?.[0]?.currency_code ||
          storeObj.default_currency_code;
        if (defaultCurr) {
          storeCurrency = defaultCurr.toUpperCase();
        }
      }
    } catch {}

    if (!dynamicSecret) {
      try {
        const storeService = req.scope.resolve(Modules.STORE);
        if (storeService && typeof storeService.listStores === "function") {
          const stores = await storeService.listStores({}, { take: 1 });
          if (stores?.[0]) {
            const storeObj = stores[0] as any;
            if (storeObj.metadata?.paystack_secret_key) {
              dynamicSecret = storeObj.metadata.paystack_secret_key as string;
            }
            const defaultCurr =
              storeObj.supported_currencies?.find((c: any) => c.is_default)?.currency_code ||
              storeObj.supported_currencies?.[0]?.currency_code ||
              storeObj.default_currency_code;
            if (defaultCurr) {
              storeCurrency = defaultCurr.toUpperCase();
            }
          }
        }
      } catch {}
    }

    const secretKey = resolvePaystackSecretKey(dynamicSecret);

    if (!secretKey) {
      return res.status(200).json({
        success: false,
        message: "Paystack secret key is not configured. Please set PAYSTACK_SECRET_KEY in environment or Settings.",
        data: {
          balance: null,
          balanceError: "Secret key not configured",
          configured: false,
        },
      });
    }

    const client = new PaystackClient(secretKey);
    const balanceRes = await client.balance.get();

    if (!balanceRes || !balanceRes.status) {
      const errorMsg = balanceRes?.message || "Failed to retrieve balance from Paystack";
      return res.status(400).json({
        success: false,
        message: errorMsg,
        data: {
          balance: null,
          balanceError: errorMsg,
          configured: true,
        },
      });
    }

    const normalizedBalances = normalizePaystackBalances(balanceRes.data, storeCurrency);

    return res.status(200).json({
      success: true,
      message: "Paystack balances retrieved successfully",
      data: {
        balance: normalizedBalances,
        balanceError: null,
        configured: true,
      },
    });
  } catch (error: any) {
    const errorMsg = error?.response?.data?.message || error.message || "Failed to fetch Paystack balance";
    console.error("[Paystack Balance Route Error]:", error);
    return res.status(500).json({
      success: false,
      message: errorMsg,
      data: {
        balance: null,
        balanceError: errorMsg,
        configured: true,
      },
    });
  }
}

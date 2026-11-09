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

    // Fetch all Medusa payments that were handled by paystack
    const { data: payments } = await query.graph({
      entity: "payment",
      fields: [
        "id", 
        "amount", 
        "currency_code", 
        "created_at", 
        "payment_collection.order.id",
        "payment_collection.order.display_id"
      ],
      filters: { 
        provider_id: { $like: "%paystack%" }
      }
    });

    // We'll aggregate data for the dashboard
    let totalRevenue = 0;
    
    const now = new Date();
    
    // Maps for aggregation
    const dailyDataMap = new Map<string, number>(); // YYYY-MM-DD
    const weeklyDataMap = new Map<string, number>(); // YYYY-Www
    const monthlyDataMap = new Map<string, number>(); // YYYY-MM

    // Pre-fill the maps with 0 for the past periods
    // Daily (last 30 days)
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      dailyDataMap.set(key, 0);
    }

    // Weekly (last 12 weeks)
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - (i * 7));
      // Get week number
      const firstDayOfYear = new Date(d.getFullYear(), 0, 1);
      const pastDaysOfYear = (d.getTime() - firstDayOfYear.getTime()) / 86400000;
      const weekNum = Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
      const key = `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
      if (!weeklyDataMap.has(key)) {
        weeklyDataMap.set(key, 0);
      }
    }

    // Monthly (last 12 months)
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now);
      d.setMonth(d.getMonth() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthlyDataMap.set(key, 0);
    }

    // Yearly (last 5 years)
    const yearlyDataMap = new Map<string, number>();
    for (let i = 4; i >= 0; i--) {
      const yearStr = String(now.getFullYear() - i);
      yearlyDataMap.set(yearStr, 0);
    }

    payments.forEach((payment: any) => {
      const amount = Number(payment.amount); // Medusa v2 payment amount is already in standard currency units
      totalRevenue += amount;

      const date = new Date(payment.created_at);
      
      // Daily key
      const dKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      if (dailyDataMap.has(dKey)) {
        dailyDataMap.set(dKey, dailyDataMap.get(dKey)! + amount);
      }

      // Weekly key
      const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
      const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
      const weekNum = Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
      const wKey = `${date.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
      if (weeklyDataMap.has(wKey)) {
        weeklyDataMap.set(wKey, weeklyDataMap.get(wKey)! + amount);
      }

      // Monthly key
      const mKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (monthlyDataMap.has(mKey)) {
        monthlyDataMap.set(mKey, monthlyDataMap.get(mKey)! + amount);
      }

      // Yearly key
      const yKey = String(date.getFullYear());
      if (yearlyDataMap.has(yKey)) {
        yearlyDataMap.set(yKey, yearlyDataMap.get(yKey)! + amount);
      }
    });

    const dailyGraph = Array.from(dailyDataMap.entries()).map(([name, total]) => ({ name, total }));
    const weeklyGraph = Array.from(weeklyDataMap.entries()).map(([name, total]) => ({ name, total }));
    const monthlyGraph = Array.from(monthlyDataMap.entries()).map(([name, total]) => ({ name, total }));
    const yearlyGraph = Array.from(yearlyDataMap.entries()).map(([name, total]) => ({ name, total }));

    // Attempt to fetch live Paystack account balance if secret key is present
    let balance: any = null;
    let balanceError: string | null = null;
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
    if (secretKey) {
      try {
        const client = new PaystackClient(secretKey);
        const balanceRes = await client.balance.get();
        if (balanceRes && balanceRes.status && balanceRes.data) {
          balance = normalizePaystackBalances(balanceRes.data, storeCurrency);
        } else if (balanceRes && !balanceRes.status) {
          balanceError = balanceRes.message || "Failed to retrieve balance from Paystack";
        }
      } catch (err: any) {
        console.error("Failed to fetch Paystack balance", err);
        balanceError = err?.response?.data?.message || err.message || "Could not connect to Paystack";
      }
    } else {
      balanceError = "Paystack secret key is not configured";
    }

    res.status(200).json({
      success: true,
      data: {
        payments,
        totalRevenue,
        dailyGraph,
        weeklyGraph,
        monthlyGraph,
        yearlyGraph,
        balance,
        balanceError,
      }
    });
  } catch (error: any) {
    console.error("Dashboard API Error:", error);
    res.status(500).json({ message: error.message || "Failed to load dashboard data" });
  }
}

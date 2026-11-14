import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import PaystackClient from "../../../../providers/paystack/services/paystack-client";
import {
  resolvePaystackSecretKey,
  normalizePaystackBalances,
  getMedusaAmount,
} from "../../../../providers/paystack/utils/currency";
import { reconcileAndCapturePaystackPayment } from "../../../../providers/paystack/utils/reconcile-payment";

export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

    // Resolve store metadata and currency
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

    // 1. Fetch internal Medusa payments handled by paystack
    const { data: payments } = await query.graph({
      entity: "payment",
      fields: [
        "id", 
        "amount", 
        "currency_code", 
        "created_at", 
        "data",
        "payment_collection.order.id",
        "payment_collection.order.display_id",
        "payment_collection.order.email",
      ],
      filters: { 
        provider_id: { $like: "%paystack%" }
      }
    }).catch(() => ({ data: [] }));

    // 2. Fetch Medusa orders to cross-reference with Paystack transactions
    const { data: orders } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "email",
        "total",
        "currency_code",
        "created_at",
        "metadata",
        "payment_collections.id",
        "payment_collections.status",
        "payment_collections.payment_sessions.id",
        "payment_collections.payment_sessions.status",
        "payment_collections.payment_sessions.data",
        "payment_collections.payment_sessions.provider_id",
        "payment_collections.payments.id",
        "payment_collections.payments.amount",
        "payment_collections.payments.currency_code",
        "payment_collections.payments.provider_id",
      ],
    }).catch(() => ({ data: [] }));

    // Build lookup maps for fast matching
    const orderById = new Map<string, any>();
    const orderByDisplayId = new Map<string, any>();
    const orderByRef = new Map<string, any>();

    (orders || []).forEach((order: any) => {
      if (order.id) orderById.set(order.id, order);
      if (order.display_id != null) orderByDisplayId.set(String(order.display_id), order);

      const metaRef = (order.metadata as any)?.paystack_reference;
      if (metaRef) orderByRef.set(String(metaRef), order);

      (order.payment_collections || []).forEach((col: any) => {
        (col.payment_sessions || []).forEach((s: any) => {
          const sRef = s.data?.paystackTxRef || s.data?.reference;
          if (sRef) orderByRef.set(String(sRef), order);
          if (s.id) orderByRef.set(String(s.id), order);
        });
        (col.payments || []).forEach((p: any) => {
          if (p.id) orderByRef.set(String(p.id), order);
        });
      });
    });

    // 3. Query Paystack balance and live transactions
    let balance: any = null;
    let balanceError: string | null = null;
    let rawPaystackTransactions: any[] = [];
    let transactionsError: string | null = null;

    if (secretKey) {
      const client = new PaystackClient(secretKey);

      // Fetch live Paystack balance
      try {
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

      // Fetch live transactions directly from Paystack API
      try {
        const txRes = await client.transaction.list({ perPage: 50 });
        if (txRes && txRes.status && Array.isArray(txRes.data)) {
          rawPaystackTransactions = txRes.data;
        } else if (txRes && !txRes.status) {
          transactionsError = txRes.message || "Failed to retrieve transactions from Paystack";
        }
      } catch (err: any) {
        console.error("Failed to fetch Paystack transactions", err);
        transactionsError = err?.response?.data?.message || err.message || "Could not fetch Paystack transactions";
      }
    } else {
      balanceError = "Paystack secret key is not configured";
      transactionsError = "Paystack secret key is not configured";
    }

    // 4. Normalize and combine transactions from Paystack and Medusa
    const normalizedTransactions: any[] = [];
    const seenReferences = new Set<string>();
    const seenPaymentIds = new Set<string>();

    for (const tx of rawPaystackTransactions) {
      const txRef = String(tx.reference || tx.id || "");
      if (txRef) seenReferences.add(txRef);
      if (tx.id) seenReferences.add(String(tx.id));

      let meta: any = tx.metadata;
      if (typeof meta === "string") {
        try { meta = JSON.parse(meta); } catch { meta = {}; }
      }
      meta = meta || {};

      // Match with Medusa order
      let matchedOrder =
        (meta.order_id && orderById.get(meta.order_id)) ||
        (meta.orderId && orderById.get(meta.orderId)) ||
        (meta.order?.id && orderById.get(meta.order?.id)) ||
        (meta.display_id && orderByDisplayId.get(String(meta.display_id))) ||
        (txRef && orderByRef.get(txRef));

      // Attempt matching by reference parts if still not found
      if (!matchedOrder && txRef) {
        const parts = txRef.split("-");
        for (const part of parts) {
          if (part && orderByDisplayId.has(part)) {
            matchedOrder = orderByDisplayId.get(part);
            break;
          }
          if (part && orderById.has(part)) {
            matchedOrder = orderById.get(part);
            break;
          }
        }
      }

      const txCurrency = (tx.currency || storeCurrency).toUpperCase();
      const standardAmount = getMedusaAmount(Number(tx.amount || 0), txCurrency);

      // Auto-reconcile unpaid order if Paystack payment succeeded
      if (matchedOrder && tx.status === "success") {
        const payCol = matchedOrder.payment_collections?.[0];
        const isNotFullyPaid = !payCol || (payCol.status !== "authorized" && payCol.status !== "captured");
        if (isNotFullyPaid) {
          try {
            await reconcileAndCapturePaystackPayment({
              container: req.scope,
              orderId: matchedOrder.id,
              reference: tx.reference,
              amount: standardAmount,
              currency: txCurrency,
            });
          } catch (reconErr: any) {
            console.debug?.("Dashboard auto-reconcile note:", reconErr?.message);
          }
        }
      }

      const txDate = tx.paid_at || tx.created_at || new Date().toISOString();

      normalizedTransactions.push({
        id: String(tx.id || tx.reference),
        reference: tx.reference || String(tx.id),
        amount: standardAmount,
        currency_code: txCurrency,
        status: tx.status || "success",
        gateway_response: tx.gateway_response || tx.message || "",
        channel: tx.channel || "card",
        paid_at: tx.paid_at || null,
        created_at: txDate,
        customer: {
          email: tx.customer?.email || matchedOrder?.email || "",
          name: [tx.customer?.first_name, tx.customer?.last_name].filter(Boolean).join(" ") || "",
          phone: tx.customer?.phone || "",
        },
        order: matchedOrder ? {
          id: matchedOrder.id,
          display_id: matchedOrder.display_id,
        } : null,
        payment_collection: matchedOrder ? {
          order: {
            id: matchedOrder.id,
            display_id: matchedOrder.display_id,
          }
        } : null,
        source: "paystack",
      });
    }

    // Merge any Medusa payment records that are not in Paystack transactions
    (payments || []).forEach((payment: any) => {
      const pRef = payment.data?.paystackTxRef || payment.data?.reference || payment.id;
      if (pRef && seenReferences.has(String(pRef))) return;
      if (payment.id && seenPaymentIds.has(payment.id)) return;
      seenPaymentIds.add(payment.id);

      const pCurrency = (payment.currency_code || storeCurrency).toUpperCase();
      const pAmount = Number(payment.amount || 0);

      normalizedTransactions.push({
        id: payment.id,
        reference: pRef || payment.id,
        amount: pAmount,
        currency_code: pCurrency,
        status: "success",
        gateway_response: "Successful",
        channel: "medusa",
        paid_at: payment.created_at,
        created_at: payment.created_at,
        customer: {
          email: payment.payment_collection?.order?.email || "",
          name: "",
          phone: "",
        },
        order: payment.payment_collection?.order ? {
          id: payment.payment_collection.order.id,
          display_id: payment.payment_collection.order.display_id,
        } : null,
        payment_collection: payment.payment_collection,
        source: "medusa",
      });
    });

    // Sort all transactions by date descending (newest first)
    normalizedTransactions.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    // 5. Aggregate revenue and graph metrics
    let totalRevenue = 0;
    const now = new Date();

    const dailyDataMap = new Map<string, number>();
    const weeklyDataMap = new Map<string, number>();
    const monthlyDataMap = new Map<string, number>();
    const yearlyDataMap = new Map<string, number>();

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
    for (let i = 4; i >= 0; i--) {
      const yearStr = String(now.getFullYear() - i);
      yearlyDataMap.set(yearStr, 0);
    }

    normalizedTransactions.forEach((tx: any) => {
      // Only successful transactions count towards revenue
      if (tx.status !== "success") return;

      const amount = Number(tx.amount || 0);
      totalRevenue += amount;

      const date = new Date(tx.created_at);

      // Daily
      const dKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      if (dailyDataMap.has(dKey)) {
        dailyDataMap.set(dKey, dailyDataMap.get(dKey)! + amount);
      }

      // Weekly
      const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
      const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
      const weekNum = Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
      const wKey = `${date.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
      if (weeklyDataMap.has(wKey)) {
        weeklyDataMap.set(wKey, weeklyDataMap.get(wKey)! + amount);
      }

      // Monthly
      const mKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (monthlyDataMap.has(mKey)) {
        monthlyDataMap.set(mKey, monthlyDataMap.get(mKey)! + amount);
      }

      // Yearly
      const yKey = String(date.getFullYear());
      if (yearlyDataMap.has(yKey)) {
        yearlyDataMap.set(yKey, yearlyDataMap.get(yKey)! + amount);
      }
    });

    const dailyGraph = Array.from(dailyDataMap.entries()).map(([name, total]) => ({ name, total }));
    const weeklyGraph = Array.from(weeklyDataMap.entries()).map(([name, total]) => ({ name, total }));
    const monthlyGraph = Array.from(monthlyDataMap.entries()).map(([name, total]) => ({ name, total }));
    const yearlyGraph = Array.from(yearlyDataMap.entries()).map(([name, total]) => ({ name, total }));

    res.status(200).json({
      success: true,
      data: {
        transactions: normalizedTransactions,
        payments: normalizedTransactions, // Backwards-compatible
        totalRevenue,
        dailyGraph,
        weeklyGraph,
        monthlyGraph,
        yearlyGraph,
        balance,
        balanceError,
        transactionsError,
      }
    });
  } catch (error: any) {
    console.error("Dashboard API Error:", error);
    res.status(500).json({ message: error.message || "Failed to load dashboard data" });
  }
}

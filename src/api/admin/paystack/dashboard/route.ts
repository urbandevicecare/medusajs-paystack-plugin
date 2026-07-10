import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import PaystackClient from "../../../../providers/paystack/services/paystack-client";

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
        provider_id: "paystack"
      }
    });

    // We'll aggregate data for the dashboard
    let totalRevenue = 0;
    const currentYear = new Date().getFullYear();
    
    // Group by month for the current year
    const monthlyDataMap = new Map<number, number>();
    for (let i = 0; i < 12; i++) monthlyDataMap.set(i, 0);

    // Group by year
    const yearlyDataMap = new Map<number, number>();

    payments.forEach((payment: any) => {
      const amount = Number(payment.amount);
      totalRevenue += amount;

      const date = new Date(payment.created_at);
      const year = date.getFullYear();
      const month = date.getMonth();

      // Yearly aggregation
      yearlyDataMap.set(year, (yearlyDataMap.get(year) || 0) + amount);

      // Monthly aggregation (only for current year)
      if (year === currentYear) {
        monthlyDataMap.set(month, (monthlyDataMap.get(month) || 0) + amount);
      }
    });

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthlyGraph = Array.from(monthlyDataMap.entries()).map(([monthIndex, total]) => ({
      name: monthNames[monthIndex],
      total
    }));

    const yearlyGraph = Array.from(yearlyDataMap.entries()).map(([year, total]) => ({
      name: year.toString(),
      total
    }));

    // Attempt to fetch live Paystack account balance if secret key is present
    let balance = null;
    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (secretKey) {
      try {
        const client = new PaystackClient(secretKey);
        const balanceRes = await client.balance.get();
        if (balanceRes.status && balanceRes.data && balanceRes.data.length > 0) {
          balance = balanceRes.data; // array of balances per currency
        }
      } catch (err) {
        console.error("Failed to fetch Paystack balance", err);
      }
    }

    res.status(200).json({
      success: true,
      data: {
        payments,
        totalRevenue,
        monthlyGraph,
        yearlyGraph,
        balance
      }
    });
  } catch (error: any) {
    console.error("Dashboard API Error:", error);
    res.status(500).json({ message: error.message || "Failed to load dashboard data" });
  }
}

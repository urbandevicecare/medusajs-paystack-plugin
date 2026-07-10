export const ZERO_DECIMAL_CURRENCIES = [
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
];

export function getPaystackAmount(amount: number, currency: string): number {
  if (ZERO_DECIMAL_CURRENCIES.includes(currency.toUpperCase())) {
    return amount; // Send as is
  }
  // Convert standard currencies to their lowest subunit (e.g. KES 100 -> 10000 cents)
  // Medusa v2 stores prices as true amounts (e.g. 100.50), not in cents!
  // Wait, in Medusa v2, prices are stored as DB amounts (e.g. 100.50). 
  // Paystack expects subunits (10050). So we multiply by 100 for non-zero decimal currencies.
  return Math.round(amount * 100);
}

export function getMedusaAmount(paystackAmount: number, currency: string): number {
  if (ZERO_DECIMAL_CURRENCIES.includes(currency.toUpperCase())) {
    return paystackAmount;
  }
  // Convert from subunit back to true amount
  return paystackAmount / 100;
}

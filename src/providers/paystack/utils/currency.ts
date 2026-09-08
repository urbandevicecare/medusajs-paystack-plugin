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
  "XPF",
];

export function getPaystackAmount(amount: number, currency: string): number {
  if (ZERO_DECIMAL_CURRENCIES.includes(currency.toUpperCase())) {
    return Math.round(amount);
  }
  // Convert standard currencies to their lowest subunit (e.g. KES 100 -> 10000 cents)
  // In Medusa v2, prices and totals are stored and represented in standard currency units (e.g. 100.50).
  // Paystack expects smallest subunit (e.g. kobo, pesewas, cents, and XOF*100).
  return Math.round(amount * 100);
}

export function getMedusaAmount(paystackAmount: number, currency: string): number {
  if (ZERO_DECIMAL_CURRENCIES.includes(currency.toUpperCase())) {
    return paystackAmount;
  }
  // Convert from subunit back to standard Medusa amount
  return paystackAmount / 100;
}

/**
 * Normalizes phone numbers for Mobile Money STK Push providers.
 * For Kenya M-Pesa (KES), Paystack recommends numbers in international format e.g. +254710000000.
 */
export function formatMobileMoneyPhone(phone: string, currency: string): string {
  if (!phone) return "";
  const cleaned = phone.replace(/[\s\-\(\)]/g, "");
  const curr = (currency || "").toUpperCase();

  if (curr === "KES") {
    if (cleaned.startsWith("+254")) return cleaned;
    if (cleaned.startsWith("254")) return `+${cleaned}`;
    if (cleaned.startsWith("0")) return `+254${cleaned.slice(1)}`;
    return `+254${cleaned}`;
  }

  if (curr === "GHS") {
    if (cleaned.startsWith("+233")) return cleaned;
    if (cleaned.startsWith("233")) return `+${cleaned}`;
    return cleaned;
  }

  return cleaned;
}

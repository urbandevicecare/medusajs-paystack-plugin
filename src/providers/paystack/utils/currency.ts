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

export function getPaystackAmount(amount: number, currency: string = "NGN"): number {
  const curr = (currency || "NGN").toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.includes(curr)) {
    return Math.round(amount);
  }
  // Convert standard currencies to their lowest subunit (e.g. KES 100 -> 10000 cents)
  // In Medusa v2, prices and totals are stored and represented in standard currency units (e.g. 100.50).
  // Paystack expects smallest subunit (e.g. kobo, pesewas, cents, and XOF*100).
  return Math.round(amount * 100);
}

export function getMedusaAmount(paystackAmount: number, currency: string = "NGN"): number {
  const curr = (currency || "NGN").toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.includes(curr)) {
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

export function resolvePaystackSecretKey(dynamicSecret?: string): string {
  let key = "";
  if (
    dynamicSecret &&
    typeof dynamicSecret === "string" &&
    dynamicSecret.trim() !== "" &&
    dynamicSecret.trim() !== "undefined" &&
    dynamicSecret.trim() !== "null"
  ) {
    key = dynamicSecret.trim();
  } else {
    key = (
      process.env.PAYSTACK_SECRET_KEY ||
      process.env.PAYSTACK_TEST_SECRET_KEY ||
      process.env.PAYSTACK_LIVE_SECRET_KEY ||
      process.env.PAYSTACK_SECRET ||
      process.env.PAYSTACK_KEY ||
      process.env.PAYSTACK_SK ||
      process.env.PAYSTACK_SECRET_KEY_URBANDEVICECARE ||
      Object.entries(process.env).find(
        ([k, v]) =>
          (k.startsWith("PAYSTACK_SECRET_KEY") || k.startsWith("PAYSTACK_SECRET") || k === "PAYSTACK_SK") &&
          Boolean(v)
      )?.[1] ||
      ""
    );
  }
  const clean = key ? key.trim().replace(/^["']|["']$/g, "") : "";
  if (clean === "undefined" || clean === "null") return "";
  return clean;
}

export interface NormalizedPaystackBalance {
  currency: string;
  balance: number;
  amount: number;
  formatted: string;
}

/**
 * Normalizes Paystack balance responses (array or single object),
 * formats amounts according to currency decimal rules,
 * provides a default entry if balance list is empty,
 * and sorts balances so preferred store currency and positive funds appear first.
 */
export function normalizePaystackBalances(
  rawBalancesPayload: any,
  preferredCurrency: string = "KES"
): NormalizedPaystackBalance[] {
  let list = Array.isArray(rawBalancesPayload)
    ? rawBalancesPayload
    : rawBalancesPayload
    ? [rawBalancesPayload]
    : [];

  const targetCurr = (preferredCurrency || "KES").toUpperCase();

  // If Paystack returns an empty array (common for newly integrated or unused accounts),
  // supply a default 0 balance entry with the target currency so UI widgets never display blank.
  if (list.length === 0) {
    list = [
      {
        currency: targetCurr,
        balance: 0,
      },
    ];
  }

  const normalized: NormalizedPaystackBalance[] = list.map((b: any) => {
    const curr = (b.currency || targetCurr).toUpperCase();
    const rawVal = Number(b.balance || 0);
    const isZeroDec = ZERO_DECIMAL_CURRENCIES.includes(curr);
    const standardVal = isZeroDec ? rawVal : rawVal / 100;
    return {
      currency: curr,
      balance: rawVal,
      amount: standardVal,
      formatted: standardVal.toLocaleString("en-US", {
        minimumFractionDigits: isZeroDec ? 0 : 2,
        maximumFractionDigits: isZeroDec ? 0 : 2,
      }),
    };
  });

  // Sort balances:
  // 1. Preferred currency (store currency) first if it exists
  // 2. Currencies with positive balance before zero balances
  normalized.sort((a, b) => {
    if (a.currency === targetCurr && b.currency !== targetCurr) return -1;
    if (b.currency === targetCurr && a.currency !== targetCurr) return 1;
    if (a.amount > 0 && b.amount <= 0) return -1;
    if (b.amount > 0 && a.amount <= 0) return 1;
    return 0;
  });

  return normalized;
}

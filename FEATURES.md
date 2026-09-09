# Medusa v2 Paystack Plugin - Comprehensive Feature & Integration Guide

[![NPM Version](https://img.shields.io/npm/v/medusajs-paystack-plugin.svg)](https://www.npmjs.com/package/medusajs-paystack-plugin)
[![Medusa v2](https://img.shields.io/badge/Medusa-v2.x-violet.svg)](https://docs.medusajs.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

This guide provides an in-depth reference for all backend, admin, and storefront features offered by the `medusajs-paystack-plugin`, along with copy-pasteable integration code and the full project changelog.

---

## Table of Contents

1. [Architectural Overview](#1-architectural-overview)
2. [Backend & Medusa Core Features](#2-backend--medusa-core-features)
   - [Provider Registration & Resolution](#provider-registration--resolution)
   - [Environment Variables](#environment-variables)
   - [Supported Currencies & Subunit Math](#supported-currencies--subunit-math)
   - [Phone Normalization for Mobile Money](#phone-normalization-for-mobile-money)
   - [Webhooks & Timing-Safe Verification](#webhooks--timing-safe-verification)
   - [Automated 15-Minute Background Sync Job](#automated-15-minute-background-sync-job)
   - [Payment Link Subscriber for Unpaid Balances](#payment-link-subscriber-for-unpaid-balances)
3. [Admin Features & Extensions](#3-admin-features--extensions)
   - [Order Details STK Push Widget](#order-details-stk-push-widget)
   - [Paystack Analytics Dashboard](#paystack-analytics-dashboard)
   - [Admin STK Push API Endpoint](#admin-stk-push-api-endpoint)
4. [Frontend & Storefront Features & Integration](#4-frontend--storefront-features--integration)
   - [Method 1: Standard Checkout (Hosted Redirect & Popup Modal)](#method-1-standard-checkout-hosted-redirect--popup-modal)
   - [Method 2: Direct Mobile Money STK Push](#method-2-direct-mobile-money-stk-push)
   - [Method 3: Deferred / Offline / Partial Payment Landing Page](#method-3-deferred--offline--partial-payment-landing-page)
   - [Method 4: Payment Verification & Polling Patterns](#method-4-payment-verification--polling-patterns)
5. [Changelog & Version History](#5-changelog--version-history)

---

## 1. Architectural Overview

The plugin integrates seamlessly with Medusa v2's modular framework architecture:

```
┌──────────────────────────────────────────────────────────────┐
│                       Medusa v2 Backend                      │
├──────────────────────┬──────────────────────┬────────────────┤
│   Payment Provider   │  Admin Extensions    │  Store APIs    │
│  pp_paystack_paystack│  • Order Widget      │  • STK Push    │
│  • Initialize / Verify│  • Analytics Page   │  • Webhooks    │
│  • Auto capture / Sync│  • Admin STK Route  │  • Subscribers │
└──────────┬───────────┴──────────┬───────────┴────────┬───────┘
           │                      │                    │
           ▼                      ▼                    ▼
   ┌───────────────┐     ┌─────────────────┐   ┌────────────────┐
   │ Paystack API  │     │  Medusa Admin   │   │  Storefront    │
   │ (Transactions,│     │ (Staff Actions, │   │ (Next.js / UI, │
   │  Mobile Money)│     │  Revenue Charts)│   │  SMS / Email)  │
   └───────────────┘     └─────────────────┘   └────────────────┘
```

---

## 2. Backend & Medusa Core Features

### Provider Registration & Resolution

The plugin implements the Medusa v2 `AbstractPaymentProvider` interface. In Medusa v2, payment providers are resolved as `pp_<module_id>_<provider_id>`. By default, with module id `paystack`, the provider is registered as **`pp_paystack_paystack`**.

In `medusa-config.ts`:

```typescript
import { defineConfig } from "@medusajs/framework/utils"

export default defineConfig({
  modules: [
    {
      resolve: "@medusajs/payment",
      options: {
        providers: [
          {
            resolve: "medusajs-paystack-plugin",
            id: "paystack",
            options: {
              secret_key: process.env.PAYSTACK_SECRET_KEY,
              public_key: process.env.PAYSTACK_PUBLIC_KEY,
              debug: process.env.NODE_ENV === "development",
            },
          },
        ],
      },
    },
  ],
})
```

### Environment Variables

| Variable | Required | Description | Example |
| :--- | :---: | :--- | :--- |
| `PAYSTACK_SECRET_KEY` | **Yes** | Paystack Secret Key (Live or Test) | `sk_live_...` or `sk_test_...` |
| `PAYSTACK_PUBLIC_KEY` | **Yes** | Paystack Public Key | `pk_live_...` or `pk_test_...` |
| `STOREFRONT_URL` | Optional | Storefront base URL for SMS/Email payment links | `https://yourstore.com` |
| `MEDUSA_PUBLISHABLE_KEY` | Optional | Publishable key used to sign HMAC payment link hashes | `pk_01J...` |
| `STORE_NAME` | Optional | Store brand name displayed in payment notifications | `Urban Device Care` |
| `STORE_TAGLINE` | Optional | Tagline displayed in payment notifications | `Fast, Reliable Repairs` |

---

### Supported Currencies & Subunit Math

Paystack expects amounts in the smallest currency subunit (e.g., Kobo for NGN, Cents for USD/KES, Pesewas for GHS). The plugin automatically converts amounts to and from subunits:

- **100x Multiplier**: KES, NGN, GHS, USD, ZAR, EUR, GBP.
- **Zero-Decimal Currencies**: Automatically detected and preserved without multiplier.

```typescript
// Helper utility: src/providers/paystack/utils/currency.ts
getPaystackAmount(500, "KES") // -> 50000 (cents)
getMedusaAmount(50000, "KES")  // -> 500
```

---

### Phone Normalization for Mobile Money

The plugin normalizes local mobile numbers into international E.164 formats expected by Paystack:

- **Kenya (KES)**: `0712345678` or `0112345678` &rarr; `+254712345678`
- **Ghana (GHS)**: `0241234567` &rarr; `+233241234567`
- **International Numbers**: Leading `+` preserved.

---

### Webhooks & Timing-Safe Verification

- **Endpoint**: `POST /hooks/payment/paystack`
- **Signature Header**: `x-paystack-signature`
- **Verification**: Uses timing-safe HMAC-SHA512 comparisons (`crypto.timingSafeEqual`) to prevent timing attacks.
- **Automated Actions**:
  - `charge.success`: Maps to `PaymentActions.SUCCESSFUL`, instantly capturing the payment session in Medusa.
  - `charge.failed`: Maps to `PaymentActions.FAILED`, updating the session status to failed.

---

### Automated 15-Minute Background Sync Job

Located at `src/jobs/sync-paystack-transactions.ts`.

- **Cron Schedule**: `*/15 * * * *` (runs every 15 minutes).
- **Purpose**: Recovers payments where the customer's browser was closed before callback execution, or where a mobile network delayed the webhook.
- **Behavior**:
  1. Queries all payment sessions in `pending`, `pending_authorization`, or `requires_more` states.
  2. Skips sessions created in the last 60 seconds to avoid race conditions with checkout.
  3. Verifies each transaction with Paystack's API.
  4. Automatically captures the payment in Medusa if Paystack confirms the charge was successful.

---

### Payment Link Subscriber for Unpaid Balances

Located at `src/subscribers/payment-link.ts`.

- **Event**: `order.placed`
- **Trigger**: Orders created with an outstanding balance (`order.total - captured_amount > 0`). This includes:
  - Cash on Delivery / Pay on Delivery orders.
  - Deferred checkout / quote orders.
  - Partial deposit / installment orders.
- **HMAC Hash Security**:
  ```typescript
  const hash = crypto
    .createHmac('sha256', process.env.MEDUSA_PUBLISHABLE_KEY)
    .update(order.id)
    .digest('hex');
  ```
- **Automated Notifications**:
  - **SMS**: Dispatched to `order.shipping_address.phone` via Medusa Notification Module.
  - **Email**: Dispatched to `order.email` with HTML and text templates containing the balance and secure link.

---

## 3. Admin Features & Extensions

### Order Details STK Push Widget

Located at `src/admin/widgets/order-paystack.tsx`.

- **Injection Zone**: `order.details.after` (renders directly inside the Medusa Admin order view).
- **Phone Prefill**: Automatically searches shipping address, billing address, and customer profile to prefill the phone number.
- **Partial Amount Support**: Admins can enter a custom amount to collect partial installments, or leave blank to collect the full order total.
- **Live Status Feedback**: Displays color-coded success and error alerts upon dispatch.

### Paystack Analytics Dashboard

Located at `src/admin/routes/paystack/page.tsx`.

- **Admin Sidebar Route**: Listed under **Paystack** with a credit card icon.
- **Live Balance**: Displays live Paystack available balance and currency.
- **Revenue Analytics**: Interactive Recharts bar charts showing volume broken down by:
  - Daily
  - Weekly
  - Monthly
  - Yearly
- **Recent Transactions Table**: Shows the latest 10 captured Paystack payments with order number, amount, and date.

### Admin STK Push API Endpoint

- **Route**: `POST /admin/paystack/stk-push`
- **Authentication**: Requires an active Medusa Admin session cookie or Bearer token.
- **Double-Tap Protection**: Enforces a 45-second lock on pending STK push attempts per order.
- **Overpayment Guard**: Rejects payments exceeding the remaining unpaid balance.

---

## 4. Frontend & Storefront Features & Integration

The plugin provides storefront developers with complete flexibility to implement any payment UX:

### Method 1: Standard Checkout (Hosted Redirect & Popup Modal)

During cart checkout, create a payment session using the provider ID `pp_paystack_paystack`:

```typescript
import Medusa from "@medusajs/js-sdk"

export const sdk = new Medusa({
  baseUrl: process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL!,
  publishableApiKey: process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY!,
})

// 1. Initialize payment session on the cart
const { cart } = await sdk.store.payment.initiatePaymentSession(cart, {
  provider_id: "pp_paystack_paystack",
})

const session = cart.payment_collection?.payment_sessions?.find(
  (s) => s.provider_id === "pp_paystack_paystack"
)

// Session data contains:
// session.data.paystackTxAuthorizationUrl -> Hosted redirect checkout URL
// session.data.paystackTxAccessCode       -> Access code for popup modal
// session.data.paystackTxRef              -> Unique transaction reference
```

#### Option A: Hosted Redirect
Redirect the customer to Paystack's hosted payment page:
```typescript
if (session?.data?.paystackTxAuthorizationUrl) {
  window.location.href = session.data.paystackTxAuthorizationUrl as string
}
```

#### Option B: Inline Popup Modal (`@paystack/inline-js`)
Install the Paystack Inline library:
```bash
npm install @paystack/inline-js
```

Use the access code to open the modal without leaving your storefront:
```typescript
import PaystackPop from "@paystack/inline-js"

const handlePopupPayment = (accessCode: string, cartId: string) => {
  const popup = new PaystackPop()
  popup.resumeTransaction(accessCode, {
    onSuccess: async (transaction) => {
      // Complete the cart in Medusa
      await sdk.store.cart.complete(cartId)
      window.location.href = `/order/confirmed/${cartId}`
    },
    onCancel: () => {
      console.log("Customer closed the payment popup.")
    },
  })
}
```

---

### Method 2: Direct Mobile Money STK Push

Trigger a direct SIM Toolkit prompt (M-Pesa in Kenya, MTN in Ghana) to the customer's phone without redirecting to a payment gateway.

- **Endpoint**: `POST /store/paystack/stk-push`
- **Headers**:
  - `Content-Type: application/json`
  - `x-publishable-api-key: <MEDUSA_PUBLISHABLE_KEY>`
- **Request Body**:
  ```json
  {
    "order_id": "order_01J...",
    "phone": "0712345678",
    "amount": 1500
  }
  ```
  *(Note: `amount` is optional. If omitted, the full remaining balance is charged).*

#### React / Next.js Component Example:

```tsx
"use client"

import { useState } from "react"

interface StkPushProps {
  orderId: string
  defaultPhone?: string
  remainingBalance: number
  currencyCode: string
}

export function MpesaStkPush({ orderId, defaultPhone = "", remainingBalance, currencyCode }: StkPushProps) {
  const [phone, setPhone] = useState(defaultPhone)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)
    setError(null)

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL}/store/paystack/stk-push`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-publishable-api-key": process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY!,
        },
        body: JSON.stringify({
          order_id: orderId,
          phone,
        }),
      })

      const result = await response.json()
      if (!response.ok) throw new Error(result.message || "Failed to initiate STK push")

      setMessage(result.message || "PIN prompt sent to your phone. Please enter your PIN to complete payment.")
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handlePay} className="p-4 border rounded-xl space-y-3 max-w-md">
      <h3 className="font-semibold text-lg">Pay with M-Pesa / Mobile Money</h3>
      <p className="text-sm text-gray-500">
        Amount to pay: <strong>{currencyCode} {remainingBalance.toLocaleString()}</strong>
      </p>

      {message && <div className="p-3 bg-green-50 text-green-700 text-sm rounded-lg">{message}</div>}
      {error && <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}

      <input
        type="tel"
        placeholder="e.g. 0712345678"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        required
        className="w-full p-2 border rounded-lg text-sm"
      />

      <button
        type="submit"
        disabled={loading || !phone}
        className="w-full py-2 bg-emerald-600 text-white font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50"
      >
        {loading ? "Sending Prompt..." : "Send M-Pesa Prompt"}
      </button>
    </form>
  )
}
```

---

### Method 3: Deferred / Offline / Partial Payment Landing Page

When an order has an unpaid balance, customers receive an automated SMS & Email with a link:
```text
${STOREFRONT_URL}/pay/${hash}/${order.id}
```

#### Implementing the Page in Next.js (App Router):
Create `app/pay/[hash]/[orderId]/page.tsx`:

```tsx
import crypto from "crypto"
import { notFound } from "next/navigation"
import { MpesaStkPush } from "@/components/MpesaStkPush"

interface PageProps {
  params: { hash: string; orderId: string }
}

export default async function PaymentLinkPage({ params }: PageProps) {
  const { hash, orderId } = params

  // 1. Verify HMAC Hash
  const secretKey = process.env.MEDUSA_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY!
  const expectedHash = crypto.createHmac("sha256", secretKey).update(orderId).digest("hex")

  if (hash !== expectedHash) {
    return notFound()
  }

  // 2. Fetch Order Details from Medusa Backend
  const res = await fetch(`${process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL}/store/orders/${orderId}`, {
    headers: {
      "x-publishable-api-key": process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY!,
    },
    next: { revalidate: 0 },
  })

  if (!res.ok) return notFound()
  const { order } = await res.json()

  // Calculate unpaid balance
  const capturedAmount = order.payment_collections?.[0]?.captured_amount || 0
  const unpaidBalance = Math.max(0, order.total - capturedAmount)

  if (unpaidBalance <= 0) {
    return (
      <div className="p-8 text-center max-w-md mx-auto">
        <h1 className="text-2xl font-bold text-green-600">Order Fully Paid!</h1>
        <p className="mt-2 text-gray-600">Thank you. Order #{order.display_id} has no remaining balance.</p>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto py-12 px-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Complete Your Payment</h1>
        <p className="text-gray-500">Order #{order.display_id || order.id}</p>
      </div>

      <div className="bg-gray-50 p-4 rounded-xl space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Order Total:</span>
          <span>{order.currency_code.toUpperCase()} {order.total}</span>
        </div>
        <div className="flex justify-between text-base font-bold text-emerald-600">
          <span>Remaining Balance:</span>
          <span>{order.currency_code.toUpperCase()} {unpaidBalance}</span>
        </div>
      </div>

      <MpesaStkPush
        orderId={order.id}
        defaultPhone={order.shipping_address?.phone || ""}
        remainingBalance={unpaidBalance}
        currencyCode={order.currency_code.toUpperCase()}
      />
    </div>
  )
}
```

---

### Method 4: Payment Verification & Polling Patterns

When the customer completes the prompt on their phone, the payment is captured asynchronously by Paystack via webhook. 

Your storefront should poll the order status until captured:

```typescript
export async function pollPaymentStatus(
  orderId: string,
  onSuccess: () => void,
  timeoutMs: number = 60000
) {
  const startTime = Date.now()

  const interval = setInterval(async () => {
    if (Date.now() - startTime > timeoutMs) {
      clearInterval(interval)
      console.warn("Payment polling timed out.")
      return
    }

    try {
      const { order } = await sdk.store.order.retrieve(orderId, {
        fields: "+payment_collections.status,+payment_collections.captured_amount",
      })

      if (order.payment_status === "captured") {
        clearInterval(interval)
        onSuccess()
      }
    } catch (e) {
      console.error("Polling error:", e)
    }
  }, 3000) // Poll every 3 seconds
}
```

---

## 5. Changelog & Version History

> 👉 *For the full chronological changelog with breaking changes and migration notices, see [CHANGELOG.md](./CHANGELOG.md).*

### [v1.0.8] - 2026-09-09
- **Rich, Professional Notifications**: Enhanced email notifications with itemized products table, thumbnails, full price accounting breakdown (subtotal, shipping, discounts, taxes, paid amount, balance due), and destination addresses. Mobile-optimized responsive card design and concise SMS templates.

### [v1.0.7] - 2026-09-09
- **Dedicated Feature & Integration Guide (`FEATURES.md`)**: Comprehensive documentation covering backend architecture, admin widgets, analytics dashboard, and frontend/storefront implementation tutorials.
- **Dedicated Project Changelog (`CHANGELOG.md`)**: Standalone, detailed version-by-version release history tracking all features, fixes, and improvements.
- **Automated GitHub Release Notes**: Enhanced CI workflow to automatically extract and populate GitHub Release pages with version-specific changelog notes and attached release assets (`.tgz`).
- **Storefront Payment Link Verification**: Added guidance and code samples for verifying HMAC-SHA256 signatures for deferred, offline, and partial order settlement pages (`/pay/[hash]/[orderId]`).

### [v1.0.6] - 2026-09-09
- **Storefront STK Push**: Restored and validated public route `POST /store/paystack/stk-push` with `x-publishable-api-key`.
- **Documentation**: Added comprehensive Storefront Integration Guide with copy-pasteable Next.js and React code snippets.
- **Release Automation**: Automated GitHub Releases and npm tarball asset deployment.

### [v1.0.5] - 2026-09-08
- **Admin Bundler Stability**: Replaced static imports of `recharts` in admin extensions with safe packaging to prevent Vite/Webpack build crashes.
- **Guest Checkout Safe**: Payment sessions now gracefully handle guest checkouts initialized prior to email entry (`emailPending` state).
- **TypeScript Alignment**: Ensured full compilation compatibility with `@medusajs/framework` v2.17+.

### [v1.0.4] - 2026-09-08
- **Multi-Currency Mobile Money**: Expanded mobile money provider routing (Safaricom M-Pesa for `KES`, MTN Mobile Money for `GHS`, `XOF`, `RWF`).
- **Phone Sanitization**: Added automatic conversion of local phone numbers (`07...`, `01...`) to E.164 international standard (`+254...`).

### [v1.0.3] - 2026-09-08
- **Payment Link Automation**: Introduced `order.placed` subscriber generating unique HMAC-SHA256 links for unpaid or partial orders.
- **Notification Templates**: Added customizable HTML email and SMS notification templates.

### [v1.0.2] - 2026-09-07
- **Admin Order Widget**: Added `order.details.after` widget for triggering manual M-Pesa STK prompts directly from Medusa Admin.
- **Idempotency Guard**: Added 45-second lock on duplicate STK push attempts to prevent accidental customer double charges.
- **Overpayment Guard**: Enforced backend validation blocking charge amounts greater than the remaining balance.

### [v1.0.1] - 2026-09-07
- **Webhook Timing-Safe Equal**: Implemented `crypto.timingSafeEqual` for HMAC-SHA512 verification.
- **Background Transaction Sync**: Added automated 15-minute cron job to recover stranded and in-flight payments.

### [v1.0.0] - 2026-09-06
- **Initial Release**: Complete Medusa v2 Paystack payment provider implementation with multi-currency subunit normalization.

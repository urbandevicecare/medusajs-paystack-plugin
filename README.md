# Medusa v2 Paystack Plugin

[![NPM Version](https://img.shields.io/npm/v/medusajs-paystack-plugin.svg)](https://www.npmjs.com/package/medusajs-paystack-plugin)
[![Medusa v2](https://img.shields.io/badge/Medusa-v2.x-violet.svg)](https://docs.medusajs.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A multi-currency **Paystack** payment plugin designed for **Medusa v2**. Supports standard checkout redirects, inline popup checkout, direct M-Pesa / Mobile Money STK Push, an Admin Order widget, an analytics dashboard, and automated background transaction sync.

---

## Features

- **Medusa v2 Native**: Built with `AbstractPaymentProvider` and `@medusajs/framework`.
- **Flexible Frontend Checkout**: Supports hosted redirect, inline popup modal, and headless mobile money STK push.
- **M-Pesa / Mobile Money STK Push**: Send instant PIN prompts directly to customer phones via storefront or admin.
- **Admin Order Widget**: Integrated directly in order details (`order.details.after`) with phone prefill and partial payment support.
- **Paystack Analytics Dashboard**: Dedicated page in the Medusa Admin sidebar with revenue metrics, charts, and live balance.
- **Automated Payment Links**: Background subscriber sends SMS & email reminders with secure HMAC links for unpaid orders.
- **Background Sync**: 15-minute cron job to verify and capture in-flight payments.
- **Multi-Currency & Webhooks**: Automatic subunit normalization (KES, NGN, GHS, USD, etc.) and timing-safe HMAC SHA-512 webhook verification.

---

## Installation

```bash
npm install medusajs-paystack-plugin
# or
yarn add medusajs-paystack-plugin
```

---

## Backend Configuration

Add the provider to `@medusajs/payment` in `medusa-config.ts` (or `medusa-config.js`):

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

```env
# Required: Paystack API keys
PAYSTACK_SECRET_KEY=sk_live_xxxxxxx   # or sk_test_xxxxxxx
PAYSTACK_PUBLIC_KEY=pk_live_xxxxxxx   # or pk_test_xxxxxxx

# Optional (for payment link notifications):
STOREFRONT_URL=https://yourstore.com
MEDUSA_PUBLISHABLE_KEY=pk_xxxxxxx
```

---

## Webhook Setup

In your [Paystack Dashboard](https://dashboard.paystack.com/#/settings/developer) &rarr; **API Keys & Webhooks**, set the **Webhook URL** to:

```text
https://your-medusa-backend.com/hooks/payment/paystack
```

Incoming `charge.success` events automatically capture payments and update the Medusa order status.

---

## Storefront & Frontend Integration Guide

The plugin exposes multiple ways for your storefront (e.g. Next.js, Remix, Gatsby) to collect payments:

### 1. Standard Checkout (Hosted Redirect & Popup Modal)

When a customer selects Paystack at checkout, initialize a payment session with provider `pp_paystack_paystack`:

```typescript
import Medusa from "@medusajs/js-sdk"

const sdk = new Medusa({
  baseUrl: process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL!,
  publishableApiKey: process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY!,
})

// Initialize payment session on cart
const { cart } = await sdk.store.payment.initiatePaymentSession(cart, {
  provider_id: "pp_paystack_paystack",
})

const paystackSession = cart.payment_collection?.payment_sessions?.find(
  (s) => s.provider_id === "pp_paystack_paystack"
)
```

The payment session returns:
- `paystackTxAuthorizationUrl`: Hosted Paystack checkout URL.
- `paystackTxAccessCode`: Access code for Paystack inline popup modal.
- `paystackTxRef`: Unique transaction reference.

#### Option A: Hosted Redirect
Redirect the customer directly to Paystack:
```typescript
if (paystackSession?.data?.paystackTxAuthorizationUrl) {
  window.location.href = paystackSession.data.paystackTxAuthorizationUrl as string
}
```

#### Option B: Inline Popup Modal
Use `@paystack/inline-js` to keep the user on your site:
```bash
npm install @paystack/inline-js
```
```typescript
import PaystackPop from "@paystack/inline-js"

const popup = new PaystackPop()
popup.resumeTransaction(paystackSession.data.paystackTxAccessCode as string)
```

---

### 2. Direct Mobile Money STK Push (`POST /store/paystack/stk-push`)

Trigger an instant SIM Toolkit prompt (e.g. M-Pesa in Kenya, MTN in Ghana) directly to the customer's phone without redirecting to a payment gateway.

- **Endpoint**: `POST /store/paystack/stk-push`
- **Header**: `x-publishable-api-key: <MEDUSA_PUBLISHABLE_KEY>`
- **Body**:
  ```json
  {
    "order_id": "order_01J...",
    "phone": "0712345678",
    "amount": 1500
  }
  ```
  *(Note: `amount` is optional and defaults to the full unpaid balance. Phone is automatically sanitized to international format).*

#### Features:
- **Phone Sanitization**: Automatically handles `07...`, `01...`, or `+254...`.
- **Overpayment Guard**: Blocks amounts exceeding the remaining balance.
- **Double-Tap Protection**: Enforces 45-second idempotency to prevent duplicate mobile prompts.

#### Frontend Example:
```typescript
const triggerStkPush = async (orderId: string, phone: string, amount?: number) => {
  const res = await fetch(`${process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL}/store/paystack/stk-push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-publishable-api-key": process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY!,
    },
    body: JSON.stringify({
      order_id: orderId,
      phone,
      ...(amount ? { amount } : {}),
    }),
  })

  const data = await res.json()
  if (!res.ok) throw new Error(data.message)
  return data // { success: true, message: "...", reference: "..." }
}
```

---

### 3. Payment Link Landing Page (`/pay/[hash]/[orderId]`)

When orders are created with an unpaid balance, the plugin subscriber sends SMS & Email notifications containing a payment link:
```text
${STOREFRONT_URL}/pay/${hash}/${order.id}
```
where `hash = sha256(order.id, MEDUSA_PUBLISHABLE_KEY)`.

In your storefront:
1. Create a page at `/pay/[hash]/[orderId]`.
2. Fetch the order details using `sdk.store.order.retrieve(orderId)`.
3. Display the order total and remaining balance.
4. Render a phone input and "Pay via M-Pesa" button calling `POST /store/paystack/stk-push`.

---

### 4. Payment Verification & Polling

Once the customer completes the prompt on their phone or finishes the popup checkout, Paystack sends a webhook to capture the payment.

Your frontend can poll the order status:
```typescript
const pollOrderStatus = async (orderId: string, maxAttempts = 20): Promise<boolean> => {
  for (let i = 0; i < maxAttempts; i++) {
    const { order } = await sdk.store.order.retrieve(orderId, {
      fields: "+payment_collections.status,+payment_collections.captured_amount",
    })

    if (order.payment_status === "captured") {
      return true
    }

    await new Promise((resolve) => setTimeout(resolve, 3000)) // Wait 3s
  }
  return false
}
```

---

## Admin Extensions

- **Order STK Push Widget**: Send prompts directly from the Medusa Admin order view (`order.details.after`).
- **Paystack Analytics Dashboard**: Monitor gross volume, transactions, and live Paystack balance in the Medusa Admin sidebar.
- **Admin STK Route**: `POST /admin/paystack/stk-push` (authenticated for staff).

---

## Development & Building

```bash
yarn build   # Builds server code and admin extensions into .medusa/server
yarn dev     # Development watch mode
```

---

## License

MIT © [Urban Device Care](https://urbandevicecare.co.uk)

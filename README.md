# Medusa v2 Paystack Plugin

[![NPM Version](https://img.shields.io/npm/v/medusajs-paystack-plugin.svg)](https://www.npmjs.com/package/medusajs-paystack-plugin)
[![Medusa v2](https://img.shields.io/badge/Medusa-v2.x-violet.svg)](https://docs.medusajs.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A multi-currency **Paystack** payment plugin designed for **Medusa v2**. Supports standard checkout redirects, M-Pesa / Mobile Money STK Push, an Admin Order widget, an analytics dashboard, and automated background transaction sync.

## Features

- **Medusa v2 Native**: Built with `ModuleProvider` and `@medusajs/framework`.
- **M-Pesa / Mobile Money STK Push**: Send SIM Toolkit payment prompts directly to customer phones from Medusa Admin.
- **Admin Order Widget**: Integrated in order details (`order.details.after`) with phone prefill and partial payment support.
- **Paystack Analytics Dashboard**: Dedicated page under **Paystack** in the admin sidebar with revenue charts and live balance.
- **Automated Payment Links**: Subscriber triggers SMS & email reminders with secure HMAC links for unpaid orders.
- **Background Sync**: 15-minute cron job to verify and capture in-flight payments.
- **Multi-Currency & Webhooks**: Automatic subunit normalization (KES, NGN, GHS, USD, etc.) and timing-safe HMAC SHA-512 webhook verification.

## Installation

```bash
npm install medusajs-paystack-plugin
# or
yarn add medusajs-paystack-plugin
```

## Configuration

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

## Webhook Setup

In your [Paystack Dashboard](https://dashboard.paystack.com/#/settings/developer) &rarr; **API Keys & Webhooks**, set the **Webhook URL** to:

```text
https://your-medusa-backend.com/hooks/payment/paystack
```

Incoming `charge.success` events will automatically capture the payment and mark the order as paid.

## STK Push APIs

- **Storefront (`POST /store/paystack/stk-push`)**: Public endpoint used by Next.js storefronts and custom payment link pages to trigger M-Pesa prompts for customers.
  ```json
  { "order_id": "order_01...", "phone": "+254712345678", "amount": 500 }
  ```
- **Admin (`POST /admin/paystack/stk-push`)**: Authenticated endpoint used by the Admin UI Order Widget for manual payments.

## Development & Building

```bash
yarn build   # Builds server code and admin extensions
yarn dev     # Development watch mode
```

## License

MIT © [Urban Device Care](https://urbandevicecare.co.uk)

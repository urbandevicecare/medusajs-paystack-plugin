# Medusa v2 Paystack Payment Plugin

[![NPM Version](https://img.shields.io/npm/v/medusajs-paystack-plugin.svg)](https://www.npmjs.com/package/medusajs-paystack-plugin)
[![Medusa Plugin](https://img.shields.io/badge/Medusa-v2.x-violet.svg)](https://docs.medusajs.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A robust, multi-currency **Paystack** payment plugin designed natively for **Medusa v2**. Supports standard checkout redirects, M-Pesa / Mobile Money STK Push prompts, partial installment payments, live analytics dashboard, and automated background transaction reconciliation.

---

## Key Features

- **Native Medusa v2 Architecture**: Built with `ModuleProvider` and `@medusajs/framework`, supporting standard payment sessions, refunds, captures, and cancellations.
- **Mobile Money STK Push (M-Pesa & MTN)**: Trigger SIM Toolkit push notifications directly to customer phones from the Medusa Admin order view.
- **Admin Order Widget**: Integrated widget in the order details page (`order.details.after`) with phone number pre-filling, partial amount customization, and real-time status feedback.
- **Paystack Analytics Dashboard**: Dedicated admin page (`/app/paystack`) displaying daily, weekly, monthly, and yearly revenue graphs, live Paystack account balances, and recent transaction history.
- **Automated Unpaid Order Notifications**: Built-in event subscriber (`order.placed`) that generates secure HMAC payment links and dispatches SMS and email reminders for orders with pending balances.
- **Scheduled Background Sync**: Built-in cron job running every 15 minutes to reconcile in-flight and asynchronous mobile money payments (`pending`, `pending_authorization`, `requires_more`).
- **Medusa v2 Currency Handling**: Seamless conversion between Medusa v2 decimal amounts (e.g. `150.00` KES) and Paystack lowest subunits (e.g. `15000` cents), including zero-decimal currencies.
- **Timing-Safe Webhooks**: Cryptographically verified HMAC SHA-512 webhook signature verification using `crypto.timingSafeEqual` with automatic payment capture on `charge.success` and failure handling on `charge.failed`.

---

## Installation

```bash
npm install medusajs-paystack-plugin
# or
yarn add medusajs-paystack-plugin
```

---

## Configuration

In Medusa v2, payment providers are registered inside `@medusajs/payment` in `medusa-config.ts` (or `medusa-config.js`):

```typescript
import { defineConfig } from "@medusajs/framework/utils"

export default defineConfig({
  projectConfig: {
    // ... your project configuration
  },
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

Add the following keys to your `.env` file:

```env
# Required: Paystack API credentials
PAYSTACK_SECRET_KEY=sk_live_xxxxxxx   # or sk_test_xxxxxxx for test mode
PAYSTACK_PUBLIC_KEY=pk_live_xxxxxxx   # or pk_test_xxxxxxx for test mode

# Optional: Storefront and publishable key for payment link subscriber
STOREFRONT_URL=https://yourstore.com
MEDUSA_PUBLISHABLE_KEY=pk_xxxxxxx
STORE_NAME="Your Store Name"
STORE_TAGLINE="Your Store Tagline"
```

---

## Webhooks

To ensure payments are captured automatically when completed via Paystack checkout or Mobile Money STK Push:

1. Open your **Paystack Dashboard** &rarr; **Settings** &rarr; **API Keys & Webhooks**.
2. Set the **Webhook URL** to:
   ```text
   https://your-medusa-backend.com/hooks/payment/paystack
   ```
   *(Replace `paystack` with whatever `id` you set in `medusa-config.ts`)*.
3. Save changes. Paystack will sign webhook payloads with your `PAYSTACK_SECRET_KEY`.

---

## Admin Features

### 1. Order STK Push Widget
When viewing any order in Medusa Admin, the **Paystack - STK Push** widget appears below the order details:
- **Phone Number**: Automatically populated from the shipping/billing address or customer profile. Supports Kenyan numbers (`07...`, `254...`, `+254...`) and international mobile money formats.
- **Custom Amount**: Allows partial payments or installment collections. Leave blank to charge the remaining unpaid order balance.
- **Instant Trigger**: Sends an interactive SIM Toolkit PIN prompt to the customer's phone in production (`sk_live_*`), or records a simulated approval in test mode (`sk_test_*`).

### 2. Paystack Analytics Dashboard
Navigate to **Paystack** in the Medusa Admin sidebar to view:
- **Total Medusa Revenue**: Aggregated sum of payments processed through Paystack.
- **Live Paystack Balance**: Real-time account balance across currencies directly from Paystack API.
- **Interactive Revenue Chart**: Toggle between Daily (last 30 days), Weekly (last 12 weeks), Monthly (last 12 months), and Yearly (last 5 years).
- **Recent Transactions**: Filterable table showing order display ID, formatted amounts, and timestamps.

---

## Admin API Routes

### Initiate STK Push
```http
POST /admin/paystack/stk-push
Content-Type: application/json
```

**Request Body:**
```json
{
  "order_id": "order_01JXXXX...",
  "phone": "+254712345678",
  "amount": 500
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "STK push initiated successfully. Please complete the prompt on your phone.",
  "reference": "stk_1741467400000_order_01",
  "data": { ... }
}
```

### Dashboard Analytics
```http
GET /admin/paystack/dashboard
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "payments": [ ... ],
    "totalRevenue": 15400,
    "dailyGraph": [ ... ],
    "weeklyGraph": [ ... ],
    "monthlyGraph": [ ... ],
    "yearlyGraph": [ ... ],
    "balance": [ { "currency": "KES", "balance": 5490000 } ]
  }
}
```

---

## Scheduled Background Sync

The plugin includes a Medusa scheduled job (`src/jobs/sync-paystack-transactions.ts`) that runs every 15 minutes (`*/15 * * * *`):
- Queries all in-flight Paystack payment sessions (`pending`, `pending_authorization`, `requires_more`).
- Verifies payment status with Paystack's API.
- Captures and reconciles orders automatically if a webhook was missed or delayed.

---

## Development & Building

```bash
# Build the plugin (compiles server code and admin extensions)
yarn build

# Watch mode for local plugin development
yarn dev
```

---

## License

MIT &copy; [Urban Device Care](https://urbandevicecare.co.uk)

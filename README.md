# Medusa v2 Paystack Payment Plugin

[![NPM Version](https://img.shields.io/npm/v/medusajs-paystack-plugin.svg)](https://www.npmjs.com/package/medusajs-paystack-plugin)
[![Medusa Plugin](https://img.shields.io/badge/Medusa-Plugin-violet.svg)](https://docs.medusajs.com)
A powerful, multi-currency Paystack payment integration designed specifically for **Medusa v2**. This plugin supports standard checkouts, partial installments, STK push for Mobile Money, and a comprehensive admin widget for manual payments.

## Features

- **Full Medusa v2 Compatibility**: Natively exports via `ModuleProvider` and works seamlessly with Medusa's dependency injection system.
- **Dynamic Provider Configuration**: Easily set up one or multiple Paystack accounts in your `medusa-config.js`.
- **Storefront & Admin STK Push APIs**: Initiate direct mobile money pushes from both the Admin dashboard and custom payment links.
- **Currency Normalization**: Handles zero-decimal vs standard currency conversions perfectly behind the scenes.

## Installation

```bash
npm install medusajs-paystack-plugin
```

## Configuration

In Medusa v2, payment providers are configured inside the `@medusajs/payment` module.

Open your `medusa-config.js` and add the provider:

```javascript
import { defineConfig } from "@medusajs/framework/utils"

export default defineConfig({
  projectConfig: {
    // ...
  },
  modules: [
    {
      resolve: "@medusajs/payment",
      options: {
        providers: [
          {
            resolve: "medusajs-paystack-plugin",  // Uses the npm package name
            id: "paystack",       // The identifier you will use in the dashboard/API
            options: {
              secret_key: process.env.PAYSTACK_SECRET_KEY,
              public_key: process.env.PAYSTACK_PUBLIC_KEY,
            },
          },
        ],
      },
    },
  ]
})
```

> **Note**: The `id` is crucial. It acts as the identifier (`paystack`) for the payment session when a customer checks out.

## Webhooks

To ensure payments are automatically captured when a customer completes the payment on Paystack's hosted page or via STK Push, add your Medusa backend URL to the Paystack Dashboard Webhook settings.

Your webhook URL will look like this:
```
https://your-medusa-backend.com/hooks/payment/paystack
```
*(The path ends with the `id` you defined in your `medusa-config.js`)*

## Admin UI Widget

This plugin automatically injects an **Admin UI Widget** into the Order Details page. It allows store admins to easily request a manual payment via Mobile Money STK Push directly to a customer's phone number for any unpaid order. 

## Manual Payment API (Storefront STK Push)

This plugin also exposes a dedicated **JSON API endpoint** for your Next.js storefront to initiate an STK push directly to a customer's phone for an existing order (i.e. custom payment links).

### Endpoint: `POST /store/paystack/stk-push`

Call this endpoint when a customer clicks "Pay with Mobile Money" from a custom payment link on your storefront.

**Request Payload:**
```json
{
  "order_id": "order_01H...",
  "phone": "254700000000"
}
```

**Example Implementation (Next.js Storefront):**

```typescript
const initiateManualPayment = async (orderId: string, phone: string) => {
  const response = await fetch(`${process.env.NEXT_PUBLIC_MEDUSA_URL}/store/paystack/stk-push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      order_id: orderId,
      phone: phone
    })
  });
  
  const data = await response.json();
  if (data.success) {
    alert("Please check your phone to complete the payment!");
  }
}
```

### Auto-updating Payment Status
Once the customer enters their PIN on their phone, Paystack sends a webhook back to your Medusa backend. The plugin natively intercepts this via the `getWebhookActionAndData` method and **automatically marks the Medusa order as Paid!**

## Scheduled Background Sync

For local development environments (where webhooks cannot reach your localhost) or as a robust fallback for missed webhooks in production, this plugin includes a built-in **Medusa Scheduled Job**.

Every 15 minutes, the background job automatically scans your database for all `pending` Paystack payment sessions. It queries the Paystack API to verify their real-time status. Any successfully paid sessions are instantly authorized and captured within Medusa, automatically updating the associated order's payment status to paid.

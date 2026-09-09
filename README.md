# Medusa v2 Paystack Plugin

[![NPM Version](https://img.shields.io/npm/v/medusajs-paystack-plugin.svg)](https://www.npmjs.com/package/medusajs-paystack-plugin)
[![Medusa v2](https://img.shields.io/badge/Medusa-v2.x-violet.svg)](https://docs.medusajs.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A multi-currency **Paystack** payment plugin designed for **Medusa v2**. Supports standard checkout redirects, inline popup checkout, direct M-Pesa / Mobile Money STK Push, an Admin Order widget, an analytics dashboard, and automated background transaction sync.

> 📖 **Documentation & Integration Links**:
> - **[Comprehensive Feature & Integration Guide (FEATURES.md)](./FEATURES.md)**: Deep dive into all backend architecture, admin widgets, and storefront implementation tutorials (Next.js & React).
> - **[Release Changelog (CHANGELOG.md)](./CHANGELOG.md)**: Detailed version-by-version change history and release notes.

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

👉 *For detailed feature breakdowns and architecture diagrams, see [FEATURES.md](./FEATURES.md).*

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

## Frontend & Storefront Integration

The plugin exposes multiple integration paths for storefronts (Next.js, Remix, Gatsby):

1. **Standard Checkout (Hosted Redirect & Popup Modal)**:
   - Provider ID: `pp_paystack_paystack`
   - Redirect to `session.data.paystackTxAuthorizationUrl` or mount popup using `session.data.paystackTxAccessCode`.
2. **Direct Mobile Money STK Push (`POST /store/paystack/stk-push`)**:
   - Accepts `{ "order_id": "...", "phone": "07...", "amount": 500 }`.
   - Automatic phone sanitization to `+254...`, 45-second idempotency guard, and overpayment prevention.
3. **Payment Link Landing Page (`/pay/[hash]/[orderId]`)**:
   - Tamper-proof HMAC links sent via automated SMS/Email for offline/deferred balances.
4. **Payment Polling**:
   - Poll `sdk.store.order.retrieve` while waiting for customer PIN entry.

👉 *For complete, copy-pasteable React and Next.js component implementations, see [Frontend & Storefront Guide in FEATURES.md](./FEATURES.md#4-frontend--storefront-features--integration).*

---

## Admin Extensions

- **Order STK Push Widget**: Send prompts directly from the Medusa Admin order view (`order.details.after`).
- **Paystack Analytics Dashboard**: Monitor gross volume, transactions, and live Paystack balance in the Medusa Admin sidebar.
- **Admin STK Route**: `POST /admin/paystack/stk-push` (authenticated for staff).

👉 *For admin configuration and UI details, see [Admin Extensions in FEATURES.md](./FEATURES.md#3-admin-features--extensions).*

---

## Development & Building

```bash
yarn build   # Builds server code and admin extensions into .medusa/server
yarn dev     # Development watch mode
```

---

## Changelog

Detailed release notes and migration guides are maintained in [CHANGELOG.md](./CHANGELOG.md).

- **v1.0.7**: Dedicated `FEATURES.md` and `CHANGELOG.md` documentation, automated GitHub Release changelog population.
- **v1.0.6**: Storefront STK Push route restoration, comprehensive frontend docs.
- **v1.0.5**: Admin bundler stability fix (recharts dynamic isolation), guest checkout session safety.
- **v1.0.4**: Multi-currency mobile money expansion (KES M-Pesa, GHS/XOF/RWF MTN), phone sanitization.
- **v1.0.3**: Automated payment link subscriber (`order.placed`) with HMAC-SHA256 signing and SMS/Email templates.
- **v1.0.2**: Medusa Admin order details STK push widget with 45s idempotency and overpayment protections.
- **v1.0.1**: Timing-safe HMAC-SHA512 webhook verification, 15-minute background transaction sync cron.
- **v1.0.0**: Initial Medusa v2 Paystack Payment Provider release.

---

## License

MIT © [Urban Device Care](https://urbandevicecare.co.uk)

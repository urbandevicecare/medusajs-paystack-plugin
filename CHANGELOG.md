# Changelog

All notable changes to the `medusajs-paystack-plugin` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [v1.0.8] - 2026-09-09

### Added
- **Rich, Professional Order Notifications**:
  - **Itemized Order Table**: Notifications now include full line item details (product titles, variant subtitles, thumbnail images, quantities, unit prices, and line totals).
  - **Comprehensive Financial Breakdown**: Complete accounting summary showing subtotal, shipping fees, discounts, taxes, total order amount, amount already paid, and prominent balance due.
  - **Customer & Destination Details**: Displays recipient name and delivery destination address directly in the email.
  - **Responsive HTML Card Template**: Mobile-optimized email layout with clean brand headers, status badges, prominent payment call-to-action button, direct link fallbacks, and support links.
  - **High-Clarity SMS Formatting**: Compact, informative SMS template containing store name, customer name, order number, total, remaining balance, and secure payment link.

---

## [v1.0.7] - 2026-09-09

### Added
- **Dedicated Feature & Integration Guide (`FEATURES.md`)**: Comprehensive documentation covering backend architecture, admin widgets, analytics dashboard, and frontend/storefront implementation tutorials.
- **Dedicated Project Changelog (`CHANGELOG.md`)**: Standalone, detailed version-by-version release history tracking all features, fixes, and improvements.
- **Automated GitHub Release Notes**: Enhanced CI workflow to automatically extract and populate GitHub Release pages with version-specific changelog notes and attached release assets (`.tgz`).
- **Storefront Payment Link Verification**: Added guidance and code samples for verifying HMAC-SHA256 signatures for deferred, offline, and partial order settlement pages (`/pay/[hash]/[orderId]`).

### Changed
- **Main Readme Restructuring**: Streamlined `README.md` into a clean, compact overview with direct cross-references to in-depth technical guides.

---

## [v1.0.6] - 2026-09-09

### Added
- **Storefront STK Push Route**: Restored and exposed `POST /store/paystack/stk-push` protected by `x-publishable-api-key` for public storefront mobile money transactions.
- **Storefront & Frontend Integration Guide**: Added comprehensive documentation in README covering Hosted Checkout redirects, Inline Popup modal (`@paystack/inline-js`), Direct STK Push, and polling verification.

### Fixed
- Ensured consistent API parity between Admin and Storefront STK push endpoints.

---

## [v1.0.5] - 2026-09-08

### Fixed
- **Admin Bundler Stability**: Resolved build crash during `medusa plugin:build` by isolating `recharts` dependencies in admin extensions, preventing Webpack/Vite runtime chunking errors.
- **Guest Checkout Safe**: Payment sessions now gracefully handle guest checkouts initialized prior to customer email entry (`emailPending` state) without throwing unhandled exceptions.

### Changed
- **TypeScript Framework Alignment**: Updated type definitions to strictly conform to `@medusajs/framework` v2.17+ requirements.

---

## [v1.0.4] - 2026-09-08

### Added
- **Multi-Currency Mobile Money**: Dynamic provider selection routing to Safaricom M-Pesa for Kenyan Shilling (`KES`) and MTN Mobile Money for Ghanaian Cedi (`GHS`), West African CFA (`XOF`), and Rwandan Franc (`RWF`).
- **Phone Sanitization Utility**: Added automatic normalization converting local formats (e.g. `07...` or `01...`) into standard E.164 international phone formats (`+254...`).

---

## [v1.0.3] - 2026-09-08

### Added
- **Automated Payment Link Subscriber**: Added background subscriber listening for `order.placed` events to detect unpaid, deferred, or partial order balances.
- **HMAC Tamper-Proof Security**: Unique signature generated using `crypto.createHmac('sha256', secretKey)` for secure customer payment links (`/pay/[hash]/[orderId]`).
- **Multi-Channel Notifications**: Built-in responsive HTML email and SMS notification templates for prompt customer settlement.

---

## [v1.0.2] - 2026-09-07

### Added
- **Admin Order Details Widget**: Added `order.details.after` extension allowing administrators to trigger manual M-Pesa STK push prompts from the Medusa Admin.
- **Idempotency / Double-Tap Guard**: Enforced a 45-second lock on pending STK push attempts per order to prevent accidental duplicate prompts.
- **Overpayment Guard**: Backend validation ensuring charged amounts do not exceed the remaining unpaid balance on orders.

---

## [v1.0.1] - 2026-09-07

### Security
- **Timing-Safe Webhook Verification**: Replaced basic equality check with `crypto.timingSafeEqual` for HMAC-SHA512 `x-paystack-signature` verification to eliminate timing attack vectors.

### Added
- **Background Transaction Sync Cron**: Implemented automated 15-minute scheduled job (`jobs/sync-paystack-transactions.ts`) to query and capture in-flight/stranded customer payments.

---

## [v1.0.0] - 2026-09-06

### Added
- **Initial Release**: Complete Medusa v2 Paystack Payment Provider module (`AbstractPaymentProvider`).
- **Multi-Currency Support**: Automatic subunit normalization for KES, NGN, GHS, USD, ZAR, EUR, and GBP.
- **Core Operations**: Full implementation of `initiatePayment`, `authorizePayment`, `retrievePayment`, `refundPayment`, `getPaymentStatus`, and `getWebhookActionAndData`.

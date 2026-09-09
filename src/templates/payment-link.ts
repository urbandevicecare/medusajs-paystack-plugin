export interface OrderItem {
  id?: string;
  title?: string;
  subtitle?: string;
  thumbnail?: string;
  quantity?: number;
  unit_price?: number;
}

export interface OrderAddress {
  first_name?: string;
  last_name?: string;
  address_1?: string;
  address_2?: string;
  city?: string;
  province?: string;
  postal_code?: string;
  country_code?: string;
  phone?: string;
}

export interface OrderData {
  id: string;
  display_id?: number | string;
  email?: string;
  created_at?: string;
  currency_code?: string;
  total?: number;
  subtotal?: number;
  shipping_total?: number;
  discount_total?: number;
  tax_total?: number;
  customer?: {
    first_name?: string;
    last_name?: string;
    email?: string;
  };
  shipping_address?: OrderAddress;
  billing_address?: OrderAddress;
  items?: OrderItem[];
  payment_collections?: Array<{
    captured_amount?: number;
    amount?: number;
  }>;
}

function formatAmount(amount: number | undefined | null, currency: string): string {
  if (amount == null || isNaN(amount)) return `${currency.toUpperCase()} 0.00`;
  return `${currency.toUpperCase()} ${Number(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function getPaymentRequiredTemplate(
  orderData: OrderData,
  paymentLink: string,
  remainingBalance: number
) {
  const STORE_NAME = process.env.STORE_NAME || "Urban Device Care";
  const STORE_TAGLINE = process.env.STORE_TAGLINE || "Quality & Reliability Guaranteed";
  const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "support@urbandevicecare.co.uk";

  const currency = (orderData.currency_code || "KES").toUpperCase();
  const orderNumber = orderData.display_id ? `#${orderData.display_id}` : `#${orderData.id.slice(-8)}`;

  // Determine Customer Name
  const firstName =
    orderData.customer?.first_name ||
    orderData.shipping_address?.first_name ||
    orderData.billing_address?.first_name ||
    "";
  const lastName =
    orderData.customer?.last_name ||
    orderData.shipping_address?.last_name ||
    orderData.billing_address?.last_name ||
    "";
  const customerFullName = [firstName, lastName].filter(Boolean).join(" ") || "Valued Customer";
  const greeting = firstName ? `Hi ${firstName},` : "Hello,";

  // Order Totals
  const totalAmount = Number(orderData.total || 0);
  const alreadyPaid = Math.max(0, totalAmount - remainingBalance);
  const orderDate = orderData.created_at
    ? new Date(orderData.created_at).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

  // Items rows
  const items = orderData.items || [];
  const itemsHtml = items.length > 0
    ? items
        .map((item) => {
          const itemTitle = item.title || "Product Item";
          const itemSubtitle = item.subtitle ? `<div style="font-size: 12px; color: #6b7280; margin-top: 2px;">${item.subtitle}</div>` : "";
          const qty = item.quantity || 1;
          const unitPrice = item.unit_price != null ? Number(item.unit_price) : 0;
          const lineTotal = unitPrice * qty;
          const thumbHtml = item.thumbnail
            ? `<img src="${item.thumbnail}" alt="${itemTitle}" width="48" height="48" style="width: 48px; height: 48px; object-fit: cover; border-radius: 6px; border: 1px solid #e5e7eb; display: block;" />`
            : `<div style="width: 48px; height: 48px; border-radius: 6px; background-color: #f3f4f6; display: flex; align-items: center; justify-content: center; font-size: 10px; color: #9ca3af; text-align: center; border: 1px solid #e5e7eb;">Item</div>`;

          return `
            <tr>
              <td style="padding: 12px 0; border-bottom: 1px solid #f3f4f6; vertical-align: middle; width: 56px;">
                ${thumbHtml}
              </td>
              <td style="padding: 12px 12px; border-bottom: 1px solid #f3f4f6; vertical-align: middle;">
                <div style="font-weight: 500; font-size: 14px; color: #111827;">${itemTitle}</div>
                ${itemSubtitle}
                <div style="font-size: 12px; color: #6b7280; margin-top: 2px;">Qty: ${qty} × ${formatAmount(unitPrice, currency)}</div>
              </td>
              <td style="padding: 12px 0; border-bottom: 1px solid #f3f4f6; vertical-align: middle; text-align: right; font-weight: 600; font-size: 14px; color: #111827;">
                ${formatAmount(lineTotal, currency)}
              </td>
            </tr>
          `;
        })
        .join("")
    : `
      <tr>
        <td colspan="3" style="padding: 12px 0; text-align: center; color: #6b7280; font-size: 14px;">
          Order #${orderData.display_id || orderData.id}
        </td>
      </tr>
    `;

  // Shipping details block
  const shipping = orderData.shipping_address;
  const shippingAddressHtml = shipping
    ? `
      <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; margin-top: 20px;">
        <div style="font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #4b5563; margin-bottom: 6px;">
          Delivery Destination
        </div>
        <div style="font-size: 13px; color: #111827; line-height: 1.5;">
          <strong>${shipping.first_name || ""} ${shipping.last_name || ""}</strong><br />
          ${shipping.address_1 || ""}${shipping.address_2 ? `, ${shipping.address_2}` : ""}<br />
          ${[shipping.city, shipping.province, shipping.postal_code, shipping.country_code?.toUpperCase()].filter(Boolean).join(", ")}<br />
          ${shipping.phone ? `Phone: ${shipping.phone}` : ""}
        </div>
      </div>
    `
    : "";

  // Email HTML Content
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Required: Order ${orderNumber}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1f2937;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f3f4f6; padding: 30px 12px;">
    <tr>
      <td align="center">
        <!-- Main Card Container -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 580px; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          
          <!-- Brand Header -->
          <tr>
            <td style="padding: 24px 28px; border-bottom: 1px solid #f3f4f6; background-color: #ffffff;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <h1 style="margin: 0; font-size: 20px; font-weight: 700; color: #111827; letter-spacing: -0.02em;">${STORE_NAME}</h1>
                    <div style="font-size: 12px; color: #6b7280; margin-top: 2px;">${STORE_TAGLINE}</div>
                  </td>
                  <td align="right">
                    <span style="display: inline-block; padding: 4px 10px; font-size: 11px; font-weight: 600; text-transform: uppercase; background-color: #fef3c7; color: #92400e; border-radius: 20px;">
                      Payment Pending
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Message Body -->
          <tr>
            <td style="padding: 28px 28px 20px 28px;">
              <div style="font-size: 16px; font-weight: 600; color: #111827; margin-bottom: 8px;">
                ${greeting}
              </div>
              <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.6; color: #4b5563;">
                Thank you for placing your order with us. We have received your order <strong>${orderNumber}</strong> placed on ${orderDate}. 
                To proceed with processing and dispatch, please complete payment for your outstanding balance.
              </p>

              <!-- Outstanding Balance Callout Banner -->
              <div style="background: linear-gradient(135deg, #047857 0%, #065f46 100%); border-radius: 10px; padding: 20px 24px; text-align: center; color: #ffffff; margin-bottom: 24px;">
                <div style="font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; color: #a7f3d0;">
                  Outstanding Balance Due
                </div>
                <div style="font-size: 30px; font-weight: 800; margin: 4px 0 8px 0; letter-spacing: -0.02em; color: #ffffff;">
                  ${formatAmount(remainingBalance, currency)}
                </div>
                ${
                  alreadyPaid > 0
                    ? `<div style="font-size: 12px; color: #d1fae5;">Total: ${formatAmount(totalAmount, currency)} • Already Paid: ${formatAmount(alreadyPaid, currency)}</div>`
                    : `<div style="font-size: 12px; color: #d1fae5;">Total Order Amount: ${formatAmount(totalAmount, currency)}</div>`
                }
              </div>

              <!-- Primary Action CTA Button -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom: 28px;">
                <tr>
                  <td align="center">
                    <a href="${paymentLink}" style="display: inline-block; width: 100%; max-width: 340px; box-sizing: border-box; background-color: #059669; color: #ffffff; text-align: center; padding: 14px 24px; border-radius: 8px; font-size: 15px; font-weight: 600; text-decoration: none; box-shadow: 0 2px 4px rgba(5, 150, 105, 0.2);">
                      Complete Payment Securely &rarr;
                    </a>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-top: 10px;">
                    <span style="font-size: 11px; color: #9ca3af;">
                      Supports M-Pesa, Mobile Money, Debit/Credit Cards &amp; Apple Pay via Paystack
                    </span>
                  </td>
                </tr>
              </table>

              <!-- Order Summary Section -->
              <div style="border-top: 1px solid #e5e7eb; padding-top: 20px;">
                <div style="font-size: 14px; font-weight: 700; color: #111827; margin-bottom: 12px;">
                  Order Summary (${orderNumber})
                </div>

                <!-- Items Table -->
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  ${itemsHtml}
                </table>

                <!-- Financial Calculation Breakdown -->
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top: 14px;">
                  ${
                    orderData.subtotal != null
                      ? `
                    <tr>
                      <td style="padding: 4px 0; font-size: 13px; color: #6b7280;">Subtotal</td>
                      <td style="padding: 4px 0; font-size: 13px; color: #374151; text-align: right;">${formatAmount(orderData.subtotal, currency)}</td>
                    </tr>`
                      : ""
                  }
                  ${
                    orderData.shipping_total != null && orderData.shipping_total > 0
                      ? `
                    <tr>
                      <td style="padding: 4px 0; font-size: 13px; color: #6b7280;">Shipping &amp; Delivery</td>
                      <td style="padding: 4px 0; font-size: 13px; color: #374151; text-align: right;">${formatAmount(orderData.shipping_total, currency)}</td>
                    </tr>`
                      : ""
                  }
                  ${
                    orderData.discount_total != null && orderData.discount_total > 0
                      ? `
                    <tr>
                      <td style="padding: 4px 0; font-size: 13px; color: #059669;">Discount</td>
                      <td style="padding: 4px 0; font-size: 13px; color: #059669; text-align: right;">-${formatAmount(orderData.discount_total, currency)}</td>
                    </tr>`
                      : ""
                  }
                  ${
                    orderData.tax_total != null && orderData.tax_total > 0
                      ? `
                    <tr>
                      <td style="padding: 4px 0; font-size: 13px; color: #6b7280;">Taxes</td>
                      <td style="padding: 4px 0; font-size: 13px; color: #374151; text-align: right;">${formatAmount(orderData.tax_total, currency)}</td>
                    </tr>`
                      : ""
                  }
                  <tr>
                    <td style="padding: 8px 0 4px 0; font-size: 14px; font-weight: 600; color: #111827; border-top: 1px solid #e5e7eb;">Total Order Amount</td>
                    <td style="padding: 8px 0 4px 0; font-size: 14px; font-weight: 700; color: #111827; text-align: right; border-top: 1px solid #e5e7eb;">${formatAmount(totalAmount, currency)}</td>
                  </tr>
                  ${
                    alreadyPaid > 0
                      ? `
                    <tr>
                      <td style="padding: 4px 0; font-size: 13px; color: #059669;">Amount Paid</td>
                      <td style="padding: 4px 0; font-size: 13px; color: #059669; text-align: right;">-${formatAmount(alreadyPaid, currency)}</td>
                    </tr>`
                      : ""
                  }
                  <tr>
                    <td style="padding: 8px 0; font-size: 15px; font-weight: 800; color: #047857; border-top: 2px solid #e5e7eb;">Remaining Balance Due</td>
                    <td style="padding: 8px 0; font-size: 15px; font-weight: 800; color: #047857; text-align: right; border-top: 2px solid #e5e7eb;">${formatAmount(remainingBalance, currency)}</td>
                  </tr>
                </table>
              </div>

              <!-- Shipping Address Block -->
              ${shippingAddressHtml}

              <!-- Direct URL Fallback -->
              <div style="margin-top: 24px; padding: 14px; background-color: #f8fafc; border-radius: 8px; border: 1px dashed #cbd5e1; font-size: 12px; color: #64748b; line-height: 1.5;">
                <strong>Having trouble with the button?</strong> Paste this secure payment link into your browser:<br />
                <a href="${paymentLink}" style="color: #0284c7; word-break: break-all;">${paymentLink}</a>
              </div>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 28px; background-color: #f9fafb; border-top: 1px solid #f3f4f6; text-align: center;">
              <p style="margin: 0 0 6px 0; font-size: 12px; color: #6b7280;">
                Questions about your order? Reach us at <a href="mailto:${SUPPORT_EMAIL}" style="color: #4b5563; font-weight: 500;">${SUPPORT_EMAIL}</a>
              </p>
              <p style="margin: 0; font-size: 11px; color: #9ca3af;">
                &copy; ${new Date().getFullYear()} ${STORE_NAME}. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

  // Concise, highly informative SMS
  const greetingName = firstName || customerFullName;
  const text = `${STORE_NAME}: Hi ${greetingName}, order ${orderNumber} placed. Total: ${formatAmount(totalAmount, currency)}, remaining balance: ${formatAmount(remainingBalance, currency)}. Complete payment securely here: ${paymentLink}`;

  return { html, text };
}

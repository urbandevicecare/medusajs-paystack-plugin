export function getPaymentRequiredTemplate(orderData: any, paymentLink: string, remainingBalance: number) {
  const STORE_NAME = process.env.STORE_NAME || "Your Store";
  const STORE_TAGLINE = process.env.STORE_TAGLINE || "Your Premium Store";

  const currencyCode = orderData.currency_code ? orderData.currency_code.toUpperCase() : "USD";

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111; line-height: 1.5; max-width: 500px; margin: 0 auto; padding: 20px;">
      <h2 style="font-weight: 600; font-size: 24px; margin-bottom: 16px;">Action Required: Payment Pending</h2>
      <p style="color: #444; margin-bottom: 24px;">Thank you for your order <strong>#${orderData.display_id || orderData.id}</strong>. We noticed you have an outstanding balance.</p>
      <div style="background-color: #f5f5f7; padding: 16px; border-radius: 8px; margin-bottom: 24px;">
        <p style="margin: 0; font-weight: 500;">Remaining Balance: ${currencyCode} ${remainingBalance}</p>
      </div>
      <p style="color: #444; font-size: 14px;">To complete your purchase, please securely pay your balance using the link below:</p>
      
      <div style="margin-top: 20px; padding: 15px; background-color: #e0f2fe; border-radius: 8px; border: 1px solid #bae6fd;">
        <p style="margin: 0 0 10px 0; font-weight: bold; color: #0284c7;">Complete Your Payment</p>
        <p style="margin: 0;"><a href="${paymentLink}" style="color: #0369a1; text-decoration: underline;">${paymentLink}</a></p>
      </div>
      
      <p style="color: #444; font-size: 14px; margin-top: 24px;">Once your payment is complete, we'll continue processing your order.</p>
      <hr style="border: 0; border-top: 1px solid #eaeaea; margin: 32px 0;" />
      <p style="font-size: 12px; color: #888;">${STORE_NAME} - ${STORE_TAGLINE}</p>
    </div>`;

  const text = `${STORE_NAME}: Order #${orderData.display_id || orderData.id} has an outstanding balance of ${currencyCode} ${remainingBalance}. Please pay securely here: ${paymentLink}`;

  return { html, text };
}

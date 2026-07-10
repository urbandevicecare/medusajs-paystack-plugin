import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import crypto from "crypto"
import { getPaymentRequiredTemplate } from "../templates/payment-link"

export default async function paymentLinkSubscriber({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger")
  const query = container.resolve("query")
  
  logger.info(`[Paystack-Plugin] Checking order.placed event for unpaid balances (Order: ${data.id})`)

  // Retrieve full order data
  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "display_id",
      "email",
      "currency_code",
      "total",
      "payment_collections.payments.amount",
      "payment_collections.payments.captured_at",
      "payment_collections.payments.canceled_at",
      "shipping_address.phone"
    ],
    filters: {
      id: data.id,
    },
  }).catch(err => {
    logger.error(`[Paystack-Plugin] Failed to query order in subscriber: ${err}`)
    return { data: [] }
  })

  if (!orders || orders.length === 0) {
    logger.error(`[Paystack-Plugin] Order ${data.id} not found`)
    return
  }

  const order = orders[0]

  // Calculate remaining balance
  let capturedAmountRaw = 0;
  if (order.payment_collections) {
    for (const pc of order.payment_collections as any[]) {
      if (pc.payments) {
        capturedAmountRaw += pc.payments.reduce((acc: number, p: any) => {
          const isPaid = p.captured_at || !p.canceled_at;
          return acc + (isPaid ? Number(p.amount) : 0);
        }, 0);
      }
    }
  }

  const remainingBalanceRaw = Math.max(0, (order.total as number) - capturedAmountRaw);

  if (remainingBalanceRaw <= 0) {
    logger.info(`[Paystack-Plugin] Order ${order.id} is fully paid. No payment link notification needed.`);
    return;
  }

  // Generate HMAC hash
  const secretKey = process.env.MEDUSA_PUBLISHABLE_KEY;
  if (!secretKey) {
    logger.error("[Paystack-Plugin] Missing MEDUSA_PUBLISHABLE_KEY for HMAC generation")
    return
  }

  const hash = crypto.createHmac('sha256', secretKey)
    .update(order.id)
    .digest('hex');

  const storefrontUrl = process.env.STOREFRONT_URL || "http://localhost:5173"
  const paymentLink = `${storefrontUrl}/pay/${hash}/${order.id}`
  
  const notificationService = container.resolve("notification")
  const templatePayload = getPaymentRequiredTemplate(order, paymentLink, remainingBalanceRaw)
  const notificationSubject = `Action Required: Payment Pending for Order #${order.display_id || order.id}`
  
  // 1. Send SMS
  const phone = (order.shipping_address as any)?.phone
  if (phone) {
    try {
      await notificationService.createNotifications({
        to: phone,
        template: "paystack-payment-required", // The template name passed to the provider
        channel: "sms",
        data: {
          message: templatePayload.text
        },
      })
      logger.info(`[Paystack-Plugin] Payment link SMS queued for ${phone}`)
    } catch (e: any) {
      logger.error(`[Paystack-Plugin] Failed to send SMS to ${phone}: ${e.message}`)
    }
  } else {
    logger.info(`[Paystack-Plugin] No phone number found for order ${order.id}, skipping SMS`)
  }

  // 2. Send Email
  if (order.email) {
    try {
      await notificationService.createNotifications({
        to: order.email as string,
        template: "paystack-payment-required",
        channel: "email",
        content: {
          subject: notificationSubject,
          html: templatePayload.html,
        },
        data: {
          order_id: order.id,
          remaining_balance: remainingBalanceRaw,
          currency_code: order.currency_code,
          payment_link: paymentLink,
          message: templatePayload.text
        },
      })
      logger.info(`[Paystack-Plugin] Payment link Email queued for ${order.email}`)
    } catch (e: any) {
      logger.error(`[Paystack-Plugin] Failed to send Email to ${order.email}: ${e.message}`)
    }
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}

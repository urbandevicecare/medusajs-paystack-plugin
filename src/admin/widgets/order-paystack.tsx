import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { DetailWidgetProps, AdminOrder } from "@medusajs/framework/types"
import { Container, Heading, Text, Button, Input } from "@medusajs/ui"
import { useState } from "react"

import Medusa from "@medusajs/js-sdk"

const sdk = new Medusa({
  baseUrl: "/",
  debug: false,
  auth: {
    type: "session",
  },
})

const OrderPaystackWidget = ({ data }: DetailWidgetProps<AdminOrder>) => {
  const initialPhone = 
    (data as any)?.shipping_address?.phone || 
    (data as any)?.billing_address?.phone || 
    (data as any)?.customer?.phone || 
    "";

  const [phone, setPhone] = useState(initialPhone)
  const [amount, setAmount] = useState<string>("")
  const [isLoading, setIsLoading] = useState(false)
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null)

  const handleStkPush = async () => {
    if (!phone) return
    setIsLoading(true)
    setFeedback(null)

    try {
      const payload: { order_id: string; phone: string; amount?: number } = {
        order_id: data.id,
        phone,
      }

      if (amount && Number(amount) > 0) {
        payload.amount = Number(amount)
      }

      const res: any = await sdk.client.fetch(`/admin/paystack/stk-push`, { 
        method: "POST", 
        body: payload,
      })

      const displayMsg = res?.message || `STK push initiated to ${phone}`
      setFeedback({ type: "success", message: displayMsg })
    } catch (e: any) {
      console.error("STK Push error:", e)
      const errorMsg = e?.message || e?.response?.data?.message || "Failed to initiate STK Push"
      setFeedback({ type: "error", message: errorMsg })
    } finally {
      setIsLoading(false)
    }
  }

  const currencyCode = (data as any)?.currency_code?.toUpperCase() || "KES"

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Paystack - STK Push</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Prompt customer for payment via M-Pesa / Mobile Money ({currencyCode}).
          </Text>
        </div>
      </div>
      <div className="flex flex-col gap-y-4 px-6 py-4">
        {feedback && (
          <div 
            className={`p-3 rounded-md text-sm ${
              feedback.type === "success" 
                ? "bg-ui-bg-subtle-pressed text-ui-fg-interactive border border-ui-border-interactive" 
                : "bg-ui-bg-error-subtle text-ui-fg-error border border-ui-border-error"
            }`}
          >
            {feedback.message}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Text size="xsmall" className="text-ui-fg-subtle mb-1">Phone Number</Text>
            <Input 
              placeholder="e.g. 0712345678 or +254..." 
              value={phone} 
              onChange={(e) => setPhone(e.target.value)} 
            />
          </div>
          <div>
            <Text size="xsmall" className="text-ui-fg-subtle mb-1">Amount ({currencyCode}, leave blank for full)</Text>
            <Input 
              type="number"
              placeholder={`Order Total: ${(data as any)?.total || 0}`} 
              value={amount} 
              onChange={(e) => setAmount(e.target.value)} 
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button 
            variant="primary" 
            size="small" 
            onClick={handleStkPush} 
            isLoading={isLoading} 
            disabled={!phone || isLoading}
          >
            Send STK Push Prompt
          </Button>
        </div>
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.after",
})

export default OrderPaystackWidget

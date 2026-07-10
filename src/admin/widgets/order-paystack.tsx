import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { DetailWidgetProps, AdminOrder } from "@medusajs/framework/types"
import { Container, Heading, Text, Button, Input } from "@medusajs/ui"
import { useState } from "react"

import { sdk } from "../lib/client"

const OrderPaystackWidget = ({ data }: DetailWidgetProps<AdminOrder>) => {
  const [phone, setPhone] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  const handleStkPush = async () => {
    if (!phone) return
    setIsLoading(true)
    try {
      // Call the admin API route
      await sdk.client.fetch(`/admin/paystack/stk-push`, { 
        method: "POST", 
        body: { order_id: data.id, phone } 
      })
      alert(`STK Push initiated successfully to phone ${phone}`)
      setPhone("")
    } catch (e: any) {
      console.error(e)
      alert(e.message || "Failed to initiate STK Push")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Paystack - STK Push</Heading>
      </div>
      <div className="flex flex-col gap-y-4 px-6 py-4">
        <Text size="small" className="text-ui-fg-subtle">
          Initiate a manual STK Push to collect payment via M-Pesa for this order.
        </Text>
        <div className="flex items-center gap-2">
          <Input 
            placeholder="Phone Number (e.g. 2547...)" 
            value={phone} 
            onChange={(e) => setPhone(e.target.value)} 
          />
          <Button variant="secondary" size="small" onClick={handleStkPush} isLoading={isLoading} disabled={!phone}>
            Send STK Push
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

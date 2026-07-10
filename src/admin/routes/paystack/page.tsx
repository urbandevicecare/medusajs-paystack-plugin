import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Text } from "@medusajs/ui"
import { CreditCard } from "@medusajs/icons"

const PaystackDashboard = () => {
  return (
    <div className="flex flex-col gap-y-4">
      <Container className="p-6 flex flex-col gap-y-4">
        <Heading level="h1">Paystack Dashboard</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          View your Paystack transaction analytics and manage your payment settings here.
        </Text>
      </Container>
      <Container className="p-6">
        <Heading level="h2" className="mb-4">Recent Transactions</Heading>
        <Text size="small" className="text-ui-fg-muted italic">
          No recent transactions found or backend integration is not fully wired up.
        </Text>
      </Container>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Paystack",
  icon: CreditCard,
})

export default PaystackDashboard

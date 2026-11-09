import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Text, Button } from "@medusajs/ui"
import { CreditCard } from "@medusajs/icons"
import { useState, useEffect } from "react"
import Medusa from "@medusajs/js-sdk"

const sdk = new Medusa({
  baseUrl: "/",
  debug: false,
  auth: {
    type: "session",
  },
})

const PaystackBalanceWidget = () => {
  const [balance, setBalance] = useState<any[] | null>(null)
  const [balanceError, setBalanceError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchBalance = async () => {
    setLoading(true)
    try {
      const res: any = await sdk.client.fetch(`/admin/paystack/balance`, { method: "GET" })
      if (res?.data?.balance) {
        setBalance(res.data.balance)
        setBalanceError(null)
      } else if (res?.data?.balanceError) {
        setBalanceError(res.data.balanceError)
      }
    } catch (e: any) {
      setBalanceError(e?.message || "Failed to load Paystack balance")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchBalance()
  }, [])

  return (
    <Container className="p-4 mb-4 border border-ui-border-base rounded-lg bg-ui-bg-subtle">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-x-3">
          <div className="p-2 rounded-md bg-ui-bg-base border border-ui-border-base text-ui-fg-interactive">
            <CreditCard />
          </div>
          <div>
            <Text size="xsmall" className="text-ui-fg-subtle uppercase tracking-wider font-medium">
              Live Paystack Balance
            </Text>
            {loading ? (
              <Text size="small" className="text-ui-fg-muted">Fetching balance...</Text>
            ) : balance && balance.length > 0 ? (
              <div className="flex flex-wrap items-baseline gap-2">
                <Heading level="h3" className="text-ui-fg-base">
                  {balance[0].currency} {balance[0].formatted || (Number(balance[0].balance) / 100).toFixed(2)}
                </Heading>
                {balance.length > 1 && (
                  <div className="flex gap-1.5">
                    {balance.slice(1).map((b: any) => (
                      <span
                        key={b.currency}
                        className="text-xs px-1.5 py-0.5 rounded bg-ui-bg-base border text-ui-fg-subtle"
                      >
                        {b.currency}: {b.formatted || (Number(b.balance) / 100).toFixed(2)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : balanceError ? (
              <Text size="small" className="text-ui-fg-error">{balanceError}</Text>
            ) : (
              <Heading level="h3" className="text-ui-fg-muted">0.00</Heading>
            )}
          </div>
        </div>

        <Button
          variant="transparent"
          size="small"
          onClick={fetchBalance}
          isLoading={loading}
          className="text-ui-fg-muted hover:text-ui-fg-base text-xs"
        >
          Refresh
        </Button>
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: ["order.list", "order.list.before"],
})

export default PaystackBalanceWidget

import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Text, Table, Select, Tabs, Button, Input, Label, Badge, StatusBadge, toast } from "@medusajs/ui"
import { CreditCard } from "@medusajs/icons"
import { useState, useEffect, useRef } from "react"
import Medusa from "@medusajs/js-sdk"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"

const sdk = new Medusa({
  baseUrl: "/",
  debug: false,
  auth: {
    type: "session",
  },
})

const PaystackDashboard = () => {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [graphView, setGraphView] = useState<"dailyGraph" | "weeklyGraph" | "monthlyGraph" | "yearlyGraph">("monthlyGraph")
  const [activeTab, setActiveTab] = useState<string>("analytics")
  const [refreshingBalance, setRefreshingBalance] = useState(false)
  const [refreshingTransactions, setRefreshingTransactions] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("success")
  const [visibleCount, setVisibleCount] = useState(20)
  const loadMoreRef = useRef<HTMLDivElement>(null)

  const [settings, setSettings] = useState({ companyName: "", storefrontUrl: "", secretKey: "" })
  const [saving, setSaving] = useState(false)
  const [loadingSettings, setLoadingSettings] = useState(true)

  const MAX_ROWS = 100
  const allTransactions = (data?.transactions || data?.payments || []) as any[]
  const filteredTransactions = allTransactions.filter((tx: any) => {
    if (statusFilter !== "all" && (tx.status || "").toLowerCase() !== statusFilter) {
      return false
    }
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase().trim()
    const ref = (tx.reference || tx.id || "").toLowerCase()
    const email = (tx.customer?.email || "").toLowerCase()
    const phone = (tx.customer?.phone || "").toLowerCase()
    const orderDisplay = String(tx.order?.display_id ?? tx.payment_collection?.order?.display_id ?? "").toLowerCase()
    const repairTicket = String(tx.repair?.ticket_number || tx.repair?.id || "").toLowerCase()
    return ref.includes(q) || email.includes(q) || phone.includes(q) || orderDisplay.includes(q) || repairTicket.includes(q)
  })

  const cappedTransactions = filteredTransactions.slice(0, MAX_ROWS)
  const visibleTransactions = cappedTransactions.slice(0, visibleCount)

  useEffect(() => {
    setVisibleCount(20)
  }, [searchQuery, statusFilter, data])

  useEffect(() => {
    if (!loadMoreRef.current) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((prev) => {
            if (prev < cappedTransactions.length) {
              return Math.min(prev + 20, cappedTransactions.length)
            }
            return prev
          })
        }
      },
      { rootMargin: "120px" }
    )

    observer.observe(loadMoreRef.current)
    return () => observer.disconnect()
  }, [cappedTransactions.length])

  const loadDashboardData = async () => {
    try {
      const res: any = await sdk.client.fetch(`/admin/paystack/dashboard`, { method: "GET" })
      if (res?.data) {
        setData(res.data)
      }
    } catch (e) {
      console.error("Failed to load dashboard data", e)
    } finally {
      setLoading(false)
    }
  }

  const handleRefreshBalance = async () => {
    setRefreshingBalance(true)
    try {
      const res: any = await sdk.client.fetch(`/admin/paystack/balance`, { method: "GET" })
      if (res?.data) {
        setData((prev: any) => ({
          ...prev,
          balance: res.data.balance,
          balanceError: res.data.balanceError,
        }))
        if (res.data.balanceError) {
          toast.error(res.data.balanceError)
        } else {
          toast.success("Paystack balance updated")
        }
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to refresh balance")
      // Fallback to reloading full dashboard
      await loadDashboardData()
    } finally {
      setRefreshingBalance(false)
    }
  }

  const handleRefreshTransactions = async () => {
    setRefreshingTransactions(true)
    try {
      await loadDashboardData()
      toast.success("Paystack transactions refreshed")
    } catch {
      toast.error("Failed to refresh transactions")
    } finally {
      setRefreshingTransactions(false)
    }
  }

  const transactions = data?.transactions || data?.payments || []

  useEffect(() => {
    loadDashboardData()

    sdk.client.fetch(`/admin/paystack/settings`, { method: "GET" })
      .then((res: any) => {
        if (res.data) {
          setSettings(res.data)
        }
      })
      .catch((e) => console.error("Failed to load settings", e))
      .finally(() => setLoadingSettings(false))
  }, [])

  const handleSaveSettings = async () => {
    setSaving(true)
    try {
      await sdk.client.fetch(`/admin/paystack/settings`, { 
        method: "POST",
        body: settings 
      })
      toast.success("Settings saved successfully")
      // Reload dashboard data so live balance is re-fetched with the newly saved key
      loadDashboardData()
    } catch (e) {
      toast.error("Failed to save settings")
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-y-4">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <Tabs.List className="mb-4">
          <Tabs.Trigger value="analytics">Analytics</Tabs.Trigger>
          <Tabs.Trigger value="settings">Settings</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="analytics" className="flex flex-col gap-y-4">
          <Container className="p-6 flex flex-col gap-y-4">
            <Heading level="h1">Paystack Dashboard</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              View your Paystack transaction analytics and manage your payment settings here.
            </Text>
            {loading ? (
              <Text size="small">Loading dashboard data...</Text>
            ) : (
              <div className="flex flex-col gap-y-8 mt-4">
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="p-4 border rounded-lg flex-1">
                    <Text size="small" className="text-ui-fg-subtle">Total Paystack Revenue</Text>
                    <Heading level="h2">{data?.totalRevenue != null ? Number(data.totalRevenue).toFixed(2) : "0.00"}</Heading>
                  </div>

                  <div className="p-4 border rounded-lg flex-1 flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <Text size="small" className="text-ui-fg-subtle">Live Paystack Balance</Text>
                      <Button
                        variant="transparent"
                        size="small"
                        onClick={handleRefreshBalance}
                        isLoading={refreshingBalance}
                        className="text-ui-fg-muted hover:text-ui-fg-base h-6 px-2 text-xs"
                      >
                        Refresh
                      </Button>
                    </div>

                    {data?.balance && data.balance.length > 0 ? (
                      <div className="flex flex-wrap items-baseline gap-3 mt-1">
                        <Heading level="h2">
                          {data.balance[0].currency} {data.balance[0].formatted || (Number(data.balance[0].balance) / 100).toFixed(2)}
                        </Heading>
                        {data.balance.length > 1 && (
                          <div className="flex flex-wrap gap-2">
                            {data.balance.slice(1).map((b: any) => (
                              <span
                                key={b.currency}
                                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-ui-bg-subtle text-ui-fg-subtle border border-ui-border-base"
                              >
                                {b.currency}: {b.formatted || (Number(b.balance) / 100).toFixed(2)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : data?.balanceError ? (
                      <div className="flex flex-col gap-y-1 mt-1">
                        <Text size="small" className="text-ui-fg-error">
                          {data.balanceError}
                        </Text>
                        <Button
                          variant="secondary"
                          size="small"
                          className="w-fit text-xs mt-1"
                          onClick={() => setActiveTab("settings")}
                        >
                          Configure in Settings
                        </Button>
                      </div>
                    ) : (
                      <Heading level="h2" className="text-ui-fg-muted mt-1">
                        0.00
                      </Heading>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-y-4">
                  <div className="flex items-center justify-between">
                    <Heading level="h2">Revenue Chart</Heading>
                    <div className="w-[150px]">
                      <Select value={graphView} onValueChange={(v: any) => setGraphView(v)}>
                        <Select.Trigger>
                          <Select.Value />
                        </Select.Trigger>
                        <Select.Content>
                          <Select.Item value="dailyGraph">Daily</Select.Item>
                          <Select.Item value="weeklyGraph">Weekly</Select.Item>
                          <Select.Item value="monthlyGraph">Monthly</Select.Item>
                          <Select.Item value="yearlyGraph">Yearly</Select.Item>
                        </Select.Content>
                      </Select>
                    </div>
                  </div>
                  <div className="w-full h-[300px]">
                    {data?.[graphView] && data[graphView].length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data[graphView]}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6B7280' }} dy={10} />
                          <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6B7280' }} dx={-10} />
                          <Tooltip cursor={{ fill: '#F3F4F6' }} contentStyle={{ borderRadius: '8px', border: '1px solid #E5E7EB', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                          <Bar dataKey="total" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gray-50 rounded-lg">
                        <Text className="text-ui-fg-muted">No data available for this view.</Text>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </Container>
          <Container className="p-0">
            <div className="p-6 border-b border-ui-border-base flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <Heading level="h2">Recent Transactions</Heading>
                <Text size="small" className="text-ui-fg-subtle mt-0.5">
                  Live payments processed via Paystack (synced with Medusa orders & Mobile Money).
                </Text>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="small"
                  onClick={async () => {
                    setRefreshingTransactions(true);
                    await loadDashboardData();
                    setRefreshingTransactions(false);
                    toast.success("Transactions refreshed");
                  }}
                  isLoading={refreshingTransactions}
                >
                  Refresh Transactions
                </Button>
              </div>
            </div>

            {data?.transactionsError && (
              <div className="p-4 m-6 rounded-md bg-ui-bg-error-subtle border border-ui-border-error flex items-center justify-between">
                <Text size="small" className="text-ui-fg-error">
                  Paystack Notice: {data.transactionsError}
                </Text>
                <Button variant="secondary" size="small" onClick={() => setActiveTab("settings")}>
                  Check Settings
                </Button>
              </div>
            )}

            <div className="px-6 py-3 border-b border-ui-border-base bg-ui-bg-subtle flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="flex-1 max-w-sm">
                <Input
                  placeholder="Search reference, email, phone, or order #"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  size="small"
                />
              </div>
              <div className="flex items-center gap-2">
                <Text size="xsmall" className="text-ui-fg-subtle whitespace-nowrap">Filter Status:</Text>
                <div className="w-[130px]">
                  <Select value={statusFilter} onValueChange={(val: any) => setStatusFilter(val)}>
                    <Select.Trigger size="small">
                      <Select.Value />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value="all">All Statuses</Select.Item>
                      <Select.Item value="success">Success</Select.Item>
                      <Select.Item value="failed">Failed</Select.Item>
                      <Select.Item value="abandoned">Abandoned</Select.Item>
                    </Select.Content>
                  </Select>
                </div>
              </div>
            </div>

            {!loading && filteredTransactions.length === 0 ? (
              <div className="p-8 text-center flex flex-col items-center">
                <Text size="small" className="text-ui-fg-muted italic">
                  {searchQuery || statusFilter !== "all"
                    ? `No ${statusFilter !== "all" ? statusFilter : ""} transactions match your search or filter criteria.`
                    : "No transactions found on this Paystack account."}
                </Text>
                {statusFilter !== "all" && (
                  <Button
                    variant="secondary"
                    size="small"
                    className="mt-3"
                    onClick={() => setStatusFilter("all")}
                  >
                    View All Statuses
                  </Button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <Table.Header>
                    <Table.Row>
                      <Table.HeaderCell>Reference</Table.HeaderCell>
                      <Table.HeaderCell>Order / Repair</Table.HeaderCell>
                      <Table.HeaderCell>Customer</Table.HeaderCell>
                      <Table.HeaderCell>Channel</Table.HeaderCell>
                      <Table.HeaderCell>Status</Table.HeaderCell>
                      <Table.HeaderCell className="text-right">Amount</Table.HeaderCell>
                      <Table.HeaderCell className="text-right">Date</Table.HeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {visibleTransactions.map((tx: any) => {
                      const orderDisplayId = tx.order?.display_id ?? tx.payment_collection?.order?.display_id;
                      const orderId = tx.order?.id ?? tx.payment_collection?.order?.id;
                      const repairTicketNumber = tx.repair?.ticket_number;
                      const repairId = tx.repair?.id;

                      return (
                        <Table.Row key={tx.id || tx.reference}>
                          <Table.Cell>
                            <Text size="small" className="font-mono text-ui-fg-base font-medium">
                              {tx.reference || tx.id}
                            </Text>
                          </Table.Cell>
                          <Table.Cell>
                            {repairTicketNumber ? (
                              <a
                                href={`/repairs/${repairId || ""}`}
                                className="inline-flex items-center gap-1 font-medium text-sm text-ui-fg-interactive hover:underline"
                              >
                                <Badge color="blue" size="small">
                                  Repair #{repairTicketNumber}
                                </Badge>
                              </a>
                            ) : orderDisplayId != null ? (
                              <a
                                href={`/orders/${orderId || ""}`}
                                className="inline-flex items-center gap-1 font-medium text-sm text-ui-fg-interactive hover:underline"
                              >
                                <Badge color="grey" size="small">
                                  #{orderDisplayId}
                                </Badge>
                              </a>
                            ) : (
                              <Text size="xsmall" className="text-ui-fg-subtle italic">
                                Direct / Standalone
                              </Text>
                            )}
                          </Table.Cell>
                          <Table.Cell>
                            <div className="flex flex-col">
                              <Text size="small" className="text-ui-fg-base font-medium truncate max-w-[180px]">
                                {tx.customer?.email || tx.customer?.name || "—"}
                              </Text>
                              {tx.customer?.phone && (
                                <Text size="xsmall" className="text-ui-fg-subtle">
                                  {tx.customer.phone}
                                </Text>
                              )}
                            </div>
                          </Table.Cell>
                          <Table.Cell>
                            <span className="text-xs font-medium text-ui-fg-subtle capitalize">
                              {tx.channel === "mobile_money"
                                ? "M-Pesa / Mobile Money"
                                : tx.channel === "card"
                                ? "Card"
                                : tx.channel === "bank_transfer"
                                ? "Bank Transfer"
                                : tx.channel || "Paystack"}
                            </span>
                          </Table.Cell>
                          <Table.Cell>
                            {tx.status === "success" ? (
                              <Badge color="green" size="small">Success</Badge>
                            ) : tx.status === "failed" ? (
                              <Badge color="red" size="small">Failed</Badge>
                            ) : (
                              <Badge color="grey" size="small">{tx.status || "Pending"}</Badge>
                            )}
                          </Table.Cell>
                          <Table.Cell className="text-right">
                            <Text size="small" className="font-semibold text-ui-fg-base">
                              {tx.currency_code?.toUpperCase()} {Number(tx.amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </Text>
                          </Table.Cell>
                          <Table.Cell className="text-right">
                            <Text size="xsmall" className="text-ui-fg-subtle whitespace-nowrap">
                              {tx.created_at ? new Date(tx.created_at).toLocaleString() : "—"}
                            </Text>
                          </Table.Cell>
                        </Table.Row>
                      );
                    })}
                  </Table.Body>
                </Table>

                {/* Infinite scroll sentinel & progress indicator */}
                {visibleCount < cappedTransactions.length ? (
                  <div ref={loadMoreRef} className="py-4 text-center border-t border-ui-border-base bg-ui-bg-subtle/40">
                    <Text size="xsmall" className="text-ui-fg-muted animate-pulse font-medium">
                      Loading more transactions ({visibleTransactions.length} of {cappedTransactions.length})...
                    </Text>
                  </div>
                ) : cappedTransactions.length > 0 ? (
                  <div className="py-3 px-6 bg-ui-bg-subtle border-t border-ui-border-base flex items-center justify-between text-ui-fg-subtle">
                    <Text size="xsmall">
                      Showing all {cappedTransactions.length} transaction{cappedTransactions.length === 1 ? "" : "s"}
                      {filteredTransactions.length > MAX_ROWS ? ` (capped at top ${MAX_ROWS})` : ""}
                    </Text>
                    {filteredTransactions.length > MAX_ROWS && (
                      <Text size="xsmall" className="italic text-ui-fg-muted">
                        Capped at top 100 recent transactions
                      </Text>
                    )}
                  </div>
                ) : null}
              </div>
            )}
          </Container>
        </Tabs.Content>

        <Tabs.Content value="settings">
          <Container className="p-6 flex flex-col gap-y-6">
            <div>
              <Heading level="h1">Plugin Settings</Heading>
              <Text size="small" className="text-ui-fg-subtle mt-1">
                Configure your company details and storefront URLs for payment link generation.
                If left blank, these will default to your .env variables (STORE_NAME and STOREFRONT_URL).
              </Text>
            </div>

            {loadingSettings ? (
              <Text size="small">Loading settings...</Text>
            ) : (
              <div className="flex flex-col gap-y-4 max-w-[600px]">
                <div className="flex flex-col gap-y-2">
                  <Label htmlFor="companyName">Company Name</Label>
                  <Input 
                    id="companyName" 
                    placeholder="e.g. Urban Device Care" 
                    value={settings.companyName || ""} 
                    onChange={(e) => setSettings({ ...settings, companyName: e.target.value })}
                  />
                  <Text size="small" className="text-ui-fg-muted">
                    This name appears in email and SMS payment notifications.
                  </Text>
                </div>

                <div className="flex flex-col gap-y-2">
                  <Label htmlFor="storefrontUrl">Storefront URL</Label>
                  <Input 
                    id="storefrontUrl" 
                    placeholder="e.g. https://my-store.com" 
                    value={settings.storefrontUrl || ""} 
                    onChange={(e) => setSettings({ ...settings, storefrontUrl: e.target.value })}
                  />
                  <Text size="small" className="text-ui-fg-muted">
                    The base URL where the payment link points (e.g., https://my-store.com).
                  </Text>
                </div>

                <div className="flex flex-col gap-y-2 mt-4 pt-4 border-t border-ui-border-base">
                  <Label htmlFor="secretKey">Paystack Secret Key</Label>
                  <Input 
                    id="secretKey" 
                    type="password"
                    placeholder="sk_test_..." 
                    value={settings.secretKey || ""} 
                    onChange={(e) => setSettings({ ...settings, secretKey: e.target.value })}
                  />
                  <Text size="small" className="text-ui-fg-muted">
                    Overrides the PAYSTACK_SECRET_KEY in your .env file. Useful for rotating keys without restarting the server. Leave blank to use .env value.
                  </Text>
                </div>

                <div className="flex justify-end mt-4">
                  <Button variant="primary" onClick={handleSaveSettings} isLoading={saving}>
                    Save Settings
                  </Button>
                </div>
              </div>
            )}
          </Container>
        </Tabs.Content>
      </Tabs>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Paystack",
  icon: CreditCard,
})

export default PaystackDashboard

import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Text, Table, Select } from "@medusajs/ui"
import { CreditCard } from "@medusajs/icons"
import { useState, useEffect } from "react"
import { sdk } from "../../lib/client"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"

const PaystackDashboard = () => {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [graphView, setGraphView] = useState<"dailyGraph" | "weeklyGraph" | "monthlyGraph" | "yearlyGraph">("monthlyGraph")

  useEffect(() => {
    sdk.client.fetch(`/admin/paystack/dashboard`, { method: "GET" })
      .then((res: any) => {
        setData(res.data)
      })
      .catch((e) => console.error("Failed to load dashboard data", e))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="flex flex-col gap-y-4">
      <Container className="p-6 flex flex-col gap-y-4">
        <Heading level="h1">Paystack Dashboard</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          View your Paystack transaction analytics and manage your payment settings here.
        </Text>
        {loading ? (
          <Text size="small">Loading dashboard data...</Text>
        ) : (
          <div className="flex flex-col gap-y-8 mt-4">
            <div className="flex gap-4">
              <div className="p-4 border rounded-lg flex-1">
                <Text size="small" className="text-ui-fg-subtle">Total Medusa Revenue</Text>
                <Heading level="h2">{data?.totalRevenue ? (data.totalRevenue / 100).toFixed(2) : 0}</Heading>
              </div>
              {data?.balance && (
                <div className="p-4 border rounded-lg flex-1">
                  <Text size="small" className="text-ui-fg-subtle">Live Paystack Balance</Text>
                  <Heading level="h2">
                    {data.balance[0]?.currency} {data.balance[0]?.balance ? (data.balance[0].balance / 100).toFixed(2) : 0}
                  </Heading>
                </div>
              )}
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
        <div className="p-6">
          <Heading level="h2" className="mb-4">Recent Transactions</Heading>
          {!loading && data?.payments?.length === 0 && (
            <Text size="small" className="text-ui-fg-muted italic">
              No recent transactions found.
            </Text>
          )}
        </div>
        {!loading && data?.payments?.length > 0 && (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Order</Table.HeaderCell>
                <Table.HeaderCell>Amount</Table.HeaderCell>
                <Table.HeaderCell>Date</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {data.payments.slice(0, 10).map((payment: any) => (
                <Table.Row key={payment.id}>
                  <Table.Cell>#{payment.payment_collection?.order?.display_id || "N/A"}</Table.Cell>
                  <Table.Cell>{(payment.amount / 100).toFixed(2)} {payment.currency_code?.toUpperCase()}</Table.Cell>
                  <Table.Cell>{new Date(payment.created_at).toLocaleDateString()}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Container>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Paystack",
  icon: CreditCard,
})

export default PaystackDashboard

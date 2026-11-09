import test from "node:test";
import assert from "node:assert";
import axios from "axios";
import { GET as getBalance } from "../admin/paystack/balance/route.ts";
import { GET as getDashboard } from "../admin/paystack/dashboard/route.ts";
import { POST as verifyRoute } from "../store/paystack/verify/route.ts";
import syncPaystackTransactions from "../../jobs/sync-paystack-transactions.ts";
import { reconcileAndCapturePaystackPayment } from "../../providers/paystack/utils/reconcile-payment.ts";

test("Balance Route - unconfigured secret key returns friendly status", async () => {
  const originalEnv = { ...process.env };
  delete process.env.PAYSTACK_SECRET_KEY;
  delete process.env.PAYSTACK_TEST_SECRET_KEY;
  delete process.env.PAYSTACK_KEY;
  delete process.env.PAYSTACK_SECRET_KEY_URBANDEVICECARE;

  try {
    const req: any = {
      scope: {
        resolve(key: string) {
          if (key === "query") {
            return {
              graph: async () => ({ data: [] }),
            };
          }
          if (key === "store") {
            return {
              listStores: async () => [],
            };
          }
          return {};
        },
      },
    };

    let statusCode = 0;
    let jsonResponse: any = null;
    const res: any = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(data: any) {
        jsonResponse = data;
        return this;
      },
    };

    await getBalance(req, res);
    assert.strictEqual(statusCode, 200);
    assert.strictEqual(jsonResponse.success, false);
    assert.strictEqual(jsonResponse.data.configured, false);
    assert.strictEqual(jsonResponse.data.balance, null);
    assert.strictEqual(jsonResponse.data.balanceError, "Secret key not configured");
  } finally {
    process.env = originalEnv;
  }
});

test("Balance Route - multi-currency retrieval and formatting", async () => {
  const originalCreate = axios.create;
  (axios as any).create = () => ({
    get: async (url: string) => {
      if (url === "/balance") {
        return {
          data: {
            status: true,
            message: "Balances retrieved",
            data: [
              { currency: "KES", balance: 1542050 }, // 15,420.50
              { currency: "NGN", balance: 5000000 }, // 50,000.00
              { currency: "RWF", balance: 120000 },  // zero-decimal: 120,000
            ],
          },
        };
      }
      return { data: {} };
    },
    post: async () => ({ data: {} }),
  });

  try {
    const req: any = {
      scope: {
        resolve(key: string) {
          if (key === "query") {
            return {
              graph: async () => ({
                data: [{ metadata: { paystack_secret_key: "sk_test_mock_123" } }],
              }),
            };
          }
          return {};
        },
      },
    };

    let statusCode = 0;
    let jsonResponse: any = null;
    const res: any = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(data: any) {
        jsonResponse = data;
        return this;
      },
    };

    await getBalance(req, res);
    assert.strictEqual(statusCode, 200);
    assert.strictEqual(jsonResponse.success, true);
    assert.strictEqual(jsonResponse.data.configured, true);
    assert.strictEqual(jsonResponse.data.balance.length, 3);

    // KES balance check
    assert.strictEqual(jsonResponse.data.balance[0].currency, "KES");
    assert.strictEqual(jsonResponse.data.balance[0].amount, 15420.50);
    assert.strictEqual(jsonResponse.data.balance[0].formatted, "15,420.50");

    // NGN balance check
    assert.strictEqual(jsonResponse.data.balance[1].currency, "NGN");
    assert.strictEqual(jsonResponse.data.balance[1].amount, 50000);
    assert.strictEqual(jsonResponse.data.balance[1].formatted, "50,000.00");

    // RWF (zero-decimal) balance check
    assert.strictEqual(jsonResponse.data.balance[2].currency, "RWF");
    assert.strictEqual(jsonResponse.data.balance[2].amount, 120000);
    assert.strictEqual(jsonResponse.data.balance[2].formatted, "120,000");
  } finally {
    axios.create = originalCreate;
  }
});

test("Dashboard Route - includes normalized balance and revenue graphs", async () => {
  const originalCreate = axios.create;
  (axios as any).create = () => ({
    get: async (url: string) => {
      if (url === "/balance") {
        return {
          data: {
            status: true,
            message: "Balances retrieved",
            data: [{ currency: "KES", balance: 250000 }],
          },
        };
      }
      return { data: {} };
    },
    post: async () => ({ data: {} }),
  });

  try {
    const req: any = {
      scope: {
        resolve(key: string) {
          if (key === "query") {
            return {
              graph: async ({ entity }: any) => {
                if (entity === "payment") {
                  return {
                    data: [
                      {
                        id: "pay_1",
                        amount: 2500,
                        currency_code: "KES",
                        created_at: new Date().toISOString(),
                        payment_collection: { order: { id: "order_1", display_id: 1001 } },
                      },
                    ],
                  };
                }
                if (entity === "store") {
                  return {
                    data: [{ metadata: { paystack_secret_key: "sk_test_dashboard_key" } }],
                  };
                }
                return { data: [] };
              },
            };
          }
          return {};
        },
      },
    };

    let statusCode = 0;
    let jsonResponse: any = null;
    const res: any = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(data: any) {
        jsonResponse = data;
        return this;
      },
    };

    await getDashboard(req, res);
    assert.strictEqual(statusCode, 200);
    assert.strictEqual(jsonResponse.success, true);
    assert.strictEqual(jsonResponse.data.totalRevenue, 2500);
    assert.ok(Array.isArray(jsonResponse.data.balance));
    assert.strictEqual(jsonResponse.data.balance[0].currency, "KES");
    assert.strictEqual(jsonResponse.data.balance[0].amount, 2500);
    assert.strictEqual(jsonResponse.data.balance[0].formatted, "2,500.00");
    assert.strictEqual(jsonResponse.data.balanceError, null);
  } finally {
    axios.create = originalCreate;
  }
});

test("Auto-Deduct / Mark As Paid via Verify Route", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    if (url.toString().includes("paystack.co/transaction/verify/TX_AUTO_RECON_789")) {
      return new Response(
        JSON.stringify({
          status: true,
          message: "Verification successful",
          data: {
            status: "success",
            reference: "TX_AUTO_RECON_789",
            amount: 350000, // 3500 KES
            currency: "KES",
            metadata: {
              order_id: "order_reconcile_test",
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify({ status: false }), { status: 400 });
  }) as any;

  let authorizedSessionId: string | null = null;
  let capturedPaymentId: string | null = null;

  try {
    const req: any = {
      body: { reference: "TX_AUTO_RECON_789" },
      scope: {
        resolve(key: string) {
          if (key === "query") {
            return {
              graph: async ({ entity }: any) => {
                if (entity === "store") {
                  return { data: [{ metadata: { paystack_secret_key: "sk_test_key" } }] };
                }
                if (entity === "order") {
                  return {
                    data: [
                      {
                        id: "order_reconcile_test",
                        total: 3500,
                        currency_code: "KES",
                        payment_collections: [
                          {
                            id: "paycol_rec_1",
                            amount: 3500,
                            captured_amount: 0,
                            status: "not_paid",
                            payment_sessions: [
                              {
                                id: "payses_rec_1",
                                provider_id: "paystack",
                                status: "pending",
                                data: { paystackTxRef: "TX_AUTO_RECON_789" },
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  };
                }
                return { data: [] };
              },
            };
          }
          if (key === "payment") {
            return {
              authorizePaymentSession: async (sessionId: string) => {
                authorizedSessionId = sessionId;
                return {
                  id: "pay_captured_123",
                  amount: 3500,
                  captured_at: new Date().toISOString(),
                };
              },
              capturePayment: async (opts: any) => {
                capturedPaymentId = opts.payment_id;
                return { id: opts.payment_id, captured_at: new Date().toISOString() };
              },
            };
          }
          return {};
        },
      },
    };

    let statusCode = 0;
    let jsonResponse: any = null;
    const res: any = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(data: any) {
        jsonResponse = data;
        return this;
      },
    };

    await verifyRoute(req, res);
    assert.strictEqual(statusCode, 200);
    assert.strictEqual(jsonResponse.success, true);
    assert.strictEqual(jsonResponse.status, "success");
    assert.strictEqual(jsonResponse.captured, true);
    assert.strictEqual(authorizedSessionId, "payses_rec_1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Cron Job Reconciliation - captures in-flight sessions and unpaid orders", async () => {
  let authorizedSessions: string[] = [];
  let capturedPayments: string[] = [];

  const mockContainer: any = {
    resolve(key: string) {
      if (key === "logger") {
        return {
          info: () => {},
          debug: () => {},
          error: () => {},
        };
      }
      if (key === "query") {
        return {
          graph: async ({ entity, filters }: any) => {
            if (entity === "payment_session") {
              return {
                data: [
                  {
                    id: "payses_cron_1",
                    status: "pending",
                    provider_id: "paystack",
                    created_at: new Date(Date.now() - 120000).toISOString(), // 2 minutes ago
                    data: { paystackTxRef: "ref_cron_test" },
                  },
                ],
              };
            }
            if (entity === "order") {
              return {
                data: [
                  {
                    id: "order_cron_unpaid",
                    total: 5000,
                    currency_code: "KES",
                    payment_collections: [
                      {
                        id: "paycol_cron_unpaid",
                        status: "not_paid",
                        amount: 5000,
                        captured_amount: 0,
                        payment_sessions: [
                          {
                            id: "payses_cron_unpaid_1",
                            provider_id: "paystack",
                            status: "pending",
                            data: { paystackTxRef: "ref_cron_unpaid" },
                          },
                        ],
                      },
                    ],
                  },
                ],
              };
            }
            return { data: [] };
          },
        };
      }
      if (key === "payment") {
        return {
          authorizePaymentSession: async (sessionId: string) => {
            authorizedSessions.push(sessionId);
            return {
              id: `payment_${sessionId}`,
              amount: 5000,
              captured_at: sessionId === "payses_cron_1" ? new Date().toISOString() : null, // one already captured, one needs capture
            };
          },
          capturePayment: async (opts: any) => {
            capturedPayments.push(opts.payment_id);
            return { id: opts.payment_id, captured_at: new Date().toISOString() };
          },
        };
      }
      return {};
    },
  };

  await syncPaystackTransactions(mockContainer);

  // Both the pending payment_session and the unpaid order session were authorized
  assert.ok(authorizedSessions.includes("payses_cron_1"));
  assert.ok(authorizedSessions.includes("payses_cron_unpaid_1"));
  // Session that did not have captured_at was explicitly captured
  assert.ok(capturedPayments.includes("payment_payses_cron_unpaid_1"));
});

test("reconcileAndCapturePaystackPayment - skips already fully paid orders", async () => {
  const container: any = {
    resolve(key: string) {
      if (key === "logger") return { info: () => {}, warn: () => {}, error: () => {} };
      if (key === "query") {
        return {
          graph: async () => ({
            data: [
              {
                id: "order_paid_already",
                total: 1000,
                payment_collections: [
                  {
                    id: "paycol_already_paid",
                    amount: 1000,
                    captured_amount: 1000,
                  },
                ],
              },
            ],
          }),
        };
      }
      return {};
    },
  };

  const res = await reconcileAndCapturePaystackPayment({
    container,
    orderId: "order_paid_already",
    reference: "any_ref",
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.captured, true);
  assert.strictEqual(res.message, "Order already fully paid");
});

test("Balance Route - single object balance payload normalization", async () => {
  const originalCreate = axios.create;
  (axios as any).create = () => ({
    get: async (url: string) => {
      if (url === "/balance") {
        return {
          data: {
            status: true,
            message: "Balances retrieved",
            // Single object instead of array
            data: { currency: "KES", balance: 750000 },
          },
        };
      }
      return { data: {} };
    },
    post: async () => ({ data: {} }),
  });

  try {
    const req: any = {
      scope: {
        resolve: () => ({
          graph: async () => ({
            data: [{ metadata: { paystack_secret_key: "sk_test_mock_single" } }],
          }),
        }),
      },
    };

    let statusCode = 0;
    let jsonResponse: any = null;
    const res: any = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(data: any) {
        jsonResponse = data;
        return this;
      },
    };

    await getBalance(req, res);
    assert.strictEqual(statusCode, 200);
    assert.strictEqual(jsonResponse.success, true);
    assert.strictEqual(jsonResponse.data.balance.length, 1);
    assert.strictEqual(jsonResponse.data.balance[0].currency, "KES");
    assert.strictEqual(jsonResponse.data.balance[0].amount, 7500);
    assert.strictEqual(jsonResponse.data.balance[0].formatted, "7,500.00");
  } finally {
    axios.create = originalCreate;
  }
});

test("Balance Route - API network failure returns error details gracefully", async () => {
  const originalCreate = axios.create;
  (axios as any).create = () => ({
    get: async () => {
      const err: any = new Error("Network timeout connecting to api.paystack.co");
      err.response = { data: { message: "Connection timed out" } };
      throw err;
    },
    post: async () => ({ data: {} }),
  });

  try {
    const req: any = {
      scope: {
        resolve: () => ({
          graph: async () => ({
            data: [{ metadata: { paystack_secret_key: "sk_test_timeout" } }],
          }),
        }),
      },
    };

    let statusCode = 0;
    let jsonResponse: any = null;
    const res: any = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(data: any) {
        jsonResponse = data;
        return this;
      },
    };

    await getBalance(req, res);
    assert.strictEqual(statusCode, 500);
    assert.strictEqual(jsonResponse.success, false);
    assert.strictEqual(jsonResponse.data.balance, null);
    assert.strictEqual(jsonResponse.data.balanceError, "Connection timed out");
  } finally {
    axios.create = originalCreate;
  }
});

test("Webhook Handler - resolves sessionId via order_id and captures payment", async () => {
  const PaystackPaymentProvider = (await import("../../providers/paystack/paystack-provider.ts")).default;

  let authorizedSessionId: string | null = null;
  const mockContainer: any = {
    query: {
      graph: async ({ entity }: any) => {
        if (entity === "payment_session") {
          return {
            data: [
              {
                id: "payses_webhook_match",
                provider_id: "paystack",
                data: { paystackTxRef: "STK_WEBHOOK_REF_123" },
              },
            ],
          };
        }
        if (entity === "order") {
          return {
            data: [
              {
                id: "order_webhook_123",
                total: 2000,
                currency_code: "KES",
                payment_collections: [
                  {
                    id: "paycol_webhook_123",
                    amount: 2000,
                    captured_amount: 0,
                    payment_sessions: [{ id: "payses_webhook_match", provider_id: "paystack" }],
                  },
                ],
              },
            ],
          };
        }
        return { data: [] };
      },
    },
    resolve(key: string) {
      if (key === "payment") {
        return {
          authorizePaymentSession: async (sId: string) => {
            authorizedSessionId = sId;
            return { id: "pay_1", amount: 2000, captured_at: new Date().toISOString() };
          },
        };
      }
      if (key === "logger") {
        return { info: () => {}, warn: () => {}, error: () => {} };
      }
      return {};
    },
  };

  const provider = new PaystackPaymentProvider(mockContainer, {
    secret_key: "sk_test_webhook_secret_key",
  });

  const rawPayload = {
    event: "charge.success",
    data: {
      reference: "STK_WEBHOOK_REF_123",
      amount: 200000, // 2000 KES
      currency: "KES",
      metadata: {
        order_id: "order_webhook_123",
        // Notice: session_id is deliberately omitted to test fallback resolution!
      },
    },
  };

  const crypto = await import("crypto");
  const signature = crypto
    .createHmac("sha512", "sk_test_webhook_secret_key")
    .update(JSON.stringify(rawPayload))
    .digest("hex");

  const result = await provider.getWebhookActionAndData({
    rawData: JSON.stringify(rawPayload),
    data: rawPayload,
    headers: {
      "x-paystack-signature": signature,
    },
  } as any);

  assert.strictEqual(result.action, "captured");
  assert.strictEqual((result.data as any).session_id, "payses_webhook_match");
  assert.strictEqual((result.data as any).amount, 2000);
});

test("Balance Route - empty balance array normalization to store currency", async () => {
  const originalCreate = axios.create;
  (axios as any).create = () => ({
    get: async (url: string) => {
      if (url === "/balance") {
        return {
          data: {
            status: true,
            message: "Balances retrieved",
            data: [], // Empty array returned by Paystack for new account
          },
        };
      }
      return { data: {} };
    },
    post: async () => ({ data: {} }),
  });

  try {
    const req: any = {
      scope: {
        resolve: (key: string) => {
          if (key === "query") {
            return {
              graph: async () => ({
                data: [
                  {
                    default_currency_code: "kes",
                    metadata: { paystack_secret_key: "sk_test_empty_balance" },
                  },
                ],
              }),
            };
          }
          return {};
        },
      },
    };

    let statusCode = 0;
    let jsonResponse: any = null;
    const res: any = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(data: any) {
        jsonResponse = data;
        return this;
      },
    };

    await getBalance(req, res);
    assert.strictEqual(statusCode, 200);
    assert.strictEqual(jsonResponse.success, true);
    assert.strictEqual(jsonResponse.data.configured, true);
    assert.strictEqual(jsonResponse.data.balance.length, 1);
    assert.strictEqual(jsonResponse.data.balance[0].currency, "KES");
    assert.strictEqual(jsonResponse.data.balance[0].amount, 0);
    assert.strictEqual(jsonResponse.data.balance[0].formatted, "0.00");
  } finally {
    axios.create = originalCreate;
  }
});

test("Balance Route - multi-currency sorting prioritizes positive balances over 0 NGN", async () => {
  const originalCreate = axios.create;
  (axios as any).create = () => ({
    get: async (url: string) => {
      if (url === "/balance") {
        return {
          data: {
            status: true,
            message: "Balances retrieved",
            data: [
              { currency: "NGN", balance: 0 },
              { currency: "KES", balance: 450000 }, // 4500 KES
            ],
          },
        };
      }
      return { data: {} };
    },
    post: async () => ({ data: {} }),
  });

  try {
    const req: any = {
      scope: {
        resolve: () => ({
          graph: async () => ({
            data: [{ metadata: { paystack_secret_key: "sk_test_sort_key" } }],
          }),
        }),
      },
    };

    let statusCode = 0;
    let jsonResponse: any = null;
    const res: any = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(data: any) {
        jsonResponse = data;
        return this;
      },
    };

    await getBalance(req, res);
    assert.strictEqual(statusCode, 200);
    assert.strictEqual(jsonResponse.success, true);
    assert.strictEqual(jsonResponse.data.balance.length, 2);
    // Active balance in KES was prioritized ahead of 0 NGN
    assert.strictEqual(jsonResponse.data.balance[0].currency, "KES");
    assert.strictEqual(jsonResponse.data.balance[0].amount, 4500);
    assert.strictEqual(jsonResponse.data.balance[1].currency, "NGN");
    assert.strictEqual(jsonResponse.data.balance[1].amount, 0);
  } finally {
    axios.create = originalCreate;
  }
});

test("reconcileAndCapturePaystackPayment - prioritizes exact reference session match over preceding pending session", async () => {
  let authorizedSessionId: string | null = null;
  const container: any = {
    resolve(key: string) {
      if (key === "logger") return { info: () => {}, warn: () => {}, error: () => {} };
      if (key === "query") {
        return {
          graph: async () => ({
            data: [
              {
                id: "order_multi_session",
                total: 2000,
                currency_code: "KES",
                payment_collections: [
                  {
                    id: "paycol_multi",
                    amount: 2000,
                    captured_amount: 0,
                    payment_sessions: [
                      {
                        id: "payses_old_abandoned",
                        provider_id: "paystack",
                        status: "pending",
                        data: { paystackTxRef: "OLD_ABANDONED_REF" },
                      },
                      {
                        id: "payses_exact_match",
                        provider_id: "paystack",
                        status: "pending",
                        data: { paystackTxRef: "EXACT_TARGET_REF" },
                      },
                    ],
                  },
                ],
              },
            ],
          }),
        };
      }
      if (key === "payment") {
        return {
          authorizePaymentSession: async (sId: string) => {
            authorizedSessionId = sId;
            return { id: "pay_captured_exact", amount: 2000, captured_at: new Date().toISOString() };
          },
        };
      }
      return {};
    },
  };

  const res = await reconcileAndCapturePaystackPayment({
    container,
    orderId: "order_multi_session",
    reference: "EXACT_TARGET_REF",
  });

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.captured, true);
  // Must match the exact session, NOT the old abandoned one!
  assert.strictEqual(authorizedSessionId, "payses_exact_match");
});

test("Cron Job Reconciliation - captures sessionless unpaid order with metadata paystack_reference", async () => {
  let createdSessionCollectionId: string | null = null;
  let authorizedSessionId: string | null = null;

  const mockContainer: any = {
    resolve(key: string) {
      if (key === "logger") {
        return { info: () => {}, debug: () => {}, error: () => {} };
      }
      if (key === "query") {
        return {
          graph: async ({ entity }: any) => {
            if (entity === "payment_session") {
              return { data: [] };
            }
            if (entity === "order") {
              return {
                data: [
                  {
                    id: "order_no_sessions_but_metadata",
                    total: 3000,
                    currency_code: "KES",
                    metadata: { paystack_reference: "REF_METADATA_ONLY" },
                    payment_collections: [
                      {
                        id: "paycol_sessionless",
                        status: "not_paid",
                        amount: 3000,
                        captured_amount: 0,
                        payment_sessions: [], // NO sessions!
                      },
                    ],
                  },
                ],
              };
            }
            return { data: [] };
          },
        };
      }
      if (key === "payment") {
        return {
          createPaymentSession: async (colId: string, opts: any) => {
            createdSessionCollectionId = colId;
            return { id: "payses_newly_created", ...opts };
          },
          authorizePaymentSession: async (sId: string) => {
            authorizedSessionId = sId;
            return { id: "pay_sessionless_capt", amount: 3000, captured_at: new Date().toISOString() };
          },
        };
      }
      return {};
    },
  };

  await syncPaystackTransactions(mockContainer);

  assert.strictEqual(createdSessionCollectionId, "paycol_sessionless");
  assert.strictEqual(authorizedSessionId, "payses_newly_created");
});


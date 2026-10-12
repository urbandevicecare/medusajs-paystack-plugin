import test from "node:test";
import assert from "node:assert";
import { POST as stkPushAdmin } from "../admin/paystack/stk-push/route.ts";
import { GET as getSettings, POST as postSettings } from "../admin/paystack/settings/route.ts";
import { POST as customPaymentStore } from "../store/paystack/custom-payment/route.ts";

test("STK Push Admin Route - validation errors", async () => {
  const req: any = { body: {} };
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

  await stkPushAdmin(req, res);
  assert.strictEqual(statusCode, 400);
  assert.strictEqual(jsonResponse.message, "order_id and phone are required");
});

test("STK Push Admin Route - order not found", async () => {
  const req: any = {
    body: { order_id: "order_non_existent", phone: "0712345678" },
    scope: {
      resolve(key: string) {
        if (key === "order") {
          return {
            retrieveOrder: async () => null,
          };
        }
        if (key === "query") {
          return {
            graph: async () => ({ data: [] }),
          };
        }
        if (key === "pg_connection") {
          return () => ({
            where: () => ({
              orWhere: () => ({
                limit: async () => [],
              }),
            }),
          });
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

  await stkPushAdmin(req, res);
  assert.strictEqual(statusCode, 404);
  assert.strictEqual(jsonResponse.message, "Order not found");
});

test("STK Push Admin Route - successful initiation", async () => {
  // Mock global fetch for Paystack charge API
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (url.toString().includes("paystack.co/charge")) {
      return new Response(
        JSON.stringify({
          status: true,
          message: "Charge attempted",
          data: {
            display_text: "Please enter your M-Pesa PIN",
            status: "pay_offline",
            reference: "STK-test-ref",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return originalFetch(url, init);
  }) as any;

  try {
    const req: any = {
      body: { order_id: "order_test_123", phone: "0712345678", amount: 1500 },
      scope: {
        resolve(key: string) {
          if (key === "order") {
            return {
              retrieveOrder: async () => ({
                id: "order_test_123",
                display_id: 123,
                currency_code: "KES",
                email: "customer@example.com",
                total: 1500,
              }),
            };
          }
          if (key === "query") {
            return {
              graph: async ({ entity }: any) => {
                if (entity === "store") {
                  return { data: [{ metadata: { paystack_secret_key: "sk_test_mock_key" } }] };
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

    await stkPushAdmin(req, res);
    assert.strictEqual(statusCode, 200);
    assert.strictEqual(jsonResponse.success, true);
    assert.match(jsonResponse.message, /Please/);
    assert.strictEqual(jsonResponse.data.reference, "STK-test-ref");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("STK Push Admin Route - Paystack decline detailed message extraction", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (url.toString().includes("paystack.co/charge")) {
      return new Response(
        JSON.stringify({
          status: false,
          message: "Charge attempted",
          data: {
            reference: "pepc7e4eqywghc8",
            status: "failed",
            message: "Declined. Please use the test mobile money number since you are doing a test transaction."
          },
          type: "api_error",
          code: "unprocessed_transaction"
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    return originalFetch(url, init);
  }) as any;

  try {
    const req: any = {
      body: { order_id: "order_test_123", phone: "0712345678", amount: 1500 },
      scope: {
        resolve(key: string) {
          if (key === "order") {
            return {
              retrieveOrder: async () => ({
                id: "order_test_123",
                display_id: 123,
                currency_code: "KES",
                email: "customer@example.com",
                total: 1500,
              }),
            };
          }
          if (key === "query") {
            return {
              graph: async ({ entity }: any) => {
                if (entity === "store") {
                  return { data: [{ metadata: { paystack_secret_key: "sk_test_mock_key" } }] };
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

    await stkPushAdmin(req, res);
    assert.strictEqual(statusCode, 400);
    assert.strictEqual(jsonResponse.message, "Declined. Please use the test mobile money number since you are doing a test transaction.");
    assert.strictEqual(jsonResponse.data.data.status, "failed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Settings Route - GET & POST", async () => {
  let storedMetadata: any = {
    paystack_company_name: "Original Name",
    paystack_storefront_url: "https://original.com",
    paystack_secret_key: "sk_test_original",
  };

  const storeServiceMock = {
    listStores: async () => [{ id: "store_123", metadata: storedMetadata }],
    updateStores: async (_id: string, update: any) => {
      storedMetadata = update.metadata;
      return { id: "store_123", metadata: storedMetadata };
    },
  };

  // Test GET
  const getReq: any = {
    scope: {
      resolve: () => storeServiceMock,
    },
  };

  let getCode = 0;
  let getResponse: any = null;
  const getRes: any = {
    status(code: number) {
      getCode = code;
      return this;
    },
    json(data: any) {
      getResponse = data;
      return this;
    },
  };

  await getSettings(getReq, getRes);
  assert.strictEqual(getCode, 200);
  assert.strictEqual(getResponse.data.companyName, "Original Name");

  // Test POST update
  const postReq: any = {
    body: {
      companyName: "Updated Care",
      storefrontUrl: "https://updated.com",
      secretKey: "sk_test_newkey",
    },
    scope: {
      resolve: () => storeServiceMock,
    },
  };

  let postCode = 0;
  let postResponse: any = null;
  const postRes: any = {
    status(code: number) {
      postCode = code;
      return this;
    },
    json(data: any) {
      postResponse = data;
      return this;
    },
  };

  await postSettings(postReq, postRes);
  assert.strictEqual(postCode, 200);
  assert.strictEqual(postResponse.data.companyName, "Updated Care");
  assert.strictEqual(storedMetadata.paystack_company_name, "Updated Care");
  assert.strictEqual(storedMetadata.paystack_secret_key, "sk_test_newkey");
});

test("Custom Payment Route - Popup Initialization", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (url.toString().includes("paystack.co/transaction/initialize")) {
      return new Response(
        JSON.stringify({
          status: true,
          message: "Authorization URL created",
          data: {
            authorization_url: "https://checkout.paystack.com/popup-mock",
            access_code: "access-code-12345",
            reference: "ORD-mock-ref",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return originalFetch(url, init);
  }) as any;

  try {
    const req: any = {
      body: { order_id: "order_popup_123", amount: 5000 },
      scope: {
        resolve(key: string) {
          if (key === "order") {
            return {
              retrieveOrder: async () => ({
                id: "order_popup_123",
                display_id: 999,
                currency_code: "KES",
                email: "popup@example.com",
                total: 5000,
              }),
            };
          }
          if (key === "query") {
            return {
              graph: async ({ entity }: any) => {
                if (entity === "store") {
                  return { data: [{ metadata: { paystack_secret_key: "sk_test_mock_key" } }] };
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

    await customPaymentStore(req, res);
    assert.strictEqual(statusCode, 200);
    assert.strictEqual(jsonResponse.success, true);
    assert.strictEqual(jsonResponse.access_code, "access-code-12345");
    assert.strictEqual(jsonResponse.paymentSession.access_code, "access-code-12345");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

import { POST as stkPushStore } from "../store/paystack/stk-push/route.ts";
import { POST as verifyRoute } from "../store/paystack/verify/route.ts";
import { getPaymentRequiredTemplate } from "../../templates/payment-link.ts";
import crypto from "crypto";

test("Storefront STK Push Route - Successful execution", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (url.toString().includes("paystack.co/charge")) {
      return new Response(
        JSON.stringify({
          status: true,
          message: "Charge attempted",
          data: {
            display_text: "Please enter your M-Pesa PIN on your phone",
            status: "pay_offline",
            reference: "STK-store-ref",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return originalFetch(url, init);
  }) as any;

  try {
    const req: any = {
      body: { order_id: "order_store_999", phone: "0798765432", amount: 2000 },
      scope: {
        resolve(key: string) {
          if (key === "order") {
            return {
              retrieveOrder: async () => ({
                id: "order_store_999",
                display_id: 999,
                currency_code: "KES",
                email: "customer@urbandevicecare.co.uk",
                total: 2000,
              }),
            };
          }
          if (key === "query") {
            return {
              graph: async ({ entity }: any) => {
                if (entity === "store") {
                  return { data: [{ metadata: { paystack_secret_key: "sk_test_store_mock" } }] };
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

    await stkPushStore(req, res);
    assert.strictEqual(statusCode, 200);
    assert.strictEqual(jsonResponse.success, true);
    assert.match(jsonResponse.message, /Please enter your M-Pesa PIN/);
    assert.strictEqual(jsonResponse.data.reference, "STK-store-ref");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Verify Transaction Route - Success and Error handling", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (url.toString().includes("paystack.co/transaction/verify/TX_SUCCESS_123")) {
      return new Response(
        JSON.stringify({
          status: true,
          message: "Verification successful",
          data: {
            status: "success",
            reference: "TX_SUCCESS_123",
            amount: 500000,
            currency: "KES",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return originalFetch(url, init);
  }) as any;

  try {
    const req: any = {
      body: { reference: "TX_SUCCESS_123" },
      scope: {
        resolve(key: string) {
          if (key === "query") {
            return {
              graph: async ({ entity }: any) => {
                if (entity === "store") {
                  return { data: [{ metadata: { paystack_secret_key: "sk_test_verify_mock" } }] };
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

    await verifyRoute(req, res);
    assert.strictEqual(statusCode, 200);
    assert.strictEqual(jsonResponse.success, true);
    assert.strictEqual(jsonResponse.status, "success");
    assert.strictEqual(jsonResponse.amount, 5000); // 500000 cents -> 5000 KES
    assert.strictEqual(jsonResponse.currency, "KES");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Payment Link Template & HMAC Hash Consistency", () => {
  const mockOrder = {
    id: "order_test_hash_456",
    display_id: 101,
    currency_code: "KES",
    total: 7500,
    email: "test@urbandevicecare.co.uk",
    customer: { first_name: "Jane", last_name: "Doe" },
    shipping_address: { phone: "+254712345678", address_1: "Moi Avenue", city: "Nairobi" },
    items: [
      { id: "item_1", title: "iPhone Screen Replacement", quantity: 1, unit_price: 7500 }
    ]
  };

  const secretKey = "pk_c7904d9e7fcc12a1a42277a4e0e33e3479c9653efeed505bdc70dc442d21b067";
  const expectedHash = crypto.createHmac("sha256", secretKey).update(mockOrder.id).digest("hex");
  const paymentLink = `https://urbandevicecare.co.uk/pay/${expectedHash}/${mockOrder.id}`;

  const template = getPaymentRequiredTemplate(mockOrder, paymentLink, 7500, "Urban Device Care");

  // Verify email template contains payment link, currency, total, customer greeting
  assert.ok(template.html.includes(paymentLink));
  assert.ok(template.html.includes("KES 7,500.00"));
  assert.ok(template.html.includes("Jane"));
  assert.ok(template.html.includes("iPhone Screen Replacement"));

  // Verify SMS text is concise and contains the exact link
  assert.ok(template.text.includes(paymentLink));
  assert.ok(template.text.includes("Jane"));
  assert.ok(template.text.includes("KES 7,500.00"));
});


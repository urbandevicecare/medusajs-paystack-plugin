import crypto from "crypto";

import PaystackClient from "./services/paystack-client";
import { getPaystackAmount, getMedusaAmount } from "./utils/currency";

import {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
  CancelPaymentInput,
  CancelPaymentOutput,
  ProviderWebhookPayload,
} from "@medusajs/types";
import {
  MedusaError,
  PaymentSessionStatus,
  AbstractPaymentProvider,
  PaymentActions,
} from "@medusajs/framework/utils";

export type PaystackPaymentProviderSessionData = {
  paystackTxRef: string;
  paystackTxAccessCode: string;
  paystackTxAuthorizationUrl: string;
};

export type AuthorizedPaystackPaymentProviderSessionData =
  PaystackPaymentProviderSessionData & {
    paystackTxId: number;
    paystackTxData: Record<string, unknown>;
  };

export interface PaystackPaymentProcessorConfig extends Record<string, unknown> {
  secret_key: string;
  public_key?: string;
  debug?: boolean;
}

class PaystackPaymentProvider extends AbstractPaymentProvider<PaystackPaymentProcessorConfig> {
  // IMPORTANT: Leave this generic. Medusa V2 resolves multiple accounts by concatenating the config 'id' with this static identifier.
  // E.g. Config id "apple_4all" + identifier "paystack" = "apple_4all_paystack"
  static identifier = "paystack";

  protected readonly configuration: PaystackPaymentProcessorConfig;
  protected readonly paystack: PaystackClient;
  protected readonly debug: boolean;

  static validateOptions(options: PaystackPaymentProcessorConfig): void {
    const secretKey =
      options?.secret_key ||
      (options as any)?.secretKey ||
      (options as any)?.apiKey ||
      process.env.PAYSTACK_SECRET_KEY ||
      process.env.PAYSTACK_TEST_SECRET_KEY ||
      process.env.PAYSTACK_KEY;

    if (!secretKey) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        "The Paystack provider requires the secret_key option (or PAYSTACK_SECRET_KEY in environment)",
      );
    }
  }

  constructor(
    container: Record<string, unknown>,
    options: PaystackPaymentProcessorConfig,
  ) {
    super(container, options);

    const secretKey =
      options?.secret_key ||
      (options as any)?.secretKey ||
      (options as any)?.apiKey ||
      process.env.PAYSTACK_SECRET_KEY ||
      process.env.PAYSTACK_TEST_SECRET_KEY ||
      process.env.PAYSTACK_KEY;

    if (!secretKey) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        "The Paystack provider requires the secret_key option",
      );
    }

    this.configuration = { ...options, secret_key: secretKey };
    this.paystack = new PaystackClient(secretKey);
    this.debug = Boolean(options.debug);
  }

  async initiatePayment(
    input: InitiatePaymentInput,
  ): Promise<InitiatePaymentOutput> {
    if (this.debug) {
      console.info("PS_P_Debug: InitiatePayment", JSON.stringify(input, null, 2));
    }

    const { data, amount, currency_code } = input;
    const contextAny = input.context as any;
    const email =
      (data?.email as string) ||
      (contextAny?.email as string) ||
      (contextAny?.customer?.email as string) ||
      (contextAny?.billing_address?.email as string) ||
      (contextAny?.account_holder?.data?.email as string);
    const session_id = data?.session_id as string | undefined;

    // In Medusa v2 checkout, payment sessions can be initialized before a guest customer enters their email.
    // Return a pending session placeholder so cart creation succeeds; updatePayment will initialize with Paystack once email is provided.
    if (!email && !data?.stk_push) {
      return {
        id: session_id || `ps_pending_${Date.now()}`,
        status: PaymentSessionStatus.PENDING,
        data: {
          ...data,
          emailPending: true,
        } as any,
      };
    }

    try {
      const paystackAmount = getPaystackAmount(Number(amount), currency_code);

      if (data?.stk_push) {
        // Skip calling Paystack's initialize endpoint if this is an STK Push.
        // The STK Push route handles the actual Paystack charge creation.
        return {
          id: (data.paystackTxRef as string) || `stk_${Date.now()}`,
          status: PaymentSessionStatus.PENDING_AUTHORIZATION,
          data: {
            ...data,
            paystackTxRef: data.paystackTxRef as string,
          } as PaystackPaymentProviderSessionData,
        };
      }

      // Generate Custom Reference
      const randomSuffix = Math.floor(10000 + Math.random() * 90000);
      const resourceId = (contextAny?.resource_id as string) || (data?.session_id as string) || (contextAny?.payment_collection?.id as string) || "";
      const displayId = data?.display_id || contextAny?.order?.display_id || contextAny?.payment_collection?.order?.display_id || "";
      
      let customReference = "";
      if (resourceId.startsWith("order_")) {
        const strippedId = resourceId.replace("order_", "");
        customReference = displayId ? `${displayId}-${strippedId}-${randomSuffix}` : `${strippedId}-${randomSuffix}`;
      } else if (resourceId.startsWith("cart_")) {
        const strippedId = resourceId.replace("cart_", "");
        customReference = `${strippedId}-${randomSuffix}`;
      } else if (resourceId) {
        const strippedId = resourceId.replace(/^(cart_|order_|paycol_)/, "");
        customReference = displayId ? `${displayId}-${strippedId}-${randomSuffix}` : `${strippedId}-${randomSuffix}`;
      } else {
        customReference = `ref-${Date.now()}-${randomSuffix}`;
      }

      const response = await this.paystack.transaction.initialize({
        amount: paystackAmount,
        email: email as string,
        currency: (currency_code || "NGN").toUpperCase(),
        reference: customReference,
        metadata: {
          session_id,
          ...data,
        },
      });

      if (!response.status) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "Failed to initiate Paystack payment",
          response.message,
        );
      }

      return {
        id: response.data.reference,
        status: PaymentSessionStatus.PENDING,
        data: {
          paystackTxRef: response.data.reference,
          paystackTxAccessCode: response.data.access_code,
          paystackTxAuthorizationUrl: response.data.authorization_url,
        } satisfies PaystackPaymentProviderSessionData,
      };
    } catch (error: any) {
      if (this.debug) console.error("PS_P_Debug: InitiatePayment: Error", error);
      const errMsg = error?.response?.data?.message || error?.message || error?.toString() || "Unknown error";
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Failed to initiate Paystack payment",
        errMsg,
      );
    }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    if (this.debug) console.info("PS_P_Debug: UpdatePayment", JSON.stringify(input, null, 2));

    // Paystack doesn't support updating transaction amounts. 
    // We abandon the current one and create a new one.
    const session = await this.initiatePayment(input);

    return {
      data: session.data,
      status: session.status,
    };
  }

  async authorizePayment(
    input: AuthorizePaymentInput,
  ): Promise<AuthorizePaymentOutput> {
    if (this.debug) console.info("PS_P_Debug: AuthorizePayment", JSON.stringify(input, null, 2));

    try {
      const { paystackTxRef } = input.data as PaystackPaymentProviderSessionData;

      if (!paystackTxRef) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Missing paystackTxRef in payment data.",
        );
      }

      const response = await this.paystack.transaction.verify({ reference: paystackTxRef });

      if (!response.status) {
        return {
          status: PaymentSessionStatus.ERROR,
          data: { ...input.data, paystackTxId: response.data?.id, paystackTxData: response.data },
        };
      }

      switch (response.data.status) {
        case "success":
          return {
            status: PaymentSessionStatus.CAPTURED,
            data: {
              ...input.data,
              paystackTxId: response.data.id,
              paystackTxData: response.data,
            },
          };
        case "failed":
          return {
            status: PaymentSessionStatus.ERROR,
            data: { ...input.data, paystackTxId: response.data?.id, paystackTxData: response.data },
          };
        case "pay_offline":
        case "pending":
          return {
            status: PaymentSessionStatus.PENDING_AUTHORIZATION,
            data: { ...input.data, paystackTxId: response.data?.id, paystackTxData: response.data },
          };
        default:
          return {
            status: PaymentSessionStatus.PENDING,
            data: { ...input.data, paystackTxId: response.data?.id, paystackTxData: response.data },
          };
      }
    } catch (error: any) {
      if (this.debug) console.error("PS_P_Debug: AuthorizePayment: Error", error);
      const errMsg = error?.response?.data?.message || error?.message || error?.toString() || "Unknown error";
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Failed to authorize payment",
        errMsg,
      );
    }
  }

  async retrievePayment(
    input: RetrievePaymentInput,
  ): Promise<RetrievePaymentOutput> {
    if (this.debug) console.info("PS_P_Debug: RetrievePayment", JSON.stringify(input, null, 2));

    try {
      const { paystackTxId, paystackTxRef } = input.data as AuthorizedPaystackPaymentProviderSessionData;

      if (!paystackTxId && !paystackTxRef) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Missing paystackTxId or paystackTxRef in payment data.",
        );
      }

      const response = paystackTxId 
        ? await this.paystack.transaction.get({ id: paystackTxId })
        : await this.paystack.transaction.verify({ reference: paystackTxRef });

      if (!response.status) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "Failed to retrieve payment",
          response.message,
        );
      }

      return {
        data: {
          ...input.data,
          paystackTxData: response.data,
        },
      };
    } catch (error: any) {
      if (this.debug) console.error("PS_P_Debug: RetrievePayment: Error", error);
      const errMsg = error?.response?.data?.message || error?.message || error?.toString() || "Unknown error";
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Failed to retrieve payment",
        errMsg,
      );
    }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    if (this.debug) console.info("PS_P_Debug: RefundPayment", JSON.stringify(input, null, 2));

    try {
      const { paystackTxId, paystackTxRef } = input.data as AuthorizedPaystackPaymentProviderSessionData;

      if (!paystackTxId && !paystackTxRef) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Missing paystackTxId or paystackTxRef in payment data.",
        );
      }

      const currency = (input.data?.paystackTxData as any)?.currency || "NGN";
      const paystackAmount = getPaystackAmount(Number(input.amount), currency);
      
      const originalAmount = Number((input.data?.paystackTxData as any)?.amount);
      if (originalAmount && paystackAmount > originalAmount) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Cannot refund an amount greater than the original transaction amount.`
        );
      }

      const response = await this.paystack.refund.create({
        transaction: String(paystackTxId || paystackTxRef),
        amount: paystackAmount,
      });

      if (!response.status) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "Failed to refund payment",
          response.message,
        );
      }

      return {
        data: {
          ...input.data,
          paystackRefundData: response.data,
        },
      };
    } catch (error: any) {
      if (this.debug) console.error("PS_P_Debug: RefundPayment: Error", error);
      const errMsg = error?.response?.data?.message || error?.message || error?.toString() || "Unknown error";
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Failed to refund payment",
        errMsg,
      );
    }
  }

  async getPaymentStatus(
    input: GetPaymentStatusInput,
  ): Promise<GetPaymentStatusOutput> {
    if (this.debug) console.info("PS_P_Debug: GetPaymentStatus", JSON.stringify(input, null, 2));

    const { paystackTxId, paystackTxRef } = input.data as AuthorizedPaystackPaymentProviderSessionData;

    if (!paystackTxId && !paystackTxRef) {
      return { status: PaymentSessionStatus.PENDING };
    }

    try {
      const response = paystackTxId
        ? await this.paystack.transaction.get({ id: paystackTxId })
        : await this.paystack.transaction.verify({ reference: paystackTxRef });

      if (!response.status) {
        return { status: PaymentSessionStatus.ERROR };
      }

      switch (response.data?.status) {
        case "success":
          return { status: PaymentSessionStatus.CAPTURED }; 
        case "failed":
          return { status: PaymentSessionStatus.ERROR };
        case "abandoned":
          return { status: PaymentSessionStatus.CANCELED };
        case "pay_offline":
        case "pending":
          return { status: PaymentSessionStatus.PENDING_AUTHORIZATION };
        default:
          return { status: PaymentSessionStatus.PENDING };
      }
    } catch (error: any) {
      if (this.debug) console.error("PS_P_Debug: GetPaymentStatus: Error", error);
      return { status: PaymentSessionStatus.ERROR };
    }
  }

  async getWebhookActionAndData(
    payload: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    if (this.debug) console.info("PS_P_Debug: Webhook", JSON.stringify(payload, null, 2));

    const { data: rawPayloadData, rawData, headers } = (payload || {}) as any;
    const webhookSecretKey = this.configuration.secret_key;

    if (!webhookSecretKey) {
      return { action: PaymentActions.NOT_SUPPORTED };
    }

    const signature = (headers?.["x-paystack-signature"] || headers?.["X-Paystack-Signature"]) as string;
    if (!signature) {
      if (this.debug) console.error("PS_P_Debug: Webhook missing signature header");
      return { action: PaymentActions.NOT_SUPPORTED };
    }

    const rawPayload = typeof rawData === "string" || Buffer.isBuffer(rawData)
      ? rawData
      : JSON.stringify(rawPayloadData || {});

    const hash = crypto
      .createHmac("sha512", webhookSecretKey)
      .update(rawPayload)
      .digest("hex");

    let isSignatureValid = false;
    try {
      const hashBuf = Buffer.from(hash, "hex");
      const sigBuf = Buffer.from(signature, "hex");
      isSignatureValid = hashBuf.length === sigBuf.length && crypto.timingSafeEqual(hashBuf, sigBuf);
    } catch {
      isSignatureValid = hash === signature;
    }

    if (!isSignatureValid) {
      if (this.debug) console.error("PS_P_Debug: Webhook signature mismatch");
      return {
        action: PaymentActions.NOT_SUPPORTED,
      };
    }

    const body = (rawPayloadData || {}) as any;
    const event = body.event;
    const eventData = body.data || {};

    const sessionId = (eventData.metadata?.session_id as string) || undefined;
    if (!sessionId) {
      if (this.debug) console.warn("PS_P_Debug: Webhook event missing session_id in metadata");
      return {
        action: PaymentActions.NOT_SUPPORTED,
      };
    }

    const currency = eventData.currency || "NGN";
    const medusaAmount = getMedusaAmount(Number(eventData.amount || 0), currency);

    if (event === "charge.success") {
      console.info(`[Paystack Webhook] Received charge.success for reference: ${eventData.reference} (Session: ${sessionId})`);
      return {
        action: PaymentActions.SUCCESSFUL,
        data: {
          session_id: sessionId,
          amount: medusaAmount,
        },
      };
    }

    if (event === "charge.failed") {
      console.info(`[Paystack Webhook] Received charge.failed for reference: ${eventData.reference} (Session: ${sessionId})`);
      return {
        action: PaymentActions.FAILED,
        data: {
          session_id: sessionId,
          amount: medusaAmount,
        },
      };
    }

    return {
      action: PaymentActions.NOT_SUPPORTED,
    };
  }

  async capturePayment(
    input: CapturePaymentInput,
  ): Promise<CapturePaymentOutput> {
    return { data: input.data };
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    return { data: input.data };
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: input.data };
  }
}

export default PaystackPaymentProvider;

import axios, { AxiosInstance } from "axios";

export interface InitializePaymentOptions {
  amount: number; // in lowest subunit
  email: string;
  currency: string;
  metadata?: Record<string, unknown>;
  callback_url?: string;
  reference?: string;
}

export interface VerifyPaymentOptions {
  reference: string;
}

export interface RefundPaymentOptions {
  transaction: string;
  amount?: number;
}

export interface GetTransactionOptions {
  id: string | number;
}

export interface ChargePaymentOptions {
  email: string;
  amount: number;
  mobile_money: {
    phone: string;
    provider: string; // e.g. "mpesa"
  };
}

export default class PaystackClient {
  private axios: AxiosInstance;

  constructor(secretKey: string) {
    this.axios = axios.create({
      baseURL: "https://api.paystack.co",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
    });
  }

  public transaction = {
    initialize: async (data: InitializePaymentOptions) => {
      const response = await this.axios.post("/transaction/initialize", data);
      return response.data;
    },
    verify: async ({ reference }: VerifyPaymentOptions) => {
      const response = await this.axios.get(`/transaction/verify/${reference}`);
      return response.data;
    },
    get: async ({ id }: GetTransactionOptions) => {
      const response = await this.axios.get(`/transaction/${id}`);
      return response.data;
    },
  };

  public charge = {
    create: async (data: ChargePaymentOptions) => {
      const response = await this.axios.post("/charge", data);
      return response.data;
    },
  };

  public refund = {
    create: async (data: RefundPaymentOptions) => {
      const response = await this.axios.post("/refund", data);
      return response.data;
    },
  };

  public balance = {
    get: async () => {
      const response = await this.axios.get("/balance");
      return response.data;
    },
  };
}

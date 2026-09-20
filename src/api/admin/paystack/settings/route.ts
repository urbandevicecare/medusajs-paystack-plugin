import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { Modules } from "@medusajs/framework/utils";

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const storeService = req.scope.resolve(Modules.STORE);
    const stores = await storeService.listStores({}, { take: 1 });
    
    if (!stores || stores.length === 0) {
      return res.status(404).json({ message: "Store not found" });
    }

    const store = stores[0];
    const metadata = store.metadata || {};

    res.status(200).json({
      success: true,
      data: {
        companyName: metadata.paystack_company_name || process.env.STORE_NAME || "Urban Device Care",
        storefrontUrl: metadata.paystack_storefront_url || process.env.STOREFRONT_URL || "http://localhost:5173",
        secretKey: metadata.paystack_secret_key || "", // Mask this or return empty if preferring security, but returning it so it populates the field
      }
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Failed to load settings" });
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const storeService = req.scope.resolve(Modules.STORE);
    const stores = await storeService.listStores({}, { take: 1 });
    
    if (!stores || stores.length === 0) {
      return res.status(404).json({ message: "Store not found" });
    }

    const store = stores[0];
    const { companyName, storefrontUrl, secretKey } = req.body as any;
    
    const updatedMetadata: Record<string, any> = {
      ...store.metadata,
      paystack_company_name: companyName,
      paystack_storefront_url: storefrontUrl,
    };
    
    if (secretKey) {
      updatedMetadata.paystack_secret_key = secretKey;
    } else {
      delete updatedMetadata.paystack_secret_key;
    }

    // Update store metadata
    await storeService.updateStores(store.id, {
      metadata: updatedMetadata,
    });

    res.status(200).json({
      success: true,
      data: {
        companyName,
        storefrontUrl,
        secretKey: secretKey ? "********" : "",
      }
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Failed to update settings" });
  }
}

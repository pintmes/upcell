import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

type CompliancePayload = {
  shop_domain?: string;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} compliance webhook for ${shop}`);

  if (topic === "SHOP_REDACT") {
    const body = payload as CompliancePayload;
    const targetShop = body.shop_domain || shop;
    if (targetShop) {
      await db.session.deleteMany({ where: { shop: targetShop } });
    }
  }

  // For CUSTOMERS_DATA_REQUEST and CUSTOMERS_REDACT we currently don't persist
  // customer personal data, so a 200 response is sufficient for compliance.
  return new Response(null, { status: 200 });
};

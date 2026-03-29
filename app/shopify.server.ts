import "@shopify/shopify-app-react-router/adapters/node";
import fs from "node:fs";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

export const MONTHLY_PLAN = "UpsellPro Monthly" as const;
export const LAUNCH_PLAN = "UpsellPro Launch" as const;
const LAUNCH_SHOP_LIMIT = 20;
const BILLING_TRIAL_DAYS = 7;
const SHOPIFY_API_KEY = readConfigValue("SHOPIFY_API_KEY");
const SHOPIFY_API_SECRET = readConfigValue("SHOPIFY_API_SECRET");
const SHOPIFY_SCOPES = readConfigValue("SCOPES");
const APP_URL = resolveAppUrl();

const shopify = shopifyApp({
  apiKey: SHOPIFY_API_KEY,
  apiSecretKey: SHOPIFY_API_SECRET,
  apiVersion: ApiVersion.October25,
  scopes: SHOPIFY_SCOPES?.split(","),
  appUrl: APP_URL,
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  hooks: {
    afterAuth: async ({ admin }) => {
      await ensureStorefrontUpsellScriptTag(admin);
    },
  },
  billing: {
    [LAUNCH_PLAN]: {
      lineItems: [
        {
          amount: 19,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
      trialDays: BILLING_TRIAL_DAYS,
    },
    [MONTHLY_PLAN]: {
      lineItems: [
        {
          amount: 29,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
      trialDays: BILLING_TRIAL_DAYS,
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;

export async function getPreferredPlanForShop(
  shop: string,
): Promise<typeof LAUNCH_PLAN | typeof MONTHLY_PLAN> {
  const uniqueOfflineSessions = await prisma.session.findMany({
    where: { isOnline: false },
    distinct: ["shop"],
    select: { shop: true },
  });

  const uniqueShops = new Set(uniqueOfflineSessions.map((session) => session.shop));
  uniqueShops.add(shop);

  return uniqueShops.size <= LAUNCH_SHOP_LIMIT ? LAUNCH_PLAN : MONTHLY_PLAN;
}

const STOREFRONT_UPSELL_SCRIPT_PATH = "/upsell-cart.js";
const STOREFRONT_UPSELL_SCRIPT_VERSION = "2026-03-28-03";

export async function ensureStorefrontUpsellScriptTag(admin: {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<{ json: () => Promise<unknown> }>;
}) {
  const baseUrl = APP_URL;
  const scriptUrl = `${baseUrl}${STOREFRONT_UPSELL_SCRIPT_PATH}?v=${STOREFRONT_UPSELL_SCRIPT_VERSION}`;
  if (!scriptUrl.startsWith("https://")) return;

  const existingResponse = await admin.graphql(
    `#graphql
      query ExistingScriptTags {
        scriptTags(first: 100) {
          edges {
            node {
              id
              src
            }
          }
        }
      }`,
  );
  const existingJson = (await existingResponse.json()) as {
    data?: {
      scriptTags?: { edges?: Array<{ node?: { id?: string; src?: string } }> };
    };
  };
  const allScriptTags = (existingJson.data?.scriptTags?.edges ?? [])
    .map((edge) => edge?.node)
    .filter((node): node is { id?: string; src?: string } => !!node?.id && !!node?.src);

  const currentExists = allScriptTags.some((node) => node.src === scriptUrl);
  const staleUpsellScriptTags = allScriptTags.filter((node) =>
    node.src?.startsWith(`${baseUrl}${STOREFRONT_UPSELL_SCRIPT_PATH}`),
  );

  // Remove stale versions so storefront always executes latest upsell script.
  for (const scriptTag of staleUpsellScriptTags) {
    if (!scriptTag.id || scriptTag.src === scriptUrl) continue;
    await admin.graphql(
      `#graphql
        mutation DeleteStorefrontScriptTag($id: ID!) {
          scriptTagDelete(id: $id) {
            deletedScriptTagId
            userErrors {
              message
            }
          }
        }`,
      {
        variables: {
          id: scriptTag.id,
        },
      },
    );
  }

  if (currentExists) return;

  await admin.graphql(
    `#graphql
      mutation CreateStorefrontScriptTag($input: ScriptTagInput!) {
        scriptTagCreate(input: $input) {
          scriptTag {
            id
          }
          userErrors {
            message
          }
        }
      }`,
    {
      variables: {
        input: {
          src: scriptUrl,
          displayScope: "ONLINE_STORE",
        },
      },
    },
  );
}

function resolveAppUrl() {
  const raw =
    readConfigValue("SHOPIFY_APP_URL") ||
    process.env.RENDER_EXTERNAL_URL ||
    process.env.URL ||
    "";
  const normalized = raw.trim().replace(/\/+$/, "");
  return normalized;
}

function readConfigValue(key: string) {
  const fromEnv = process.env[key];
  if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv.trim();

  const secretPaths = [`/etc/secrets/${key}`, `${process.cwd()}/${key}`];
  for (const filePath of secretPaths) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const value = fs.readFileSync(filePath, "utf8").trim();
      if (value) return value;
    } catch {
      // noop - continue to other fallbacks
    }
  }

  return "";
}

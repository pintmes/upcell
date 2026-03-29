import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import {
  authenticate,
  LAUNCH_PLAN,
  MONTHLY_PLAN,
  getPreferredPlanForShop,
} from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const isProduction = process.env.NODE_ENV === "production";
  const isBillingTestMode = process.env.SHOPIFY_BILLING_TEST_MODE === "true";
  const shouldEnforceBilling = process.env.SHOPIFY_ENFORCE_BILLING === "true";

  if (isProduction && shouldEnforceBilling) {
    const preferredPlan = await getPreferredPlanForShop(session.shop);

    await billing.require({
      plans: [LAUNCH_PLAN as never, MONTHLY_PLAN as never],
      isTest: isBillingTestMode,
      onFailure: async () =>
        billing.request({
          plan: preferredPlan as never,
          isTest: isBillingTestMode,
        }),
    });
  }

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Home</s-link>
        <s-link href="/app/additional">Additional page</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

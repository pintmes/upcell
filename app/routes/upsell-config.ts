import type { LoaderFunctionArgs } from "react-router";
import { unauthenticated } from "../shopify.server";

type ParsedSettings = {
  offers: Array<{
    productId: string;
    variantId: string;
    title: string;
    imageUrl: string | null;
    discountCode: string | null;
  }>;
  localePreference: string;
  discountPercent: number;
  headingText: string;
  addButtonText: string;
  declineButtonText: string;
  noteText: string;
  cardBackgroundColor: string;
  primaryButtonColor: string;
  logoUrl: string;
  guideImageUrls: string[];
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop || !shop.endsWith(".myshopify.com")) {
    return jsonResponse({ ok: false, error: "Invalid shop." }, 400);
  }

  try {
    const { admin } = await unauthenticated.admin(shop);
    const settingsResponse = await admin.graphql(
      `#graphql
        query StorefrontUpsellSettings {
          shop {
            metafield(namespace: "$app:upsell", key: "settings") {
              value
            }
          }
        }`,
    );
    const settingsJson = (await settingsResponse.json()) as {
      data?: { shop?: { metafield?: { value?: string | null } | null } };
    };
    const rawSettings = settingsJson.data?.shop?.metafield?.value;
    const parsed = parseSettings(rawSettings);

    if (!parsed?.offers?.length) {
      return jsonResponse({ ok: false, error: "No upsell configured." }, 404);
    }

    const variantResponse = await admin.graphql(
      `#graphql
        query StorefrontUpsellVariants($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on ProductVariant {
              id
              legacyResourceId
              availableForSale
              price
              product {
                title
                onlineStoreUrl
                featuredImage {
                  url
                }
              }
            }
          }
        }`,
      { variables: { ids: parsed.offers.map((offer) => offer.variantId) } },
    );
    const variantJson = (await variantResponse.json()) as {
      data?: { nodes?: Array<{
          id?: string | null;
          legacyResourceId?: string | number | null;
          availableForSale?: boolean | null;
          price?: string | null;
          product?: {
            title?: string | null;
            onlineStoreUrl?: string | null;
            featuredImage?: { url?: string | null } | null;
          } | null;
      } | null> };
    };
    const nodes = variantJson.data?.nodes ?? [];
    const variantMap = new Map(
      nodes
        .filter((node): node is NonNullable<(typeof nodes)[number]> => !!node?.id)
        .map((node) => [String(node.id), node]),
    );
    const offers = parsed.offers
      .map((offer) => {
        const variant = variantMap.get(offer.variantId);
        if (!variant?.legacyResourceId || !variant.availableForSale) return null;
        return {
          variantId: String(variant.legacyResourceId),
          title: offer.title || variant.product?.title || "Recommended product",
          imageUrl:
            offer.imageUrl ||
            variant.product?.featuredImage?.url ||
            "https://cdn.shopify.com/static/images/examples/img-placeholder-1120x1120.png",
          price: variant.price || null,
          productUrl: variant.product?.onlineStoreUrl || null,
          discountPercent: parsed.discountPercent ?? 30,
          discountCode: offer.discountCode ?? null,
          localePreference: parsed.localePreference ?? "auto",
          headingText: parsed.headingText ?? "",
          addButtonText: parsed.addButtonText ?? "",
          declineButtonText: parsed.declineButtonText ?? "",
          noteText: parsed.noteText ?? "",
          cardBackgroundColor: parsed.cardBackgroundColor ?? "#ffffff",
          primaryButtonColor: parsed.primaryButtonColor ?? "#111827",
          logoUrl: parsed.logoUrl ?? "/upsellpro-logo.svg",
          guideImageUrls: parsed.guideImageUrls ?? [],
        };
      })
      .filter((offer): offer is NonNullable<typeof offer> => !!offer);

    if (!offers.length) {
      return jsonResponse({ ok: false, error: "Upsell variant unavailable." }, 409);
    }

    return jsonResponse({
      ok: true,
      offers,
      offer: offers[0],
    });
  } catch {
    return jsonResponse({ ok: false, error: "Failed to load upsell config." }, 500);
  }
};

function parseSettings(raw: unknown): ParsedSettings | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      productId?: string;
      variantId?: string;
      title?: string;
      imageUrl?: string | null;
      offers?: Array<{
        productId?: string;
        variantId?: string;
        title?: string;
        imageUrl?: string | null;
        discountCode?: string | null;
      }>;
      localePreference?: string;
      discountPercent?: number;
      discountCode?: string | null;
      headingText?: string;
      addButtonText?: string;
      declineButtonText?: string;
      noteText?: string;
      cardBackgroundColor?: string;
      primaryButtonColor?: string;
      logoUrl?: string;
      guideImageUrls?: string[];
    };
    const offers = Array.isArray(parsed.offers)
      ? parsed.offers
          .map((offer) => {
            if (
              typeof offer.productId !== "string" ||
              typeof offer.variantId !== "string" ||
              typeof offer.title !== "string"
            ) {
              return null;
            }
            return {
              productId: offer.productId,
              variantId: offer.variantId,
              title: offer.title,
              imageUrl: offer.imageUrl ?? null,
              discountCode: typeof offer.discountCode === "string" ? offer.discountCode : null,
            };
          })
          .filter((offer): offer is NonNullable<typeof offer> => !!offer)
      : [];
    if (!offers.length && typeof parsed.variantId === "string" && typeof parsed.title === "string") {
      offers.push({
        productId: typeof parsed.productId === "string" ? parsed.productId : "",
        variantId: parsed.variantId,
        title: parsed.title,
        imageUrl: parsed.imageUrl ?? null,
        discountCode: parsed.discountCode ?? null,
      });
    }
    if (!offers.length) return null;

    return {
      offers,
      localePreference: parsed.localePreference ?? "auto",
      discountPercent: parsed.discountPercent ?? 30,
      headingText: parsed.headingText ?? "",
      addButtonText: parsed.addButtonText ?? "",
      declineButtonText: parsed.declineButtonText ?? "",
      noteText: parsed.noteText ?? "",
      cardBackgroundColor: parsed.cardBackgroundColor ?? "#ffffff",
      primaryButtonColor: parsed.primaryButtonColor ?? "#111827",
      logoUrl: parsed.logoUrl ?? "/upsellpro-logo.svg",
      guideImageUrls: Array.isArray(parsed.guideImageUrls) ? parsed.guideImageUrls : [],
    };
  } catch {
    return null;
  }
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

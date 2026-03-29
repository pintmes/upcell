import { useEffect, useMemo, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate, ensureStorefrontUpsellScriptTag } from "../shopify.server";

const UPSELL_SETTINGS_NAMESPACE = "$app:upsell";
const UPSELL_SETTINGS_KEY = "settings";
const DEFAULT_DISCOUNT_PERCENT = 30;
const DEFAULT_CARD_BACKGROUND = "#ffffff";
const DEFAULT_PRIMARY_BUTTON = "#111827";
const DEFAULT_LOGO_URL = "/upsellpro-logo.svg";
const DEFAULT_GUIDE_IMAGE_URLS = ["/upsell-guide-step1.svg", "/upsell-guide-step2.svg"];
const MAX_UPSELL_PRODUCTS = 6;

const LANGUAGE_OPTIONS = [
  { value: "auto", label: "Auto (site language)" },
  { value: "en", label: "English" },
  { value: "tr", label: "Turkce" },
  { value: "de", label: "Deutsch" },
  { value: "fr", label: "Francais" },
  { value: "es", label: "Espanol" },
  { value: "it", label: "Italiano" },
  { value: "pt", label: "Portugues" },
  { value: "nl", label: "Nederlands" },
  { value: "ar", label: "Arabic" },
  { value: "ru", label: "Russian" },
];

type UpsellOffer = {
  productId: string;
  variantId: string;
  title: string;
  imageUrl: string | null;
  discountCode: string | null;
};

type SavedUpsellSettings = {
  offers: UpsellOffer[];
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

type PickerProduct = {
  productId: string;
  title: string;
  imageUrl: string | null;
};

type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<{ json: () => Promise<unknown> }>;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  await ensureStorefrontUpsellScriptTag(admin);

  const rawValue = await getRawUpsellSettings(admin);
  let settings = parseSavedSettings(rawValue);
  let autoConfigured = false;

  if (!settings) {
    const fallbackSettings = await getFallbackUpsellSettings(admin);
    if (fallbackSettings) {
      const saveResult = await saveUpsellSettings(admin, fallbackSettings);
      if (saveResult.ok) {
        settings = fallbackSettings;
        autoConfigured = true;
      }
    }
  }

  return { settings, autoConfigured, shopDomain: session.shop };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const productSelections = formData.get("productSelections");
  const localePreference = formData.get("localePreference");
  const discountPercentRaw = formData.get("discountPercent");
  const headingText = formData.get("headingText");
  const addButtonText = formData.get("addButtonText");
  const declineButtonText = formData.get("declineButtonText");
  const noteText = formData.get("noteText");
  const cardBackgroundColor = formData.get("cardBackgroundColor");
  const primaryButtonColor = formData.get("primaryButtonColor");
  const logoUrl = formData.get("logoUrl");
  const guideImageUrl1 = formData.get("guideImageUrl1");
  const guideImageUrl2 = formData.get("guideImageUrl2");

  const parsedSelections = parseProductSelections(productSelections);
  if (!parsedSelections.ok) return { ok: false, error: parsedSelections.error };

  if (typeof localePreference !== "string" || !localePreference) {
    return { ok: false, error: "Missing language selection." };
  }
  const discountPercent = normalizeDiscountPercent(discountPercentRaw);
  if (!discountPercent) {
    return { ok: false, error: "Discount percent must be between 1 and 90." };
  }

  const offers: UpsellOffer[] = [];
  for (const product of parsedSelections.products) {
    const sellableVariant = await resolveSellableVariant(admin, product.productId);
    if (!sellableVariant?.variantId) {
      return {
        ok: false,
        error: `"${product.title}" urununde satilabilir varyant yok.`,
      };
    }

    const discountCode = await ensureDiscountCodeForProduct(
      admin,
      product.productId,
      discountPercent,
    );

    offers.push({
      productId: product.productId,
      variantId: sellableVariant.variantId,
      title: sellableVariant.title ?? product.title,
      imageUrl: sellableVariant.imageUrl ?? product.imageUrl,
      discountCode,
    });
  }

  const settings: SavedUpsellSettings = {
    offers,
    localePreference,
    discountPercent,
    headingText: typeof headingText === "string" ? headingText.trim() : "",
    addButtonText: typeof addButtonText === "string" ? addButtonText.trim() : "",
    declineButtonText:
      typeof declineButtonText === "string" ? declineButtonText.trim() : "",
    noteText: typeof noteText === "string" ? noteText.trim() : "",
    cardBackgroundColor: normalizeHexColor(cardBackgroundColor, DEFAULT_CARD_BACKGROUND),
    primaryButtonColor: normalizeHexColor(primaryButtonColor, DEFAULT_PRIMARY_BUTTON),
    logoUrl: normalizeAssetUrl(logoUrl, DEFAULT_LOGO_URL),
    guideImageUrls: [
      normalizeAssetUrl(guideImageUrl1, DEFAULT_GUIDE_IMAGE_URLS[0]),
      normalizeAssetUrl(guideImageUrl2, DEFAULT_GUIDE_IMAGE_URLS[1]),
    ],
  };

  const saveResult = await saveUpsellSettings(admin, settings);
  if (!saveResult.ok) {
    return { ok: false, error: saveResult.error };
  }

  return { ok: true, settings };
};

export default function Index() {
  const { settings, autoConfigured, shopDomain } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [selectedProducts, setSelectedProducts] = useState<PickerProduct[]>(
    (settings?.offers ?? []).map((offer) => ({
      productId: offer.productId,
      title: offer.title,
      imageUrl: offer.imageUrl,
    })),
  );
  const [localePreference, setLocalePreference] = useState(
    settings?.localePreference ?? "auto",
  );
  const [discountPercent, setDiscountPercent] = useState(
    settings?.discountPercent ?? DEFAULT_DISCOUNT_PERCENT,
  );
  const [headingText, setHeadingText] = useState(settings?.headingText ?? "");
  const [addButtonText, setAddButtonText] = useState(settings?.addButtonText ?? "");
  const [declineButtonText, setDeclineButtonText] = useState(
    settings?.declineButtonText ?? "",
  );
  const [noteText, setNoteText] = useState(settings?.noteText ?? "");
  const [cardBackgroundColor, setCardBackgroundColor] = useState(
    settings?.cardBackgroundColor ?? DEFAULT_CARD_BACKGROUND,
  );
  const [primaryButtonColor, setPrimaryButtonColor] = useState(
    settings?.primaryButtonColor ?? DEFAULT_PRIMARY_BUTTON,
  );
  const [logoUrl, setLogoUrl] = useState(settings?.logoUrl ?? DEFAULT_LOGO_URL);
  const [guideImageUrl1, setGuideImageUrl1] = useState(
    settings?.guideImageUrls?.[0] ?? DEFAULT_GUIDE_IMAGE_URLS[0],
  );
  const [guideImageUrl2, setGuideImageUrl2] = useState(
    settings?.guideImageUrls?.[1] ?? DEFAULT_GUIDE_IMAGE_URLS[1],
  );
  const savedOffers = useMemo(() => settings?.offers ?? [], [settings?.offers]);
  const offerCount = selectedProducts.length;
  const hasProductSelection = offerCount > 0;
  const selectableRemaining = MAX_UPSELL_PRODUCTS - offerCount;
  const discountHint = useMemo(
    () =>
      savedOffers.length
        ? `${savedOffers.filter((offer) => !!offer.discountCode).length}/${savedOffers.length} code ready`
        : "No saved offers yet",
    [savedOffers],
  );

  useEffect(() => {
    if (autoConfigured) {
      shopify.toast.show("Default upsell products configured automatically");
    }
    if (fetcher.data?.ok) {
      shopify.toast.show("Upsell panel settings saved");
    } else if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [autoConfigured, fetcher.data, shopify]);

  const handleOpenPicker = async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      action: "select",
      multiple: true,
    });

    if (!selected?.length) return;

    const nextProducts: PickerProduct[] = selected
      .map((item) => ({
        productId: item.id,
        title: item.title ?? "Untitled product",
        imageUrl: item.images?.[0]?.originalSrc ?? null,
      }))
      .slice(0, MAX_UPSELL_PRODUCTS);

    if (!nextProducts.length) {
      shopify.toast.show("No product selected", { isError: true });
      return;
    }

    setSelectedProducts(nextProducts);
  };

  const handleSave = () => {
    if (!hasProductSelection) {
      shopify.toast.show("Select at least one product before saving", {
        isError: true,
      });
      return;
    }

    fetcher.submit(
      {
        productSelections: JSON.stringify(selectedProducts),
        localePreference,
        discountPercent: String(discountPercent),
        headingText,
        addButtonText,
        declineButtonText,
        noteText,
        cardBackgroundColor,
        primaryButtonColor,
        logoUrl,
        guideImageUrl1,
        guideImageUrl2,
      },
      { method: "POST" },
    );
  };

  const isSaving =
    ["loading", "submitting"].includes(fetcher.state) && fetcher.formMethod === "POST";
  const checkoutSettingsUrl = `https://${shopDomain}/admin/settings/checkout`;

  return (
    <s-page heading="UpsellPro Dashboard">
      <s-section heading="Brand and Overview">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "92px 1fr",
            gap: 14,
            alignItems: "center",
            padding: 14,
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            background: "#ffffff",
          }}
        >
          <img
            src={logoUrl}
            alt="UpsellPro logo"
            width={84}
            height={84}
            style={{ objectFit: "contain", borderRadius: 10, border: "1px solid #e5e7eb" }}
          />
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>UpsellPro Control Center</div>
            <div style={{ marginTop: 4, color: "#4b5563" }}>
              Multi-product offers, visual customization and localized popup texts from one
              panel.
            </div>
            <div style={{ marginTop: 8, color: "#6b7280", fontSize: 13 }}>
              Selected products: {offerCount} / {MAX_UPSELL_PRODUCTS} - {discountHint}
            </div>
          </div>
        </div>
      </s-section>

      <s-section heading="Quick Setup">
        <s-unordered-list>
          <s-list-item>
            <s-text>1) Billing and app install: done during onboarding</s-text>
          </s-list-item>
          <s-list-item>
            <s-text>2) Upsell products: {hasProductSelection ? "configured" : "not set"}</s-text>
          </s-list-item>
          <s-list-item>
            <s-stack direction="inline" gap="base">
              <s-text>3) Enable post-purchase extension:</s-text>
              <s-button
                variant="secondary"
                onClick={() => {
                  window.open(checkoutSettingsUrl, "_top");
                }}
              >
                Enable Post-purchase
              </s-button>
            </s-stack>
          </s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section heading="Upsell Product Settings">
        <s-paragraph>
          Pick multiple products for upsell. Popup rotates and shows the first eligible item
          that is not already in cart.
        </s-paragraph>

        <s-stack direction="inline" gap="base">
          <s-button onClick={handleOpenPicker}>Select Products</s-button>
          <s-button
            variant="primary"
            onClick={handleSave}
            {...(isSaving ? { loading: true } : {})}
          >
            Save
          </s-button>
        </s-stack>
        <div style={{ marginTop: 6, color: "#6b7280", fontSize: 12 }}>
          Max {MAX_UPSELL_PRODUCTS} products. Remaining slots: {Math.max(0, selectableRemaining)}
        </div>

        <div style={{ marginTop: 12 }}>
          <label htmlFor="upsell-language-select">Popup language</label>
          <br />
          <select
            id="upsell-language-select"
            value={localePreference}
            onChange={(event) => {
              setLocalePreference(event.target.value);
              setSelectedProduct((previous) =>
                previous ? { ...previous, localePreference: event.target.value } : previous,
              );
            }}
            style={{ marginTop: 6, minWidth: 220, padding: 8, borderRadius: 6 }}
          >
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div style={{ marginTop: 12, display: "grid", gap: 10, maxWidth: 560 }}>
          <label htmlFor="upsell-discount-percent">Discount percent (1-90)</label>
          <input
            id="upsell-discount-percent"
            type="number"
            min={1}
            max={90}
            value={discountPercent}
            onChange={(event) => setDiscountPercent(Number(event.target.value))}
            style={{ padding: 8, borderRadius: 6 }}
          />

          <label htmlFor="upsell-heading-text">Popup heading override</label>
          <input
            id="upsell-heading-text"
            type="text"
            value={headingText}
            onChange={(event) => setHeadingText(event.target.value)}
            placeholder="Leave empty to use language defaults"
            style={{ padding: 8, borderRadius: 6 }}
          />

          <label htmlFor="upsell-add-button">Add button text override</label>
          <input
            id="upsell-add-button"
            type="text"
            value={addButtonText}
            onChange={(event) => setAddButtonText(event.target.value)}
            placeholder="Leave empty to use language defaults"
            style={{ padding: 8, borderRadius: 6 }}
          />

          <label htmlFor="upsell-decline-button">Decline button text override</label>
          <input
            id="upsell-decline-button"
            type="text"
            value={declineButtonText}
            onChange={(event) => setDeclineButtonText(event.target.value)}
            placeholder="Leave empty to use language defaults"
            style={{ padding: 8, borderRadius: 6 }}
          />

          <label htmlFor="upsell-note-text">Popup note text override</label>
          <input
            id="upsell-note-text"
            type="text"
            value={noteText}
            onChange={(event) => setNoteText(event.target.value)}
            placeholder="Leave empty to use language defaults"
            style={{ padding: 8, borderRadius: 6 }}
          />

          <label htmlFor="upsell-card-bg">Card background color</label>
          <input
            id="upsell-card-bg"
            type="color"
            value={cardBackgroundColor}
            onChange={(event) => setCardBackgroundColor(event.target.value)}
            style={{ width: 80, height: 36, borderRadius: 6 }}
          />

          <label htmlFor="upsell-primary-btn">Primary button color</label>
          <input
            id="upsell-primary-btn"
            type="color"
            value={primaryButtonColor}
            onChange={(event) => setPrimaryButtonColor(event.target.value)}
            style={{ width: 80, height: 36, borderRadius: 6 }}
          />

          <label htmlFor="upsell-logo-url">App logo URL</label>
          <input
            id="upsell-logo-url"
            type="text"
            value={logoUrl}
            onChange={(event) => setLogoUrl(event.target.value)}
            style={{ padding: 8, borderRadius: 6 }}
          />

          <label htmlFor="upsell-guide-image-1">Guide image URL #1</label>
          <input
            id="upsell-guide-image-1"
            type="text"
            value={guideImageUrl1}
            onChange={(event) => setGuideImageUrl1(event.target.value)}
            style={{ padding: 8, borderRadius: 6 }}
          />

          <label htmlFor="upsell-guide-image-2">Guide image URL #2</label>
          <input
            id="upsell-guide-image-2"
            type="text"
            value={guideImageUrl2}
            onChange={(event) => setGuideImageUrl2(event.target.value)}
            style={{ padding: 8, borderRadius: 6 }}
          />
        </div>

        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          {hasProductSelection ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
                gap: 10,
              }}
            >
              {selectedProducts.map((product) => {
                const savedOffer = savedOffers.find(
                  (offer) => offer.productId === product.productId,
                );
                return (
                  <div
                    key={product.productId}
                    style={{
                      border: "1px solid #d1d5db",
                      borderRadius: 10,
                      background: "#fff",
                      padding: 10,
                    }}
                  >
                    <img
                      src={
                        product.imageUrl ??
                        "https://cdn.shopify.com/static/images/examples/img-placeholder-1120x1120.png"
                      }
                      alt={product.title}
                      width={44}
                      height={44}
                      style={{ borderRadius: 6, objectFit: "cover" }}
                    />
                    <div style={{ marginTop: 8, fontWeight: 600 }}>{product.title}</div>
                    <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                      {savedOffer?.discountCode ? savedOffer.discountCode : "code pending"}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <s-text tone="neutral">
              No product selected yet. Click Select Products to choose offers.
            </s-text>
          )}
        </s-box>
      </s-section>

      <s-section heading="Kullanma Kilavuzu">
        <s-unordered-list>
          <s-list-item>
            <s-text>1) Select Products ile 1-6 arasi upsell urunu secin.</s-text>
          </s-list-item>
          <s-list-item>
            <s-text>2) Popup language ile dil secin (Auto, site dilini kullanir).</s-text>
          </s-list-item>
          <s-list-item>
            <s-text>3) Discount percent ile orani belirleyin, Save ile kaydedin.</s-text>
          </s-list-item>
          <s-list-item>
            <s-text>4) Metin alanlarini doldurursaniz varsayilan dil metinleri override edilir.</s-text>
          </s-list-item>
          <s-list-item>
            <s-text>5) Renk secicilerle kart ve ana buton rengini degistirin.</s-text>
          </s-list-item>
          <s-list-item>
            <s-text>6) Storefrontta urun sepete eklenince upsell popup otomatik acilir.</s-text>
          </s-list-item>
        </s-unordered-list>
        <div
          style={{
            marginTop: 12,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 12,
          }}
        >
          <img
            src={guideImageUrl1}
            alt="Guide visual 1"
            style={{ width: "100%", borderRadius: 10, border: "1px solid #e5e7eb" }}
          />
          <img
            src={guideImageUrl2}
            alt="Guide visual 2"
            style={{ width: "100%", borderRadius: 10, border: "1px solid #e5e7eb" }}
          />
        </div>
      </s-section>
    </s-page>
  );
}

async function getRawUpsellSettings(admin: AdminGraphqlClient): Promise<string | null> {
  const response = await admin.graphql(
    `#graphql
      query UpsellSettings {
        shop {
          metafield(namespace: "$app:upsell", key: "settings") {
            value
          }
        }
      }`,
  );
  const responseJson = (await response.json()) as {
    data?: { shop?: { metafield?: { value?: string | null } | null } };
  };
  return responseJson.data?.shop?.metafield?.value ?? null;
}

async function getFallbackUpsellSettings(
  admin: AdminGraphqlClient,
): Promise<SavedUpsellSettings | null> {
  const fallbackResponse = await admin.graphql(
    `#graphql
      query FallbackUpsellProduct {
        products(first: 12, query: "status:active") {
          nodes {
            id
            title
            featuredImage {
              url
            }
            variants(first: 20) {
              nodes {
                id
                availableForSale
              }
            }
          }
        }
      }`,
  );
  const fallbackJson = (await fallbackResponse.json()) as {
    data?: {
      products?: {
        nodes?: Array<{
          id?: string;
          title?: string;
          featuredImage?: { url?: string | null } | null;
          variants?: { nodes?: Array<{ id?: string; availableForSale?: boolean }> };
        }>;
      };
    };
  };
  const products = fallbackJson.data?.products?.nodes ?? [];
  const sellableProducts = products
    .filter((product) => product.variants?.nodes?.some((variant) => variant.availableForSale))
    .slice(0, 3);

  if (!sellableProducts.length) {
    return null;
  }

  const offers: UpsellOffer[] = [];
  for (const product of sellableProducts) {
    if (!product.id) continue;
    const variant = product.variants?.nodes?.find((candidate) => candidate.availableForSale);
    if (!variant?.id) continue;
    const discountCode = await ensureDiscountCodeForProduct(
      admin,
      product.id,
      DEFAULT_DISCOUNT_PERCENT,
    );
    offers.push({
      productId: product.id,
      variantId: variant.id,
      title: product.title ?? "Untitled product",
      imageUrl: product.featuredImage?.url ?? null,
      discountCode,
    });
  }

  if (!offers.length) return null;

  return {
    offers,
    localePreference: "auto",
    discountPercent: DEFAULT_DISCOUNT_PERCENT,
    headingText: "",
    addButtonText: "",
    declineButtonText: "",
    noteText: "",
    cardBackgroundColor: DEFAULT_CARD_BACKGROUND,
    primaryButtonColor: DEFAULT_PRIMARY_BUTTON,
    logoUrl: DEFAULT_LOGO_URL,
    guideImageUrls: DEFAULT_GUIDE_IMAGE_URLS,
  };
}

async function saveUpsellSettings(admin: AdminGraphqlClient, settings: SavedUpsellSettings) {
  const ownerIdResult = await getShopOwnerId(admin);
  if (!ownerIdResult.ok) return ownerIdResult;

  const saveResponse = await admin.graphql(
    `#graphql
      mutation SaveUpsellSettings($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors {
            message
          }
        }
      }`,
    {
      variables: {
        metafields: [
          {
            ownerId: ownerIdResult.ownerId,
            namespace: UPSELL_SETTINGS_NAMESPACE,
            key: UPSELL_SETTINGS_KEY,
            type: "json",
            value: JSON.stringify(settings),
          },
        ],
      },
    },
  );
  const saveResponseJson = (await saveResponse.json()) as {
    data?: { metafieldsSet?: { userErrors?: Array<{ message?: string }> } };
  };
  const userErrors = saveResponseJson.data?.metafieldsSet?.userErrors ?? [];
  if (userErrors.length > 0) {
    return { ok: false, error: userErrors[0]?.message ?? "Save failed." };
  }

  return { ok: true };
}

async function getShopOwnerId(admin: AdminGraphqlClient) {
  const shopResponse = await admin.graphql(
    `#graphql
      query ShopIdForUpsellSettings {
        shop {
          id
        }
      }`,
  );
  const shopResponseJson = (await shopResponse.json()) as {
    data?: { shop?: { id?: string } };
  };
  const ownerId = shopResponseJson.data?.shop?.id;
  if (typeof ownerId !== "string" || !ownerId) {
    return { ok: false as const, error: "Could not resolve shop id for saving settings." };
  }
  return { ok: true as const, ownerId };
}

async function ensureDiscountCodeForProduct(
  admin: AdminGraphqlClient,
  productId: string,
  discountPercent: number,
): Promise<string | null> {
  const code = `UPSELL${discountPercent}-${Date.now().toString(36).toUpperCase()}`;
  const startsAt = new Date().toISOString();
  const createResponse = await admin.graphql(
    `#graphql
      mutation CreateUpsellCode($input: DiscountCodeBasicInput!) {
        discountCodeBasicCreate(basicCodeDiscount: $input) {
          codeDiscountNode {
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
          title: `UpsellPro ${discountPercent}%`,
          code,
          startsAt,
          customerSelection: { all: true },
          customerGets: {
            value: { percentage: discountPercent / 100 },
            items: { products: { productsToAdd: [productId] } },
          },
        },
      },
    },
  );
  const createJson = (await createResponse.json()) as {
    data?: {
      discountCodeBasicCreate?: {
        codeDiscountNode?: { id?: string } | null;
        userErrors?: Array<{ message?: string }>;
      };
    };
  };

  const userErrors = createJson.data?.discountCodeBasicCreate?.userErrors ?? [];
  if (userErrors.length > 0) {
    return null;
  }

  return createJson.data?.discountCodeBasicCreate?.codeDiscountNode?.id ? code : null;
}

async function resolveSellableVariant(
  admin: AdminGraphqlClient,
  productId: string,
): Promise<{ variantId: string; title: string | null; imageUrl: string | null } | null> {
  const response = await admin.graphql(
    `#graphql
      query ResolveSellableVariant($id: ID!) {
        product(id: $id) {
          title
          featuredImage {
            url
          }
          variants(first: 20) {
            nodes {
              id
              availableForSale
            }
          }
        }
      }`,
    { variables: { id: productId } },
  );
  const responseJson = (await response.json()) as {
    data?: {
      product?: {
        title?: string | null;
        featuredImage?: { url?: string | null } | null;
        variants?: { nodes?: Array<{ id?: string; availableForSale?: boolean }> };
      } | null;
    };
  };

  const product = responseJson.data?.product;
  const sellableVariant = product?.variants?.nodes?.find(
    (variant) => variant.id && variant.availableForSale,
  );
  if (!sellableVariant?.id) return null;

  return {
    variantId: sellableVariant.id,
    title: product?.title ?? null,
    imageUrl: product?.featuredImage?.url ?? null,
  };
}

function parseSavedSettings(rawValue: unknown): SavedUpsellSettings | null {
  if (typeof rawValue !== "string" || !rawValue) return null;
  try {
    const parsed = JSON.parse(rawValue) as Partial<SavedUpsellSettings>;
    const offers = Array.isArray(parsed.offers)
      ? parsed.offers
          .map((offer) => normalizeOffer(offer))
          .filter((offer): offer is UpsellOffer => !!offer)
      : [];
    const legacyOffer = normalizeLegacyOffer(parsed as Record<string, unknown>);
    const normalizedOffers =
      offers.length > 0 ? offers : legacyOffer ? [legacyOffer] : [];
    if (!normalizedOffers.length) return null;

    return {
      offers: normalizedOffers,
      localePreference: typeof parsed.localePreference === "string" ? parsed.localePreference : "auto",
      discountPercent:
        typeof parsed.discountPercent === "number"
          ? parsed.discountPercent
          : DEFAULT_DISCOUNT_PERCENT,
      headingText: typeof parsed.headingText === "string" ? parsed.headingText : "",
      addButtonText: typeof parsed.addButtonText === "string" ? parsed.addButtonText : "",
      declineButtonText:
        typeof parsed.declineButtonText === "string" ? parsed.declineButtonText : "",
      noteText: typeof parsed.noteText === "string" ? parsed.noteText : "",
      cardBackgroundColor:
        typeof parsed.cardBackgroundColor === "string"
          ? normalizeHexColor(parsed.cardBackgroundColor, DEFAULT_CARD_BACKGROUND)
          : DEFAULT_CARD_BACKGROUND,
      primaryButtonColor:
        typeof parsed.primaryButtonColor === "string"
          ? normalizeHexColor(parsed.primaryButtonColor, DEFAULT_PRIMARY_BUTTON)
          : DEFAULT_PRIMARY_BUTTON,
      logoUrl:
        typeof parsed.logoUrl === "string"
          ? normalizeAssetUrl(parsed.logoUrl, DEFAULT_LOGO_URL)
          : DEFAULT_LOGO_URL,
      guideImageUrls: normalizeGuideUrls(parsed.guideImageUrls),
    };
  } catch {
    return null;
  }
  return null;
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

function normalizeDiscountPercent(raw: FormDataEntryValue | null) {
  if (typeof raw !== "string") return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.floor(parsed);
  if (normalized < 1 || normalized > 90) return null;
  return normalized;
}

function normalizeHexColor(raw: FormDataEntryValue | string | null, fallback: string) {
  if (typeof raw !== "string") return fallback;
  const value = raw.trim();
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function normalizeAssetUrl(raw: FormDataEntryValue | string | null, fallback: string) {
  if (typeof raw !== "string") return fallback;
  const value = raw.trim();
  if (!value) return fallback;
  if (value.startsWith("/")) return value;
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  return fallback;
}

function normalizeGuideUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return DEFAULT_GUIDE_IMAGE_URLS;
  const normalized = raw
    .map((item) => normalizeAssetUrl(typeof item === "string" ? item : null, ""))
    .filter(Boolean)
    .slice(0, 2);
  if (normalized.length === 2) return normalized;
  if (normalized.length === 1) return [normalized[0], DEFAULT_GUIDE_IMAGE_URLS[1]];
  return DEFAULT_GUIDE_IMAGE_URLS;
}

function normalizeOffer(raw: unknown): UpsellOffer | null {
  if (!raw || typeof raw !== "object") return null;
  const offer = raw as Record<string, unknown>;
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
    imageUrl: typeof offer.imageUrl === "string" ? offer.imageUrl : null,
    discountCode: typeof offer.discountCode === "string" ? offer.discountCode : null,
  };
}

function normalizeLegacyOffer(raw: Record<string, unknown>): UpsellOffer | null {
  if (
    typeof raw.productId !== "string" ||
    typeof raw.variantId !== "string" ||
    typeof raw.title !== "string"
  ) {
    return null;
  }
  return {
    productId: raw.productId,
    variantId: raw.variantId,
    title: raw.title,
    imageUrl: typeof raw.imageUrl === "string" ? raw.imageUrl : null,
    discountCode: typeof raw.discountCode === "string" ? raw.discountCode : null,
  };
}

function parseProductSelections(raw: FormDataEntryValue | null) {
  if (typeof raw !== "string" || !raw) {
    return { ok: false as const, error: "Select at least one product." };
  }
  try {
    const parsed = JSON.parse(raw) as Array<{
      productId?: string;
      title?: string;
      imageUrl?: string | null;
    }>;
    if (!Array.isArray(parsed) || parsed.length < 1) {
      return { ok: false as const, error: "Select at least one product." };
    }
    const products = parsed
      .map((item) => ({
        productId: typeof item.productId === "string" ? item.productId : "",
        title: typeof item.title === "string" ? item.title : "Untitled product",
        imageUrl: typeof item.imageUrl === "string" ? item.imageUrl : null,
      }))
      .filter((item) => item.productId)
      .slice(0, MAX_UPSELL_PRODUCTS);
    if (!products.length) {
      return { ok: false as const, error: "Select at least one valid product." };
    }
    return { ok: true as const, products };
  } catch {
    return { ok: false as const, error: "Invalid selected products payload." };
  }
}

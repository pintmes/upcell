import { useMemo, useState } from "react";
import type {
  InputForRenderExtension,
  PostPurchaseShouldRenderApi,
} from "@shopify/post-purchase-ui-extensions-react";
import {
  extend,
  render,
  BlockStack,
  Button,
  CalloutBanner,
  Heading,
  Image,
  Layout,
  Text,
  TextBlock,
  TextContainer,
  View,
} from "@shopify/post-purchase-ui-extensions-react";

type RenderState = "idle" | "applying" | "success" | "error";

type UpsellOffer = {
  title: string;
  imageUrl: string;
  originalPrice: number;
  currencyCode: string;
  discountPercent: number;
  variantId: number;
};

const DEFAULT_OFFER: Omit<UpsellOffer, "variantId" | "currencyCode"> = {
  title: "Premium Travel Bottle",
  imageUrl:
    "https://cdn.shopify.com/static/images/examples/img-placeholder-1120x1120.png",
  originalPrice: 29.99,
  discountPercent: 30,
};

const OFFER_COPY = {
  heading: "Wait! Add this to your order",
  subheading: "Limited post-purchase discount. One click, no extra checkout.",
  accept: "Add to Order",
  decline: "No, thanks",
  success: "Added successfully. Redirecting to your order status page...",
  error:
    "We couldn't add this item right now. You can continue without changes.",
};

extend(
  "Checkout::PostPurchase::ShouldRender",
  async ({ inputData, storage }: PostPurchaseShouldRenderApi) => {
    const firstPurchasedVariant =
      inputData.initialPurchase.lineItems[0]?.product.variant.id;

    if (!firstPurchasedVariant) {
      return { render: false };
    }

    const offer: UpsellOffer = {
      ...DEFAULT_OFFER,
      variantId: firstPurchasedVariant,
      currencyCode:
        inputData.initialPurchase.totalPriceSet.presentmentMoney.currencyCode,
    };

    await storage.update(offer);
    return { render: true };
  },
);

render("Checkout::PostPurchase::Render", (input) => <App {...input} />);

function App({
  storage,
  calculateChangeset,
  applyChangeset,
  done,
}: InputForRenderExtension<"Checkout::PostPurchase::Render">) {
  const [state, setState] = useState<RenderState>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const offer = getOffer(storage.initialData);
  const discountedPrice = useMemo(
    () => roundMoney(offer.originalPrice * (1 - offer.discountPercent / 100)),
    [offer.originalPrice, offer.discountPercent],
  );

  const priceFormatter = useMemo(() => {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: offer.currencyCode,
      minimumFractionDigits: 2,
    });
  }, [offer.currencyCode]);

  const offerChangeset = useMemo(
    () => ({
      changes: [
        {
          type: "add_variant" as const,
          variantId: offer.variantId,
          quantity: 1,
          discount: {
            value: offer.discountPercent,
            valueType: "percentage" as const,
            title: `${offer.discountPercent}% post-purchase discount`,
          },
        },
      ],
    }),
    [offer.discountPercent, offer.variantId],
  );

  const handleAccept = async () => {
    if (state === "applying") return;

    setState("applying");
    setErrorMessage("");

    const calculated = await calculateChangeset(offerChangeset);
    if (calculated.status !== "processed") {
      setState("error");
      setErrorMessage(calculated.errors[0]?.message ?? OFFER_COPY.error);
      return;
    }

    const applyResult = await applyChangeset(JSON.stringify(offerChangeset));

    if (applyResult.status === "processed") {
      setState("success");
      await done();
      return;
    }

    setState("error");
    setErrorMessage(applyResult.errors[0]?.message ?? OFFER_COPY.error);
  };

  const handleDecline = async () => {
    await done();
  };

  return (
    <BlockStack spacing="loose">
      <Layout
        maxInlineSize={0.95}
        media={[
          { viewportSize: "small", sizes: [1] },
          { viewportSize: "medium", sizes: [0.42, 0.58] },
          { viewportSize: "large", sizes: [0.4, 0.6] },
        ]}
      >
        <View>
          <Image
            source={offer.imageUrl}
            description={offer.title}
            aspectRatio={1}
            bordered
          />
        </View>
        <BlockStack spacing="base">
          <TextContainer>
            <Heading>{OFFER_COPY.heading}</Heading>
            <TextBlock>{OFFER_COPY.subheading}</TextBlock>
          </TextContainer>

          <Text size="large" emphasized>
            {offer.title}
          </Text>

          <BlockStack spacing="tight">
            <Text role="deletion" subdued>
              {priceFormatter.format(offer.originalPrice)}
            </Text>
            <Text size="xlarge" appearance="success" emphasized>
              {priceFormatter.format(discountedPrice)}
            </Text>
          </BlockStack>

          <Button loading={state === "applying"} onPress={handleAccept}>
            {OFFER_COPY.accept}
          </Button>

          <Button plain subdued onPress={handleDecline}>
            {OFFER_COPY.decline}
          </Button>
        </BlockStack>
      </Layout>

      {state === "success" ? (
        <CalloutBanner title="Done">{OFFER_COPY.success}</CalloutBanner>
      ) : null}
      {state === "error" ? (
        <CalloutBanner title="Unable to apply offer">
          {errorMessage || OFFER_COPY.error}
        </CalloutBanner>
      ) : null}
    </BlockStack>
  );
}

function getOffer(initialData: unknown): UpsellOffer {
  if (isUpsellOffer(initialData)) {
    return initialData;
  }

  return {
    ...DEFAULT_OFFER,
    variantId: 0,
    currencyCode: "USD",
  };
}

function isUpsellOffer(value: unknown): value is UpsellOffer {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<UpsellOffer>;
  return (
    typeof candidate.title === "string" &&
    typeof candidate.imageUrl === "string" &&
    typeof candidate.originalPrice === "number" &&
    typeof candidate.currencyCode === "string" &&
    typeof candidate.discountPercent === "number" &&
    typeof candidate.variantId === "number"
  );
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
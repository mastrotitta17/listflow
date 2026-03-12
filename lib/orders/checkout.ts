import type Stripe from "stripe";

export type OrderCheckoutDraft = {
  storeId: string | null;
  category: string;
  subProductName: string;
  variantName: string | null;
  productLink: string;
  listingId: string | null;
  listingKey: string | null;
  listingTitle: string | null;
  listingImageUrl: string | null;
  date: string;
  address: string;
  receiverName: string;
  receiverPhone: string;
  receiverCountryCode: string;
  receiverState: string | null;
  receiverCity: string;
  receiverTown: string;
  receiverPostalCode: string;
  note: string | null;
  ioss: string | null;
  labelNumber: string;
  amountUsd: number;
};

const ORDER_DRAFT_PREFIX = "od_";
export const buildOrderCheckoutShopId = (storeId: string | null, checkoutRef: string) =>
  `${ORDER_DRAFT_PREFIX}${storeId || "no_store"}:${checkoutRef}`;

const compactString = (value: string | null | undefined) => {
  const normalized = String(value || "").trim();
  return normalized || null;
};

const metadataValue = (metadata: Stripe.Metadata | null | undefined, key: string) => {
  const raw = metadata?.[key];
  if (typeof raw !== "string") {
    return null;
  }

  return compactString(raw);
};

export const buildOrderCheckoutMetadata = (
  draft: OrderCheckoutDraft,
  extra: {
    userId: string;
    shopId: string;
    stripeMode: string;
  }
): Record<string, string> => ({
  userId: extra.userId,
  shopId: extra.shopId,
  stripeMode: extra.stripeMode,
  od_store_id: draft.storeId || "",
  od_category: draft.category,
  od_sub_product_name: draft.subProductName,
  od_variant_name: draft.variantName || "",
  od_product_link: draft.productLink,
  od_listing_id: draft.listingId || "",
  od_listing_key: draft.listingKey || "",
  od_listing_title: draft.listingTitle || "",
  od_listing_image_url: draft.listingImageUrl || "",
  od_date: draft.date,
  od_address: draft.address,
  od_receiver_name: draft.receiverName,
  od_receiver_phone: draft.receiverPhone,
  od_receiver_country_code: draft.receiverCountryCode,
  od_receiver_state: draft.receiverState || "",
  od_receiver_city: draft.receiverCity,
  od_receiver_town: draft.receiverTown,
  od_receiver_postal_code: draft.receiverPostalCode,
  od_note: draft.note || "",
  od_ioss: draft.ioss || "",
  od_label_number: draft.labelNumber,
  od_amount_usd: String(draft.amountUsd),
});

export const parseOrderCheckoutDraftMetadata = (
  metadata: Stripe.Metadata | null | undefined
): OrderCheckoutDraft | null => {
  const category = metadataValue(metadata, "od_category");
  const subProductName = metadataValue(metadata, "od_sub_product_name");
  const productLink = metadataValue(metadata, "od_product_link");
  const date = metadataValue(metadata, "od_date");
  const address = metadataValue(metadata, "od_address");
  const receiverName = metadataValue(metadata, "od_receiver_name");
  const receiverPhone = metadataValue(metadata, "od_receiver_phone");
  const receiverCountryCode = metadataValue(metadata, "od_receiver_country_code");
  const receiverCity = metadataValue(metadata, "od_receiver_city");
  const receiverTown = metadataValue(metadata, "od_receiver_town");
  const receiverPostalCode = metadataValue(metadata, "od_receiver_postal_code");
  const labelNumber = metadataValue(metadata, "od_label_number");
  const amountUsdRaw = metadataValue(metadata, "od_amount_usd");
  const amountUsd = Number(amountUsdRaw ?? "0");

  if (
    !category ||
    !subProductName ||
    !productLink ||
    !date ||
    !address ||
    !receiverName ||
    !receiverPhone ||
    !receiverCountryCode ||
    !receiverCity ||
    !receiverTown ||
    !receiverPostalCode ||
    !labelNumber ||
    Number.isNaN(amountUsd)
  ) {
    return null;
  }

  return {
    storeId: metadataValue(metadata, "od_store_id"),
    category,
    subProductName,
    variantName: metadataValue(metadata, "od_variant_name"),
    productLink,
    listingId: metadataValue(metadata, "od_listing_id"),
    listingKey: metadataValue(metadata, "od_listing_key"),
    listingTitle: metadataValue(metadata, "od_listing_title"),
    listingImageUrl: metadataValue(metadata, "od_listing_image_url"),
    date,
    address,
    receiverName,
    receiverPhone,
    receiverCountryCode,
    receiverState: metadataValue(metadata, "od_receiver_state"),
    receiverCity,
    receiverTown,
    receiverPostalCode,
    note: metadataValue(metadata, "od_note"),
    ioss: metadataValue(metadata, "od_ioss"),
    labelNumber,
    amountUsd,
  };
};

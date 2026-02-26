type Primitive = string | number | boolean | null;

type GenericRecord = Record<string, unknown>;

export type EtsySyncSelectorProbe = {
  selector: string;
  total: number;
  visible: number;
};

export type EtsySyncButtonSnapshot = {
  text: string | null;
  aria_label: string | null;
  data_testid: string | null;
  id: string | null;
  class_name: string | null;
};

export type EtsyPageSyncInput = {
  page_url: string | null;
  path: string | null;
  ui_version: string | null;
  selector_groups: Record<string, EtsySyncSelectorProbe[]>;
  buttons: EtsySyncButtonSnapshot[];
  synced_at: string;
};

export type EtsyPageSyncHints = {
  photo_upload_button: string[];
  image_file_input: string[];
  shipping_select_profile_button: string[];
  shipping_add_profile_button: string[];
  shipping_apply_button: string[];
  processing_add_profile_button: string[];
  processing_apply_button: string[];
  publish_primary_button: string[];
  publish_modal_button: string[];
};

export type EtsyPageSyncResult = {
  hints: EtsyPageSyncHints;
  confidence: number;
  ui_version: string;
  debug: {
    page_url: string | null;
    selector_group_hits: Record<string, number>;
  };
};

const normalizeText = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const normalizeUrl = (value: unknown) => {
  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }

  try {
    return new URL(text).toString();
  } catch {
    return null;
  }
};

const toPlainObject = (value: unknown): GenericRecord => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as GenericRecord;
};

const toArray = (value: unknown) => (Array.isArray(value) ? value : []);

const toSafeString = (value: unknown) => {
  const text = String(value ?? "").trim();
  return text || null;
};

const toSafeNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const asNumber = Number(String(value ?? "").trim());
  return Number.isFinite(asNumber) ? asNumber : 0;
};

const sanitizeSelector = (value: unknown) => {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (text.length > 240) return null;
  return text;
};

const sanitizeSelectorGroup = (value: unknown): EtsySyncSelectorProbe[] =>
  toArray(value)
    .map((entry) => toPlainObject(entry))
    .map((entry) => {
      const selector = sanitizeSelector(entry.selector);
      if (!selector) {
        return null;
      }
      return {
        selector,
        total: Math.max(0, toSafeNumber(entry.total)),
        visible: Math.max(0, toSafeNumber(entry.visible)),
      };
    })
    .filter((entry): entry is EtsySyncSelectorProbe => Boolean(entry));

const sanitizeButtons = (value: unknown): EtsySyncButtonSnapshot[] =>
  toArray(value)
    .slice(0, 200)
    .map((entry) => toPlainObject(entry))
    .map((entry) => ({
      text: toSafeString(entry.text),
      aria_label: toSafeString(entry.aria_label),
      data_testid: toSafeString(entry.data_testid),
      id: toSafeString(entry.id),
      class_name: toSafeString(entry.class_name),
    }));

const sanitizeUiVersion = (value: unknown) => {
  const normalized = normalizeText(value);
  if (normalized === "new-era" || normalized === "old-era") {
    return normalized;
  }
  return "unknown";
};

const knownGroups = [
  "photo_upload_button",
  "image_file_input",
  "shipping_select_profile_button",
  "shipping_add_profile_button",
  "shipping_apply_button",
  "processing_add_profile_button",
  "processing_apply_button",
  "publish_primary_button",
  "publish_modal_button",
] as const;

const DEFAULT_HINTS: EtsyPageSyncHints = {
  photo_upload_button: [
    "#field-listingImages button[data-clg-id='WtButton']",
    "#field-listingImages button.wt-btn.wt-btn--tertiary",
    "button[data-clg-id='WtButton'].wt-btn.wt-btn--tertiary",
    "button.wt-btn.wt-btn--tertiary",
  ],
  image_file_input: [
    "#field-listingImages input[type='file'][multiple]",
    "#field-listingImages input[type='file']",
    "input#listing-photos[type='file']",
    "input[type='file'][multiple][accept*='image']",
    "input[type='file'][accept*='image']",
    "input[type='file']",
  ],
  shipping_select_profile_button: [
    "button.wt-btn.wt-btn--secondary",
    "button[data-clg-id='WtButton'].wt-btn.wt-btn--secondary",
  ],
  shipping_add_profile_button: [
    "button.wt-btn.wt-btn--secondary",
    "button[data-clg-id='WtButton'].wt-btn.wt-btn--secondary",
  ],
  shipping_apply_button: [
    "button[data-testid^='apply-readiness-state']",
    "button[aria-label='apply_aria_label']",
    "button.wt-btn.wt-btn--tertiary",
  ],
  processing_add_profile_button: ["button.wt-btn.wt-btn--secondary"],
  processing_apply_button: [
    "button[data-testid^='apply-readiness-state']",
    "button[data-testid*='apply-readiness-state']",
    "button[aria-label='apply_aria_label']",
  ],
  publish_primary_button: ["button[data-testid='publish']"],
  publish_modal_button: ["button#shop-manager--listing-publish", "button[data-testid='publish']"],
};

const dedupe = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

const isSafeCssToken = (value: string) => /^[A-Za-z0-9_\-:.]+$/.test(value);

const buttonSelectorFromSnapshot = (button: EtsySyncButtonSnapshot) => {
  if (button.data_testid && isSafeCssToken(button.data_testid)) {
    return `button[data-testid='${button.data_testid}']`;
  }
  if (button.id && isSafeCssToken(button.id)) {
    return `button#${button.id}`;
  }
  return null;
};

const resolveButtonDrivenCandidates = (
  buttons: EtsySyncButtonSnapshot[],
  includeTerms: string[],
  excludeTerms: string[] = []
) => {
  const selectors: string[] = [];
  for (const button of buttons) {
    const haystack = normalizeText(`${button.text ?? ""} ${button.aria_label ?? ""}`);
    if (!haystack) {
      continue;
    }
    if (!includeTerms.some((term) => haystack.includes(normalizeText(term)))) {
      continue;
    }
    if (excludeTerms.some((term) => haystack.includes(normalizeText(term)))) {
      continue;
    }
    const selector = buttonSelectorFromSnapshot(button);
    if (selector) {
      selectors.push(selector);
    }
  }
  return dedupe(selectors);
};

const pickGroupSelectors = (groups: Record<string, EtsySyncSelectorProbe[]>, key: keyof EtsyPageSyncHints) => {
  const rows = groups[key] ?? [];
  return rows
    .filter((row) => row.visible > 0 || row.total > 0)
    .sort((a, b) => {
      if (b.visible !== a.visible) {
        return b.visible - a.visible;
      }
      return b.total - a.total;
    })
    .map((row) => row.selector);
};

export const parseEtsyPageSyncInput = (payload: unknown): EtsyPageSyncInput => {
  const body = toPlainObject(payload);
  const groupsRecord = toPlainObject(body.selector_groups);

  const selector_groups = Object.fromEntries(
    knownGroups.map((group) => [group, sanitizeSelectorGroup(groupsRecord[group])])
  ) as Record<string, EtsySyncSelectorProbe[]>;

  return {
    page_url: normalizeUrl(body.page_url),
    path: toSafeString(body.path),
    ui_version: sanitizeUiVersion(body.ui_version),
    selector_groups,
    buttons: sanitizeButtons(body.buttons),
    synced_at: new Date().toISOString(),
  };
};

const computeConfidence = (hints: EtsyPageSyncHints) => {
  const values = Object.values(hints);
  const populated = values.filter((selectors) => selectors.length > 0).length;
  return Number((populated / values.length).toFixed(2));
};

export const deriveEtsySelectorHints = (input: EtsyPageSyncInput): EtsyPageSyncResult => {
  const selector_group_hits: Record<string, number> = {};

  const byGroup = Object.fromEntries(
    knownGroups.map((group) => {
      const selectors = pickGroupSelectors(input.selector_groups, group);
      selector_group_hits[group] = selectors.length;
      return [group, selectors];
    })
  ) as Record<keyof EtsyPageSyncHints, string[]>;

  const buttonHints: Partial<EtsyPageSyncHints> = {
    photo_upload_button: resolveButtonDrivenCandidates(input.buttons, ["upload"], ["cancel", "delete"]),
    shipping_select_profile_button: resolveButtonDrivenCandidates(input.buttons, ["select profile"], ["cancel"]),
    shipping_add_profile_button: resolveButtonDrivenCandidates(input.buttons, ["add profile", "create profile"], ["cancel"]),
    shipping_apply_button: resolveButtonDrivenCandidates(input.buttons, ["apply"], ["cancel", "delete"]),
    processing_add_profile_button: resolveButtonDrivenCandidates(input.buttons, ["add profile"], ["shipping"]),
    processing_apply_button: resolveButtonDrivenCandidates(input.buttons, ["apply"], ["shipping", "cancel"]),
    publish_primary_button: resolveButtonDrivenCandidates(input.buttons, ["publish"], ["cancel"]),
    publish_modal_button: resolveButtonDrivenCandidates(input.buttons, ["publish"], ["cancel"]),
  };

  const merged: EtsyPageSyncHints = {
    photo_upload_button: dedupe([
      ...(byGroup.photo_upload_button ?? []),
      ...(buttonHints.photo_upload_button ?? []),
      ...DEFAULT_HINTS.photo_upload_button,
    ]),
    image_file_input: dedupe([...(byGroup.image_file_input ?? []), ...DEFAULT_HINTS.image_file_input]),
    shipping_select_profile_button: dedupe([
      ...(byGroup.shipping_select_profile_button ?? []),
      ...(buttonHints.shipping_select_profile_button ?? []),
      ...DEFAULT_HINTS.shipping_select_profile_button,
    ]),
    shipping_add_profile_button: dedupe([
      ...(byGroup.shipping_add_profile_button ?? []),
      ...(buttonHints.shipping_add_profile_button ?? []),
      ...DEFAULT_HINTS.shipping_add_profile_button,
    ]),
    shipping_apply_button: dedupe([
      ...(byGroup.shipping_apply_button ?? []),
      ...(buttonHints.shipping_apply_button ?? []),
      ...DEFAULT_HINTS.shipping_apply_button,
    ]),
    processing_add_profile_button: dedupe([
      ...(byGroup.processing_add_profile_button ?? []),
      ...(buttonHints.processing_add_profile_button ?? []),
      ...DEFAULT_HINTS.processing_add_profile_button,
    ]),
    processing_apply_button: dedupe([
      ...(byGroup.processing_apply_button ?? []),
      ...(buttonHints.processing_apply_button ?? []),
      ...DEFAULT_HINTS.processing_apply_button,
    ]),
    publish_primary_button: dedupe([
      ...(byGroup.publish_primary_button ?? []),
      ...(buttonHints.publish_primary_button ?? []),
      ...DEFAULT_HINTS.publish_primary_button,
    ]),
    publish_modal_button: dedupe([
      ...(byGroup.publish_modal_button ?? []),
      ...(buttonHints.publish_modal_button ?? []),
      ...DEFAULT_HINTS.publish_modal_button,
    ]),
  };

  return {
    hints: merged,
    confidence: computeConfidence(merged),
    ui_version: input.ui_version || "unknown",
    debug: {
      page_url: input.page_url,
      selector_group_hits,
    },
  };
};

export const maskPrimitivePayload = (value: unknown): Primitive | Primitive[] | Record<string, Primitive> => {
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => {
      if (entry === null || typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
        return entry;
      }
      return String(entry);
    });
  }

  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (value && typeof value === "object") {
    const result: Record<string, Primitive> = {};
    for (const [key, raw] of Object.entries(value as GenericRecord).slice(0, 40)) {
      if (raw === null || typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
        result[key] = raw;
      } else {
        result[key] = String(raw);
      }
    }
    return result;
  }

  return String(value) as Primitive;
};

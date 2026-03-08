export const normalizeForMatch = (value: string | null | undefined) => {
  if (!value) {
    return "";
  }

  return value
    .toLocaleLowerCase("tr-TR")
    .replaceAll("ı", "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
};

export const buildCategoryNeedles = (category: string | null | undefined) => {
  const normalized = normalizeForMatch(category);
  if (!normalized) {
    return [] as string[];
  }

  const parts = Array.from(
    new Set(
      String(category ?? "")
        .split(/[/|>,;-]+/g)
        .map((part) => normalizeForMatch(part))
        .filter((part) => part.length >= 3)
    )
  );

  return Array.from(new Set([normalized, ...parts]));
};

export type ProductMatchCandidate = {
  id: string;
  titleTr?: string | null;
  titleEn?: string | null;
  categoryTitleTr?: string | null;
  categoryTitleEn?: string | null;
  labelTr?: string | null;
  labelEn?: string | null;
};

const candidateNeedles = (candidate: ProductMatchCandidate) => {
  const rawValues = [
    candidate.titleTr ?? null,
    candidate.titleEn ?? null,
    candidate.labelTr ?? null,
    candidate.labelEn ?? null,
    candidate.categoryTitleTr && candidate.titleTr ? `${candidate.categoryTitleTr} / ${candidate.titleTr}` : null,
    candidate.categoryTitleEn && candidate.titleEn ? `${candidate.categoryTitleEn} / ${candidate.titleEn}` : null,
    candidate.categoryTitleTr && candidate.titleEn ? `${candidate.categoryTitleTr} / ${candidate.titleEn}` : null,
    candidate.categoryTitleEn && candidate.titleTr ? `${candidate.categoryTitleEn} / ${candidate.titleTr}` : null,
  ];

  return Array.from(new Set(rawValues.map((item) => normalizeForMatch(item)).filter(Boolean)));
};

export const resolveProductCandidateForCategory = (
  category: string | null | undefined,
  candidates: ProductMatchCandidate[]
): ProductMatchCandidate | null => {
  const needles = buildCategoryNeedles(category);
  if (!needles.length || !candidates.length) {
    return null;
  }

  let best: ProductMatchCandidate | null = null;
  let bestScore = -1;

  for (const candidate of candidates) {
    const normalizedCandidateNeedles = candidateNeedles(candidate);
    if (!normalizedCandidateNeedles.length) {
      continue;
    }

    let score = 0;
    for (const candidateNeedle of normalizedCandidateNeedles) {
      if (needles.includes(candidateNeedle)) {
        score = Math.max(score, 100);
        continue;
      }

      for (const needle of needles) {
        if (candidateNeedle === needle) {
          score = Math.max(score, 100);
        } else if (candidateNeedle.includes(needle) || needle.includes(candidateNeedle)) {
          score = Math.max(score, 75);
        }
      }
    }

    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return bestScore >= 75 ? best : null;
};

export const buildStrictListingCategoryNeedles = (args: {
  storeCategory?: string | null;
  product?: ProductMatchCandidate | null;
}) => {
  const strict = new Set<string>();
  const fallback = new Set<string>();

  const addStrict = (value: string | null | undefined) => {
    const normalized = normalizeForMatch(value);
    if (normalized) {
      strict.add(normalized);
    }
  };

  const addFallback = (value: string | null | undefined) => {
    for (const needle of buildCategoryNeedles(value)) {
      fallback.add(needle);
    }
  };

  if (args.product) {
    addStrict(args.product.titleTr ?? null);
    addStrict(args.product.titleEn ?? null);
    addStrict(args.product.labelTr ?? null);
    addStrict(args.product.labelEn ?? null);
    addStrict(
      args.product.categoryTitleTr && args.product.titleTr
        ? `${args.product.categoryTitleTr} / ${args.product.titleTr}`
        : null
    );
    addStrict(
      args.product.categoryTitleEn && args.product.titleEn
        ? `${args.product.categoryTitleEn} / ${args.product.titleEn}`
        : null
    );
    addStrict(
      args.product.categoryTitleTr && args.product.titleEn
        ? `${args.product.categoryTitleTr} / ${args.product.titleEn}`
        : null
    );
    addStrict(
      args.product.categoryTitleEn && args.product.titleTr
        ? `${args.product.categoryTitleEn} / ${args.product.titleTr}`
        : null
    );
  }

  addFallback(args.storeCategory ?? null);

  return {
    strict,
    fallback,
  };
};

export const listingCategoryMatchesStoreProfile = (
  listingCategory: string | null | undefined,
  profile: ReturnType<typeof buildStrictListingCategoryNeedles>
) => {
  const normalized = normalizeForMatch(listingCategory);
  if (!normalized) {
    return profile.strict.size === 0 && profile.fallback.size === 0;
  }

  if (profile.strict.size > 0) {
    return profile.strict.has(normalized);
  }

  if (profile.fallback.size > 0) {
    return profile.fallback.has(normalized);
  }

  return true;
};

export const isWebhookCompatibleWithStore = (args: {
  storeProductId?: string | null;
  storeCurrency?: "USD" | "TRY" | null;
  storeCurrencyKnown?: boolean;
  webhookProductId?: string | null;
  webhookCurrency?: "USD" | "TRY" | null;
}) => {
  const storeProductId = String(args.storeProductId ?? "").trim();
  const webhookProductId = String(args.webhookProductId ?? "").trim();

  if (storeProductId) {
    if (!webhookProductId || webhookProductId !== storeProductId) {
      return false;
    }
  }

  if (args.storeCurrencyKnown && args.storeCurrency && args.webhookCurrency && args.webhookCurrency !== args.storeCurrency) {
    return false;
  }

  return true;
};

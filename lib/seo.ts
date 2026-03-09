import type { Metadata } from "next";

export const SITE_NAME = "Listflow";
export const SITE_DOMAIN = "listflow.pro";
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://listflow.pro").replace(/\/+$/, "");
export const DEFAULT_OG_IMAGE = "/og-image.webp";

const DEFAULT_TITLE = "AI-Powered Etsy Automation Platform";
const DEFAULT_DESCRIPTION =
  "Listflow helps Etsy sellers generate products, manage store automation, publish listings, and track operations from one control center.";

const DEFAULT_KEYWORDS = [
  "etsy automation",
  "etsy product generation",
  "etsy ai tools",
  "etsy listing automation",
  "etsy store management",
  "etsy product research",
  "etsy growth software",
  "listflow",
];

type MetadataInput = {
  title?: string;
  description?: string;
  path?: string;
  keywords?: string[];
  noIndex?: boolean;
  type?: "website" | "article";
  image?: string;
};

export const absoluteUrl = (path = "/") => {
  if (!path) {
    return SITE_URL;
  }

  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
};

export const buildMetadata = ({
  title,
  description = DEFAULT_DESCRIPTION,
  path = "/",
  keywords = [],
  noIndex = false,
  type = "website",
  image = DEFAULT_OG_IMAGE,
}: MetadataInput = {}): Metadata => {
  const metadataTitle = title ?? DEFAULT_TITLE;
  const shareTitle = title ? `${title} | ${SITE_NAME}` : `${SITE_NAME} | ${DEFAULT_TITLE}`;
  const canonical = absoluteUrl(path);
  const imageUrl = absoluteUrl(image);

  return {
    title: metadataTitle,
    description,
    keywords: [...DEFAULT_KEYWORDS, ...keywords],
    alternates: {
      canonical,
    },
    openGraph: {
      type,
      url: canonical,
      title: shareTitle,
      description,
      siteName: SITE_NAME,
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: `${SITE_NAME} Open Graph Image`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: shareTitle,
      description,
      images: [imageUrl],
    },
    robots: noIndex
      ? {
          index: false,
          follow: false,
          nocache: true,
          googleBot: {
            index: false,
            follow: false,
            noimageindex: true,
          },
        }
      : {
          index: true,
          follow: true,
          googleBot: {
            index: true,
            follow: true,
            "max-video-preview": -1,
            "max-image-preview": "large",
            "max-snippet": -1,
          },
        },
  };
};

export const buildPrivateMetadata = (title: string, path: string): Metadata =>
  buildMetadata({
    title,
    path,
    noIndex: true,
    keywords: [],
  });

export const rootMetadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} | ${DEFAULT_TITLE}`,
    template: `%s | ${SITE_NAME}`,
  },
  description: DEFAULT_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: DEFAULT_KEYWORDS,
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  category: "technology",
  alternates: {
    canonical: absoluteUrl("/"),
  },
  openGraph: {
    type: "website",
    url: SITE_URL,
    title: `${SITE_NAME} | ${DEFAULT_TITLE}`,
    description: DEFAULT_DESCRIPTION,
    siteName: SITE_NAME,
    images: [
      {
        url: absoluteUrl(DEFAULT_OG_IMAGE),
        width: 1200,
        height: 630,
        alt: `${SITE_NAME} Open Graph Image`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} | ${DEFAULT_TITLE}`,
    description: DEFAULT_DESCRIPTION,
    images: [absoluteUrl(DEFAULT_OG_IMAGE)],
  },
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/favicon.ico",
  },
  manifest: "/manifest.webmanifest",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

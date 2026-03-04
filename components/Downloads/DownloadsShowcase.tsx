"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, useScroll, useTransform } from "framer-motion";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ArrowLeft } from "lucide-react";
import type { SupportedLocale } from "@/lib/i18n/config";
import Footer from "@/components/Footer";

gsap.registerPlugin(ScrollTrigger);

type StoryTempoPreset = "cinematic" | "balanced" | "fast";
type ShowcaseProps = { initialLocale: SupportedLocale };
type BadgeItem = { href: string; badgeUrl: string; fallbackLabel: string };

const STORY_TEMPO_CONFIG: Record<StoryTempoPreset, number> = {
  cinematic: 1.3,
  balanced: 1,
  fast: 0.8,
};

const resolveStoryTempo = (v: string | undefined): StoryTempoPreset => {
  const n = v?.trim().toLowerCase();
  return n === "cinematic" || n === "balanced" || n === "fast" ? n : "balanced";
};

const resolveTempoMultiplier = (v: string | undefined): number => {
  const p = Number(v);
  return Number.isFinite(p) ? Math.min(Math.max(p, 0.5), 2.2) : 1;
};

const env = {
  chromeUrl: process.env.NEXT_PUBLIC_DOWNLOADS_CHROME_URL ?? "",
  iosUrl: process.env.NEXT_PUBLIC_DOWNLOADS_IOS_URL ?? "",
  androidUrl: process.env.NEXT_PUBLIC_DOWNLOADS_ANDROID_URL ?? "",
  heroVideoUrl: process.env.NEXT_PUBLIC_DOWNLOADS_HERO_VIDEO_URL ?? "",
  mobileVideoUrl: process.env.NEXT_PUBLIC_DOWNLOADS_MOBILE_VIDEO_URL ?? "",
  extensionVideoUrl: process.env.NEXT_PUBLIC_DOWNLOADS_EXTENSION_VIDEO_URL ?? "",
  screenshot1Url: process.env.NEXT_PUBLIC_DOWNLOADS_SCREENSHOT_1_URL ?? "",
  screenshot2Url: process.env.NEXT_PUBLIC_DOWNLOADS_SCREENSHOT_2_URL ?? "",
  screenshot3Url: process.env.NEXT_PUBLIC_DOWNLOADS_SCREENSHOT_3_URL ?? "",
  phoneMockupUrl: process.env.NEXT_PUBLIC_DOWNLOADS_PHONE_MOCKUP_URL ?? "",
  laptopMockupUrl: process.env.NEXT_PUBLIC_DOWNLOADS_LAPTOP_MOCKUP_URL ?? "",
  appStoreBadgeUrl: process.env.NEXT_PUBLIC_DOWNLOADS_APP_STORE_BADGE_URL ?? "",
  googlePlayBadgeUrl: process.env.NEXT_PUBLIC_DOWNLOADS_GOOGLE_PLAY_BADGE_URL ?? "",
  chromeStoreBadgeUrl: process.env.NEXT_PUBLIC_DOWNLOADS_CHROME_WEB_STORE_BADGE_URL ?? "",
  storyTempo: resolveStoryTempo(process.env.NEXT_PUBLIC_DOWNLOADS_STORY_TEMPO),
  storyTempoMultiplier: resolveTempoMultiplier(process.env.NEXT_PUBLIC_DOWNLOADS_STORY_TEMPO_MULTIPLIER),
};

export default function DownloadsShowcase({ initialLocale }: ShowcaseProps) {
  const router = useRouter();
  const isTr = initialLocale === "tr";

  const copy = useMemo(
    () =>
      isTr
        ? {
            backCta: "Ana Sayfaya Dön",
            heroKicker: "Listflow Uygulama Ekosistemi",
            heroTitleA: "Tek kontrol merkezinden",
            heroTitleB: "mobil + eklenti",
            heroTitleC: "yayın operasyonu.",
            heroBody:
              "Üretimden yayına kadar tüm akışını tek deneyimde yönet. Hızlı kurulum, net kontrol ve yüksek tempolu listeleme.",
            galleryKicker: "Nasıl Çalışır",
            galleryTitle: "Adım adım listeleme akışı",
            galleryPanels: [
              {
                title: "Ürün Verisi, Otomatik Doldurma",
                body: "N8N veya Google Sheets'ten gelen ürün verisini Chrome eklentisi alır, Etsy formlarını başlık, kategori ve görsellerle eksiksiz doldurur.",
              },
              {
                title: "Mobil ile Anlık Takip",
                body: "iOS ve Android uygulamasından yükleme kuyruğunu ve yayın durumunu izleyin. Masaüstünden uzakta da kontrol sizde.",
              },
              {
                title: "Toplu Yükleme, Durmadan Akış",
                body: "Yüzlerce ürünü sıraya alın, eklenti arka planda çalışsın. Siz başka işlerinizle ilgilenirken operasyon duraksız devam eder.",
              },
            ],
            storyA: "01 — Chrome Eklentisi",
            storyATitle: "Etsy'e Otomatik Listeleme",
            storyADesc:
              "Ürünlerinizi n8n veya Google Sheets üzerinden besleyin; eklenti sırayı alır, Etsy formlarını kategori, görsel ve fiyatla otomatik doldurur ve yayınlar.",
            storyB: "02 — Mobil Uygulama",
            storyBTitle: "Her Yerden Yönet",
            storyBDesc:
              "iOS veya Android uygulamasından yükleme kuyruğunu görün, durumu takip edin. Acil onayları mobilden tamamlayın; akış duraksız devam eder.",
            storyC: "03 — Ekosistem",
            storyCTitle: "Masaüstü + Mobil, Tek Akış",
            storyCDesc:
              "Chrome eklentisi masaüstünde çalışırken mobil uygulama size anlık görünürlük sağlar. Tüm kanalları tek kontrol merkezinden yönetin.",
            mockupMissing: "Gerçek cihaz mockup PNG URL'i eksik. `.env` üzerinden tanımlayın.",
            badgeChrome: "Chrome Web Store",
            badgeIos: "App Store",
            badgeAndroid: "Google Play",
          }
        : {
            backCta: "Back To Home",
            heroKicker: "Listflow App Ecosystem",
            heroTitleA: "Run your publishing",
            heroTitleB: "mobile + extension",
            heroTitleC: "from one command center.",
            heroBody:
              "Manage your full listing operation from generation to publish in one cohesive experience. Faster setup, clearer control, higher throughput.",
            galleryKicker: "How It Works",
            galleryTitle: "Step-by-step publishing flow",
            galleryPanels: [
              {
                title: "Product Data, Auto-Filled",
                body: "The Chrome extension picks up product data from N8N or Google Sheets and auto-fills Etsy forms with titles, categories and images.",
              },
              {
                title: "Live Tracking from Mobile",
                body: "Monitor the upload queue and publish status from iOS or Android. Stay in control even when away from your desktop.",
              },
              {
                title: "Bulk Upload, Continuous Flow",
                body: "Queue hundreds of products and let the extension run in the background. The operation never stops while you focus on other work.",
              },
            ],
            storyA: "01 — Chrome Extension",
            storyATitle: "Auto-List to Etsy",
            storyADesc:
              "Feed products through N8N or Google Sheets; the extension picks up the queue, auto-fills Etsy forms with category, images and price, then publishes.",
            storyB: "02 — Mobile App",
            storyBTitle: "Manage from Anywhere",
            storyBDesc:
              "View the upload queue and track status from iOS or Android. Complete urgent approvals on mobile; the operation keeps moving.",
            storyC: "03 — Ecosystem",
            storyCTitle: "Desktop + Mobile, One Flow",
            storyCDesc:
              "While the Chrome extension works on your desktop, the mobile app gives you real-time visibility. Manage all channels from one control center.",
            mockupMissing: "Real device mockup PNG URL is missing. Configure it in `.env`.",
            badgeChrome: "Chrome Web Store",
            badgeIos: "App Store",
            badgeAndroid: "Google Play",
          },
    [isTr]
  );

  const homeVideoSrc = env.heroVideoUrl || env.extensionVideoUrl || env.mobileVideoUrl;

  const badgeItems: BadgeItem[] = [
    { href: env.iosUrl, badgeUrl: env.appStoreBadgeUrl, fallbackLabel: copy.badgeIos },
    { href: env.androidUrl, badgeUrl: env.googlePlayBadgeUrl, fallbackLabel: copy.badgeAndroid },
    { href: env.chromeUrl, badgeUrl: env.chromeStoreBadgeUrl, fallbackLabel: copy.badgeChrome },
  ];

  const screenshotItems = [
    { src: env.screenshot1Url, ...copy.galleryPanels[0] },
    { src: env.screenshot2Url, ...copy.galleryPanels[1] },
    { src: env.screenshot3Url, ...copy.galleryPanels[2] },
  ];


  // ── Refs ──────────────────────────────────────────────────
  const heroResumeTimerRef = useRef<number | null>(null);
  const heroPauseZoneRef = useRef(false);

  const heroSectionRef = useRef<HTMLElement | null>(null);
  const heroVideoRef = useRef<HTMLVideoElement | null>(null);

  const gallerySectionRef = useRef<HTMLElement | null>(null);
  const galleryTrackRef = useRef<HTMLDivElement | null>(null);

  const storyScopeRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const openingVideoRef = useRef<HTMLDivElement | null>(null);
  const openingVideoMediaRef = useRef<HTMLVideoElement | null>(null);
  const downloadsPanelRef = useRef<HTMLDivElement | null>(null);
  const phoneGroupRef = useRef<HTMLDivElement | null>(null);
  const phoneFrameRef = useRef<HTMLElement | null>(null);
  const phoneVideoRef = useRef<HTMLVideoElement | null>(null);
  const phoneVideoInnerRef = useRef<HTMLDivElement | null>(null);
  const laptopGroupRef = useRef<HTMLDivElement | null>(null);
  const laptopFrameRef = useRef<HTMLElement | null>(null);
  const laptopVideoRef = useRef<HTMLVideoElement | null>(null);
  const captionARef = useRef<HTMLDivElement | null>(null);
  const captionBRef = useRef<HTMLDivElement | null>(null);
  const captionCRef = useRef<HTMLDivElement | null>(null);

  // ── Framer Motion hero scroll animations ──────────────────
  // Hero section is 500vh tall. Scroll percentages:
  //   0–6%   : video only, no text
  //   6–40%  : text lines reveal bottom→top one by one
  //   40–72% : texts fully visible, grain fades (52–68%), shade darkens
  //   72–83% : texts fade out upward
  //   83–100%: watch window — video pauses on scroll
  const { scrollYProgress: heroProgress } = useScroll({
    target: heroSectionRef,
    offset: ["start start", "end end"],
  });

  const heroVideoScale = useTransform(heroProgress, [0, 0.6], [1, 1.04]);
  const heroGrainOpacity = useTransform(heroProgress, [0.52, 0.68], [1, 0]);
  const heroShadeBg = useTransform(
    heroProgress,
    [0.52, 0.68],
    ["rgba(5,7,12,0)", "rgba(5,7,12,0.28)"]
  );
  const heroTextGroupY = useTransform(heroProgress, [0.72, 0.84], [0, -38]);

  const kickerOpacity = useTransform(heroProgress, [0.06, 0.14, 0.73, 0.82], [0, 1, 1, 0]);
  const kickerY      = useTransform(heroProgress, [0.06, 0.14, 0.73, 0.82], [44, 0, 0, -28]);

  const line1Opacity = useTransform(heroProgress, [0.12, 0.20, 0.73, 0.82], [0, 1, 1, 0]);
  const line1Y       = useTransform(heroProgress, [0.12, 0.20, 0.73, 0.82], [44, 0, 0, -28]);

  const line2Opacity = useTransform(heroProgress, [0.18, 0.26, 0.73, 0.82], [0, 1, 1, 0]);
  const line2Y       = useTransform(heroProgress, [0.18, 0.26, 0.73, 0.82], [44, 0, 0, -28]);

  const line3Opacity = useTransform(heroProgress, [0.24, 0.32, 0.73, 0.82], [0, 1, 1, 0]);
  const line3Y       = useTransform(heroProgress, [0.24, 0.32, 0.73, 0.82], [44, 0, 0, -28]);

  const bodyOpacity  = useTransform(heroProgress, [0.30, 0.40, 0.73, 0.82], [0, 1, 1, 0]);
  const bodyY        = useTransform(heroProgress, [0.30, 0.40, 0.73, 0.82], [44, 0, 0, -28]);


  // ── Hide Crisp on this page ────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = "listflow-downloads-hide-crisp";
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = id;
      el.textContent = "#crisp-chatbox, #crisp-client, .crisp-client { display: none !important; }";
      document.head.appendChild(el);
    }
    const w = window as Window & { $crisp?: unknown[] };
    if (!w.$crisp) w.$crisp = [];
    w.$crisp.push(["do", "chat:hide"]);
    w.$crisp.push(["do", "chat:close"]);
    return () => { el?.remove(); };
  }, []);

  // ── Watch window: track whether we're in 83-100% of hero ──
  useEffect(() => {
    const unsub = heroProgress.on("change", (v) => {
      const inWatch = v >= 0.83;
      heroPauseZoneRef.current = inWatch;
      if (!inWatch) {
        const vid = heroVideoRef.current;
        if (vid?.paused) void vid.play().catch(() => {});
      }
    });
    return () => { unsub(); };
  }, [heroProgress]);

  // ── Pause hero video while scrolling (only in watch window) ─
  useEffect(() => {
    const pauseAndArmResume = () => {
      if (!heroPauseZoneRef.current) return;
      const video = heroVideoRef.current;
      if (!video) return;
      video.pause();
      if (heroResumeTimerRef.current != null) window.clearTimeout(heroResumeTimerRef.current);
      heroResumeTimerRef.current = window.setTimeout(() => {
        if (!heroPauseZoneRef.current) return;
        void heroVideoRef.current?.play().catch(() => {});
      }, 180);
    };
    window.addEventListener("wheel", pauseAndArmResume, { passive: true });
    window.addEventListener("touchmove", pauseAndArmResume, { passive: true });
    window.addEventListener("scroll", pauseAndArmResume, { passive: true });
    return () => {
      window.removeEventListener("wheel", pauseAndArmResume);
      window.removeEventListener("touchmove", pauseAndArmResume);
      window.removeEventListener("scroll", pauseAndArmResume);
      if (heroResumeTimerRef.current != null) window.clearTimeout(heroResumeTimerRef.current);
    };
  }, []);

  // ── Safari-safe inline video setup ────────────────────────
  useEffect(() => {
    const prep = (v: HTMLVideoElement | null) => {
      if (!v) return;
      v.muted = true; v.autoplay = true; v.loop = true; v.playsInline = true; v.preload = "metadata";
      v.setAttribute("playsinline", "true");
      v.setAttribute("webkit-playsinline", "true");
      v.setAttribute("x5-playsinline", "true");
      v.setAttribute("x-webkit-airplay", "deny");
      v.setAttribute("disablepictureinpicture", "true");
      v.setAttribute("controlslist", "nodownload noplaybackrate noremoteplayback nofullscreen");
      v.setAttribute("disableremoteplayback", "true");
      void v.play().catch(() => {});
    };
    prep(heroVideoRef.current);
    prep(openingVideoMediaRef.current);
    prep(phoneVideoRef.current);
    prep(laptopVideoRef.current);
  }, []);

  // ── Gallery: horizontal scroll ─────────────────────────────
  useLayoutEffect(() => {
    const section = gallerySectionRef.current;
    const track = galleryTrackRef.current;
    if (!section || !track) return;
    const panels = Array.from(track.querySelectorAll<HTMLElement>("[data-gallery-panel]"));
    if (!panels.length) return;
    const mm = gsap.matchMedia();
    mm.add("(min-width: 1024px)", () => {
      gsap.set(track, { xPercent: 0 });
      gsap.to(track, {
        xPercent: -100 * (panels.length - 1),
        ease: "none",
        scrollTrigger: {
          trigger: section, start: "top top",
          end: `+=${(panels.length - 1) * 1700}`,
          pin: true, scrub: 1, anticipatePin: 1, invalidateOnRefresh: true,
        },
      });
    });
    mm.add("(max-width: 1023px)", () => { gsap.set(track, { xPercent: 0 }); });
    return () => { mm.revert(); };
  }, []);

  // ── Story: full-screen → iPhone landscape → portrait → compose ─
  useLayoutEffect(() => {
    const storyScope   = storyScopeRef.current;
    const stage        = stageRef.current;
    const openingVideo = openingVideoRef.current;
    const downloadsPanel = downloadsPanelRef.current;
    const phoneGroup   = phoneGroupRef.current;
    const phoneFrame   = phoneFrameRef.current;
    const phoneVideoInner = phoneVideoInnerRef.current;
    const laptopGroup  = laptopGroupRef.current;
    const laptopFrame  = laptopFrameRef.current;
    const captionA     = captionARef.current;
    const captionB     = captionBRef.current;
    const captionC     = captionCRef.current;

    if (!storyScope || !stage || !openingVideo || !downloadsPanel || !phoneGroup ||
        !phoneFrame || !laptopGroup || !laptopFrame || !captionA || !captionB || !captionC) {
      return;
    }

    const baseTempo = STORY_TEMPO_CONFIG[env.storyTempo] ?? 1;
    const tempo = baseTempo * env.storyTempoMultiplier;
    const mm = gsap.matchMedia();

    mm.add("(min-width: 1024px)", () => {
      const phonePortraitWidth  = "34vh";
      const phonePortraitHeight = "74vh";
      // Counter-rotation scale: fills landscape phone visual area completely
      const landscapeVideoScale = 74 / 34;

      gsap.set(captionA, { autoAlpha: 1, y: 0 });
      gsap.set([captionB, captionC], { autoAlpha: 0, y: 24 });
      gsap.set(openingVideo, { autoAlpha: 1 });
      gsap.set(downloadsPanel, { autoAlpha: 0, y: 140 });
      gsap.set(phoneGroup, {
        width: phonePortraitWidth, height: phonePortraitHeight,
        xPercent: -50, yPercent: -50, x: 0, y: 0,
        scale: 2.72, borderRadius: "36px", rotation: 90, autoAlpha: 0,
        transformOrigin: "50% 50%",
      });
      gsap.set(phoneFrame, { autoAlpha: env.phoneMockupUrl ? 1 : 0 });
      if (phoneVideoInner) {
        gsap.set(phoneVideoInner, {
          rotation: -90, scale: landscapeVideoScale, transformOrigin: "50% 50%",
        });
      }
      gsap.set(laptopGroup, { autoAlpha: 0, y: 80, scale: 0.92 });

      const holdFull       = 5 * tempo;
      const shrinkLandscape = 1.25 * tempo;
      const holdLandscape  = 5 * tempo;
      const rotatePortrait = 1.35 * tempo;
      const settleCompose  = 1.55 * tempo;
      const holdCompose    = 5 * tempo;
      const revealDownloads = 1.1 * tempo;
      const holdFinal      = 5 * tempo;

      const tl = gsap.timeline({
        defaults: { ease: "power2.inOut" },
        scrollTrigger: {
          trigger: storyScope, start: "top top", end: "bottom bottom",
          scrub: 1.15 * tempo,
        },
      });

      tl.to({}, { duration: holdFull })
        .to(captionA, { autoAlpha: 0, y: -18, duration: 0.45 * tempo }, "<")
        .to(openingVideo, { autoAlpha: 0, duration: 0.75 * tempo }, "<0.05")
        .to(phoneGroup, { autoAlpha: 1, scale: 1, duration: shrinkLandscape, ease: "power2.out" }, "<0.08")
        .to(captionB, { autoAlpha: 1, y: 0, duration: 0.56 * tempo }, "<0.2")
        .to({}, { duration: holdLandscape })
        .to(phoneGroup, { rotation: 0, duration: rotatePortrait, ease: "power2.inOut" }, ">")
        .to(
          phoneVideoInner ?? {},
          { rotation: 0, scale: 1, duration: rotatePortrait, ease: "power2.inOut" },
          "<"
        )
        .to(captionB, { autoAlpha: 0, y: -18, duration: 0.42 * tempo }, "<0.2")
        .to(captionC, { autoAlpha: 1, y: 0, duration: 0.52 * tempo }, "<0.1")
        .to(phoneGroup, { x: "26.5vw", y: "4.5vh", scale: 0.76, duration: settleCompose }, ">")
        .to(laptopGroup, { autoAlpha: 1, y: 0, scale: 1, duration: settleCompose }, "<0.14")
        .to({}, { duration: holdCompose })
        .to(downloadsPanel, { autoAlpha: 1, y: 0, duration: revealDownloads, ease: "power3.out" }, ">")
        .to({}, { duration: holdFinal });
    });

    mm.add("(max-width: 1023px)", () => {
      gsap.set(captionA, { autoAlpha: 1, y: 0 });
      gsap.set([captionB, captionC], { autoAlpha: 0, y: 0 });
      gsap.set(openingVideo, { autoAlpha: 1 });
      gsap.set(downloadsPanel, { autoAlpha: 1, y: 0 });
      gsap.set(phoneFrame, { autoAlpha: env.phoneMockupUrl ? 1 : 0 });
      gsap.set(phoneGroup, {
        width: "34vh", height: "74vh", borderRadius: "36px",
        xPercent: -50, yPercent: -50, rotation: 0, transformOrigin: "50% 50%", autoAlpha: 1,
      });
      if (phoneVideoInner) gsap.set(phoneVideoInner, { rotation: 0, scale: 1 });
      gsap.set(laptopGroup, { autoAlpha: 1, y: 0, scale: 1 });
    });

    const ensurePlay = async (v: HTMLVideoElement | null) => {
      if (!v) return;
      try { await v.play(); } catch { /* autoplay blocked */ }
    };
    ensurePlay(phoneVideoRef.current);
    ensurePlay(laptopVideoRef.current);

    return () => { mm.revert(); ScrollTrigger.refresh(); };
  }, []);

  const phoneHasMockup  = Boolean(env.phoneMockupUrl);
  const laptopHasMockup = Boolean(env.laptopMockupUrl);

  // ── JSX ───────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#040406] text-white">

      {/* Back button — fixed top-left, always visible */}
      <motion.button
        type="button"
        onClick={() => router.push("/")}
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.4, ease: "easeOut" }}
        className="fixed left-6 top-6 z-50 rounded-full border border-white/20 bg-[#0b0b12]/88 px-4 py-2.5 text-xs font-black uppercase tracking-[0.16em] text-white backdrop-blur-xl hover:border-white/40"
      >
        <span className="inline-flex items-center gap-2">
          <ArrowLeft className="h-4 w-4" />
          {copy.backCta}
        </span>
      </motion.button>

      <main>
        {/* ── HERO: Full-screen video + scroll-driven text reveal ── */}
        {/* 500vh height → Framer Motion useScroll drives every element */}
        <section ref={heroSectionRef} className="relative h-[500vh]">
          <div className="sticky top-0 h-screen overflow-hidden">

            {/* Video with subtle scale-up */}
            <motion.div
              className="absolute inset-0"
              style={{ scale: heroVideoScale, transformOrigin: "50% 50%" }}
            >
              {homeVideoSrc ? (
                <video
                  ref={heroVideoRef}
                  src={homeVideoSrc}
                  autoPlay
                  muted
                  playsInline
                  loop
                  preload="metadata"
                  controls={false}
                  disablePictureInPicture
                  controlsList="nodownload noplaybackrate noremoteplayback nofullscreen"
                  className="absolute inset-0 h-full w-full object-cover"
                  style={{ WebkitTransform: "translateZ(0)" }}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-950 px-6 text-center text-sm font-semibold text-slate-400">
                  NEXT_PUBLIC_DOWNLOADS_HERO_VIDEO_URL
                </div>
              )}
            </motion.div>

            {/* Shade darkens as texts appear */}
            <motion.div
              className="pointer-events-none absolute inset-0"
              style={{ backgroundColor: heroShadeBg }}
            />

            {/* Film grain — fades out when all texts are visible */}
            <motion.div
              className="pointer-events-none absolute inset-0"
              style={{
                opacity: heroGrainOpacity,
                backgroundImage:
                  "repeating-radial-gradient(rgba(255,255,255,0.12) 0 0.45px, transparent 0.45px 1.9px), repeating-radial-gradient(rgba(0,0,0,0.1) 0 0.5px, transparent 0.5px 2.2px)",
                backgroundSize: "3.5px 3.5px, 4.1px 4.1px",
                backgroundPosition: "0 0, 1.4px 1.2px",
              }}
            />

            {/* Text group — moves up slightly as it fades out */}
            <motion.div
              className="relative z-10 mx-auto flex h-full max-w-7xl items-center justify-center px-6 text-center"
              style={{ y: heroTextGroupY }}
            >
              <div className="max-w-5xl">
                <motion.p
                  className="mb-6 text-xs font-black uppercase tracking-[0.24em] text-indigo-300"
                  style={{ opacity: kickerOpacity, y: kickerY }}
                >
                  {copy.heroKicker}
                </motion.p>

                <h1 className="text-balance text-5xl font-black leading-[1.03] tracking-tight sm:text-6xl md:text-7xl lg:text-[5.9rem]">
                  <motion.span
                    className="block text-white"
                    style={{ opacity: line1Opacity, y: line1Y }}
                  >
                    {copy.heroTitleA}
                  </motion.span>
                  <motion.span
                    className="block bg-linear-to-r from-indigo-300 via-blue-200 to-cyan-300 bg-clip-text text-transparent"
                    style={{ opacity: line2Opacity, y: line2Y }}
                  >
                    {copy.heroTitleB}
                  </motion.span>
                  <motion.span
                    className="block text-white"
                    style={{ opacity: line3Opacity, y: line3Y }}
                  >
                    {copy.heroTitleC}
                  </motion.span>
                </h1>

                <motion.p
                  className="mx-auto mt-8 max-w-3xl text-pretty text-base font-medium leading-relaxed text-slate-200 md:text-lg"
                  style={{ opacity: bodyOpacity, y: bodyY }}
                >
                  {copy.heroBody}
                </motion.p>
              </div>
            </motion.div>

          </div>
        </section>

        {/* ── GALLERY: Horizontal scroll with feature panels ── */}
        <section ref={gallerySectionRef} className="relative h-[360vh] bg-[#05050b]">
          <div className="sticky top-0 h-screen overflow-hidden border-y border-white/10">
            <div className="pointer-events-none absolute left-1/2 top-8 z-20 -translate-x-1/2 text-center">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-indigo-300">{copy.galleryKicker}</p>
              <h2 className="mt-3 text-3xl font-black tracking-tight text-white md:text-5xl">{copy.galleryTitle}</h2>
            </div>

            <div
              ref={galleryTrackRef}
              className="flex h-full"
              style={{ width: `${screenshotItems.length * 100}vw` }}
            >
              {screenshotItems.map((item) => (
                <div
                  key={item.title}
                  data-gallery-panel
                  className="relative h-full w-screen shrink-0 px-6 pb-12 pt-24 md:px-10 md:pb-16 md:pt-28"
                >
                  <div className="mx-auto grid h-full max-w-7xl grid-cols-1 gap-8 md:grid-cols-12 md:items-center">
                    <div className="md:col-span-7">
                      <div className="overflow-hidden rounded-[30px] border border-white/12 bg-[#0a0a12]">
                        {item.src ? (
                          <img src={item.src} alt={item.title} className="h-[58vh] w-full object-cover" />
                        ) : (
                          <div className="flex h-[58vh] w-full items-center justify-center bg-slate-950 px-6 text-center text-sm font-semibold text-slate-400">
                            Screenshot URL missing
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="md:col-span-5">
                      <h3 className="text-2xl font-black tracking-tight text-white md:text-4xl">{item.title}</h3>
                      <p className="mt-4 text-base leading-relaxed text-slate-300 md:text-lg">{item.body}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── STORY: full-screen → iPhone landscape → portrait → multi-device ── */}
        <section ref={storyScopeRef} className="relative h-[1200vh]">
          <div ref={stageRef} className="sticky top-0 h-screen overflow-hidden border-y border-white/10 bg-black">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(99,102,241,0.24),rgba(2,2,4,0.92)_45%)]" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_85%,rgba(59,130,246,0.16),rgba(2,2,4,0.95)_50%)]" />

            {/* Scene A: Opening full-screen video */}
            <div ref={openingVideoRef} className="absolute inset-0 z-12">
              {env.mobileVideoUrl ? (
                <video
                  ref={openingVideoMediaRef}
                  src={env.mobileVideoUrl}
                  autoPlay muted playsInline loop preload="metadata"
                  controls={false} disablePictureInPicture
                  controlsList="nodownload noplaybackrate noremoteplayback nofullscreen"
                  className="h-full w-full object-cover"
                  style={{ WebkitTransform: "translateZ(0)" }}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-slate-950 px-6 text-center text-sm font-semibold text-slate-400">
                  NEXT_PUBLIC_DOWNLOADS_MOBILE_VIDEO_URL
                </div>
              )}
            </div>

            {/* iPhone mockup */}
            <div
              ref={phoneGroupRef}
              className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 overflow-hidden bg-black shadow-[0_40px_120px_rgba(0,0,0,0.65)]"
            >
              <div className="absolute inset-0 bg-slate-950">
                {/* Video inner: GSAP counter-rotates this so content is upright in landscape */}
                <div
                  ref={phoneVideoInnerRef}
                  className="absolute inset-0"
                  style={{ transformOrigin: "50% 50%" }}
                >
                  {env.mobileVideoUrl ? (
                    <video
                      ref={phoneVideoRef}
                      src={env.mobileVideoUrl}
                      autoPlay muted playsInline loop preload="metadata"
                      controls={false} disablePictureInPicture
                      controlsList="nodownload noplaybackrate noremoteplayback nofullscreen"
                      className="absolute inset-0 h-full w-full object-cover"
                      style={{ WebkitTransform: "translateZ(0)" }}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-slate-950 px-6 text-center text-sm font-semibold text-slate-400">
                      NEXT_PUBLIC_DOWNLOADS_MOBILE_VIDEO_URL
                    </div>
                  )}
                </div>

                {phoneHasMockup ? (
                  <img
                    ref={(n) => { phoneFrameRef.current = n; }}
                    src={env.phoneMockupUrl}
                    alt="iPhone mockup frame"
                    className="pointer-events-none absolute inset-0 z-10 h-full w-full object-contain"
                  />
                ) : (
                  <div
                    ref={(n) => { phoneFrameRef.current = n; }}
                    className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-center px-6 pb-6 text-center text-[11px] font-bold uppercase tracking-[0.12em] text-amber-300"
                  >
                    {copy.mockupMissing}
                  </div>
                )}
              </div>
            </div>

            {/* Laptop / extension video */}
            <div
              ref={laptopGroupRef}
              className="absolute left-[46%] top-[56%] z-10 w-[min(58vw,980px)] max-w-245 -translate-x-1/2 -translate-y-1/2 overflow-hidden bg-black shadow-[0_42px_130px_rgba(0,0,0,0.7)]"
              style={{ aspectRatio: "16 / 9" }}
            >
              {env.extensionVideoUrl ? (
                <video
                  ref={laptopVideoRef}
                  src={env.extensionVideoUrl}
                  autoPlay muted playsInline loop preload="metadata"
                  controls={false} disablePictureInPicture
                  controlsList="nodownload noplaybackrate noremoteplayback nofullscreen"
                  className="h-full w-full object-cover"
                  style={{ WebkitTransform: "translateZ(0)" }}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-slate-950 px-6 text-center text-sm font-semibold text-slate-400">
                  NEXT_PUBLIC_DOWNLOADS_EXTENSION_VIDEO_URL
                </div>
              )}
              {laptopHasMockup ? (
                <img
                  ref={(n) => { laptopFrameRef.current = n; }}
                  src={env.laptopMockupUrl}
                  alt="MacBook Air mockup frame"
                  className="pointer-events-none absolute inset-0 h-full w-full object-contain"
                />
              ) : (
                <div
                  ref={(n) => { laptopFrameRef.current = n; }}
                  className="pointer-events-none absolute inset-0 flex items-end justify-center px-6 pb-6 text-center text-[11px] font-bold uppercase tracking-[0.12em] text-amber-300"
                >
                  {copy.mockupMissing}
                </div>
              )}
            </div>

            {/* Scene captions */}
            <div className="pointer-events-none absolute inset-x-0 top-[8vh] z-30 mx-auto max-w-5xl px-6 text-center">
              <div ref={captionARef}>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-indigo-300">{copy.storyA}</p>
                <h2 className="mt-3 text-3xl font-black tracking-tight text-white md:text-5xl">{copy.storyATitle}</h2>
                <p className="mx-auto mt-4 max-w-2xl text-sm font-medium leading-relaxed text-slate-300 md:text-base">{copy.storyADesc}</p>
              </div>
              <div ref={captionBRef}>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-300">{copy.storyB}</p>
                <h2 className="mt-3 text-3xl font-black tracking-tight text-white md:text-5xl">{copy.storyBTitle}</h2>
                <p className="mx-auto mt-4 max-w-2xl text-sm font-medium leading-relaxed text-slate-300 md:text-base">{copy.storyBDesc}</p>
              </div>
              <div ref={captionCRef}>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-blue-300">{copy.storyC}</p>
                <h2 className="mt-3 text-3xl font-black tracking-tight text-white md:text-5xl">{copy.storyCTitle}</h2>
                <p className="mx-auto mt-4 max-w-2xl text-sm font-medium leading-relaxed text-slate-300 md:text-base">{copy.storyCDesc}</p>
              </div>
            </div>

            {/* Download badges panel */}
            <div ref={downloadsPanelRef} className="absolute inset-x-0 bottom-[6vh] z-40 mx-auto max-w-5xl px-6">
              <div className="rounded-3xl border border-white/16 bg-[#090913]/82 p-4 backdrop-blur-xl md:p-5">
                <div className="grid gap-3 md:grid-cols-3">
                  {badgeItems.map((item) => {
                    const hasBadge = Boolean(item.badgeUrl);
                    const hasLink  = Boolean(item.href);
                    return (
                      <a
                        key={item.fallbackLabel}
                        href={hasLink ? item.href : undefined}
                        target={hasLink ? "_blank" : undefined}
                        rel={hasLink ? "noreferrer" : undefined}
                        className="group flex min-h-18 items-center justify-center rounded-xl border border-white/14 bg-white/4 px-3 py-2 transition hover:border-white/30 hover:bg-white/8"
                      >
                        {hasBadge ? (
                          <img
                            src={item.badgeUrl}
                            alt={item.fallbackLabel}
                            className="h-11 w-auto object-contain transition group-hover:scale-[1.02]"
                          />
                        ) : (
                          <span className="text-xs font-black uppercase tracking-[0.14em] text-slate-100">
                            {item.fallbackLabel}
                          </span>
                        )}
                      </a>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

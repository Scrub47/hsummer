/** Versioned so a Home Screen install does not keep the previous artwork. */
export const ICON_VERSION = "v2";

export const icon192 = `/icons/icon-192-${ICON_VERSION}.png`;
export const icon512 = `/icons/icon-512-${ICON_VERSION}.png`;
export const icon192Maskable = `/icons/icon-192-maskable-${ICON_VERSION}.png`;
export const icon512Maskable = `/icons/icon-512-maskable-${ICON_VERSION}.png`;
export const appleTouchIcon = `/icons/apple-touch-icon-${ICON_VERSION}.png`;
export const favicon32 = `/icons/favicon-32-${ICON_VERSION}.png`;
export const faviconIco = `/icons/favicon-${ICON_VERSION}.ico`;
export const logoMarkLarge = `/brand/logo-512-${ICON_VERSION}.webp`;
export const logoMarkSmall = `/brand/logo-256-${ICON_VERSION}.webp`;
export const logoPng = `/brand/logo-512-${ICON_VERSION}.png`;

export const appleStartupImages = [
  {
    url: `/icons/apple-splash-1170x2532-${ICON_VERSION}.png`,
    media:
      "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
  },
  {
    url: `/icons/apple-splash-1179x2556-${ICON_VERSION}.png`,
    media:
      "(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
  },
  {
    url: `/icons/apple-splash-1206x2622-${ICON_VERSION}.png`,
    media:
      "(device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
  },
  {
    url: `/icons/apple-splash-1290x2796-${ICON_VERSION}.png`,
    media:
      "(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
  },
  {
    url: `/icons/apple-splash-1320x2868-${ICON_VERSION}.png`,
    media:
      "(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
  },
] as const;

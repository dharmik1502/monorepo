export type SupportedPlatform =
  | 'instagram'
  | 'facebook'
  | 'twitter'
  | 'pinterest'
  | 'unknown';

const PLATFORM_PATTERNS: Record<SupportedPlatform, RegExp[]> = {
  instagram: [
    /^https?:\/\/(www\.)?instagram\.com\/(p|reel|tv|stories)\/[\w-]+/,
    /^https?:\/\/instagr\.am\//,
  ],
  facebook: [
    /^https?:\/\/(www\.|m\.)?facebook\.com\/.*\/videos\//,
    /^https?:\/\/(www\.|m\.)?facebook\.com\/watch/,
    /^https?:\/\/(www\.|m\.)?facebook\.com\/reel\//,
    /^https?:\/\/fb\.watch\//,
  ],
  twitter: [
    /^https?:\/\/(www\.)?(twitter|x)\.com\/\w+\/status\/\d+/,
    /^https?:\/\/t\.co\//,
  ],
  pinterest: [
    /^https?:\/\/(www\.)?pinterest\.(com|co\.\w+)\/pin\//,
    /^https?:\/\/pin\.it\//,
  ],
  unknown: [],
};

export function detectPlatform(url: string): SupportedPlatform {
  for (const [platform, patterns] of Object.entries(PLATFORM_PATTERNS)) {
    if (platform === 'unknown') continue;
    if (patterns.some((p) => p.test(url))) {
      return platform as SupportedPlatform;
    }
  }
  return 'unknown';
}

export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

export function isSupportedPlatform(url: string): boolean {
  return detectPlatform(url) !== 'unknown';
}

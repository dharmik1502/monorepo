#!/usr/bin/env node
/*
Simple Node.js script to download Instagram reels using ScrapeCreators.

Usage:
  node scripts/download_reels.js <instagram_url> [output_folder]

Provide your ScrapeCreators API key via environment variable `SCRAPE_CREATORS_API_KEY`
or by passing `--key=YOUR_KEY` as an argument.

Example:
  SCRAPE_CREATORS_API_KEY=YOUR_KEY node scripts/download_reels.js "https://www.instagram.com/reel/DZ70yc9NwHN/" downloads
*/

const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');

function usageAndExit() {
  console.error('Usage: node scripts/download_reels.js <instagram_url> [output_folder]');
  process.exit(1);
}

function getFlag(name) {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return null;
}

const instaUrl = process.argv[2];
if (!instaUrl) usageAndExit();
const outDir = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'downloads';
const apiKey = process.env.SCRAPE_CREATORS_API_KEY || getFlag('key');
if (!apiKey) {
  console.error('Error: SCRAPE_CREATORS_API_KEY environment variable or --key=YOUR_KEY is required.');
  process.exit(2);
}

const apiUrl = `https://api.scrapecreators.com/v1/instagram/post?url=${encodeURIComponent(instaUrl)}`;

function findDownloadUrls(value) {
  const found = new Set();
  const urlRegex = /(https?:\/\/[^\\s'"\]]+?\.(mp4|m3u8|jpg|jpeg|png|webp))(?:[\?#][^\s'"\]]*)?/ig;

  function walk(item) {
    if (item === null || item === undefined) return;
    if (typeof item === 'string') {
      let match;
      while ((match = urlRegex.exec(item)) !== null) {
        found.add(match[1]);
      }
    } else if (Array.isArray(item)) {
      item.forEach(walk);
    } else if (typeof item === 'object') {
      Object.values(item).forEach(walk);
    }
  }

  walk(value);
  return Array.from(found);
}

function resolveMediaUrl(json) {
  if (!json || typeof json !== 'object') return null;

  const candidates = [];
  function pushIf(url) {
    if (typeof url === 'string' && url.startsWith('http')) candidates.push(url);
  }

  pushIf(json.url);
  pushIf(json.video_url);
  pushIf(json.download_url);
  pushIf(json.media_url);

  if (json.result) {
    if (Array.isArray(json.result)) {
      json.result.forEach(item => {
        if (item && typeof item === 'object') {
          pushIf(item.url);
          pushIf(item.download_url);
          pushIf(item.link);
          pushIf(item.video_url);
        }
      });
    } else if (typeof json.result === 'object') {
      pushIf(json.result.url);
      pushIf(json.result.download_url);
      pushIf(json.result.link);
      pushIf(json.result.video_url);
    }
  }

  if (json.data) {
    if (Array.isArray(json.data)) {
      json.data.forEach(item => {
        if (item && typeof item === 'object') {
          pushIf(item.url);
          pushIf(item.download_url);
          pushIf(item.link);
          pushIf(item.video_url);
        }
      });
    } else if (typeof json.data === 'object') {
      pushIf(json.data.url);
      pushIf(json.data.download_url);
      pushIf(json.data.link);
      pushIf(json.data.video_url);
    }
  }

  if (json.links && Array.isArray(json.links)) {
    json.links.forEach(item => {
      if (item && typeof item === 'object') {
        pushIf(item.url);
        pushIf(item.link);
        pushIf(item.download_url);
      }
    });
  }

  return candidates.find(url => url.match(/\.(mp4|jpg|jpeg|png|webp)(?:[?#]|$)/i)) || candidates[0] || null;
}

async function downloadToFile(fileUrl, destPath) {
  const res = await fetch(fileUrl, { headers: { 'User-Agent': 'node-download-script' } });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  await pipeline(res.body, fs.createWriteStream(destPath));
  return destPath;
}

(async function main() {
  try {
    const resolvedOutDir = path.resolve(outDir);
    if (!fs.existsSync(resolvedOutDir)) fs.mkdirSync(resolvedOutDir, { recursive: true });

    console.log('Requesting ScrapeCreators to resolve media URLs...');
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('API error', response.status, text);
      process.exit(3);
    }

    const responseContentType = response.headers.get('content-type') || '';
    if (responseContentType.startsWith('video/') || responseContentType.startsWith('image/')) {
      const ext = responseContentType.split('/')[1].split(';')[0] || 'bin';
      const mediaFile = path.join(resolvedOutDir, `media_${Date.now()}.${ext}`);
      await pipeline(response.body, fs.createWriteStream(mediaFile));
      console.log('Saved direct media to', mediaFile);
      return;
    }

    const bodyText = await response.text();
    let parsed = null;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      parsed = null;
    }

    const urlsFromJson = parsed ? findDownloadUrls(parsed) : [];
    const urlsFromText = findDownloadUrls(bodyText);
    const mediaUrls = Array.from(new Set([...urlsFromJson, ...urlsFromText]));

    if (!mediaUrls.length) {
      const fallbackUrl = resolveMediaUrl(parsed);
      if (fallbackUrl) mediaUrls.push(fallbackUrl);
    }

    if (!mediaUrls.length) {
      console.error('No media URLs found in API response. Response body:');
      console.error(bodyText);
      process.exit(4);
    }

    console.log(`Found ${mediaUrls.length} candidate media URL(s). Starting downloads...`);
    const savedFiles = [];

    for (let i = 0; i < mediaUrls.length; i++) {
      const fileUrl = mediaUrls[i];
      const extMatch = fileUrl.match(/\.([a-zA-Z0-9]+)(?:[?#]|$)/);
      const ext = extMatch ? extMatch[1].toLowerCase() : 'bin';
      const dest = path.join(resolvedOutDir, `${Date.now()}_${i + 1}.${ext}`);
      try {
        await downloadToFile(fileUrl, dest);
        console.log('Saved', dest);
        savedFiles.push(dest);
      } catch (err) {
        console.error('Failed to download', fileUrl, err.message);
      }
    }

    console.log('Done. Files saved:', savedFiles.length);
  } catch (err) {
    console.error('Fatal error:', err && err.message ? err.message : err);
    process.exit(99);
  }
})();



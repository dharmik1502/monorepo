import Link from "next/link";

export default function Footer() {
  return (
    <footer className="relative z-10 border-t border-white/10">
      <div className="max-w-6xl mx-auto px-6 py-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10">
        {/* Brand */}
        <div className="flex flex-col gap-3 lg:col-span-1">
          <div className="flex items-center gap-2">
            <span className="text-xl">📥</span>
            <span className="text-lg font-bold gradient-text">InstaGrab</span>
          </div>
          <p className="text-sm text-purple-400 leading-relaxed">
            InstaGrab is a super-fast web based tool to download Instagram reels, videos, photos,
            and audio in original quality — simple, fast, and free.
          </p>
        </div>

        {/* Tools */}
        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-bold tracking-widest text-white uppercase">Tools</h3>
          <ul className="flex flex-col gap-2 text-sm">
            {[
              { label: "Reels Downloader", href: "/" },
              { label: "Video Downloader", href: "/video-downloader" },
              { label: "Photo Downloader", href: "/photo-downloader" },
              { label: "Audio Downloader", href: "/audio-downloader" },
              { label: "Story Downloader", href: "/story-downloader" },
              { label: "Profile Downloader", href: "/profile-downloader" },
              { label: "Facebook Downloader", href: "/facebook-downloader" },
            ].map((link) => (
              <li key={link.label}>
                <Link href={link.href} className="text-purple-400 hover:text-white transition-colors">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Legal */}
        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-bold tracking-widest text-white uppercase">Legal</h3>
          <ul className="flex flex-col gap-2 text-sm">
            {[
              { label: "Privacy Policy", href: "/privacy" },
              { label: "Terms of Service", href: "/terms" },
            ].map((link) => (
              <li key={link.label}>
                <Link href={link.href} className="text-purple-400 hover:text-white transition-colors">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Support */}
        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-bold tracking-widest text-white uppercase">Support</h3>
          <ul className="flex flex-col gap-2 text-sm">
            {[{ label: "Contact Us", href: "/contact" }].map((link) => (
              <li key={link.label}>
                <Link href={link.href} className="text-purple-400 hover:text-white transition-colors">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-white/10">
        <div className="max-w-6xl mx-auto px-6 py-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-purple-500">
          <p className="max-w-xl leading-relaxed">
            <strong className="text-purple-400">InstaGrab</strong> is not connected to Instagram™ or
            any other social platforms. We do not host or store files on our servers; all content
            belongs to its original owners. Please do not use our tool for copyrighted or restricted
            content. We comply with DMCA policies and respond to all valid infringement notices.
          </p>
          <p className="whitespace-nowrap">© 2026 InstaGrab — All Rights Reserved.</p>
        </div>
      </div>
    </footer>
  );
}

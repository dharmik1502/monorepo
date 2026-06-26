"use client";

import { useState } from "react";

const navItems = [
  {
    label: "Video",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
        <rect x="2" y="7" width="15" height="10" rx="2" />
        <path d="M17 9l5-2v10l-5-2V9z" />
      </svg>
    ),
  },
  {
    label: "Audio",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    ),
  },
  {
    label: "Photo",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="M21 15l-5-5L5 21" />
      </svg>
    ),
  },
];

export default function Header() {
  const [active, setActive] = useState("Video");

  return (
    <header className="relative z-10 flex items-center justify-between px-6 py-4 max-w-6xl mx-auto w-full border-b border-white/5">
      <div className="flex items-center gap-1.5">
        <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-600 to-pink-500 flex items-center justify-center shadow-lg">
          <svg viewBox="0 0 24 24" fill="white" className="w-4 h-4">
            <path d="M13 2L4.5 13H11L10 22L20.5 11H14L13 2Z" />
          </svg>
        </span>
        <span className="text-xl font-bold tracking-tight">
          <span className="text-white">Insta</span>
          <span className="gradient-text">Grab</span>
        </span>
      </div>

      <nav className="flex items-center gap-1 p-1 rounded-xl bg-white/5">
        {navItems.map((item) => (
          <button
            key={item.label}
            onClick={() => setActive(item.label)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
              active === item.label
                ? "tab-active text-white shadow-lg"
                : "text-purple-300 hover:text-white"
            }`}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>
    </header>
  );
}

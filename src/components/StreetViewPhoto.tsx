"use client";

import { useState } from "react";

/**
 * Same-origin photo. `src` is `/api/streetview`, never a maps.googleapis.com
 * URL, so the Google key is not in the page. A failed load replaces the image
 * instead of leaving a broken icon.
 */
export default function StreetViewPhoto({ src, address }: { src: string; address: string }) {
  const [phase, setPhase] = useState<"pending" | "ready" | "missing">("pending");

  if (phase === "missing") {
    return (
      <div className="flex aspect-video items-center justify-center bg-neutral-100 px-4 text-center">
        <p className="text-sm font-medium text-neutral-700">No street view available</p>
      </div>
    );
  }

  return (
    <div className="relative aspect-video bg-neutral-100">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={`Street view of ${address}`}
        width={640}
        height={360}
        decoding="async"
        className={`h-full w-full object-cover ${phase === "ready" ? "" : "opacity-0"}`}
        onLoad={() => setPhase("ready")}
        onError={() => setPhase("missing")}
      />
    </div>
  );
}

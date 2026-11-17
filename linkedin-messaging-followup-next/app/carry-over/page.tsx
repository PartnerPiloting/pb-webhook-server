"use client";
import { useEffect } from "react";

// The login carry-over (17 Nov 2026). A browser remembers a client's portal login per web address,
// so someone who has only ever used pb-webhook-server.vercel.app is a stranger on
// portal.knowaguy.com.au. When the new address has no login, it sends the browser here, to the OLD
// address, which looks in its own memory and sends them straight back - logged in if it knows them,
// to the normal "open your link" page if it does not.
//
// The destination is fixed (never taken from the URL), so this cannot be used to bounce anyone
// anywhere else.
const NEW_PORTAL = "https://portal.knowaguy.com.au";

export default function CarryOver() {
  useEffect(() => {
    let token: string | null = null;
    try {
      token = localStorage.getItem("portalToken") || sessionStorage.getItem("portalToken");
    } catch {
      token = null;
    }
    window.location.replace(
      token ? `${NEW_PORTAL}/?token=${encodeURIComponent(token)}` : `${NEW_PORTAL}/?carried=0`
    );
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
        <p className="mt-4 text-gray-600">Opening your portal...</p>
      </div>
    </div>
  );
}

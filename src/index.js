// Worker entry point.
//
// Everything the browser downloads (index.html, style.css, the JavaScript) is
// served automatically by Cloudflare from the ./public folder — see "assets" in
// wrangler.jsonc. This file only handles one thing: turning a request to
// /api/room/<CODE> into a WebSocket connection to that room's Durable Object.

import { GameRoom } from "./GameRoom.js";

// Cloudflare needs the Durable Object class exported from the entry module.
export { GameRoom };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/room\/([A-Za-z0-9]{4,12})$/);

    if (!match) {
      return new Response("Not found", { status: 404 });
    }

    // A WebSocket connection starts life as a normal HTTP request carrying the
    // header "Upgrade: websocket". Anything else is a mistake.
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket upgrade request", { status: 426 });
    }

    const roomCode = match[1].toUpperCase();

    // getByName gives us THE one Durable Object for this room code. Everyone who
    // types the same code reaches the same object, wherever they are.
    const stub = env.ROOM.getByName(roomCode);
    return stub.fetch(request);
  },
};

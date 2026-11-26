// Signaling transport for multiplayer.
//
// - Cross-machine play uses Trystero over public Nostr relays. Relays only carry
//   encrypted WebRTC handshakes/discovery; gameplay data stays peer-to-peer.
// - Same-origin tabs and embedded iframes use the BroadcastChannel + localStorage
//   bus, so local multiplayer never depends on the internet.
//
// Trystero 0.27 normalizes peer ids into `{ peerId }` contexts and takes
// `{ target }` send options. This module wraps that API into the simple shape the
// rest of the net layer expects:
//   makeAction(ns) -> [send(data, targetPeerId?), receive(cb(data, peerId))]
//   onPeerJoin(cb(peerId)), onPeerLeave(cb(peerId)), leave(), selfId

export const APP_ID = 'hrodic-mafia-2d-p2p-v26';

// Curated from Trystero 0.27's default pool. Public relays come and go, so keep a
// small pool and let Trystero fail over instead of pinning a single relay.
export const RELAY_URLS = [
  'wss://relay.ditto.pub',
  'wss://relay.primal.net',
  'wss://relay.nostr.net',
  'wss://relay.nostr.com',
  'wss://relay.snort.social',
  'wss://relay.minibolt.info',
  'wss://relay.mostro.network',
  'wss://nostr.data.haus',
  'wss://nostr.hifish.org',
  'wss://nostrelay.circum.space',
  'wss://bucket.coracle.social',
  'wss://soloco.nl',
];

const TRYSTERO_SOURCES = [
  {
    url: 'https://esm.sh/@trystero-p2p/nostr@0.27.0?bundle',
    relayUrls: RELAY_URLS,
  },
  {
    // MQTT is only a CDN/strategy fallback and uses its own public brokers.
    url: 'https://esm.sh/@trystero-p2p/mqtt@0.27.0?bundle',
    relayUrls: null,
  },
  {
    url: 'https://cdn.jsdelivr.net/npm/@trystero-p2p/nostr@0.27.0/+esm',
    relayUrls: RELAY_URLS,
  },
];

export function randomToken(len = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

// Trystero 0.27 handlers receive `{ peerId, userId, ... }`; older/local transports
// pass the peer id string directly. Always expose the string to callers.
export function peerIdFrom(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof value.peerId === 'string') {
    return value.peerId;
  }
  return '';
}

// Normalize a Trystero action (object API in 0.27+, tuple API in old/local bus).
export function normalizeActionBinding(binding) {
  const legacy = Array.isArray(binding);
  const rawSend = legacy ? binding[0] : (binding?.send || binding?.[0]);
  const rawReceive = legacy ? binding[1] : (binding?.receive || binding?.get || binding?.onMessage || binding?.[1]);

  if (typeof rawSend !== 'function' || typeof rawReceive !== 'function') {
    throw new Error('Invalid Trystero action binding');
  }

  return [
    (data, targetPeerId = null) => {
      const target = typeof targetPeerId === 'string' && targetPeerId ? targetPeerId : null;
      if (legacy) return rawSend(data, target);

      const pending = rawSend(data, target ? { target } : undefined);
      // Targeted sends can reject after a peer leaves; callers are fire-and-forget.
      if (pending && typeof pending.catch === 'function') pending.catch(() => {});
      return pending;
    },
    (cb) => rawReceive((data, context) => cb(data, peerIdFrom(context))),
  ];
}

// Wrap a Trystero room in the normalized transport interface.
export function wrapTrysteroRoom(rtcRoom, selfId) {
  return {
    selfId,
    makeAction(ns) {
      return normalizeActionBinding(rtcRoom.makeAction(ns));
    },
    onPeerJoin(cb) {
      if (typeof rtcRoom.onPeerJoin !== 'function') return;
      rtcRoom.onPeerJoin((info) => {
        const peerId = peerIdFrom(info);
        if (peerId) cb(peerId);
      });
    },
    onPeerLeave(cb) {
      if (typeof rtcRoom.onPeerLeave !== 'function') return;
      rtcRoom.onPeerLeave((info) => {
        const peerId = peerIdFrom(info);
        if (peerId) cb(peerId);
      });
    },
    onError(cb) {
      if (typeof rtcRoom.onError === 'function') rtcRoom.onError(cb);
    },
    leave() {
      try {
        const pending = rtcRoom.leave?.();
        if (pending && typeof pending.catch === 'function') pending.catch(() => {});
      } catch (_) {}
    },
  };
}

// CSP-Safe Same-Origin BroadcastChannel + localStorage Room Transport
function createLocalBusRoom(fullRoomId) {
  const channelName = `hrodic_mp_${fullRoomId}`;
  const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(channelName) : null;
  const myId = `TAB_${randomToken(10)}`;
  const mountTs = Date.now();
  const actionHandlers = new Map();
  const joinHandlers = [];
  const leaveHandlers = [];
  const knownTabs = new Set();

  function dispatchIncoming(raw) {
    if (!raw || raw.sender === myId) return;
    if (raw.ts && raw.ts < mountTs - 2000) return;
    if (raw.target && raw.target !== myId) return;

    if (!knownTabs.has(raw.sender)) {
      knownTabs.add(raw.sender);
      joinHandlers.forEach((cb) => cb(raw.sender));
    }

    if (raw.sys === 'PING') {
      postPacket({ sys: 'PONG', target: raw.sender });
      return;
    }
    if (raw.sys === 'LEAVE') {
      knownTabs.delete(raw.sender);
      leaveHandlers.forEach((cb) => cb(raw.sender));
      return;
    }
    if (raw.ns && actionHandlers.has(raw.ns)) {
      actionHandlers.get(raw.ns).forEach((cb) => cb(raw.data, raw.sender));
    }
  }

  function postPacket(pkt) {
    const full = { ...pkt, sender: myId, ts: Date.now() };
    if (bc) {
      try { bc.postMessage(full); } catch (_) {}
    }
    try {
      localStorage.setItem(`${channelName}_pkt`, JSON.stringify({ ...full, nonce: Math.random() }));
    } catch (_) {}
  }

  if (bc) {
    bc.onmessage = (e) => dispatchIncoming(e.data);
  }
  const onStorage = (e) => {
    if (e.key === `${channelName}_pkt` && e.newValue) {
      try { dispatchIncoming(JSON.parse(e.newValue)); } catch (_) {}
    }
  };
  window.addEventListener('storage', onStorage);

  const onUnload = () => postPacket({ sys: 'LEAVE' });
  window.addEventListener('beforeunload', onUnload);

  setTimeout(() => postPacket({ sys: 'PING' }), 60);

  return {
    selfId: myId,
    makeAction(ns) {
      if (!actionHandlers.has(ns)) actionHandlers.set(ns, []);
      const sendFn = (data, targetPeer = null) => {
        postPacket({ ns, data, target: typeof targetPeer === 'string' ? targetPeer : null });
      };
      const recvFn = (cb) => {
        actionHandlers.get(ns).push(cb);
      };
      return [sendFn, recvFn];
    },
    onPeerJoin(cb) {
      joinHandlers.push(cb);
      knownTabs.forEach((id) => cb(id));
    },
    onPeerLeave(cb) {
      leaveHandlers.push(cb);
    },
    leave() {
      postPacket({ sys: 'LEAVE' });
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('beforeunload', onUnload);
      if (bc) {
        try { bc.close(); } catch (_) {}
      }
    },
  };
}

export async function connectSignalingRoom(code, secret) {
  const fullRoomId = `${APP_ID}-${code}-${secret}`;
  const isEmbeddedSandbox = window.self !== window.top;

  if (!isEmbeddedSandbox) {
    for (const source of TRYSTERO_SOURCES) {
      try {
        const mod = await Promise.race([
          import(source.url),
          new Promise((_, rej) => setTimeout(() => rej(new Error('Signaling CDN timeout')), 6500)),
        ]);
        const joinFn = mod.joinRoom || mod.default?.joinRoom;
        if (typeof joinFn !== 'function') continue;

        const config = {
          appId: APP_ID,
          password: secret,
          relayConfig: {
            ...(source.relayUrls ? { urls: source.relayUrls } : {}),
            // Trystero already fails over; only a total relay failure is surfaced.
            warnOnRelayFailure: false,
          },
        };
        const rtcRoom = joinFn(config, fullRoomId);

        let selfId = '';
        try {
          const self = typeof rtcRoom.getSelf === 'function' ? await rtcRoom.getSelf() : null;
          selfId = self?.peerId || '';
        } catch (_) {}
        if (!selfId && typeof mod.selfId === 'string') selfId = mod.selfId;
        if (!selfId) selfId = `RTC_${randomToken(10)}`;

        return wrapTrysteroRoom(rtcRoom, selfId);
      } catch (_) {
        // Fall back to the next CDN/strategy or the local bus.
      }
    }
  }

  return createLocalBusRoom(fullRoomId);
}

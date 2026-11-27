// Human-friendly multiplayer invite codes.
// One grouped code carries both the room id and the Trystero password; the
// password stays inside the URL fragment so it is never sent to the web server.

const NEW_ROOM_LENGTH = 4;
const NEW_SECRET_LENGTH = 6;
const LEGACY_ROOM_LENGTH = 6;
const LEGACY_SECRET_LENGTH = 8;

export function formatInviteCode(roomCode, secret) {
  return `${String(roomCode).toUpperCase()}-${String(secret).toUpperCase()}`;
}

export function buildInviteUrl(origin, pathname, code) {
  return `${origin}${pathname}#code=${encodeURIComponent(code)}`;
}

function splitCompact(clean) {
  if (clean.length === NEW_ROOM_LENGTH + NEW_SECRET_LENGTH) {
    return {
      roomCode: clean.slice(0, NEW_ROOM_LENGTH),
      secret: clean.slice(NEW_ROOM_LENGTH),
    };
  }
  if (clean.length === LEGACY_ROOM_LENGTH + LEGACY_SECRET_LENGTH) {
    return {
      roomCode: clean.slice(0, LEGACY_ROOM_LENGTH),
      secret: clean.slice(LEGACY_ROOM_LENGTH),
    };
  }
  return { roomCode: '', secret: '' };
}

/**
 * Accepts a new invite code, a `#code=` link, a legacy `?room=&secret=` link,
 * or a legacy `ROOM:SECRET` pair.
 */
export function parseInviteInput(raw) {
  const text = String(raw || '').trim();
  if (!text) return { roomCode: '', secret: '' };
  const normalized = text.toUpperCase();

  if (
    /^https?:\/\//i.test(text)
    || normalized.startsWith('#')
    || normalized.includes('#CODE=')
    || normalized.includes('ROOM=')
  ) {
    try {
      const url = new URL(text, 'https://invite.local/');
      const hash = url.hash.replace(/^#/, '');
      if (hash) {
        const code = new URLSearchParams(hash).get('code');
        if (code) return splitCompact(code.toUpperCase().replace(/[^A-Z0-9]/g, ''));
        if (!hash.includes('=')) return splitCompact(hash.toUpperCase().replace(/[^A-Z0-9]/g, ''));
      }
      const room = url.searchParams.get('room');
      const secret = url.searchParams.get('secret');
      if (room && secret) {
        return { roomCode: room.toUpperCase(), secret: secret.toUpperCase() };
      }
    } catch (_) {}
    return { roomCode: '', secret: '' };
  }

  if (normalized.includes(':')) {
    const [room, secret] = normalized.split(':');
    return { roomCode: (room || '').trim(), secret: (secret || '').trim() };
  }

  return splitCompact(normalized.replace(/[^A-Z0-9]/g, ''));
}

/** Read a prefilled invite from the URL fragment first, then the legacy query. */
export function readInviteFromLocation(location) {
  if (!location) return { roomCode: '', secret: '' };
  if (location.hash) {
    const fromHash = parseInviteInput(location.hash);
    if (fromHash.roomCode) return fromHash;
  }
  if (location.search) {
    const fromQuery = parseInviteInput(location.search);
    if (fromQuery.roomCode) return fromQuery;
  }
  return { roomCode: '', secret: '' };
}

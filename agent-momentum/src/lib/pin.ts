// A privacy screen, not encryption: the data itself is not encrypted.

export async function hashPin(pin: string, salt: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function newSalt(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function checkPin(pin: string, salt: string | undefined, hash: string | undefined): Promise<boolean> {
  if (!salt || !hash) return true;
  return (await hashPin(pin, salt)) === hash;
}

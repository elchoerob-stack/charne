import os from "node:os";

/**
 * Choosing the address to give the phone.
 *
 * A LAN address only works inside the building it was issued in, which is no
 * use to someone who spends the week between Upington, Kimberley and Vryburg.
 * A Tailscale address is the same everywhere: install Tailscale on the laptop
 * and the phone once, and the address in the QR code keeps working from a
 * dealership, a hotel or the car — over a private link, with nothing exposed
 * to the internet.
 */

/** Tailscale hands out addresses in 100.64.0.0/10 (the carrier-grade NAT range). */
export function isTailscale(address: string): boolean {
  const m = /^100\.(\d+)\./.exec(address);
  return m ? Number(m[1]) >= 64 && Number(m[1]) <= 127 : false;
}

/** Every IPv4 address this machine answers on, minus loopback and unrouted link-local. */
export function localAddresses(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): string[] {
  const found: string[] = [];
  for (const list of Object.values(interfaces)) {
    for (const nic of list ?? []) {
      // Node has reported family as both "IPv4" and 4 across versions.
      const family = String(nic.family);
      if ((family !== "IPv4" && family !== "4") || nic.internal) continue;
      if (nic.address.startsWith("169.254.")) continue;
      found.push(nic.address);
    }
  }
  return found;
}

/** The address most likely to still work tomorrow, somewhere else. */
export function pickAddress(addresses: string[]): string | undefined {
  return addresses.find(isTailscale) ?? addresses[0];
}

export function describeAddress(address: string): string {
  return isTailscale(address) ? "works on any network (Tailscale)" : "works on this Wi-Fi";
}

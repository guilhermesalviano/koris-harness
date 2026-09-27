import { networkInterfaces } from 'node:os';

type Interfaces = ReturnType<typeof networkInterfaces>;

// Container and VM bridges are only reachable from this machine, so they are
// not useful as "open it from your phone" addresses.
const VIRTUAL_INTERFACE = /^(docker|br-|veth|virbr|vboxnet|vmnet|cni|flannel|lxc|tailscale|zt)/i;

/** IPv4 addresses other devices on the local network can use to reach this machine. */
export function lanAddresses(interfaces: Interfaces = networkInterfaces()): string[] {
  const addresses = new Set<string>();
  for (const [name, entries] of Object.entries(interfaces)) {
    if (VIRTUAL_INTERFACE.test(name)) continue;
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal || entry.address.startsWith('169.254.')) continue;
      addresses.add(entry.address);
    }
  }
  return [...addresses];
}

/** Whether a listen host accepts connections from other machines. */
export function listensOnAllInterfaces(host?: string): boolean {
  return !host || host === '0.0.0.0' || host === '::';
}

/**
 * The URLs to announce when the server starts: localhost always, plus each LAN
 * address when the server is bound to every interface.
 */
export function serverUrls(port: number, host?: string, interfaces?: Interfaces): { local: string; lan: string[] } {
  const lan = listensOnAllInterfaces(host) ? lanAddresses(interfaces).map((address) => `http://${address}:${port}`) : [];
  return { local: `http://localhost:${port}`, lan };
}

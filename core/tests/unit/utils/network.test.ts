import { describe, expect, it } from 'vitest';
import type { NetworkInterfaceInfo } from 'node:os';
import { lanAddresses, listensOnAllInterfaces, serverUrls } from '../../../src/utils/network';

function iface(address: string, props: Partial<NetworkInterfaceInfo> = {}): NetworkInterfaceInfo {
  return {
    address,
    netmask: '255.255.255.0',
    family: 'IPv4',
    mac: '00:00:00:00:00:00',
    internal: false,
    cidr: `${address}/24`,
    ...props,
  } as NetworkInterfaceInfo;
}

const INTERFACES = {
  lo: [iface('127.0.0.1', { internal: true }), iface('::1', { family: 'IPv6', internal: true })],
  wlp2s0: [iface('192.168.1.42'), iface('fe80::1', { family: 'IPv6' })],
  enp3s0: [iface('10.0.0.7'), iface('169.254.10.2')],
  docker0: [iface('172.17.0.1')],
  'br-3f2a': [iface('172.18.0.1')],
};

describe('lanAddresses', () => {
  it('keeps real IPv4 addresses and skips loopback, IPv6, link-local and virtual bridges', () => {
    expect(lanAddresses(INTERFACES)).toEqual(['192.168.1.42', '10.0.0.7']);
  });

  it('returns nothing when there is no network', () => {
    expect(lanAddresses({ lo: INTERFACES.lo })).toEqual([]);
  });
});

describe('listensOnAllInterfaces', () => {
  it('is true for the default bind and wildcard hosts only', () => {
    expect(listensOnAllInterfaces(undefined)).toBe(true);
    expect(listensOnAllInterfaces('0.0.0.0')).toBe(true);
    expect(listensOnAllInterfaces('::')).toBe(true);
    expect(listensOnAllInterfaces('127.0.0.1')).toBe(false);
    expect(listensOnAllInterfaces('192.168.1.42')).toBe(false);
  });
});

describe('serverUrls', () => {
  it('lists LAN URLs next to localhost when bound to every interface', () => {
    expect(serverUrls(3000, undefined, INTERFACES)).toEqual({
      local: 'http://localhost:3000',
      lan: ['http://192.168.1.42:3000', 'http://10.0.0.7:3000'],
    });
  });

  it('omits LAN URLs for a loopback-only server (desktop app)', () => {
    expect(serverUrls(51234, '127.0.0.1', INTERFACES)).toEqual({ local: 'http://localhost:51234', lan: [] });
  });
});

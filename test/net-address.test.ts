import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * `net.SocketAddress` / `net.BlockList` — the `block_list` binding stand-in.
 *
 * Every expectation here was read off a real Node v26.9.0 first (the rule
 * strings, the `check` semantics, the error codes and full messages), so this
 * doubles as the differential for `src/node-runtime/net/socket-address.ts`.
 */
function boot() {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: () => {},
    onStderr: () => {},
  });
  return runtime.realm.require('net') as any;
}

describe('net.SocketAddress', () => {
  it('parses, defaults and canonicalises', () => {
    const { SocketAddress } = boot();
    const a = new SocketAddress({ address: '127.0.0.1', port: 80, family: 'ipv4' });
    expect(a.address).toBe('127.0.0.1');
    expect(a.port).toBe(80);
    expect(a.family).toBe('ipv4');
    expect(a.flowlabel).toBe(0);
    expect(a.toJSON()).toEqual({ address: '127.0.0.1', port: 80, family: 'ipv4', flowlabel: 0 });
    expect(JSON.stringify(a)).toBe('{"address":"127.0.0.1","port":80,"family":"ipv4","flowlabel":0}');

    // defaults
    expect(new SocketAddress({}).toJSON()).toEqual({
      address: '127.0.0.1',
      port: 0,
      family: 'ipv4',
      flowlabel: 0,
    });
    expect(new SocketAddress({ family: 'ipv6' }).address).toBe('::');
    // family is case-insensitive
    expect(new SocketAddress({ address: '1.2.3.4', family: 'IPv4' }).family).toBe('ipv4');

    const b = new SocketAddress({ address: '::1', port: 443, family: 'ipv6', flowlabel: 5 });
    expect(b.address).toBe('::1');
    expect(b.flowlabel).toBe(5);
    expect(SocketAddress.isSocketAddress(a)).toBe(true);
    expect(SocketAddress.isSocketAddress({})).toBe(false);
  });

  it('renders IPv6 like glibc inet_ntop (longest zero run, v4-embedded)', () => {
    const { SocketAddress } = boot();
    const canon = (address: string): string =>
      new SocketAddress({ address, family: 'ipv6' }).address;
    expect(canon('2001:0db8:0000:0000:0000:0000:0000:0001')).toBe('2001:db8::1');
    expect(canon('fe80::1')).toBe('fe80::1');
    expect(canon('0:0:0:0:0:0:0:0')).toBe('::');
    expect(canon('1:0:0:2:0:0:0:3')).toBe('1:0:0:2::3');
    expect(canon('::')).toBe('::');
    expect(canon('1:2:3:4:5:6:7:8')).toBe('1:2:3:4:5:6:7:8');
    // IPv4-mapped / IPv4-compatible keep the dotted quad
    expect(canon('::ffff:1.2.3.4')).toBe('::ffff:1.2.3.4');
    expect(canon('::1.2.3.4')).toBe('::1.2.3.4');
    expect(canon('::ffff:0:1.2.3.4')).toBe('::ffff:0:102:304');
    expect(canon('64:ff9b::1.2.3.4')).toBe('64:ff9b::102:304');
  });

  it('rejects bad input with Node error codes/messages', () => {
    const { SocketAddress } = boot();
    expect(() => new SocketAddress({ address: '1.2.3.4', family: 'bogus' })).toThrowError(
      /The property 'options\.family' is invalid\. Received 'bogus'/,
    );
    expect(() => new SocketAddress({ address: '1.2.3.4', family: 'bogus' })).toThrowError(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_VALUE' }),
    );
    let err: any;
    try {
      new SocketAddress({ address: '127.0.0.1', port: -1, family: 'ipv4' });
    } catch (e) {
      err = e;
    }
    expect(err.code).toBe('ERR_SOCKET_BAD_PORT');
    expect(err.message).toBe('options.port should be >= 0 and < 65536. Received type number (-1).');
    expect(() => new SocketAddress({ address: '2001:db8::1', family: 'ipv4' })).toThrowError(
      expect.objectContaining({ code: 'ERR_INVALID_ADDRESS', message: 'Invalid socket address' }),
    );
    expect(() => new SocketAddress({ address: '1.2.3.4', family: 'ipv6' })).toThrowError(
      expect.objectContaining({ code: 'ERR_INVALID_ADDRESS' }),
    );
    expect(() => new SocketAddress('127.0.0.1' as any)).toThrowError(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' }),
    );
  });
});

describe('net.BlockList', () => {
  it('stores addresses/subnets/ranges and matches like Node', () => {
    const { BlockList } = boot();
    const b = new BlockList();
    b.addAddress('1.2.3.4');
    b.addRange('10.0.0.1', '10.0.0.5', 'ipv4');
    b.addSubnet('192.168.0.0', 24, 'ipv4');
    // addresses first (newest first), then subnets, then ranges
    expect(b.rules).toEqual([
      'Address: IPv4 1.2.3.4',
      'Subnet: IPv4 192.168.0.0/24',
      'Range: IPv4 10.0.0.1-10.0.0.5',
    ]);
    expect(b.size).toBe(3);
    expect(b.check('1.2.3.4')).toBe(true);
    expect(b.check('10.0.0.3')).toBe(true);
    expect(b.check('192.168.0.9')).toBe(true);
    expect(b.check('8.8.8.8')).toBe(false);
  });

  it('prepends addresses (addAddress / addAddresses / addCIDR order)', () => {
    const { BlockList } = boot();
    const b = new BlockList();
    b.addAddress('::1', 'ipv6');
    b.addAddresses(['2.2.2.2', '3.3.3.3']);
    b.addCIDR('10.0.0.0/8');
    expect(b.size).toBe(4);
    expect(b.rules).toEqual([
      'Address: IPv4 3.3.3.3',
      'Address: IPv4 2.2.2.2',
      'Address: IPv6 ::1',
      'Subnet: IPv4 10.0.0.0/8',
    ]);
    expect(b.check('::1')).toBe(false); // default family is ipv4
    expect(b.check('9.9.9.9')).toBe(false);
    expect(b.check('2.2.2.2')).toBe(true);
    expect(b.check('10.200.1.1')).toBe(true);
  });

  it('round-trips through toJSON / fromJSON and removes rules', () => {
    const { BlockList } = boot();
    const b = new BlockList();
    b.addAddress('::1', 'ipv6');
    b.addAddresses(['2.2.2.2', '3.3.3.3']);
    b.addCIDR('10.0.0.0/8');
    expect(Array.isArray(b.toJSON())).toBe(true);

    const b2 = new BlockList();
    b2.fromJSON(b.toJSON());
    expect(b2.rules).toEqual([
      'Address: IPv6 ::1',
      'Address: IPv4 2.2.2.2',
      'Address: IPv4 3.3.3.3',
      'Subnet: IPv4 10.0.0.0/8',
    ]);

    b.removeAddress('2.2.2.2');
    expect(b.rules).toEqual([
      'Address: IPv4 3.3.3.3',
      'Address: IPv6 ::1',
      'Subnet: IPv4 10.0.0.0/8',
    ]);
    b.removeSubnet('10.0.0.0', 8, 'ipv4');
    expect(b.rules).toEqual(['Address: IPv4 3.3.3.3', 'Address: IPv6 ::1']);
    b.clear();
    expect(b.size).toBe(0);
    expect(b.rules).toEqual([]);
  });

  it('treats v4 and v4-mapped v6 as the same host', () => {
    const { BlockList } = boot();
    const b = new BlockList();
    b.addAddress('::ffff:1.2.3.4', 'ipv6');
    expect(b.rules).toEqual(['Address: IPv6 ::ffff:1.2.3.4']);
    expect(b.check('1.2.3.4', 'ipv4')).toBe(true);
    expect(b.check('::ffff:1.2.3.4', 'ipv6')).toBe(true);
  });

  it('validates and throws Node-shaped errors', () => {
    const { BlockList } = boot();
    expect(() => new BlockList().addAddress('not-an-ip')).toThrowError(
      expect.objectContaining({ code: 'ERR_INVALID_ADDRESS', message: 'Invalid socket address' }),
    );
    expect(() => new BlockList().addAddress(123 as any)).toThrowError(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' }),
    );
    expect(() => new BlockList().addSubnet('1.2.3.4', 33, 'ipv4')).toThrowError(
      expect.objectContaining({
        code: 'ERR_OUT_OF_RANGE',
        message: 'The value of "prefix" is out of range. It must be >= 0 && <= 32. Received 33',
      }),
    );
    expect(() => new BlockList().addSubnet('::1', 129, 'ipv6')).toThrowError(
      expect.objectContaining({
        code: 'ERR_OUT_OF_RANGE',
        message: 'The value of "prefix" is out of range. It must be >= 0 && <= 128. Received 129',
      }),
    );
    expect(() => new BlockList().addCIDR('10.0.0.0')).toThrowError(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_VALUE' }),
    );
    // a bad address in `check` is false, not a throw
    expect(new BlockList().check('not-an-ip')).toBe(false);
    expect(BlockList.isBlockList(new BlockList())).toBe(true);
    expect(BlockList.isBlockList({})).toBe(false);
    expect(Array.isArray(BlockList.PRIVATE_RANGES)).toBe(true);
    expect(Object.isFrozen(BlockList.PRIVATE_RANGES)).toBe(true);
    expect(BlockList.PRIVATE_RANGES).toContain('10.0.0.0/8');
  });
});

describe('net misc surface', () => {
  it('Stream is Socket, and the auto-select-family knobs exist', () => {
    const net = boot();
    expect(net.Stream).toBe(net.Socket);
    expect(net.getDefaultAutoSelectFamily()).toBe(true);
    expect(net.getDefaultAutoSelectFamilyAttemptTimeout()).toBe(500);
    net.setDefaultAutoSelectFamily(false);
    expect(net.getDefaultAutoSelectFamily()).toBe(false);
    net.setDefaultAutoSelectFamilyAttemptTimeout(250);
    expect(net.getDefaultAutoSelectFamilyAttemptTimeout()).toBe(250);
  });
});

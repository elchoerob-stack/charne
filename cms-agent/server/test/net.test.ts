import { test } from "node:test";
import assert from "node:assert/strict";
import type os from "node:os";
import { describeAddress, isTailscale, localAddresses, pickAddress } from "../src/net.js";

const nic = (address: string, internal = false): os.NetworkInterfaceInfo =>
  ({ address, netmask: "255.255.255.0", family: "IPv4", mac: "00:00:00:00:00:00", internal, cidr: `${address}/24` }) as os.NetworkInterfaceInfo;

test("Tailscale addresses are recognised across the whole range", () => {
  assert.ok(isTailscale("100.64.0.1"));
  assert.ok(isTailscale("100.101.102.103"));
  assert.ok(isTailscale("100.127.255.254"));
  assert.ok(!isTailscale("100.63.0.1"), "below the range");
  assert.ok(!isTailscale("100.128.0.1"), "above the range");
  assert.ok(!isTailscale("192.168.1.20"));
  assert.ok(!isTailscale("10.0.0.5"));
});

test("the phone is given the address that survives leaving the building", () => {
  assert.equal(pickAddress(["192.168.1.20", "100.101.5.7"]), "100.101.5.7");
  assert.equal(pickAddress(["192.168.1.20", "10.0.0.5"]), "192.168.1.20");
  assert.equal(pickAddress([]), undefined);
});

test("loopback and link-local addresses are never offered", () => {
  const found = localAddresses({
    lo: [nic("127.0.0.1", true)],
    "Wi-Fi": [nic("169.254.7.7"), nic("192.168.0.14")],
    tailscale0: [nic("100.90.1.2")],
  });
  assert.deepEqual(found, ["192.168.0.14", "100.90.1.2"]);
  assert.equal(pickAddress(found), "100.90.1.2");
});

test("addresses are described in terms of where they work", () => {
  assert.match(describeAddress("100.90.1.2"), /any network/);
  assert.match(describeAddress("192.168.0.14"), /this Wi-Fi/);
});

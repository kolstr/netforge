# WAN emulation (WAN Cloud and Cable Modem)

The **WAN Emulation** palette category contains two devices: the **WAN Cloud** and the **Cable Modem**.
Both are *transparent Layer-2 bridges*: every port on the device is wired to the same broadcast domain, and
whatever arrives on one port is repeated out of all the others. Neither device has an IP address, a CLI, a
DHCP server, NAT or routing logic — it only transports frames, exactly like a provider network drawn as a
cloud.

| Device | Ports | Typical use |
| --- | --- | --- |
| WAN Cloud | `Ethernet0`–`Ethernet2`, `Serial0`–`Serial1`, `Coax0`, `Phone0` | Service-provider cloud between sites, ISP edge, serial/coax provider links |
| Cable Modem | `Coax0`, `Ethernet0`, `Phone0` | Coax provider link in, Ethernet subscriber link out (adds no L3 behavior) |

## Can a LAN be connected to a WAN?

Yes — but the cloud is a *shared WAN segment*, not a magic LAN-to-WAN converter. Two rules cover almost
every case:

1. **Terminate every LAN on a router; put only the router's WAN interface on the cloud.** The cloud
   extends one broadcast domain between sites, so two LAN subnets must stay separated by routers. Cable a
   switch directly into two cloud ports and both sites become one flat subnet with no routing.
2. **Address the WAN side like a real provider link.** Give each site's WAN interface an address in the
   same subnet (for example `10.0.0.1/30` and `10.0.0.2/30`) and point the default route or a static route
   at the peer WAN address. Run OSPF/EIGRP/RIP instead of static routes if you prefer.

The cloud itself needs no configuration at all: drag it in, cable the ports and it forwards.

### Pattern 1 — two routed sites (branch ↔ HQ)

```
PC-A ── SW1 ── G0/0 [R1-Branch] G0/1 ── Ethernet0 [WAN Cloud] Ethernet1 ── G0/1 [R2-HQ] G0/0 ── SW2 ── SRV-HQ
```

* `R1-Branch`: `GigabitEthernet0/0` = `192.168.10.1/24` (LAN), `GigabitEthernet0/1` = `10.0.0.1/30` (WAN)
* `R2-HQ`: `GigabitEthernet0/0` = `192.168.20.1/24` (LAN), `GigabitEthernet0/1` = `10.0.0.2/30` (WAN)
* Static routes: `ip route 192.168.20.0 255.255.255.0 10.0.0.2` on R1 and
  `ip route 192.168.10.0 255.255.255.0 10.0.0.1` on R2
* Cabling: straight-through from each router to the cloud (the cloud behaves like a switch for
  straight/cross-over purposes).

Ready-to-import file: [doc/examples/wan-cloud-two-sites.json](examples/wan-cloud-two-sites.json).

### Default route (gateway of last resort)

A site that only needs "LAN stays local, everything else goes to the WAN" does not need a route per remote
subnet — use a default route (`0.0.0.0/0`) as the gateway of last resort:

```json
"config": { "routes": [{ "network": "0.0.0.0", "mask": "0.0.0.0", "nextHop": "10.0.0.2" }] }
```

or in the GUI **Config → Routing** (network `0.0.0.0`, mask `0.0.0.0`, next hop = provider address), or in
the CLI:

```
ip route 0.0.0.0 0.0.0.0 10.0.0.2
```

`ip default-gateway 10.0.0.2` does the same thing here — unlike IOS it installs a real default route on
routers, not just a management gateway.

How the router chooses:

* Lookup is **longest prefix match**, so connected LAN routes (`192.168.10.0/24`), VLAN/SVI routes and any
  more specific static or dynamic route always win. Only packets with no better match take `0.0.0.0/0`.
  A wrong or unreachable default route therefore breaks inter-site traffic while the local LAN keeps working.
* `show ip route` prints **Gateway of last resort is 10.0.0.2** and the route as `S 0.0.0.0/0 [1/0] via …`;
  with no default route it says `not set`.
* The **next hop must be a directly connected address** (the provider router on the cloud segment). There is
  no recursive lookup, so a next hop that is only reachable through another route is dropped.
* Use a **next-hop IP, not an egress interface**: an interface-only default asks ARP for the final
  destination, which nothing on the cloud answers, so the traffic is lost.
* Static routes carry administrative distance 1 against 0 for connected routes, and the default route is
  **not redistributed by RIP/OSPF/EIGRP** — every router that needs one must be configured with it.
* A **home router installs its default route automatically** from its WAN gateway (static WAN mode) or from
  the DHCP lease (automatic WAN mode); end devices use the *Default gateway* field in their Config tab.
* **Replies are routed like any other packet.** A PC/server without a default gateway can still be reached
  from its own subnet, but traffic from another subnet never gets an answer: the echo reply has no route
  back and is dropped, so remote `ping` fails and `tracert` stops at the last router.

### Pattern 2 — home LAN to the internet through a cable modem

This is the classic "LAN to WAN" lab: home devices behind the Home Router, the router's **Internet** port
acting as CPE, a cable modem, and the provider cloud.

```
HomePC ─ Ethernet1 HomeGW Internet ─ Ethernet0 Cable-Modem Coax0 ─ Coax0 WAN Cloud Ethernet0 ─ G0/0 ISP-R
```

* Home Router: **GUI → WAN mode** = `Automatic (DHCP)` (or a static `203.0.113.0/24` address); the LAN side
  keeps its own `192.168.0.0/24` subnet, DHCP server and NAT.
* ISP router: `GigabitEthernet0/0` = `203.0.113.1/24` plus a DHCP pool for `203.0.113.0/24` so the home
  router's WAN lease comes from the cloud segment.
* Inside hosts then browse the internet through home NAT; the ISP-side hosts are reached at their real
  addresses.
* Cabling: coax (`Coax0` ↔ `Coax0`) between cloud and modem, straight-through from the modem's `Ethernet0`
  to the home router's `Internet` port.

Ready-to-import file: [doc/examples/wan-cloud-home-router.json](examples/wan-cloud-home-router.json) — the
home PC is DHCP-addressed, gets WAN `203.0.113.10` from the ISP and can browse a web server behind the ISP
router.

## Cabling and clocking rules

* **Straight-through** to routers, PCs, servers and firewalls; **cross-over** between the cloud and another
  switch/hub/cloud/modem (both ends are MDIX).
* **Serial** links need a `NIM-2T` module on the router and a clock rate on the DCE end: set
  `clock rate 1544000` in the router's serial interface (Config tab or CLI). A serial link is only up when
  the *first* endpoint of the link is the clocking side, so connect **router → cloud** (not cloud → router)
  when you draw the cable.
* **Coax** is only accepted between coax ports (cloud ↔ modem).
* **Phone** links require phone ports on both ends (cloud/modem/phone).
* One cable per port; ports without a cable stay down.

## Configuration entry points

1. Drag **WAN Emulation → WAN Cloud** (or **Cable Modem**) onto the workspace.
2. Cable it to the devices that terminate the WAN (routers or a home router's `Internet` port).
3. Configure the *terminating devices*, not the cloud:
   * Routers — **Config → Interfaces** for addresses, **Config → Routing** or the **CLI** for static
     routes/OSPF/EIGRP, **Config → NAT** for source NAT.
   * Home Router — the **GUI** tab: *WAN mode* (Automatic/DHCP or static), *LAN IP address* and the DHCP
     server block.
4. Verify with the Desktop **Command Prompt** (`ping`, `tracert`), the **Web Browser** or Simulation-mode PDUs.

The cloud and modem expose **Physical** (power, port LEDs), **Config** and **Attributes** tabs, but they
have no CLI. Because they are Layer-2 devices, IP addresses entered on their ports in the Config tab are
ignored and no routing, VLAN or NAT settings apply to them.

## Filtering LAN ↔ WAN traffic with ACLs

The **ISP router is an ordinary router**, so ACLs apply to everything it forwards between the provider side
and the core — that is the natural place to police a home site that reaches the ISP through the cloud and
modem. Attach the list to the WAN-facing interface:

| Where | Catches |
| --- | --- |
| `GigabitEthernet0/0` **ACL in** | Traffic coming out of the WAN cloud (home site → internet) |
| `GigabitEthernet0/0` **ACL out** | Traffic heading into the WAN cloud (internet → home site) |

In the Config tab open **Interfaces** and set **ACL in** / **ACL out**, or use the ACL panel to build the
list; the CLI equivalent is:

```
access-list 100 deny tcp any host 192.0.2.10 eq 80
access-list 100 permit ip any any
interface GigabitEthernet0/0
 ip access-group 100 in
```

The same thing when editing [wan-cloud-home-router.json](examples/wan-cloud-home-router.json) by hand — add
`aclIn` to the ISP router's WAN interface:

```json
{ "id": "GigabitEthernet0/0", "ip": "203.0.113.1", "mask": "255.255.255.0", "aclIn": "100" }
```

and an `acls` list inside that device's `config` (keep the existing `dhcpPools` entry so the home router
still gets a WAN lease):

```json
"acls": [{ "id": "100", "type": "extended", "rules": [
  { "action": "deny", "proto": "tcp", "src": "any", "srcWild": "0.0.0.0", "dst": "192.0.2.10", "dstWild": "0.0.0.0", "dstPort": "80" },
  { "action": "permit", "proto": "ip", "src": "any", "srcWild": "0.0.0.0", "dst": "any", "dstWild": "0.0.0.0" }
] }]
```

Things that surprise people in this topology:

* **The home site appears as one address.** The home router NATs every inside host to its WAN lease
  (`203.0.113.10` in the example), so rules on the ISP router match `203.0.113.0/24`, never
  `192.168.0.0/24`. To filter individual home devices, build the list on the home router's LAN side instead
  (home routers have no ACL editor, so use a router or firewall as the gateway).
* **Lists are stateless.** Permit the return direction explicitly, or the reply is dropped and the client
  simply times out. A `deny` with a trailing `permit ip any any` only blocks the one direction it names.
* **Return traffic has no service port.** Rules can only match a *destination* port, so on the WAN **ACL out**
  you cannot say "deny the replies to port 80" — match the server address instead
  (`access-list 100 deny tcp host 192.0.2.10 any`), or filter the connection in the forward direction.
* **The list must exist.** An interface pointing at a missing ACL id filters nothing, and the implicit deny
  at the end of a list means a list with only a `deny` rule blocks everything it is applied to.
* **Traffic to the router itself is not filtered** — pinging `203.0.113.1` from the home PC still works even
  with a deny-all inbound list; use line/VTY settings if you want to restrict management access.
* For genuinely stateful filtering (return traffic allowed automatically, zones, DMZ) put a **Firewall**
  between the modem and the ISP router instead of relying on ACLs.

## Importing a topology JSON file

Use **File → Open topology…** (`Ctrl+O`) and pick a `.json` file — the import replaces the current
workspace — or **Export JSON…** to see the full format the app writes. Only a few fields are required;
everything else is filled in with device defaults on import, and every port of the model is created even if
the file lists only the ones you use:

```json
{
  "devices": [
    { "id": "r1", "kind": "router", "name": "R1", "x": 300, "y": 140,
      "interfaces": [{ "id": "GigabitEthernet0/0", "ip": "192.168.10.1", "mask": "255.255.255.0" },
                     { "id": "GigabitEthernet0/1", "ip": "10.0.0.1", "mask": "255.255.255.252" }],
      "config": { "routes": [{ "network": "192.168.20.0", "mask": "255.255.255.0", "nextHop": "10.0.0.2" }] } },
    { "id": "cloud-1", "kind": "cloud", "name": "WAN",
      "interfaces": [{ "id": "Ethernet0" }, { "id": "Ethernet1" }] }
  ],
  "links": [
    { "id": "l1", "type": "straight", "a": { "deviceId": "r1", "ifaceId": "GigabitEthernet0/1" },
      "b": { "deviceId": "cloud-1", "ifaceId": "Ethernet0" } }
  ]
}
```

| Field | Notes |
| --- | --- |
| `kind` | `router`, `switch`, `hub`, `pc`, `laptop`, `server`, `printer`, `phone`, `accesspoint`, `homerouter`, `firewall`, `cloud`, `modem`, `tablet`, `smartphone`, `iot` |
| `interfaces[].id` | Port name of the device model (`GigabitEthernet0/0`, `FastEthernet0/1`, `Ethernet0`, `Internet`, `Coax0`, …); `links[].ifaceId` refers to it. A name the model does not have is added as an extra Ethernet port |
| `interfaces[].ip` / `mask` | Optional; omit for DHCP clients (`"dhcp": true`) or Layer-2-only devices |
| `config` | Optional and partial — gateways, static routes, VLANs, DHCP pools, NAT, ACLs, services and home-router settings are merged with the device defaults |
| `links[].type` | `straight`, `crossover`, `fiber`, `serial`, `console`, `coax`, `phone`; mismatched links stay down |
| `model`, `mac`, `modules`, `notes`, `shapes`, `scenarios` | Optional; MAC addresses are generated when missing |

`format` and `version` at the top level are informational — the importer only requires `devices` (and
accepts a file without `links`).

## Limitations

* The cloud is hub-like: every frame is repeated out of all other ports, so all sites and all VLANs share
  one provider medium. Tagged frames pass through untouched, which means trunk links to remote switches work,
  but the cloud itself has no VLAN awareness or per-VLAN separation.
* No provider-side services: no DHCP on the WAN, no NAT, no rate limiting or per-link latency. Packet
  delay comes only from link serialization time at the port speed.
* **Serial ports are not routable** in this build. A router can hold a serial interface with an IP address,
  and the cloud will bridge the serial link, but routed traffic uses Ethernet/fiber interfaces — use
  Ethernet (or coax + modem for a CPE lab) when you need real end-to-end connectivity.
* The Cable Modem behaves like a two-port cloud (coax ↔ Ethernet); it has no DOCSIS configuration, MAC
  filtering or line-quality model.

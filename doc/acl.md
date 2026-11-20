# Access control lists (ACLs)

Access control lists filter routed IPv4 traffic on routers, Layer 3 switches and firewalls. An ACL is an
ordered list of `permit` and `deny` rules; it does nothing until you attach it to an interface with
`ip access-group <acl> in|out` (or the **ACL in / ACL out** fields in the Config tab).

## Where ACLs are evaluated

ACLs in NetForge live in the routing path, not on the switch fabric:

```
frame arrives ─► L2 handling ─► TTL check ─► [ACL in] ─► NAT inside ─► route lookup ─► firewall levels ─► [ACL out] ─► NAT outside ─► transmit
```

* **Inbound (`in`)** rules run on the interface the packet arrives on, before inbound NAT and before the
  route lookup.
* **Outbound (`out`)** rules run on the egress interface, after the firewall security-level decision and
  before source NAT is applied — so an outbound ACL sees the original, untranslated inside address.
* Matching is **top-down, first match wins**, and the end of every list is an **implicit deny**. An ACL with
  no rules denies everything on the interface it is applied to.
* ACLs are **stateless**: return traffic must be permitted by a rule in the opposite direction. For a
  firewall, the stateful security levels handle the return path; the ACLs only refine what is allowed.
* Traffic *addressed to the device itself* (ping the router's IP, SSH/Telnet, SNMP-style management) and
  traffic *originated by the device* is **not** filtered by ACLs.
* Only one ACL can be attached per interface and direction. Applying another ACL replaces the previous one.
* ACLs belong to a single device; they are not shared between routers and must be created on each device that
  evaluates them.
* If the interface references an ACL id that does not exist, traffic is **permitted** (the simulator treats
  a missing list as "no filtering"). Ids are matched case-sensitively, so `guests` and `GUESTS` are different.

## Managing ACLs in the Config tab

1. Double-click the router or switch and open **Config**.
2. Expand **Access control lists**.
3. Type an id next to the **ACL** button and click it. Numbered lists below 100 become **standard**,
   100 and above become **extended**; a non-numeric name (e.g. `GUEST-FILTER`) defaults to **standard**.
4. Add rules with the row at the bottom of the list: action (`permit` / `deny`), protocol
   (`ip`, `tcp`, `udp`, `icmp`), source, destination and optional destination port. The trash icons delete a
   rule or a whole list.
5. On a router, apply the list per interface in the **Interfaces** section with the **ACL in** and
   **ACL out** fields. Switch ports have no ACL fields, so attach lists with `ip access-group` on the SVI or
   access port (see Example 6).

The source and destination fields accept the same forms as the CLI, and a CIDR suffix generates the
wildcard mask automatically:

| Input | Rule that is stored |
| --- | --- |
| `any` | `any 0.0.0.0` |
| `10.0.0.5` or `host 10.0.0.5` | `10.0.0.5 0.0.0.0` |
| `192.168.10.0/24` | `192.168.10.0 0.0.0.255` |
| `192.168.10.130/24` | `192.168.10.0 0.0.0.255` (host bits are cleared) |
| `192.168.10.0 0.0.0.255` | `192.168.10.0 0.0.0.255` |

The line below the row previews the rule exactly as it will be evaluated; input that cannot be parsed is
rejected with a hint instead of adding a rule that matches nothing.

For NAT, **Config → NAT → Inside source ACL** points at an ACL that selects which inside hosts are
translated.

> Firewalls do not show the ACL form, but they accept the same CLI commands and the same per-interface
> `ip access-group` settings; on a firewall the list is applied to the `inside`, `outside` or `dmz` port.

## CLI quick reference

All ACL commands are available in `configure terminal`; `show` commands work in privileged exec mode or
with `do` from configuration modes.

| Command | Purpose |
| --- | --- |
| `access-list 20 deny 192.168.10.10 0.0.0.0` | Add a rule to a numbered standard ACL (1–99) |
| `access-list 110 permit tcp any host 203.0.113.10 eq 80` | Add a rule to a numbered extended ACL (100–199) |
| `access-list 110 remark allow web` | Attach a remark to a numbered ACL |
| `ip access-list standard GUESTS` | Create/enter a named standard ACL |
| `ip access-list extended WEB-FILTER` | Create/enter a named extended ACL |
| `permit …` / `deny …` / `remark …` | Add entries inside the `config-std-nacl` / `config-ext-nacl` mode |
| `ip access-group 110 in` | Apply a list to the current interface, direction `in` or `out` |
| `no ip access-group 110 in` | Detach a list from the current interface |
| `show access-lists` | Print every list of the device |
| `show running-config` | Show the ACLs as rendered configuration |

`show access-lists` always prints all lists; an id suffix is ignored. Named lists are still rendered as
`access-list <name> …` lines in `show running-config`.

## Address and port matching

Extended rules accept the usual Cisco-style address forms:

| Form | Example | Matches |
| --- | --- | --- |
| `any` | `permit ip any any` | every address |
| `host <addr>` | `deny tcp host 10.0.0.5 any` | exactly that host |
| `<addr> <wildcard>` | `permit ip 192.168.10.0 0.0.0.255 any` | the whole /24 |
| `<addr>` (no wildcard) | `deny 192.168.10.10` | that host (wildcard defaults to `0.0.0.0`) |
| `eq <port>` after a destination | `permit tcp any host 203.0.113.10 eq 443` | that destination port |

Wildcards are inverted masks: `0.0.0.0` matches one address, `0.0.0.255` matches a /24, `0.0.255.255` a /16,
`255.255.255.255` everything. CIDR notation (`192.168.10.0/24`) is a Config tab convenience that is converted
to that wildcard form; in the CLI write the wildcard explicitly.

The protocol keyword is matched against the packet type:

| Rule protocol | Matches |
| --- | --- |
| `ip` | every routed packet |
| `icmp` | echo requests/replies, unreachables, TTL exceeded |
| `tcp` | HTTP, HTTPS, FTP, SMTP, POP3, SSH, Telnet |
| `udp` | DNS and DHCP |

Port matching uses the packet's destination port, so write `eq 53` for DNS queries and `eq 80`/`eq 443`
for web traffic. ICMP packets carry no ports, so `permit icmp any any` is the way to allow ping.

Standard ACLs only look at the source address and take `<addr> <wildcard>` or `any` — there is no `host`
keyword in this simulator, so use `192.168.10.10 0.0.0.0` for a single host.

The list type is a CLI parsing and rendering detail; the engine evaluates whatever fields a rule carries.
Rules created in the Config tab keep their protocol, destination and port even inside a list typed as
standard, so use the CLI when you want strict Cisco-style standard behaviour.

## Example 1 — block one host with a standard ACL

Topology: `R1` with `GigabitEthernet0/0` = `192.168.10.1/24` (PC `192.168.10.10`) and
`GigabitEthernet0/1` = `203.0.113.1/24` (server `203.0.113.10`).

```
R1> enable
R1# configure terminal
R1(config)# access-list 20 deny 192.168.10.10 0.0.0.0
R1(config)# access-list 20 permit any
R1(config)# interface GigabitEthernet0/1
R1(config-if)# ip access-group 20 out
R1(config-if)# end
R1# show access-lists
Standard IP access list 20
  deny ip 192.168.10.10 0.0.0.0 any
  permit ip any 0.0.0.0 any
```

A ping from `192.168.10.10` now fails with `Denied by outbound ACL`, while every other host still reaches
the server through the trailing `permit any`. Standard lists match only the source address, so the usual
placement is close to the destination — here `out` on the WAN interface.

## Example 2 — publish a web server with an extended ACL

Allow only HTTP, HTTPS and ping from the LAN towards the server and drop everything else coming from the
LAN:

```
R1# configure terminal
R1(config)# access-list 110 permit tcp 192.168.10.0 0.0.0.255 host 203.0.113.10 eq 80
R1(config)# access-list 110 permit tcp 192.168.10.0 0.0.0.255 host 203.0.113.10 eq 443
R1(config)# access-list 110 permit icmp 192.168.10.0 0.0.0.255 any
R1(config)# access-list 110 deny ip any any
R1(config)# interface GigabitEthernet0/0
R1(config-if)# ip access-group 110 in
R1(config-if)# end
```

Verified results: `http://203.0.113.10/` and `https://203.0.113.10/` load, ping succeeds, and any other
protocol from the LAN (FTP, SSH, DNS, …) is reported as `Denied by ACL`. The explicit `deny ip any any`
documents the implicit deny and makes the counters/log entries explicit; it can be left out.

## Example 3 — a named list with remarks

Named lists read well and can be re-entered at any time to append rules:

```
R1# configure terminal
R1(config)# ip access-list extended GUEST-FILTER
R1(config-ext-nacl)# remark Guests may only browse the web server
R1(config-ext-nacl)# permit tcp any host 203.0.113.10 eq 80
R1(config-ext-nacl)# permit tcp any host 203.0.113.10 eq 443
R1(config-ext-nacl)# deny ip any any
R1(config-ext-nacl)# exit
R1(config)# interface GigabitEthernet0/0
R1(config-if)# ip access-group GUEST-FILTER in
R1(config-if)# end
R1# show running-config
...
access-list GUEST-FILTER remark Guests may only browse the web server
access-list GUEST-FILTER permit tcp any 0.0.0.0 203.0.113.10 0.0.0.0 eq 80
access-list GUEST-FILTER permit tcp any 0.0.0.0 203.0.113.10 0.0.0.0 eq 443
access-list GUEST-FILTER deny ip any 0.0.0.0 any 0.0.0.0
```

Ping from the guest host is now denied while the browser still works.

## Example 4 — ACL-driven NAT overload

The `inside source list` command uses an ACL as the "which hosts are translated" selector:

```
R1# configure terminal
R1(config)# access-list 1 permit 192.168.10.0 0.0.0.255
R1(config)# ip nat inside source list 1 interface GigabitEthernet0/1 overload
R1(config)# interface GigabitEthernet0/0
R1(config-if)# ip nat inside
R1(config-if)# exit
R1(config)# interface GigabitEthernet0/1
R1(config-if)# ip nat outside
R1(config-if)# end
R1# show ip nat translations
Pro Inside global      Inside local       Outside local      Outside global
tcp 203.0.113.1:37833 192.168.10.10:55767 203.0.113.1 203.0.113.1:37833
```

Notes:

* The same list can be reused for filtering, but keep the purposes apart — one list that both selects NAT
  sources and is applied with `ip access-group` will also drop traffic from excluded hosts.
* An empty ACL matches **everything** in the NAT selector, unlike an interface ACL where it matches nothing.
  Add an explicit rule.
* In the GUI the same setting is **Config → NAT → Inside source ACL / Outside interface / PAT overload**.

## Example 5 — refining a firewall policy

Security levels decide the basic flow (inside 100 → dmz 50 → outside 0, with stateful return traffic); ACLs
narrow that down. Here the DMZ is reachable only on HTTP:

```
FW1# configure terminal
FW1(config)# access-list 130 permit tcp any host 172.16.1.10 eq 80
FW1(config)# access-list 130 deny ip any any
FW1(config)# interface dmz
FW1(config-if)# ip access-group 130 out
FW1(config-if)# end
```

Ping from the inside network to the DMZ host now fails with `Denied by outbound ACL`, while HTTP passes.
Because the ACL is stateless, web replies from the DMZ back to the inside are still handled by the
security-level state — but anything you deny with an *inbound* ACL on the outside or DMZ port will also cut
the return path of established flows.

## Example 6 — filtering inter-VLAN traffic on a Layer 3 switch

ACLs also work on SVIs of a Layer 3 switch:

```
SW1# configure terminal
SW1(config)# ip routing
SW1(config)# vlan 10
SW1(config-vlan)# name USERS
SW1(config-vlan)# exit
SW1(config)# vlan 20
SW1(config-vlan)# name SERVERS
SW1(config-vlan)# exit
SW1(config)# interface FastEthernet0/1
SW1(config-if)# switchport access vlan 10
SW1(config-if)# exit
SW1(config)# interface FastEthernet0/2
SW1(config-if)# switchport access vlan 20
SW1(config-if)# exit
SW1(config)# interface vlan10
SW1(config-if)# ip address 192.168.10.1 255.255.255.0
SW1(config-if)# no shutdown
SW1(config-if)# exit
SW1(config)# interface vlan20
SW1(config-if)# ip address 192.168.20.1 255.255.255.0
SW1(config-if)# no shutdown
SW1(config-if)# exit
SW1(config)# access-list 100 deny icmp 192.168.10.0 0.0.0.255 192.168.20.0 0.0.0.255
SW1(config)# access-list 100 permit ip any any
SW1(config)# interface vlan20
SW1(config-if)# ip access-group 100 out
SW1(config-if)# end
```

The SVI is created with `interface vlan10` (no space before the number). Users in VLAN 10 can no longer ping
the server VLAN, but every other protocol still passes.

On a Layer 3 switch only outbound lists work on an SVI, because inbound checks run on the physical port the
frame arrives on. To filter on the way in, apply the list to the access port instead:

```
SW1(config)# interface FastEthernet0/1
SW1(config-if)# ip access-group 100 in
```

## Verifying and troubleshooting

* `show access-lists` prints the lists exactly as evaluated: order, protocol, addresses and destination port.
* `show running-config` shows how the lists look in the saved configuration and confirms the
  `ip access-group` lines on the interfaces.
* Rejected traffic shows up in the request result, the PDU details and the device log:
  * `Denied by ACL` — the inbound list on the ingress interface dropped the packet.
  * `Denied by outbound ACL` — the list on the egress interface dropped the packet.
  * `Denied by firewall security level` — no ACL involved, the security levels blocked the flow.
* After editing an ACL, restart a failed request — the first packet after a link or addressing change can
  still be lost while ARP resolves.
* In simulation mode, reset the simulation if you want a clean event list for the new behaviour.

## Behaviour notes and limitations

* Entries are evaluated strictly in insertion order. There is no way to insert a rule in the middle of a
  list (no sequence numbers); plan the order while writing the list.
* Negating an entry does not remove it: `no deny …` or `no permit …` **appends** the rule instead of deleting
  it, and `no access-list <id>` is rejected as incomplete. Delete entries and lists with the trash icons in
  the Config tab.
* Only the destination port is matched. `eq <port>` placed right after the source address is stored but
  ignored, so always put the port after the destination address.
* Remarks are supported and skipped during matching.
* A standard list created in the CLI only carries a source address — no protocol, destination or port
  syntax is accepted there.
* Interface ACLs do not filter traffic addressed to the device or traffic the device itself originates
  (for example `ping` typed on the console).
* Only one ACL per interface and direction is supported.
* Layer 2 switching is never filtered. On a switch, ACLs only affect traffic the switch routes between
  VLANs: inbound checks run on the physical ingress port and outbound checks on the SVI of the egress
  network, so a list applied `in` to an SVI has no effect.

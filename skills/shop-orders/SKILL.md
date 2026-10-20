---
name: shop-orders
description: "Read the owner's online-shop orders: new orders, what's paid, in progress or shipped, totals, tracking."
version: 0.2.0
author: Nihal
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [Business, Orders, Shop]
    related_skills: [business-desk, morning-briefing]
---

# Shop orders

If {{OWNER}} runs an online shop, a job on the server copies its orders (read-only) into your workspace as
`~/.hermes/workspace/business/<business>/orders.tsv`, newest first, one order per line. See `examples/shop-orders/` in the Max repo.

Columns: ref · placed (local time) · status · customer · phone · city/pincode · items · total · coupon · tracking.
Statuses: `pending` (not paid yet) → `paid` (to make or pack) → `printing` (in progress) → `shipped` → `delivered`; `cancelled`.

## When to Use
"my orders", "any new orders?", "what do I need to make?", "has <ref> shipped?", "sales this week".

## How
1. `cat ~/.hermes/workspace/business/*/orders.tsv` (or `grep` a ref or a name). Don't use the web or the shop's site for this.
2. Answer in one or two lines, like a person: what needs them first (`paid`, then `printing`), then anything they asked about. Totals in {{CURRENCY}}. Leave out cancelled orders unless asked.
   - "Any new orders?" → orders from today and yesterday, or "no new orders since <date of the newest>".
   - "What do I need to make?" → the `paid` and `printing` orders with their items.
3. You can't change orders. {{OWNER}} does that in the shop's own admin page.
4. If no orders.tsv exists, say no shop is connected (or the order sync on the server isn't running).

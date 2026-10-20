#!/usr/bin/env bash
# Example: copy a shop's orders into Max's workspace, for the shop-orders skill. This one fits a shop that runs
# in a Docker container on the same server and keeps orders in SQLite (orders + order_items tables, amounts in
# cents); adapt the SELECT to your shop. It reads the database read-only and writes a plain table to
# business/<BUSINESS>/orders.tsv in the sandbox, newest first. Run every 5 minutes by max-shop-orders.timer.
#   SHOP_CONTAINER=myshop-app-1 SHOP_DB=/data/shop.db BUSINESS=myshop examples/shop-orders/sqlite-orders.sh
set -euo pipefail
here=$(cd "$(dirname "$(readlink -f "$0")")/../.." && pwd)
[ -f "$here/max.config" ] && . "$here/max.config"
: "${SHOP_CONTAINER:?set SHOP_CONTAINER}" "${BUSINESS:?set BUSINESS (the business folder slug)}"
export SHOP_DB=${SHOP_DB:-/data/shop.db} CUR=${CURRENCY:-₹} LOC=${LOCALE:-en-IN} TZN=${TIMEZONE:-UTC}
OS=~/.local/bin/openshell
docker exec -e SHOP_DB -e CUR -e LOC -e TZN "$SHOP_CONTAINER" node -e '
const { DatabaseSync } = require("node:sqlite");
const { SHOP_DB, CUR, LOC, TZN } = process.env;
const db = new DatabaseSync(SHOP_DB, { readOnly: true });
const money = (c) => CUR + Math.round(c / 100).toLocaleString(LOC);
const clean = (s) => String(s ?? "").replace(/[\t\r\n]+/g, " ").trim();
const local = (t) => t ? new Date(t.replace(" ", "T") + "Z").toLocaleString(LOC, { timeZone: TZN, dateStyle: "medium", timeStyle: "short" }) : "";
const items = db.prepare("SELECT name, qty FROM order_items WHERE order_id = ?");
console.log(["ref", "placed (local time)", "status", "customer", "phone", "city/pincode", "items", "total", "coupon", "tracking"].join("\t"));
for (const o of db.prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT 200").all()) {
  const total = o.subtotal_cents - (o.discount_cents || 0) + (o.shipping_cents || 0);
  const where = o.self_collect ? "self collect" : [o.state, o.pincode].filter(Boolean).join(" ");
  const track = o.tracking_number ? `${o.courier_name} ${o.tracking_number}` : "";
  console.log([o.ref, local(o.created_at), o.invoice_cancelled ? "cancelled" : o.status,   // a cancelled invoice (e.g. a test order) is no order
    o.customer_name, o.phone, where,
    items.all(o.id).map((i) => `${i.name} x${i.qty}`).join("; "), money(total), o.coupon_code, track].map(clean).join("\t"));
}' > /tmp/max-orders.tsv
"$OS" sandbox exec --name "${SANDBOX:-max}" -g nemoclaw --no-tty -- /bin/sh -c \
  "mkdir -p ~/.hermes/workspace/business/$BUSINESS && cat > ~/.hermes/workspace/business/$BUSINESS/orders.tsv" < /tmp/max-orders.tsv
rm -f /tmp/max-orders.tsv

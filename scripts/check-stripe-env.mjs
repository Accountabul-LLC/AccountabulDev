import { readFileSync } from "node:fs";

const text = readFileSync(new URL("../.env", import.meta.url), "utf8");
const required = [
  "STRIPE_ACCOUNT_ID",
  "STRIPE_MEMBER_RESTRICTED_KEY",
  "STRIPE_OPERATIONS_RESTRICTED_KEY",
  "STRIPE_WEBHOOK_RESTRICTED_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "PUBLIC_SITE_URL",
];

let missing = 0;
for (const key of required) {
  const match = text.match(new RegExp(`^${key}=(.*)$`, "m"));
  const value = match ? match[1].trim().replace(/^["']|["']$/g, "") : "";
  const ok =
    key === "STRIPE_ACCOUNT_ID"
      ? value.startsWith("acct_")
      : key.includes("RESTRICTED_KEY")
        ? value.startsWith("rk_")
        : key === "STRIPE_WEBHOOK_SECRET"
          ? value.startsWith("whsec_")
          : Boolean(value);
  if (!ok) missing += 1;
  let shape = "empty";
  if (value) {
    if (key.includes("RESTRICTED_KEY")) {
      shape = value.startsWith("rk_live_")
        ? "rk_live"
        : value.startsWith("rk_test_")
          ? "rk_test"
          : value.startsWith("rk_")
            ? "rk_other"
            : "other";
    } else if (key === "STRIPE_ACCOUNT_ID") {
      shape = value.startsWith("acct_") ? "acct" : "other";
    } else if (key === "STRIPE_WEBHOOK_SECRET") {
      shape = value.startsWith("whsec_") ? "whsec" : "other";
    } else {
      shape = "set";
    }
  }
  console.log(`${ok ? "ok" : "missing"}  ${key}  ${shape}`);
}

process.exit(missing === 0 ? 0 : 1);

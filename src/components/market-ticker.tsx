import { useQuery } from "@tanstack/react-query";
import { useState, type CSSProperties } from "react";

import { formatChangePercent, formatUsdPrice, isDisplayableMarket } from "@/lib/markets/format.ts";
import type { CryptoMarket, MarketTickerPayload } from "@/lib/markets/types.ts";

async function fetchTicker(): Promise<MarketTickerPayload | null> {
  const response = await fetch("/api/public/markets/ticker");
  if (!response.ok) return null;
  const payload = (await response.json()) as MarketTickerPayload;
  if (!Array.isArray(payload.assets) || !payload.assets.length) return null;
  return payload;
}

export function MarketTicker() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["markets", "ticker"],
    queryFn: fetchTicker,
    staleTime: 5 * 60_000,
    refetchInterval: 6 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const assets = (query.data?.assets ?? []).filter(isDisplayableMarket);
  if (!assets.length) return null;

  const attribution = query.data?.attribution;
  const durationSeconds = 110;

  return (
    <div className="accountabul-ticker" data-paused={selectedId ? "true" : "false"}>
      <p className="sr-only">Cryptocurrency prices. {summarizeAssets(assets)}</p>
      <div className="accountabul-ticker-viewport" aria-hidden="true">
        <div
          className="accountabul-ticker-track"
          style={{ "--accountabul-ticker-duration": `${durationSeconds}s` } as CSSProperties}
        >
          <TickerSequence assets={assets} selectedId={selectedId} onSelect={setSelectedId} />
          <TickerSequence assets={assets} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
      </div>
      {attribution ? (
        <a
          className="accountabul-ticker-attribution"
          href={attribution.href}
          target="_blank"
          rel="noreferrer"
        >
          {attribution.text}
        </a>
      ) : null}
    </div>
  );
}

function summarizeAssets(assets: CryptoMarket[]) {
  return assets
    .slice(0, 8)
    .map((asset) => {
      const price = formatUsdPrice(asset.priceUsd);
      const change = formatChangePercent(asset.change24hPercent);
      if (!price || !change) return asset.symbol;
      return `${asset.symbol} ${price} ${change.text}`;
    })
    .join(". ");
}

function TickerSequence({
  assets,
  selectedId,
  onSelect,
}: {
  assets: CryptoMarket[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  let sawFeatured = false;
  let sawMarket = false;

  return (
    <div className="accountabul-ticker-sequence">
      {assets.map((asset) => {
        const labels: string[] = [];
        if (asset.featured && !sawFeatured) {
          labels.push("Featured");
          sawFeatured = true;
        }
        if (!asset.featured && !sawMarket) {
          labels.push("Market");
          sawMarket = true;
        }
        return (
          <span key={asset.id} className="accountabul-ticker-cluster">
            {labels.map((label) => (
              <span key={label} className="accountabul-ticker-kicker">
                {label}
              </span>
            ))}
            <TickerItem asset={asset} selected={selectedId === asset.id} onSelect={onSelect} />
          </span>
        );
      })}
    </div>
  );
}

function TickerItem({
  asset,
  selected,
  onSelect,
}: {
  asset: CryptoMarket;
  selected: boolean;
  onSelect: (id: string | null) => void;
}) {
  const price = formatUsdPrice(asset.priceUsd);
  const change = formatChangePercent(asset.change24hPercent);
  if (!price || !change) return null;

  const label =
    asset.name.trim().toUpperCase() === asset.symbol
      ? `#${asset.rank} ${asset.symbol}`
      : `#${asset.rank} ${asset.symbol} · ${asset.name}`;

  return (
    <button
      type="button"
      className="accountabul-ticker-item"
      data-direction={change.direction}
      data-selected={selected}
      title={label}
      tabIndex={-1}
      onClick={() => onSelect(selected ? null : asset.id)}
    >
      <TickerLogo name={asset.name} image={asset.image} />
      <span className="accountabul-ticker-symbol">{asset.symbol}</span>
      <span className="accountabul-ticker-price">{price}</span>
      <span className="accountabul-ticker-change">{change.text}</span>
    </button>
  );
}

function TickerLogo({ name, image }: { name: string; image: string | null }) {
  const [failed, setFailed] = useState(false);
  const fallback = name.trim().charAt(0).toUpperCase() || "•";
  if (!image || failed) {
    return <span className="accountabul-ticker-logo-fallback">{fallback}</span>;
  }
  return (
    <img
      className="accountabul-ticker-logo"
      src={image}
      alt=""
      width={16}
      height={16}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

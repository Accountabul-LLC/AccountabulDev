type MappableProperty = {
  address: string | null | undefined;
  zipCode?: string | null;
};

const GOOGLE_MAPS_SEARCH_URL = "https://www.google.com/maps/search/?api=1";

export function buildGoogleMapsUrl(property: MappableProperty) {
  const address = property.address?.replace(/\s+/g, " ").trim();
  if (!address || /^address not published$/i.test(address)) return null;

  const zipCode = property.zipCode?.trim();
  const region = zipCode ? `MO ${zipCode}` : "MO";
  const query = `${address}, St. Louis, ${region}`;

  return `${GOOGLE_MAPS_SEARCH_URL}&query=${encodeURIComponent(query)}`;
}

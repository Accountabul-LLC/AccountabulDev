# Featured Property Publication Requirements

Status: required contract for homepage property spotlights.

## Purpose

The homepage may feature one or more properties when real listings are ready. A featured position
must never turn mock copy, a stock photograph, an intersection name, an estimate, or an internal
draft into an apparent property or investment offering.

Until a property satisfies the requirements below, the UI must display an explicit empty or
illustrative state rather than invented property details.

## Olive Street and Grand Boulevard finding

Official Saint Louis University sources confirm that Olive Street and Grand Boulevard meet near
the university campus. They do **not** establish that “Olive & Grand” is a parcel address, identify
the building shown in the former stock image, or support a listing, valuation, yield, ownership, or
offering claim.

- SLU describes parking near the intersection of Grand Boulevard and Olive Street:
  `https://www.slu.edu/sluma/visit.php`
- SLU explains that Olive Street becomes Lindell Boulevard west of Grand Boulevard:
  `https://www.slu.edu/marcom/branding-and-identity/writing/slu-writing-style-guide.php`
- SLU's campus address list identifies the nearby Olive Compton Garage as `3338 Olive St.`, which
  is a separate facility and not evidence for a featured property:
  `https://www.slu.edu/facilities/campus-addresses-and-maps.php`

Conclusion: do not use “Olive & Grand” as a property identity. Require a complete verified street
address and parcel match.

## Required evidence before featuring

### 1. Property identity

- Complete normalized street address.
- City, state, and postal code.
- Authoritative parcel or assessor identifier.
- Latitude and longitude matched to the parcel.
- Verification source, timestamp, and reviewer.

### 2. Authorization

- Current owner or authorized listing party identified.
- Listing/marketing authorization documented.
- Authorization status and expiration date recorded.
- Private ownership evidence kept behind the appropriate access controls.

### 3. Images and media

- Every published image is confirmed to depict the identified property.
- Photographer, owner, license, or permitted source is recorded.
- Stock imagery is never presented as listing imagery.
- Illustrative imagery carries a visible “not an active listing” label.

### 4. Property and deal facts

- Property type and description have a named source.
- Asking price, valuation, and requested amount have dated supporting evidence.
- Occupancy, income, expenses, debt, and condition claims cite the underlying documents.
- Estimates are labeled as estimates and show their method and date.
- Projected yield or return is not displayed without reviewed assumptions and required risk
  disclosures.

### 5. Publication state

A listing may appear in a featured position only when the server-derived publication state is
eligible. The UI must not infer eligibility from client-provided text.

Recommended states:

- `draft`: visible only to authorized workspace members.
- `verification_pending`: not public and not featureable.
- `published`: public property record with required evidence.
- `offering_review`: property may be public, but participation language remains disabled.
- `offering_ready`: participation CTA may appear only after legal/compliance approval and all
  required offering materials are current.
- `paused` or `closed`: no new participation CTA.

## Group-purchase and pooled-investment gate

A structure where multiple people contribute money to acquire property and expect profit from the
efforts of an operator can implicate securities laws. The SEC's Howey framework considers an
investment of money in a common enterprise with an expectation of profits derived from the efforts
of others. When that framework is satisfied, an offering generally must be registered or qualify
for an exemption.

Primary sources:

- `https://www.sec.gov/newsroom/speeches-statements/moloney-statement-book-of-howey-031726`
- `https://www.sec.gov/file/33-5347`

Before Accountabul displays “invest,” “purchase shares,” projected returns, offering availability,
funding progress, minimum investment, or similar participation language, require documented review
by qualified securities counsel and the applicable compliance workflow. This document is a product
safety requirement, not legal advice.

## Featured-property component contract

The future homepage component should accept only a server-approved public record containing:

```ts
type FeaturedProperty = {
  listingId: string;
  slug: string;
  displayName: string;
  verifiedAddress: string;
  parcelId: string;
  primaryImageUrl: string;
  imageProvenance: string;
  publicationStatus: "published" | "offering_ready" | "paused" | "closed";
  priceLabel?: string;
  offeringLabel?: string;
  evidenceUpdatedAt: string;
};
```

The component may render multiple eligible records in a carousel or curated grid. Ordering and
featured status must come from an authorized server-side editorial workflow, not from arbitrary
client input.

## Acceptance criteria

- [ ] No fictional property, address, provider, event, valuation, yield, or verification claim is
      presented as real.
- [ ] Illustrative imagery is visibly and accessibly identified.
- [ ] A complete address and parcel identifier are verified before publication.
- [ ] Listing imagery is matched to the property and its provenance is recorded.
- [ ] Featured properties are selected only from server-approved public records.
- [ ] Pooled-purchase or investment language remains disabled until legal/compliance approval.
- [ ] Paused and closed offerings cannot accept participation.

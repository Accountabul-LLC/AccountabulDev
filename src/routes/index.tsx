import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, ArrowUpRight, Check, Search } from "lucide-react";

import { AccountabulMark } from "@/components/accountabul-mark";
import { lendersListUrl } from "@/lib/lenders-list";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Accountabul — Property decisions, with proof" },
      {
        name: "description",
        content:
          "Discover property opportunities, verified businesses, and live Accountabul events with the proof behind every decision.",
      },
      { property: "og:title", content: "Accountabul — Property decisions, with proof" },
      {
        property: "og:description",
        content:
          "A clearer real-estate marketplace built around verified people, documented property, and traceable activity.",
      },
    ],
  }),
  component: Home,
});

const featuredPropertySlots = [
  {
    position: "01",
    title: "Verified address",
    body: "A complete street address and authoritative parcel match are required before publication.",
  },
  {
    position: "02",
    title: "Property-matched media",
    body: "Published photos must be tied to the identified property and their source must be recorded.",
  },
  {
    position: "03",
    title: "Reviewed deal facts",
    body: "Price, terms, financial assumptions, and participation readiness need dated supporting evidence.",
  },
] as const;

const liveEvents = [
  {
    category: "Market briefings",
    status: "Not scheduled",
    title: "Property opportunity reviews",
    location: "Programming will appear after publication",
    summary:
      "Future sessions can connect a published property record with the evidence and questions people need to evaluate it.",
    detail: "View live area",
  },
  {
    category: "Owner workshops",
    status: "Not scheduled",
    title: "Preparing a verified listing",
    location: "Programming will appear after publication",
    summary:
      "Future workshops can help owners organize address, authorization, media, and supporting property documents.",
    detail: "View live area",
  },
  {
    category: "Educational replays",
    status: "None published",
    title: "Understanding trust signals",
    location: "Replays will appear after publication",
    summary:
      "Published education can explain how identity, business, property, and activity records work together.",
    detail: "View live area",
  },
] as const;

const providers = [
  {
    initials: "TR",
    service: "Title & escrow",
    description: "Verified providers will appear after credential review.",
    tone: "mint",
  },
  {
    initials: "LF",
    service: "Lending & financing",
    description: "Verified providers will appear after credential review.",
    tone: "amber",
  },
  {
    initials: "RL",
    service: "Real estate law",
    description: "Verified providers will appear after credential review.",
    tone: "coral",
  },
  {
    initials: "PI",
    service: "Property inspection",
    description: "Verified providers will appear after credential review.",
    tone: "mint",
  },
] as const;

function Home() {
  const lendersUrl = lendersListUrl();

  return (
    <div className="accountabul-landing">
      <section className="landing-hero" aria-labelledby="home-title">
        <div className="landing-hero-glow" aria-hidden="true" />
        <div className="container-page landing-hero-grid">
          <div className="landing-hero-copy">
            <p className="landing-hero-overline">Real estate, made accountable</p>

            <h1 id="home-title">
              Property decisions,
              <br />
              <em>with proof.</em>
            </h1>
            <p className="landing-hero-lead">
              Discover opportunities, review professional credentials, and keep every important
              record in one trusted place.
            </p>
            <div className="landing-hero-actions">
              <Link to="/marketplace" className="accountabul-button accountabul-button-primary">
                Browse properties <ArrowRight aria-hidden size={17} />
              </Link>
              <Link to="/live" className="accountabul-button accountabul-button-secondary">
                Explore live events
              </Link>
            </div>
            <div className="landing-trust-line">
              <p>
                <strong>Built for confident decisions</strong>
                <span>Clear records. Verifiable people. Traceable activity.</span>
              </p>
            </div>
          </div>

          <div className="landing-hero-visual" aria-label="Featured property layout preview">
            <div className="landing-photo-card">
              <img
                src="https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=1400&q=90"
                alt="Modern residential property exterior"
              />
              <div className="landing-property-float">
                <div>
                  <span className="landing-mini-label">Featured property</span>
                  <h2>Verified listings, front and center</h2>
                </div>
                <div className="landing-float-stats">
                  <p>
                    <strong>Evidence required</strong>
                    <span>Price and terms</span>
                  </p>
                  <p>
                    <strong>Review required</strong>
                    <span>Offering readiness</span>
                  </p>
                </div>
                <Link to="/marketplace" aria-label="Open the marketplace">
                  <ArrowUpRight aria-hidden size={17} />
                </Link>
              </div>
            </div>
            <div className="landing-proof-card">
              <span className="landing-proof-icon" aria-hidden="true">
                <Check size={15} />
              </span>
              <div>
                <strong>Verification required</strong>
                <p>Address, authorization, imagery, and deal facts</p>
              </div>
            </div>
            <div className="landing-dots" aria-hidden="true">
              ••••••••••••••••••••••
            </div>
          </div>
        </div>
      </section>

      <section className="landing-confidence" aria-label="Accountabul trust principles">
        <div className="container-page landing-confidence-grid">
          <div>
            <strong>One place to move with confidence.</strong>
            <span>From first look to final record.</span>
          </div>
          {(
            [
              ["01", "Verified identity", "Know who you’re working with", "/businesses"],
              ["02", "Documented property", "Important details, organized", "/marketplace"],
              ["03", "Traceable activity", "A clear history of every step", "/live"],
            ] as [string, string, string, string][]
          ).map(([number, title, body, href]) => (
            <Link className="landing-confidence-item" key={number} to={href}>
              <b>{number}</b>
              <p>
                <strong>{title}</strong>
                <span>{body}</span>
              </p>
            </Link>
          ))}
        </div>
      </section>

      <section className="container-page landing-market" id="marketplace">
        <div className="landing-section-heading">
          <div>
            <span className="landing-kicker">FEATURED PROPERTIES</span>
            <h2>
              Real opportunities,
              <br />
              published with proof.
            </h2>
          </div>
          <div>
            <p>
              When verified listings are ready, this area can feature multiple properties with their
              real address, property-matched images, evidence, and current participation status.
            </p>
            <Link to="/marketplace" className="landing-text-link">
              Open the marketplace <ArrowUpRight aria-hidden size={15} />
            </Link>
          </div>
        </div>
        <div className="landing-property-grid landing-property-requirements">
          {featuredPropertySlots.map((slot) => (
            <article className="landing-listing-card landing-requirement-card" key={slot.position}>
              <span>{slot.position}</span>
              <div className="landing-requirement-icon" aria-hidden="true">
                <Check size={18} />
              </div>
              <p className="landing-mini-label">Publication requirement</p>
              <h3>{slot.title}</h3>
              <p>{slot.body}</p>
              <div className="landing-requirement-status">Required before featuring</div>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-live-section" id="live">
        <div className="container-page">
          <div className="landing-section-heading">
            <div>
              <span className="landing-kicker">ACCOUNTABUL LIVE</span>
              <h2>
                Better conversations.
                <br />
                Clearer next steps.
              </h2>
            </div>
            <div>
              <p>
                When programming is published, this area will connect scheduled sessions, active
                rooms, and replays with the relevant property and professional context.
              </p>
              <Link to="/live" className="landing-text-link">
                Visit the live room <ArrowUpRight aria-hidden size={15} />
              </Link>
            </div>
          </div>
          <div className="landing-live-grid">
            {liveEvents.map((event) => (
              <article className="landing-live-card" key={event.title}>
                <div className="landing-live-card-top">
                  <span>{event.category}</span>
                  <b>{event.status}</b>
                </div>
                <h3>{event.title}</h3>
                <p className="location">{event.location}</p>
                <p>{event.summary}</p>
                <div className="landing-live-detail">
                  <span>{event.detail}</span>
                  <Link to="/live" aria-label={`Open ${event.title}`}>
                    <ArrowRight aria-hidden size={16} />
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-trust-section" id="trust">
        <div className="container-page landing-trust-grid">
          <div className="landing-trust-photo">
            <img
              src="https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=1400&q=85"
              alt="Real estate professional reviewing property information"
            />
            <div className="landing-signal">
              <span className="landing-signal-mark">
                <AccountabulMark small adaptive />
              </span>
              <p>
                <b>Accountabul verification framework</b>
                <span>Identity · Business · Property</span>
              </p>
              <strong>3 checks</strong>
            </div>
          </div>
          <div className="landing-trust-copy">
            <span className="landing-kicker">BUILT ON TRUST</span>
            <h2>
              Less guessing.
              <br />
              More knowing.
            </h2>
            <p>
              Real estate involves people, paperwork, money, and time. Accountabul brings the proof
              behind each one into a clear, usable experience.
            </p>
            <div className="landing-trust-list">
              {[
                [
                  "People can verify who they are",
                  "Reviewed identity and business evidence can support clearer working relationships.",
                ],
                [
                  "Property records stay together",
                  "Keep important documents, status, and history attached to the opportunity.",
                ],
                [
                  "Activity leaves a trail",
                  "Payments, approvals, and updates remain visible to the people who need them.",
                ],
              ].map(([title, body]) => (
                <div key={title}>
                  <b aria-hidden="true">
                    <Check size={14} />
                  </b>
                  <p>
                    <strong>{title}</strong>
                    <span>{body}</span>
                  </p>
                </div>
              ))}
            </div>
            <Link to="/businesses" className="accountabul-button accountabul-button-dark">
              Explore verified businesses <ArrowRight aria-hidden size={16} />
            </Link>
          </div>
        </div>
      </section>

      <section className="container-page landing-network" id="network">
        <div className="landing-network-intro">
          <span className="landing-kicker">THE VERIFIED NETWORK</span>
          <h2>
            The right people,
            <br />
            with visible proof.
          </h2>
          <p>
            The directory is designed to show professionals only after the relevant identity,
            business, and credential evidence has been reviewed.
          </p>
          <Link to="/businesses" className="accountabul-button accountabul-button-secondary">
            Browse verified businesses <ArrowUpRight aria-hidden size={16} />
          </Link>
        </div>
        <div className="landing-network-board">
          <div className="landing-network-top">
            <div className="landing-search-fake">
              <Search aria-hidden size={14} /> Search by service or location
            </div>
            <span>{providers.length} service categories</span>
          </div>
          {providers.map((provider) => (
            <Link to="/businesses" className="landing-provider-card" key={provider.service}>
              <div className={`landing-provider-avatar ${provider.tone}`}>{provider.initials}</div>
              <div>
                <span>Directory category</span>
                <h3>{provider.service}</h3>
                <p>{provider.description}</p>
              </div>
              <b className="landing-category-arrow" aria-hidden="true">
                <ArrowRight size={14} />
              </b>
            </Link>
          ))}
        </div>
      </section>

      <section className="landing-financing" id="financing">
        <div className="container-page landing-financing-grid">
          <div>
            <span className="landing-kicker">FINANCING REQUESTS</span>
            <h2>
              Bring the opportunity.
              <br />
              Build a clearer request.
            </h2>
            <p>
              Start with a verified property, explain the financing need, and attach the facts a
              provider would need. Provider routing appears only after the request and provider
              credentials are reviewed.
            </p>
            <div className="landing-disclaimer">
              Accountabul helps prepare and route inquiries. It does not approve, originate, or
              guarantee financing.
            </div>
            {lendersUrl ? (
              <p>
                Capital providers can list indicative terms on <a href={lendersUrl}>Lenders List</a>
                . That site is a private intake form, not a public lender marketplace.
              </p>
            ) : null}
            <Link to="/signup" className="accountabul-button accountabul-button-primary">
              Create an Accountabul account <ArrowRight aria-hidden size={17} />
            </Link>
          </div>
          <div className="landing-request-preview">
            <div className="landing-request-head">
              <span>REQUEST FORMAT PREVIEW</span>
              <b>Example only</b>
            </div>
            <h3>No property request created</h3>
            <div className="landing-request-rows">
              <p>
                <span>Property</span>
                <b>Verified listing required</b>
              </p>
              <p>
                <span>Requested amount</span>
                <b>Provided by requester</b>
              </p>
              <p>
                <span>Purpose</span>
                <b>Provided by requester</b>
              </p>
              <p>
                <span>Documents</span>
                <b>Evidence required</b>
              </p>
            </div>
            <div className="landing-matched-provider">
              <div className="landing-provider-avatar amber">LF</div>
              <p>
                <span>Provider routing</span>
                <b>No provider matched</b>
                <small>Available after listing, request, and provider review</small>
              </p>
              <strong>Review first</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-cta">
        <div className="landing-cta-orb" aria-hidden="true" />
        <div className="container-page landing-cta-inner">
          <AccountabulMark variant="mint" />
          <span className="landing-kicker">YOUR NEXT MOVE, CLEARER</span>
          <h2>
            Build real estate relationships
            <br />
            on a better foundation.
          </h2>
          <p>Join the platform designed to make trust visible and progress easier to follow.</p>
          <div>
            <Link to="/signup" className="accountabul-button landing-cream-button">
              Get started with Accountabul <ArrowRight aria-hidden size={17} />
            </Link>
            <Link to="/marketplace" className="accountabul-button landing-ghost-button">
              Browse first
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

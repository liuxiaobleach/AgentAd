import Link from "next/link";

type FlowStep = {
  title: string;
  body: string;
  href?: string;
  cta?: string;
};

type GuideSection = {
  id: string;
  title: string;
  route: string;
  href: string;
  summary: string;
  purpose: string;
  actions: string[];
  tips: string[];
};

const advertiserFlow: FlowStep[] = [
  {
    title: "Fund Your Workspace",
    body: "Start on Billing so the platform can reserve budget for creative generation, audit, and bidder simulations.",
    href: "/billing",
    cta: "Open Billing",
  },
  {
    title: "Create a Branded Variant Set",
    body: "Go to Creatives, manage your Brand Kit, then launch Batch Creative Studio to generate multiple angles from one brief.",
    href: "/creatives",
    cta: "Open Creatives",
  },
  {
    title: "Compare Before You Scale",
    body: "Use Creative Lab to compare risk, fit, CTR signals, and the batch context before you pick a winner.",
    href: "/creative-lab",
    cta: "Open Creative Lab",
  },
  {
    title: "Run Audit + Verification",
    body: "Submit the selected creative to audit, review evidence and replay, then issue certificates for approved assets.",
    href: "/audit-cases",
    cta: "Open Audit Cases",
  },
  {
    title: "Configure Bidder Agents",
    body: "Tune bidder strategy, simulate auctions, inspect why you won, and keep iterating from reports and analyst feedback.",
    href: "/bidder-agents",
    cta: "Open Bidder Agents",
  },
];

const publisherFlow: FlowStep[] = [
  {
    title: "Sign In as a Publisher",
    body: "Use the publisher login route to access earnings, wallet configuration, and claim tools.",
    href: "/publisher/login",
    cta: "Open Publisher Login",
  },
  {
    title: "Link Your Wallet",
    body: "Inside the dashboard, connect MetaMask and bind the payout wallet that will receive USDC from BudgetEscrow.",
    href: "/publisher/dashboard",
    cta: "Open Publisher Dashboard",
  },
  {
    title: "Review Earnings + Events",
    body: "Track total earned, unclaimed balance, and event-level earnings to understand how slots are monetizing.",
    href: "/publisher/dashboard",
    cta: "See Earnings",
  },
  {
    title: "Prepare and Submit Claim",
    body: "Enter a claim amount, let the backend prepare the receipt, then sign and broadcast the on-chain claim flow.",
    href: "/publisher/dashboard",
    cta: "Go to Claim Flow",
  },
];

const advertiserSections: GuideSection[] = [
  {
    id: "advertiser-dashboard",
    title: "Dashboard",
    route: "/dashboard",
    href: "/dashboard",
    summary: "The advertiser command center for recent audits, key creative counts, and quick access to agents.",
    purpose: "Use this page to understand overall creative health before you jump into generation, audit, or bidding.",
    actions: [
      "Review the top stat cards to see total creative volume, approval count, pending items, and active audits.",
      "Open Recent Audit Cases when you want to inspect the newest review decisions or continue an in-progress case.",
      "Open My Bidder Agents to tune a strategy that is underperforming or launch a new simulation path.",
    ],
    tips: [
      "Treat Dashboard as your start-of-day checkpoint.",
      "If audit count is growing faster than approvals, move to Audit Cases before generating new volume.",
    ],
  },
  {
    id: "advertiser-billing",
    title: "Billing",
    route: "/billing",
    href: "/billing",
    summary: "Budget management, deposits, and the balance gate that powers generation, audit, and simulation runs.",
    purpose: "Use Billing whenever you need to top up spendable balance or verify that a workflow has enough budget to start.",
    actions: [
      "Deposit USDC into the platform budget escrow before running generation or large simulation batches.",
      "Check available balance when Create or Audit actions return a 402 insufficient balance prompt.",
      "Use this page first if Batch Creative Studio is about to launch multiple variants at once.",
    ],
    tips: [
      "Generation and audit flows reserve spend up front, so keep extra headroom above the exact expected cost.",
      "If a workflow fails to start, Billing is the first page to verify.",
    ],
  },
  {
    id: "advertiser-creatives",
    title: "Creatives",
    route: "/creatives",
    href: "/creatives",
    summary: "Creative inventory, Batch Creative Studio, Brand Kit management, and recent studio run history.",
    purpose: "This is now the main production workspace for building new assets and organizing creative supply.",
    actions: [
      "Use Batch Creative Studio to generate one to four variants from a single brief.",
      "Open Manage Brand Kit to save voice, visual, CTA, and language constraints for branded generation.",
      "Review Recent Studio Runs to reopen an in-flight batch and jump straight into Creative Lab when results are ready.",
    ],
    tips: [
      "Use Brand Kit whenever multiple team members create assets and you want consistent outputs.",
      "Name each batch clearly so it is easy to reopen from Recent Studio Runs.",
    ],
  },
  {
    id: "advertiser-lab",
    title: "Creative Lab",
    route: "/creative-lab",
    href: "/creative-lab",
    summary: "A comparison workspace for up to three creatives, now with batch run context and Brand Kit recall.",
    purpose: "Use this page to decide which generated asset should advance to audit, testing, or scale.",
    actions: [
      "Compare multiple creatives on risk, profile, audience fit, CTR signals, and summary labels like safest or best candidate.",
      "Open Creative Lab from a studio run so the page preloads the best ready variants from that batch.",
      "Use the Studio Context banner to remember which brief, Brand Kit, and run title produced the compared assets.",
    ],
    tips: [
      "Creative Lab is most valuable after batch generation, not before.",
      "Pick your audit candidate here rather than reviewing one creative at a time.",
    ],
  },
  {
    id: "advertiser-audit",
    title: "Audit Cases",
    route: "/audit-cases",
    href: "/audit-cases",
    summary: "Compliance queue, case detail, evidence timeline, and Audit Replay for approved or rejected submissions.",
    purpose: "Use Audit Cases to understand why a creative passed or failed and what should change before resubmission.",
    actions: [
      "Open the case list to find assets waiting for review, completed decisions, or cases that need follow-up.",
      "Use Audit Replay inside the detail view to watch the compliance reasoning unfold step by step.",
      "Inspect evidence, findings, and summary notes before editing or resubmitting a creative.",
    ],
    tips: [
      "Rejected cases often reveal patterns that should be folded back into your Brand Kit or generation brief.",
      "Use replay mode when demonstrating platform trust and explainability to stakeholders.",
    ],
  },
  {
    id: "advertiser-agents",
    title: "Bidder Agents",
    route: "/bidder-agents",
    href: "/bidder-agents",
    summary: "Strategy management for bidding agents, including templates, prompt tuning, and budget / bid controls.",
    purpose: "Use this area to define how your bidder agents choose creatives, estimate value, and decide whether to bid.",
    actions: [
      "Create or edit agents with a strategy template that matches your campaign goal.",
      "Tune agent skills and the strategy prompt to bias bidding toward audience match, pacing, or floor awareness.",
      "Set bid ceilings and value-per-click so the model operates inside a clear financial boundary.",
    ],
    tips: [
      "Start with Balanced, then specialize once you have replay and report data.",
      "Keep at least one stable benchmark agent so prompt experiments remain measurable.",
    ],
  },
  {
    id: "advertiser-auctions",
    title: "My Bids",
    route: "/auctions",
    href: "/auctions",
    summary: "Auction simulation history, bid outcomes, settlement values, and replay entry points.",
    purpose: "Use this page to inspect how agents behave in auction conditions and whether your selected creatives are competitive.",
    actions: [
      "Run Simulation to generate fresh auction traffic for your current agents.",
      "Inspect winning and losing bids to see participation rate, pCTR, settlement price, and click outcomes.",
      "Open a specific row to jump into Auction Replay / Why I Won for a deeper explanation.",
    ],
    tips: [
      "Use My Bids together with Reports and Ad Analyst to separate strategy issues from creative issues.",
      "A high skip rate usually means your prompt or bid ceiling is too conservative.",
    ],
  },
  {
    id: "advertiser-reports",
    title: "Reports",
    route: "/reports",
    href: "/reports",
    summary: "Performance rollups and trend views for spend, outcomes, and simulated ad performance.",
    purpose: "Use Reports to understand whether the system is improving over time instead of only reviewing one run at a time.",
    actions: [
      "Review top-level charts after a day of new simulations or creative changes.",
      "Cross-check spend and CTR movement after changing bidder prompts or introducing a new batch of creatives.",
      "Use reports to decide whether to keep scaling a creative family or return to Batch Creative Studio.",
    ],
    tips: [
      "Reports tell you what changed; replay pages tell you why.",
      "Treat this page as your trend lens, not your debugging page.",
    ],
  },
  {
    id: "advertiser-analyst",
    title: "Ad Analyst",
    route: "/analyst",
    href: "/analyst",
    summary: "AI-generated analysis over agent stats and creative stats, with findings and recommended next actions.",
    purpose: "Use Analyst when you need a higher-level diagnosis after enough auction data has accumulated.",
    actions: [
      "Run Analysis after multiple simulations to generate findings, recommendations, and strategy advice.",
      "Compare agent performance and creative performance side by side before making strategic edits.",
      "Use the generated advice to decide whether to change strategy, refresh creatives, or tighten cost control.",
    ],
    tips: [
      "This page becomes more useful after you have enough recent auction volume.",
      "Use Analyst recommendations as prompts for your next Batch Creative Studio run.",
    ],
  },
  {
    id: "advertiser-certificates",
    title: "Certificates",
    route: "/certificates",
    href: "/certificates",
    summary: "The verification surface for approved creatives and their audit-derived trust state.",
    purpose: "Use Certificates when you want to inspect or demonstrate the verification status attached to a creative.",
    actions: [
      "Review issued certificates for approved assets and confirm their attestation context.",
      "Use this page when presenting the compliance trust layer to partners or publishers.",
      "Cross-reference certificates with audit decisions if a creative is being questioned downstream.",
    ],
    tips: [
      "Certificates are downstream trust artifacts; Audit Cases remain the source of reasoning.",
    ],
  },
  {
    id: "advertiser-integrations",
    title: "Integration",
    route: "/integrations",
    href: "/integrations",
    summary: "Implementation guidance for verification SDK paths and publisher-facing integration modes.",
    purpose: "Use Integration when you want to deploy verification or connect this platform to a site or partner environment.",
    actions: [
      "Read the SDK and verification patterns before rolling out certificate checks externally.",
      "Use this page when onboarding a partner or publisher to the verification side of the product.",
      "Reference the integration examples when moving from internal demo to embedded deployment.",
    ],
    tips: [
      "Integration is a build page, not a daily operations page.",
    ],
  },
];

const publisherSections: GuideSection[] = [
  {
    id: "publisher-login",
    title: "Publisher Login",
    route: "/publisher/login",
    href: "/publisher/login",
    summary: "The entry point for publisher identity, earnings access, and the wallet / claim workflow.",
    purpose: "Use this page to sign in as the publisher role before managing payout wallets or claiming earnings.",
    actions: [
      "Sign in with the publisher credentials to unlock the dashboard.",
      "Use the demo account shortcut during evaluation or internal walkthroughs.",
      "Open the user guide from this page if the claim flow is new to your team.",
    ],
    tips: [
      "Publisher and advertiser sessions are separate, so use the correct login route for the correct role.",
    ],
  },
  {
    id: "publisher-dashboard",
    title: "Publisher Dashboard",
    route: "/publisher/dashboard",
    href: "/publisher/dashboard",
    summary: "Earnings operations center for wallet linking, claim preparation, receipts, and event-level revenue visibility.",
    purpose: "Use this page to connect the payout wallet, monitor unclaimed balance, and complete the on-chain claim flow.",
    actions: [
      "Review Total Earned, Claimed On-Chain, and Unclaimed metrics at the top of the page.",
      "Link or relink the connected MetaMask wallet before attempting a claim.",
      "Use the Wallet & Claim card to prepare a claim amount and submit it to BudgetEscrow.",
      "Inspect Earning Events to see how earnings are credited over time and Claim Receipts to confirm what has been issued or redeemed.",
    ],
    tips: [
      "Make sure the connected MetaMask account matches the linked payout wallet before claiming.",
      "Use receipts as your source of truth when verifying whether a claim has already been redeemed on-chain.",
    ],
  },
];

function GuideNav({
  title,
  items,
}: {
  title: string;
  items: GuideSection[];
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white/85 p-5 shadow-sm backdrop-blur">
      <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">{title}</div>
      <div className="mt-4 space-y-2">
        {items.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className="block rounded-2xl border border-slate-200/90 px-4 py-3 text-sm text-slate-600 transition hover:border-cyan-300 hover:bg-cyan-50/70 hover:text-slate-900"
          >
            <div className="font-semibold text-slate-900">{item.title}</div>
            <div className="mt-1 text-xs text-slate-500">{item.route}</div>
          </a>
        ))}
      </div>
    </div>
  );
}

function FlowCard({ step, index }: { step: FlowStep; index: number }) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white/88 p-6 shadow-sm backdrop-blur">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.24em] text-slate-400">Step {index + 1}</div>
          <h3 className="mt-2 text-lg font-semibold text-slate-900">{step.title}</h3>
          <p className="mt-3 text-sm leading-7 text-slate-600">{step.body}</p>
        </div>
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-sm font-semibold text-white">
          {index + 1}
        </div>
      </div>
      {step.href && step.cta && (
        <Link
          href={step.href}
          className="mt-5 inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition hover:border-cyan-300 hover:text-cyan-700"
        >
          {step.cta}
          <span aria-hidden="true">↗</span>
        </Link>
      )}
    </div>
  );
}

function SectionCard({ section }: { section: GuideSection }) {
  return (
    <section
      id={section.id}
      className="scroll-mt-24 rounded-[32px] border border-slate-200 bg-white/92 p-7 shadow-sm backdrop-blur"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <div className="text-[10px] uppercase tracking-[0.24em] text-slate-400">{section.route}</div>
          <h3 className="mt-2 text-2xl font-semibold text-slate-900">{section.title}</h3>
          <p className="mt-3 text-sm leading-7 text-slate-600">{section.summary}</p>
          <p className="mt-3 text-sm leading-7 text-slate-700">
            <span className="font-semibold text-slate-900">When to use it:</span> {section.purpose}
          </p>
        </div>
        <Link
          href={section.href}
          className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-cyan-50 px-4 py-2 text-sm font-medium text-cyan-700 transition hover:border-cyan-300 hover:bg-cyan-100"
        >
          Open Page
          <span aria-hidden="true">↗</span>
        </Link>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-5">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">How To Use</div>
          <div className="mt-4 space-y-3">
            {section.actions.map((item) => (
              <div key={item} className="flex gap-3 text-sm leading-7 text-slate-700">
                <span className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-cyan-500" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-slate-950 p-5 text-slate-100">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Operator Notes</div>
          <div className="mt-4 space-y-3">
            {section.tips.map((item) => (
              <div key={item} className="flex gap-3 text-sm leading-7 text-slate-300">
                <span className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-emerald-400" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function DocsPage() {
  return (
    <div
      className="min-h-screen"
      style={{
        background:
          "radial-gradient(circle at top left, rgba(6,182,212,0.12), transparent 26%), radial-gradient(circle at 80% 20%, rgba(168,85,247,0.1), transparent 26%), linear-gradient(180deg, #f8fbff 0%, #eef5ff 100%)",
      }}
    >
      <div className="mx-auto max-w-7xl px-6 py-10 lg:px-8">
        <div className="rounded-[36px] border border-white/70 bg-white/80 p-8 shadow-[0_30px_100px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="max-w-3xl">
              <div className="text-[11px] uppercase tracking-[0.3em] text-cyan-600">AgentAd User Guide</div>
              <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950">
                One handbook for advertisers, publishers, and every page in the product.
              </h1>
              <p className="mt-5 text-base leading-8 text-slate-600">
                This guide explains what each page is for, when to open it, and how to move through the system without
                guessing. Use the quick starts if you want the shortest path, or jump into the page-by-page manual if
                you are onboarding a team.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Link
                href="#advertiser-quickstart"
                className="rounded-[24px] border border-cyan-200 bg-cyan-50 px-5 py-4 text-sm font-medium text-cyan-700 transition hover:bg-cyan-100"
              >
                Advertiser Quick Start
              </Link>
              <Link
                href="#publisher-quickstart"
                className="rounded-[24px] border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100"
              >
                Publisher Quick Start
              </Link>
              <Link
                href="/login"
                className="rounded-[24px] border border-slate-200 bg-white px-5 py-4 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              >
                Advertiser Login
              </Link>
              <Link
                href="/publisher/login"
                className="rounded-[24px] border border-slate-200 bg-white px-5 py-4 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              >
                Publisher Login
              </Link>
            </div>
          </div>
        </div>

        <div className="mt-10 grid gap-6 xl:grid-cols-[0.8fr_1.2fr_1.2fr]">
          <GuideNav title="Advertiser Pages" items={advertiserSections} />
          <GuideNav title="Publisher Pages" items={publisherSections} />
          <div className="rounded-3xl border border-slate-200 bg-slate-950 p-6 text-white shadow-sm">
            <div className="text-[11px] uppercase tracking-[0.24em] text-cyan-300">How To Read This Guide</div>
            <div className="mt-4 space-y-4 text-sm leading-7 text-slate-300">
              <p>Use the quick starts if you want the shortest end-to-end workflow for a role.</p>
              <p>Use the page sections when you want to understand the purpose of a specific screen before clicking it.</p>
              <p>Open the page directly from each section if you are already signed in and want to act immediately.</p>
            </div>
          </div>
        </div>

        <section id="advertiser-quickstart" className="scroll-mt-24 mt-14">
          <div className="mb-5">
            <div className="text-[11px] uppercase tracking-[0.24em] text-cyan-600">Advertiser Quick Start</div>
            <h2 className="mt-2 text-3xl font-semibold text-slate-950">Recommended daily workflow for advertisers</h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              If you are using the platform as an advertiser, this is the fastest path from funded budget to a tested,
              auditable creative and an active bidder strategy.
            </p>
          </div>
          <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
            {advertiserFlow.map((step, index) => (
              <FlowCard key={step.title} step={step} index={index} />
            ))}
          </div>
        </section>

        <section id="publisher-quickstart" className="scroll-mt-24 mt-14">
          <div className="mb-5">
            <div className="text-[11px] uppercase tracking-[0.24em] text-emerald-600">Publisher Quick Start</div>
            <h2 className="mt-2 text-3xl font-semibold text-slate-950">Recommended workflow for publishers</h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              Publisher mode is simpler: sign in, connect the payout wallet, review earnings, and redeem receipts on-chain.
            </p>
          </div>
          <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-4">
            {publisherFlow.map((step, index) => (
              <FlowCard key={step.title} step={step} index={index} />
            ))}
          </div>
        </section>

        <section className="mt-16">
          <div className="mb-5">
            <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Advertiser Manual</div>
            <h2 className="mt-2 text-3xl font-semibold text-slate-950">Page-by-page guide for advertiser workflows</h2>
          </div>
          <div className="space-y-6">
            {advertiserSections.map((section) => (
              <SectionCard key={section.id} section={section} />
            ))}
          </div>
        </section>

        <section className="mt-16">
          <div className="mb-5">
            <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Publisher Manual</div>
            <h2 className="mt-2 text-3xl font-semibold text-slate-950">Page-by-page guide for publisher workflows</h2>
          </div>
          <div className="space-y-6">
            {publisherSections.map((section) => (
              <SectionCard key={section.id} section={section} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

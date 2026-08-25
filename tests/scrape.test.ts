import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeEntities, parseEasyJobs, parseEasyJobsDetail, parseNextJobzRsc, parseTokyoDev, parseTokyoDevDetail } from "@/lib/adapters/scrape";

const tokyodevHtml = readFileSync(new URL("./fixtures/tokyodev.html", import.meta.url), "utf8");

const FIXTURE = `
<html><body>
  <div class="hero">Join us</div>
  <a href="https://brainstation-23.easy.jobs/principal-java-developer" class="job">
    <h3>Principal Java Developer</h3><span>Mohakhali</span>
  </a>
  <a href="https://brainstation-23.easy.jobs/data-engineer">
    Data Engineer &amp; Analytics
  </a>
  <a href="https://brainstation-23.easy.jobs/remote-support-engineer">
    Remote Support Engineer
  </a>
  <a href="/not-a-job-link">relative link ignored</a>
  <a href="https://other.example.com/some-job">external ignored</a>
</body></html>`;

describe("parseEasyJobs", () => {
  it("extracts job anchors with decoded titles", () => {
    const listings = parseEasyJobs(FIXTURE, "https://brainstation-23.easy.jobs/");
    expect(listings).toHaveLength(3);
    const java = listings.find((l) => l.externalId === "principal-java-developer");
    expect(java?.title).toBe("Principal Java Developer");
    expect(java?.url).toBe("https://brainstation-23.easy.jobs/principal-java-developer");
    expect(java?.location).toBe("Dhaka, Bangladesh");
    const de = listings.find((l) => l.externalId === "data-engineer");
    expect(de?.title).toBe("Data Engineer & Analytics");
  });

  it("flags remote in title", () => {
    const listings = parseEasyJobs(FIXTURE, "https://brainstation-23.easy.jobs/");
    const remote = listings.find((l) => l.externalId === "remote-support-engineer");
    expect(remote?.isRemote).toBe(true);
    expect(listings.find((l) => l.externalId === "data-engineer")?.isRemote).toBe(false);
  });

  it("dedupes repeated links and ignores foreign hosts", () => {
    const dup = FIXTURE + '<a href="https://brainstation-23.easy.jobs/data-engineer">Data Engineer &amp; Analytics</a>';
    const listings = parseEasyJobs(dup, "https://brainstation-23.easy.jobs/");
    expect(listings).toHaveLength(3);
  });

  it("throws when no jobs found (structure changed)", () => {
    expect(() => parseEasyJobs("<html><body>maintenance</body></html>", "https://x.easy.jobs/")).toThrow();
  });
});

describe("parseNextJobzRsc", () => {
  const FLIGHT = `2:[{"state":{"queries":[{"dehydratedAt":1787312211968,"state":{"data":{"data":[
{"sl":0,"accountId":1,"jobMasterId":53606,"jobTitle":"Business Developer","jobCode":"IJOB202652969","companyName":"Xen Tech","jobLocation":"Dhaka","workType":"On-Site","employmentType":"Full-Time","jobSkills":"[\\"Business Development\\",\\"Negotiation\\"]","fromDate":"2026-07-15T15:51:29.967","toDate":"2026-08-31T00:00:00","url":"IJOB202652969"},
{"sl":1,"jobMasterId":53607,"jobTitle":"Senior Java Engineer (Remote)","jobCode":"IJOB202653001","companyName":"Acme BD","jobLocation":"","workType":"Remote","employmentType":"Full-Time","jobSkills":null,"fromDate":"2026-08-01T09:00:00.000"}
]}}}]}}]`;

  it("extracts structured jobs from the flight payload", () => {
    const listings = parseNextJobzRsc(FLIGHT, "https://nextjobz.com.bd/jobs");
    expect(listings).toHaveLength(2);
    const bd = listings[0];
    expect(bd.externalId).toBe("IJOB202652969");
    expect(bd.title).toBe("Business Developer");
    expect(bd.company).toBe("Xen Tech");
    expect(bd.location).toBe("Dhaka, Bangladesh");
    expect(bd.isRemote).toBe(false);
    expect(bd.tags).toContain("Business Development");
    expect(bd.postedAt).toBe("2026-07-15T15:51:29.967");
    expect(bd.url).toMatch(/\/jobs\/business-developer-dhaka-IJOB202652969$/);
  });

  it("handles empty location and remote work type", () => {
    const listings = parseNextJobzRsc(FLIGHT, "https://nextjobz.com.bd/jobs");
    const remote = listings[1];
    expect(remote.location).toBe("Bangladesh");
    expect(remote.isRemote).toBe(true);
    expect(remote.url).toBe("https://nextjobz.com.bd/jobs/senior-java-engineer-remote-IJOB202653001");
  });

  it("throws when payload has no jobs", () => {
    expect(() => parseNextJobzRsc("2:[]", "https://nextjobz.com.bd/jobs")).toThrow();
  });
});

describe("decodeEntities", () => {
  it("decodes common entities", () => {
    expect(decodeEntities("Java &amp; Spring &#8212; it&#039;s great")).toBe(
      "Java & Spring — it's great",
    );
  });
});

describe("parseTokyoDev", () => {
  it("parses jobs grouped by company with tags and remote flags", () => {
    const listings = parseTokyoDev(tokyodevHtml);
    expect(listings).toHaveLength(3);

    const seo = listings.find((l) => l.externalId === "metanomaly/seo-engineer")!;
    expect(seo.title).toBe("SEO Engineer");
    expect(seo.company).toBe("Metanomaly"); // from the company group header
    expect(seo.isRemote).toBe(true); // "Partially remote"
    expect(seo.visaSponsorship).toBe(true); // "Apply from abroad"
    expect(seo.tags).toContain("No Japanese required");
    expect(seo.tags).toContain("Frontend");
    expect(seo.url).toBe("https://www.tokyodev.com/companies/metanomaly/jobs/seo-engineer");

    const fullstack = listings.find((l) => l.externalId === "metanomaly/fullstack-engineer-growth")!;
    expect(fullstack.isRemote).toBe(true); // "Fully remote"
    expect(fullstack.visaSponsorship).toBe(false);
    expect(fullstack.tags).toContain("¥8M ~ ¥12M"); // salary tag decoded from entity
    expect(fullstack.tags).toContain("Ruby on Rails");

    const backend = listings.find((l) => l.externalId === "paypay/backend-engineer")!;
    expect(backend.isRemote).toBe(false); // "No remote" excluded from tags
    expect(backend.company).toBe("PayPay");
    expect(backend.location).toBe("Japan");
    expect(backend.tags).toContain("Japan residents only");
    expect(backend.tags).toContain("Business Japanese");
    expect(backend.tags).not.toContain("No remote");
  });

  it("throws when the page has no job cards", () => {
    expect(() => parseTokyoDev("<html><body>maintenance</body></html>")).toThrow();
  });
});

describe("parseTokyoDevDetail", () => {
  const DETAIL_HTML = `<html><head>
    <script type="application/ld+json">{"@context":"https://schema.org/","@type":"WebSite","name":"TokyoDev"}</script>
    <script type="application/ld+json">{"@context":"https://schema.org/","@type":"JobPosting","title":"Backend Engineer","description":"\u003cp\u003eBuild \u003cb\u003epayments\u003c/b\u003e systems. Visa sponsorship available.\u003c/p\u003e","datePosted":"2026-01-06T14:40:49.002+09:00","jobLocation":{"@type":"Place","address":{"@type":"PostalAddress","addressLocality":"Minato-ku","addressRegion":"Tokyo","addressCountry":"JP"}}}</script>
  </head><body>job page</body></html>`;

  it("extracts description, posting date and location from the JobPosting JSON-LD", () => {
    const detail = parseTokyoDevDetail(DETAIL_HTML);
    expect(detail).not.toBeNull();
    expect(detail!.description).toBe("Build payments systems. Visa sponsorship available.");
    expect(detail!.postedAt).toBe("2026-01-06T05:40:49.002Z");
    expect(detail!.location).toBe("Minato-ku, Tokyo");
  });

  it("returns null when no JobPosting block exists", () => {
    expect(parseTokyoDevDetail("<html><body>challenge page</body></html>")).toBeNull();
  });
});

describe("parseEasyJobsDetail", () => {
  // mirrors the SSR structure of https://{tenant}.easy.jobs/{slug} detail pages
  const DETAIL_HTML = `<html><head>
    <script type="application/ld+json">{"@context":"https://schema.org/","@type":"JobPosting","title":"Asp.Net Developer","datePosted":"2026-07-28"}</script>
  </head><body>
    <section class="content-card section-gap">
      <div class="block-info translate">
        <h1>Description</h1>
        <p>We are seeking skilled engineers to join <strong>our team</strong>.</p>
        <h5>Job Responsibilities</h5>
        <ul>
          <li>Design REST APIs using ASP.NET Core</li>
          <li>Build UIs with React &amp; Redux</li>
        </ul>
        <p>3 to 6 years of experience&nbsp;required.</p>
      </div>
    </section>
    <section class="content-card"><p>unrelated section</p></section>
  </body></html>`;

  it("extracts the full Description section text and the JSON-LD posting date", () => {
    const detail = parseEasyJobsDetail(DETAIL_HTML);
    expect(detail).not.toBeNull();
    expect(detail!.description).toBe(
      [
        "We are seeking skilled engineers to join our team.",
        "Job Responsibilities",
        "Design REST APIs using ASP.NET Core",
        "Build UIs with React & Redux",
        "3 to 6 years of experience required.",
      ].join("\n"),
    );
    expect(detail!.postedAt).toBe("2026-07-28T00:00:00.000Z");
  });

  it("returns null when there is no Description section", () => {
    expect(parseEasyJobsDetail("<html><body>challenge page</body></html>")).toBeNull();
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeEntities, isTechTitle, parseArcJobs, parseArcDetail, parseEasyJobs, parseEasyJobsDetail, parseNextJobzRsc, parseRelocateMe, parseRelocateMeDetail, parseRiseupLabs, parseRiseupLabsDetail, parseSkillJobs, parseSkillJobsDetail, parseTokyoDev, parseTokyoDevDetail } from "@/lib/adapters/scrape";

const tokyodevHtml = readFileSync(new URL("./fixtures/tokyodev.html", import.meta.url), "utf8");
const arcJobsHtml = readFileSync(new URL("./fixtures/arc-jobs.html", import.meta.url), "utf8");
const arcDetailHtml = readFileSync(new URL("./fixtures/arc-detail.html", import.meta.url), "utf8");
const relocateJobsHtml = readFileSync(new URL("./fixtures/relocate-jobs.html", import.meta.url), "utf8");
const relocateDetailHtml = readFileSync(new URL("./fixtures/relocate-detail.html", import.meta.url), "utf8");

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

describe("parseEasyJobs empty state", () => {
  it("returns [] for tenants with no open positions instead of throwing", () => {
    const empty = `<html><body><h4 class="job-header__title">No open job positions</h4></body></html>`;
    expect(parseEasyJobs(empty, "https://vivasoft.easy.jobs/")).toEqual([]);
  });
});

describe("parseRiseupLabs", () => {
  // mirrors https://riseuplabs.com/jobs/ SSR structure
  const RISEUP = `
  <html><body>
    <div class="single-job">
      <div class="wrapper">
        <div class="job-info-box">
          <span class="h3 job-title"><a href="https://riseuplabs.com/jobs/senior-software-engineer/">Senior Software Engineer (Java)</a></span>
          <div class="job-info-meta">
            <span class="type">Job Type: Full time</span>
            <span class="vacancy">Vacancies: 2</span>
            <span class="deadline">
            Deadline:                        September 18, 2026 (22 days left)                      </span>
          </div>
        </div>
        <a class="job-permalink" href="https://riseuplabs.com/jobs/senior-software-engineer/"><span class="permalink">apply</span></a>
      </div>
    </div>
    <div class="single-job">
      <div class="wrapper">
        <div class="job-info-box">
          <span class="h3 job-title"><a href="https://riseuplabs.com/jobs/qa-engineer/">QA Engineer</a></span>
          <div class="job-info-meta">
            <span class="type">Job Type: Part time</span>
          </div>
        </div>
      </div>
    </div>
  </body></html>`;

  it("extracts jobs with type, vacancies and deadline", () => {
    const listings = parseRiseupLabs(RISEUP);
    expect(listings).toHaveLength(2);
    const senior = listings.find((l) => l.externalId === "senior-software-engineer");
    expect(senior?.title).toBe("Senior Software Engineer (Java)");
    expect(senior?.url).toBe("https://riseuplabs.com/jobs/senior-software-engineer/");
    expect(senior?.tags).toContain("Full time");
    expect(senior?.tags).toContain("2 vacancy");
    expect(senior?.deadline).toBe(new Date("September 18, 2026").toISOString());
    expect(senior?.location).toBe("Dhaka, Bangladesh");
    expect(senior?.company).toBe("");
  });

  it("handles blocks without vacancy/deadline meta", () => {
    const listings = parseRiseupLabs(RISEUP);
    const qa = listings.find((l) => l.externalId === "qa-engineer");
    expect(qa?.title).toBe("QA Engineer");
    expect(qa?.tags).toEqual(["Part time"]);
    expect(qa?.deadline).toBeNull();
  });

  it("throws when the listing structure changes", () => {
    expect(() => parseRiseupLabs("<html><body>nothing here</body></html>")).toThrow();
  });
});

describe("parseRiseupLabsDetail", () => {
  it("extracts the JD block as readable text", () => {
    const html = `
      <section class="fw-main-row">
        <div class="fw-page-builder-content"><section><div><div>
          <p><strong>Job Context:</strong></p>
          <p>Riseup Labs is seeking a developer &amp; tester</p>
          <ul><li>Spring Boot</li><li>React</li></ul>
        </div></div></section></div>
      </section>
      <section id="apply">form</section>`;
    const desc = parseRiseupLabsDetail(html);
    expect(desc).toContain("Job Context:");
    expect(desc).toContain("developer & tester");
    expect(desc).toContain("Spring Boot\nReact");
  });

  it("returns null when the JD block is absent", () => {
    expect(parseRiseupLabsDetail("<html><body>empty</body></html>")).toBeNull();
  });
});

describe("parseSkillJobs", () => {
  // mirrors skill.jobs /browse-jobs: JobPosting objects inside the RSC flight
  const SKILL_JOBS_FLIGHT = `<html><body><script>self.__next_f.push([1,"3:{\\"@type\\":\\"ItemList\\",\\"itemListElement\\":[{\\"@type\\":\\"ListItem\\",\\"position\\":1,\\"url\\":\\"https://skill.jobs/jobs/senior-java-engineer-AbC123\\",\\"item\\":{\\"@type\\":\\"JobPosting\\",\\"@id\\":\\"https://skill.jobs/jobs/senior-java-engineer-AbC123\\",\\"url\\":\\"https://skill.jobs/jobs/senior-java-engineer-AbC123\\",\\"title\\":\\"Senior Java Engineer\\",\\"datePosted\\":\\"Aug 27, 2026\\",\\"validThrough\\":\\"Sep 27, 2026\\",\\"hiringOrganization\\":{\\"@type\\":\\"Organization\\",\\"name\\":\\\"Acme BD Ltd.\\\"},\\"jobLocation\\":{\\"@type\\":\\"Place\\",\\"address\\":{\\"@type\\":\\"PostalAddress\\",\\"addressLocality\\":\\"Baridhara J Block, Dhaka\\",\\"addressCountry\\":\\"BD\\"}}}},{\\"@type\\":\\"ListItem\\",\\"position\\":2,\\"url\\":\\"https://skill.jobs/jobs/marketing-lead-XyZ789\\",\\"item\\":{\\"@type\\":\\"JobPosting\\",\\"@id\\":\\"https://skill.jobs/jobs/marketing-lead-XyZ789\\",\\"url\\":\\"https://skill.jobs/jobs/marketing-lead-XyZ789\\",\\"title\\":\\"Marketing Lead\\",\\"datePosted\\":\\"Aug 25, 2026\\",\\"validThrough\\":\\"Aug 30, 2026\\",\\"hiringOrganization\\":{\\"@type\\":\\"Organization\\",\\"name\\":\\"AdCo\\",\\"logo\\":\\"x\\"},\\"jobLocation\\":{\\"@type\\":\\"Place\\",\\"address\\":{\\"@type\\":\\"PostalAddress\\",\\"addressLocality\\":\\"Anywhere in Bangladesh\\",\\"addressCountry\\":\\"BD\\"}}}}]}"];self.__next_f.push([1,"9:\\"$undefined\\""])</script></body></html>`;

  it("extracts JobPostings with company, location, dates and deadline", () => {
    const listings = parseSkillJobs(SKILL_JOBS_FLIGHT);
    expect(listings).toHaveLength(2);
    const java = listings.find((l) => l.externalId === "senior-java-engineer-AbC123");
    expect(java?.title).toBe("Senior Java Engineer");
    expect(java?.company).toBe("Acme BD Ltd.");
    expect(java?.location).toBe("Baridhara J Block, Dhaka, Bangladesh");
    expect(java?.postedAt).toBe(new Date("Aug 27, 2026").toISOString());
    expect(java?.deadline).toBe(new Date("Sep 27, 2026").toISOString());
    expect(java?.url).toBe("https://skill.jobs/jobs/senior-java-engineer-AbC123");
    const mkt = listings.find((l) => l.externalId === "marketing-lead-XyZ789");
    expect(mkt?.location).toBe("Anywhere in Bangladesh");
  });

  it("throws when the payload has no jobs", () => {
    expect(() => parseSkillJobs("<html><body>empty</body></html>")).toThrow();
  });
});

describe("isTechTitle", () => {
  it("matches tech roles and rejects general ones", () => {
    expect(isTechTitle("Senior Software Engineer (Java)")).toBe(true);
    expect(isTechTitle("React Native Developer")).toBe(true);
    expect(isTechTitle("Medical Promotion Officer (MPO)")).toBe(false);
    expect(isTechTitle("Area Sales Manager")).toBe(false);
  });
});

describe("parseSkillJobsDetail", () => {
  it("extracts description and skills from the JSON-LD JobPosting", () => {
    const html = `<html><head>
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite"}</script>
      <script type="application/ld+json">{"@context":"https://schema.org/","@type":"JobPosting","title":"Senior Java Engineer","description":"<p>Build <strong>Spring Boot</strong> services</p>","skills":["Java","Spring Boot"],"validThrough":"Sep 27, 2026"}</script>
    </head><body></body></html>`;
    const detail = parseSkillJobsDetail(html);
    expect(detail?.description).toBe("Build Spring Boot services");
    expect(detail?.skills).toEqual(["Java", "Spring Boot"]);
  });

  it("returns null when no JobPosting block exists", () => {
    expect(parseSkillJobsDetail("<html><body>gone</body></html>")).toBeNull();
  });
});

describe("parseArcJobs", () => {
  it("maps vetted and external jobs from __NEXT_DATA__", () => {
    const listings = parseArcJobs(arcJobsHtml);
    expect(listings).toHaveLength(2);

    const vetted = listings.find((l) => l.externalId === "pf7wnnpd0x");
    expect(vetted?.title).toBe("Senior Full-Stack Product Engineer - Part-time - Worldwide");
    expect(vetted?.url).toBe(
      "https://arc.dev/remote-jobs/details/senior-full-stack-product-engineer-part-time-worldwide-pf7wnnpd0x",
    );
    expect(vetted?.location).toBe("Anywhere"); // empty requiredCountries = worldwide
    expect(vetted?.isRemote).toBe(true);
    expect(vetted?.tags).toContain("Node.js");
    expect(vetted?.tags).toContain("$45 ~ $55/hr");
    expect(vetted?.postedAt).toBe(new Date(1787711492 * 1000).toISOString());
    expect(vetted?.company).toBe(""); // filled by detail enrichment

    const external = listings.find((l) => l.externalId === "pg2nj2awlu");
    expect(external?.company).toBe("NetApp");
    expect(external?.location).toBe("United States");
    expect(external?.url).toBe("https://arc.dev/remote-jobs/j/netapp-sr-product-marketing-manager-keystone-pg2nj2awlu");
  });

  it("joins required countries into the location", () => {
    const html = arcJobsHtml.replace(
      '"requiredCountries":[]',
      '"requiredCountries":["Poland","Germany"]',
    );
    const listings = parseArcJobs(html);
    expect(listings[0].location).toBe("Poland, Germany");
  });

  it("throws when __NEXT_DATA__ is missing (structure changed)", () => {
    expect(() => parseArcJobs("<html><body>blocked</body></html>")).toThrow();
  });
});

describe("parseArcDetail", () => {
  it("extracts description, visa flag and company name", () => {
    const detail = parseArcDetail(arcDetailHtml);
    expect(detail?.description).toContain("Node.js and PostgreSQL");
    expect(detail?.visaSponsorship).toBe(true);
    expect(detail?.company).toBe("Acme Corp");
  });

  it("returns null when the page has no job payload", () => {
    expect(parseArcDetail("<html><body>challenge</body></html>")).toBeNull();
  });
});

describe("parseRelocateMe", () => {
  it("extracts cards with title-cased location and company from the URL path", () => {
    const listings = parseRelocateMe(relocateJobsHtml);
    expect(listings).toHaveLength(2); // the /remote/ promo card is excluded

    const picnic = listings.find((l) => l.externalId === "10298");
    expect(picnic?.title).toBe("Software Engineer - Warehouse Systems");
    expect(picnic?.company).toBe("Picnic");
    expect(picnic?.location).toBe("Amsterdam, Netherlands");
    expect(picnic?.url).toBe("https://relocate.me/netherlands/amsterdam/picnic/software-engineer-warehouse-systems-10298");
    expect(picnic?.isRemote).toBe(false);

    const multiverse = listings.find((l) => l.externalId === "10292");
    expect(multiverse?.company).toBe("Multiverse Computing");
    expect(multiverse?.location).toBe("San Sebastian, Spain");
  });

  it("skips the /remote/ promo card (site ad, not a job)", () => {
    const listings = parseRelocateMe(relocateJobsHtml);
    expect(listings.find((l) => l.externalId === "10080")).toBeUndefined();
  });

  it("falls back to a title-cased slug when the card has no title block", () => {
    const minimal = '<a href="/germany/berlin/acme-backend-gmbh/java-backend-engineer-10301">apply</a>';
    const listings = parseRelocateMe(minimal);
    expect(listings).toHaveLength(1);
    expect(listings[0].title).toBe("Java Backend Engineer");
    expect(listings[0].location).toBe("Berlin, Germany");
  });

  it("throws when no job links are found (structure changed)", () => {
    expect(() => parseRelocateMe("<html><body>maintenance</body></html>")).toThrow();
  });
});

describe("parseRelocateMeDetail", () => {
  it("extracts the JD and posted date from the JSON-LD JobPosting", () => {
    const detail = parseRelocateMeDetail(relocateDetailHtml);
    expect(detail?.description).toContain("Spring Boot");
    expect(detail?.description).toContain("Relocation support");
    expect(detail?.postedAt).toBe("2026-08-18T00:00:00.000Z");
  });

  it("skips non-JobPosting JSON-LD blocks", () => {
    const html = `<html><head><script type="application/ld+json">{"@type":"Organization","name":"X"}</script></head><body></body></html>`;
    expect(parseRelocateMeDetail(html)).toBeNull();
    expect(parseRelocateMeDetail("<html><body>gone</body></html>")).toBeNull();
  });

  it("tolerates pretty-printed JSON-LD with raw newlines inside string values", () => {
    const html = `<html><head><script type="application/ld+json">{
      "@context": "https://schema.org",
      "@type": "JobPosting",
      "datePosted": "2026-08-18",
      "description": "<p>Line one
Line two with Spring Boot</p>"
    }</script></head><body></body></html>`;
    const detail = parseRelocateMeDetail(html);
    expect(detail?.description).toContain("Line one Line two with Spring Boot");
    expect(detail?.postedAt).toBe("2026-08-18T00:00:00.000Z");
  });
});

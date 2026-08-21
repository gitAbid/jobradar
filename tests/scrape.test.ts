import { describe, expect, it } from "vitest";
import { decodeEntities, parseEasyJobs, parseNextJobzRsc } from "@/lib/adapters/scrape";

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

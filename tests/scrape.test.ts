import { describe, expect, it } from "vitest";
import { decodeEntities, parseEasyJobs } from "@/lib/adapters/scrape";

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

describe("decodeEntities", () => {
  it("decodes common entities", () => {
    expect(decodeEntities("Java &amp; Spring &#8212; it&#039;s great")).toBe(
      "Java & Spring — it's great",
    );
  });
});

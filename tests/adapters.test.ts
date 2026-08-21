import { describe, expect, it } from "vitest";
import {
  detectRemoteScope,
  detectVisaSponsorship,
  sanitizeTags,
  idFromUrl,
  normalizeArbeitnow,
  normalizeHimalayas,
  normalizeRemoteOk,
  normalizeRemotive,
} from "@/lib/adapters/normalize";
import remoteOkFixture from "./fixtures/remoteok.json";
import remotiveFixture from "./fixtures/remotive.json";

describe("normalizeRemoteOk", () => {
  it("skips the legal-notice element and maps fields", () => {
    const listings = normalizeRemoteOk(remoteOkFixture);
    expect(listings).toHaveLength(1);
    const l = listings[0];
    expect(l.externalId).toBe("12345");
    expect(l.title).toBe("Senior Java Engineer");
    expect(l.company).toBe("Acme");
    expect(l.isRemote).toBe(true);
    expect(l.postedAt).toBe("2026-08-10T00:00:00.000Z");
    expect(l.tags).toContain("spring boot");
    expect(l.description).not.toContain("<p>");
  });

  it("returns [] for non-array payloads", () => {
    expect(normalizeRemoteOk({ nope: true })).toEqual([]);
  });
});

describe("normalizeRemotive", () => {
  it("maps the jobs array", () => {
    const listings = normalizeRemotive(remotiveFixture);
    expect(listings).toHaveLength(1);
    const l = listings[0];
    expect(l.externalId).toBe("99");
    expect(l.title).toBe("Java Lead Developer");
    expect(l.company).toBe("Globex");
    expect(l.location).toBe("Anywhere");
    expect(l.visaSponsorship).toBe(true); // description mentions relocation support
  });
});

describe("normalizeArbeitnow", () => {
  it("maps data array with unix timestamps", () => {
    const listings = normalizeArbeitnow({
      data: [
        {
          slug: "java-dev-berlin",
          company_name: "Initech",
          title: "Java Developer",
          remote: false,
          url: "https://arbeitnow.com/j/java-dev-berlin",
          tags: ["java", "spring"],
          location: "Berlin",
          created_at: 1755000000,
        },
      ],
    });
    expect(listings[0].externalId).toBe("java-dev-berlin");
    expect(listings[0].isRemote).toBe(false);
    expect(listings[0].postedAt).toBe("2025-08-12T12:00:00.000Z");
  });
});

describe("normalizeHimalayas", () => {
  it("maps jobs array and joins location restrictions", () => {
    const listings = normalizeHimalayas({
      jobs: [
        {
          guid: "h-1",
          title: "Principal Java Developer",
          companyName: "Umbrella",
          applicationLink: "https://himalayas.app/jobs/h-1",
          locationRestrictions: ["Europe", "Asia"],
          isRemote: true,
          postedAt: "2026-08-15T08:00:00.000Z",
          description: "<div>Lead our platform team</div>",
        },
      ],
    });
    expect(listings[0].externalId).toBe("h-1");
    expect(listings[0].location).toBe("Europe, Asia");
    expect(listings[0].description).toBe("Lead our platform team");
  });
});

describe("sanitizeTags", () => {
  it("drops tags that appear on more than half of a large batch", () => {
    const junk = { guid: "x", title: "t", companyName: "c", applicationLink: "u", tags: [] as string[] };
    const batch = Array.from({ length: 20 }, (_, i) => ({
      ...junk,
      guid: `id-${i}`,
      title: `Job ${i}`,
      tags: ["senior", "marketing", i === 0 ? "java" : "misc"],
    }));
    const cleaned = sanitizeTags(
      batch.map((j) => ({
        externalId: j.guid,
        title: j.title,
        company: j.companyName,
        location: "",
        isRemote: true,
        visaSponsorship: false,
        tags: j.tags,
        url: j.applicationLink,
        postedAt: null,
        description: "",
      })),
    );
    expect(cleaned[0].tags).toEqual(["java"]); // "senior"/"marketing" were on 100% of jobs
    expect(cleaned[1].tags).toEqual([]);
  });

  it("applies stopwords but not frequency filtering to small batches", () => {
    const batch = Array.from({ length: 5 }, (_, i) => ({
      externalId: String(i),
      title: "t",
      company: "",
      location: "",
      isRemote: true,
      visaSponsorship: false,
      tags: i === 0 ? ["java"] : ["senior"],
      url: "",
      postedAt: null,
      description: "",
    }));
    const cleaned = sanitizeTags(batch);
    expect(cleaned[0].tags).toEqual(["java"]); // skill tag kept
    expect(cleaned[1].tags).toEqual([]); // "senior" is a stopword tag
  });
});

describe("detectRemoteScope", () => {
  it("returns null for non-remote listings", () => {
    expect(detectRemoteScope({ isRemote: false, location: "Berlin" })).toBeNull();
  });

  it("detects worldwide signals", () => {
    expect(detectRemoteScope({ isRemote: true, location: "Anywhere" })).toBe("anywhere");
    expect(detectRemoteScope({ isRemote: true, location: "Remote", description: "hire worldwide" })).toBe("anywhere");
  });

  it("detects region-restricted locations", () => {
    expect(detectRemoteScope({ isRemote: true, location: "USA Only" })).toBe("restricted");
    expect(detectRemoteScope({ isRemote: true, location: "Europe" })).toBe("restricted");
    expect(
      detectRemoteScope({ isRemote: true, location: "Remote", description: "must be located in Canada" }),
    ).toBe("restricted");
  });

  it("defaults remote with no signal to anywhere", () => {
    expect(detectRemoteScope({ isRemote: true, location: "" })).toBe("anywhere");
  });
});

describe("helpers", () => {
  it("detects visa sponsorship variants", () => {
    expect(detectVisaSponsorship("We offer visa sponsorship")).toBe(true);
    expect(detectVisaSponsorship("Relocation package included")).toBe(true);
    expect(detectVisaSponsorship("No benefits mentioned")).toBe(false);
  });

  it("derives stable ids from urls", () => {
    expect(idFromUrl("https://a/x")).toBe(idFromUrl("https://a/x"));
    expect(idFromUrl("https://a/x")).not.toBe(idFromUrl("https://a/y"));
  });
});

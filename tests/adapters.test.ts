import { describe, expect, it } from "vitest";
import {
  detectRemoteScope,
  detectVisaSponsorship,
  normalizeAirwork,
  normalizeGreenhouse,
  normalizeJapanDev,
  normalizeSmartRecruiters,
  normalizeTalvette,
  normalizeTekarsh,
  sanitizeTags,
  idFromUrl,
  parseJapanDevDetail,
  normalizeArbeitnow,
  normalizeHimalayas,
  normalizeRemoteOk,
  normalizeRemotive,
  capDescription,
} from "@/lib/adapters/normalize";
import remoteOkFixture from "./fixtures/remoteok.json";
import remotiveFixture from "./fixtures/remotive.json";
import japanDevFixture from "./fixtures/japandev.json";

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

describe("normalizeGreenhouse", () => {
  it("maps jobs, strips html content and fills company later", () => {
    const listings = normalizeGreenhouse({
      jobs: [
        {
          id: 777,
          title: "Senior Java Engineer (Remote EU)",
          updated_at: "2026-08-18T10:00:00+02:00",
          absolute_url: "https://jobs.company.com/jobs/777",
          location: { name: "Remote, Europe" },
          content: "<p>Our <b>platform</b> team uses Kafka. Visa sponsorship offered.</p>",
        },
      ],
    });
    expect(listings).toHaveLength(1);
    const l = listings[0];
    expect(l.externalId).toBe("777");
    expect(l.title).toBe("Senior Java Engineer (Remote EU)");
    expect(l.isRemote).toBe(true);
    expect(l.visaSponsorship).toBe(true);
    expect(l.description).toContain("Kafka");
    expect(l.description).not.toContain("<b>");
  });
});

describe("normalizeAirwork", () => {
  const payload = {
    data: [
      {
        _id: "abc123",
        title: "Senior Java Engineer",
        slug: "senior-java-engineer-jobs-via-airwork-xyz",
        status: "active",
        company: { name: "Flexbone" },
        location: { city: "Dhaka", country: "Bangladesh", isAnywhere: false },
        jobType: "Full-Time",
        skills: ["Java", "Spring Boot", "AWS"],
        description: "<p>Healthcare AI. Visa sponsorship available.</p>",
        publishedDate: "2026-08-10T07:19:50.312Z",
      },
      {
        _id: "def456",
        title: "Remote DevOps Engineer",
        slug: "remote-devops-jobs-via-airwork-zzz",
        status: "active",
        company: { name: "Global Co" },
        location: { isAnywhere: true },
        jobType: "Contract",
        skills: ["Kubernetes"],
        description: "",
      },
      { _id: "gone", title: "Closed role", status: "closed" },
    ],
  };

  it("maps fields, strips html and detects sponsorship", () => {
    const listings = normalizeAirwork(payload);
    expect(listings).toHaveLength(2); // closed roles dropped
    const java = listings[0];
    expect(java.externalId).toBe("abc123");
    expect(java.company).toBe("Flexbone");
    expect(java.location).toBe("Dhaka, Bangladesh");
    expect(java.isRemote).toBe(false);
    expect(java.visaSponsorship).toBe(true);
    expect(java.tags).toContain("Spring Boot");
  });

  it("treats isAnywhere as remote-anywhere", () => {
    const listings = normalizeAirwork(payload);
    expect(listings[1].location).toBe("Anywhere");
    expect(listings[1].isRemote).toBe(true);
    expect(listings[1].url).toContain("opportunities?job=remote-devops");
  });
});

describe("normalizeTalvette", () => {
  it("maps liveJobs spreadsheet rows", () => {
    const listings = normalizeTalvette({
      liveJobs: [
        {
          id: 1,
          manatalId: "V63X4538",
          title: "Mid Level Full Stack Engineer",
          category: "Technical",
          jobType: "Contractual",
          locationType: "Remote",
          officeLocation: "Dhaka",
          techStack: "React, Node.js",
          aboutTheRole: "Join our team.",
        },
      ],
    });
    expect(listings).toHaveLength(1);
    const l = listings[0];
    expect(l.externalId).toBe("V63X4538");
    expect(l.isRemote).toBe(true);
    expect(l.tags).toContain("Technical");
    expect(l.description).toContain("Join our team");
  });
});

describe("normalizeTekarsh", () => {
  it("maps jobs with skills and filters non-active", () => {
    const listings = normalizeTekarsh({
      jobs: [
        {
          _id: "t1",
          title: "Senior Software Engineer (Java)",
          slug: "senior-software-engineer-java-1785389185073",
          status: "open",
          employmentType: "Full Time",
          workLocation: "Dhaka",
          workMode: "On-site",
          technicalSkills: "Java, Spring Boot, AWS",
          postedDate: "2026-08-15T10:00:00Z",
          introduction: "<p>Join us</p>",
        },
        { _id: "t2", title: "Closed Role", status: "closed" },
      ],
    });
    expect(listings).toHaveLength(1);
    const l = listings[0];
    expect(l.externalId).toBe("t1");
    expect(l.title).toBe("Senior Software Engineer (Java)");
    expect(l.location).toBe("Dhaka");
    expect(l.tags).toContain("Java");
    expect(l.url).toContain("/career/job/senior-software-engineer-java");
  });
});

describe("normalizeSmartRecruiters", () => {
  it("maps postings with company identifier URLs", () => {
    const listings = normalizeSmartRecruiters({
      content: [
        {
          id: "743999763868338",
          name: "Software Development Engineer II (Python)",
          releasedDate: "2021-07-29T14:01:35.000Z",
          company: { identifier: "CraftsmenLtd", name: "Craftsmen Ltd" },
          location: { city: "Dhaka", country: "Bangladesh" },
        },
      ],
    });
    expect(listings).toHaveLength(1);
    const l = listings[0];
    expect(l.externalId).toBe("743999763868338");
    expect(l.company).toBe("Craftsmen Ltd");
    expect(l.location).toBe("Dhaka, Bangladesh");
    expect(l.url).toBe(
      "https://jobs.smartrecruiters.com/CraftsmenLtd/743999763868338",
    );
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

  it("caps over-long descriptions and passes short ones through", () => {
    expect(capDescription("short")).toBe("short");
    const long = "a".repeat(25_000);
    expect(capDescription(long)).toHaveLength(20_000);
    expect(capDescription(long)).toBe("a".repeat(20_000));
  });
});

describe("normalizeJapanDev", () => {
  it("maps job_lite entries: slug id, company url, skills tags", () => {
    const listings = normalizeJapanDev(japanDevFixture);
    expect(listings).toHaveLength(2);

    const robotics = listings[0];
    expect(robotics.externalId).toBe(
      "kanaria-tech-robotics-software-engineer-navigation--deployment-66poa9",
    );
    expect(robotics.title).toBe("Robotics Software Engineer (Navigation & Deployment)");
    expect(robotics.company).toBe("Kanaria Tech");
    expect(robotics.isRemote).toBe(true);
    // partial-remote + candidate_location_anywhere keeps the plain location
    expect(robotics.location).toBe("Tokyo");
    expect(robotics.url).toBe(
      "https://japan-dev.com/jobs/kanaria-tech/kanaria-tech-robotics-software-engineer-navigation--deployment-66poa9",
    );
    expect(robotics.postedAt).toBe("2026-08-18T09:14:22.000Z");
    expect(robotics.tags).toContain("Docker");
    expect(robotics.tags).toContain("Python");
    expect(robotics.description).toBe("");
  });

  it("marks japan-only roles and formats the JPY salary range as a tag", () => {
    const listings = normalizeJapanDev(japanDevFixture);
    const se = listings[1];
    expect(se.location).toBe("Tokyo, Japan (residents only)");
    expect(se.tags).toContain("¥5M ~ ¥9M");
    expect(se.company).toBe("Build.io");
  });

  it("returns [] for payloads without a data array", () => {
    expect(normalizeJapanDev({ nope: true })).toEqual([]);
  });
});

describe("parseJapanDevDetail", () => {
  it("strips raw_content html and maps the sponsors_visas enum", () => {
    const detail = parseJapanDevDetail({
      data: {
        attributes: {
          raw_content: "<p>Visa sponsorship available</p><p>Remote OK</p>",
          sponsors_visas: "sponsors_visas_yes",
        },
      },
    });
    expect(detail.description).toBe("Visa sponsorship available Remote OK");
    expect(detail.sponsorsVisas).toBe(true);
  });

  it("returns null sponsors when the enum is absent or unknown", () => {
    expect(parseJapanDevDetail({ data: { attributes: {} } })).toEqual({
      description: "",
      sponsorsVisas: null,
    });
    expect(parseJapanDevDetail({ data: { attributes: { sponsors_visas: "weird" } } }).sponsorsVisas).toBeNull();
  });
});

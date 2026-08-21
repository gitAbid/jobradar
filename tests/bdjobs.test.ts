import { describe, expect, it } from "vitest";
import { normalizeBdjobs } from "@/lib/adapters/normalize";

describe("normalizeBdjobs", () => {
  it("maps the search API payload", () => {
    const listings = normalizeBdjobs({
      data: [
        {
          Jobid: "1524519",
          jobTitle: "Full Stack Developer",
          companyName: "Micronetbd Inc",
          deadline: "Sep 19, 2026",
          publishDate: "2026-08-20T19:40:00Z",
          location: "Banani",
          experience: "At least 3 years",
          JobType: "FullTime",
          WorkPlace: "Office",
          Vacancies: 1,
          jobDescription: "<p>Build APIs</p>",
        },
      ],
    });
    expect(listings).toHaveLength(1);
    const l = listings[0];
    expect(l.externalId).toBe("1524519");
    expect(l.title).toBe("Full Stack Developer");
    expect(l.company).toBe("Micronetbd Inc");
    expect(l.location).toBe("Banani, Bangladesh");
    expect(l.isRemote).toBe(false);
    expect(l.tags).toContain("FullTime");
    expect(l.url).toContain("jobdetails.asp?id=1524519");
  });
});

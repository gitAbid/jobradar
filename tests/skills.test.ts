import { describe, expect, it } from "vitest";
import { extractSkills, SKILL_VOCABULARY } from "@/lib/skills";

describe("extractSkills", () => {
  it("finds skills in the description with canonical casing", () => {
    const skills = extractSkills({
      title: "Backend Engineer",
      description:
        "Strong experience with spring boot, hibernate and apache kafka required. 8+ years.",
    });
    expect(skills).toContain("Spring Boot");
    expect(skills).toContain("Hibernate");
    expect(skills).toContain("Kafka");
    expect(skills).not.toContain("spring boot");
  });

  it("matches hyphenated or squashed spellings", () => {
    expect(extractSkills({ title: "Java Dev", description: "springboot microservices" })).toContain(
      "Spring Boot",
    );
  });

  it("does not match javascript as java (word boundaries)", () => {
    const skills = extractSkills({
      title: "Frontend dev",
      description: "deep knowledge of javascript and react",
    });
    expect(skills).not.toContain("Java");
    expect(skills).toContain("JavaScript");
    expect(skills).toContain("React");
  });

  it("prefers specific over generic (Spring Boot suppresses Spring)", () => {
    const skills = extractSkills({ description: "built with Spring Boot and Kubernetes" });
    expect(skills).toContain("Spring Boot");
    expect(skills).not.toContain("Spring");
  });

  it("prioritizes skills found in the title first", () => {
    const skills = extractSkills({
      title: "Kafka Engineer",
      description: "uses docker and terraform",
    });
    expect(skills.indexOf("Kafka")).toBeLessThan(skills.indexOf("Docker"));
  });

  it("caps results at 12", () => {
    const everything = SKILL_VOCABULARY.join(", ");
    expect(extractSkills({ description: everything }).length).toBeLessThanOrEqual(12);
  });

  it("returns [] for empty input", () => {
    expect(extractSkills({})).toEqual([]);
  });
});

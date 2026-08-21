/**
 * Tech-skill vocabulary + extraction.
 *
 * Boards rarely agree on where skills live (tags are unreliable — see tag
 * sanitation), so we detect skills directly from the listing text using a
 * curated vocabulary relevant to a senior Java engineer. Canonical display
 * names come from this list regardless of how the source spelled them.
 */

export const SKILL_VOCABULARY: string[] = [
  // core JVM
  "Java", "Kotlin", "Scala", "Groovy",
  // Spring ecosystem
  "Spring Boot", "Spring Cloud", "Spring Security", "Spring Data", "Spring", "Spring Batch",
  // other JVM frameworks
  "Hibernate", "JPA", "Micronaut", "Quarkus", "Play Framework", "Struts", "JSF",
  // build & CI/CD
  "Maven", "Gradle", "Jenkins", "GitLab CI", "GitHub Actions", "CircleCI", "Bamboo", "CI/CD",
  // messaging & integration
  "Kafka", "RabbitMQ", "ActiveMQ", "gRPC", "SOAP", "REST API", "GraphQL", "WebSockets", "Microservices",
  // data
  "SQL", "PostgreSQL", "MySQL", "Oracle", "SQL Server", "MongoDB", "Redis", "Elasticsearch",
  "Cassandra", "DynamoDB", "Snowflake", "Spark", "Hadoop", "Airflow", "Kafka Streams",
  // cloud & infra
  "AWS", "Azure", "GCP", "Docker", "Kubernetes", "Terraform", "Ansible", "Helm",
  "Serverless", "Lambda", "OpenShift",
  // testing & quality
  "JUnit", "Mockito", "TestNG", "TDD", "BDD", "Cucumber", "Selenium", "Cypress",
  // observability
  "Prometheus", "Grafana", "ELK", "Splunk", "Datadog", "New Relic",
  // frontend & other languages
  "React", "Angular", "Vue.js", "Next.js", "TypeScript", "JavaScript", "Node.js",
  "Python", "Rust", "PHP", ".NET", "C++",
  // note: deliberately NO "Go" — it matches the English word constantly
  // practices
  "Git", "Agile", "Scrum", "System Design", "Event-Driven Architecture", "Domain-Driven Design",
];

const REGEX_CACHE = new Map<string, RegExp>();

/** Word-boundary regex per skill; tolerant of e.g. "springboot", "CI/CD". */
function skillRegex(skill: string): RegExp {
  let re = REGEX_CACHE.get(skill);
  if (!re) {
    // allow optional space/hyphen between words: "Spring Boot" ~ /spring[- ]?boot/
    const pattern = skill
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, " ")
      .split(" ")
      .join("[- ]?");
    const pre = /^\w/.test(skill) ? "\\b" : "";
    const post = /\w$/.test(skill) ? "\\b" : "";
    re = new RegExp(`${pre}${pattern}${post}`, "i");
    REGEX_CACHE.set(skill, re);
  }
  return re;
}

/**
 * Extract known skills from free text (title + tags + description).
 * Returns canonical vocabulary names, deduped, capped at 12.
 * Skills found in the title are listed first.
 * Specific entries win over generic ones ("Spring Boot" suppresses "Spring").
 */
export function extractSkills(input: {
  title?: string;
  tags?: string[];
  description?: string;
}): string[] {
  const title = input.title ?? "";
  const tagsText = (input.tags ?? []).join(" ");
  const body = input.description ?? "";

  const found: string[] = [];
  for (const skill of SKILL_VOCABULARY) {
    const re = skillRegex(skill);
    if (re.test(title) || re.test(tagsText)) {
      found.push(skill);
    } else if (body && re.test(body)) {
      found.push(skill);
    }
  }

  // drop generic parents of matched specifics ("Spring" when "Spring Boot" hit)
  const kept = found.filter((s) => {
    const wordRe = new RegExp(`\\b${escapeRegex(s)}\\b`, "i");
    return !found.some((o) => o !== s && o.length > s.length && wordRe.test(o));
  });

  return kept.slice(0, 12);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

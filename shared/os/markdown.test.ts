import { describe, expect, it } from "vitest";
import { stripFences, sectionBody, hasHeading } from "./markdown";

const B = "`".repeat(3);
const B4 = "`".repeat(4);
const T = "~".repeat(3);

describe("stripFences", () => {
  it("blanks a simple fenced block but keeps the line count", () => {
    const src = `a\n${B}\nhidden\n${B}\nb`;
    const out = stripFences(src);
    expect(out.split("\n")).toHaveLength(src.split("\n").length);
    expect(out).not.toMatch(/hidden/);
    expect(out).toMatch(/a/);
    expect(out).toMatch(/b/);
  });

  it("respects fence LENGTH — a shorter inner fence does not close a longer outer one", () => {
    // A four-backtick fence wrapping a three-backtick example is the ordinary way
    // to document fenced markdown. Toggling on any fence marker leaks the inner body.
    const src = `${B4}markdown\n${B}\n- leaked/path/**\n${B}\n${B4}\nkept`;
    const out = stripFences(src);
    expect(out, "inner fence content escaped the outer fence").not.toMatch(/leaked/);
    expect(out).toMatch(/kept/);
  });

  it("respects fence CHARACTER — a tilde fence does not close a backtick fence", () => {
    const src = `${B}\n${T}\n- leaked/path/**\n${T}\n${B}\nkept`;
    const out = stripFences(src);
    expect(out).not.toMatch(/leaked/);
    expect(out).toMatch(/kept/);
  });

  it("treats an unclosed fence as running to the end of the document", () => {
    const src = `before\n${B}\n- swallowed/**\nstill inside`;
    const out = stripFences(src);
    expect(out).toMatch(/before/);
    expect(out).not.toMatch(/swallowed/);
    expect(out).not.toMatch(/still inside/);
  });

  it("ignores a fence marker that is not at the start of a line", () => {
    const src = `text with ${B} inline\nkept`;
    expect(stripFences(src)).toMatch(/kept/);
    expect(stripFences(src)).toMatch(/inline/);
  });
});

describe("hasHeading — a heading inside a fence is an EXAMPLE, not a section", () => {
  it("finds a real heading", () => {
    expect(hasHeading(`# t\n\n## Constraints\nx\n`, "Constraints")).toBe(true);
  });

  it("does NOT count a heading that only appears inside a fenced example", () => {
    // The defect: a fenced example mentioning a required field satisfied the
    // requirement, so a record could omit the section entirely and still parse.
    const md = `# t\n\n## How to write one\n\n${B}markdown\n## Constraints\nexample\n${B}\n`;
    expect(hasHeading(md, "Constraints")).toBe(false);
  });
});

describe("sectionBody — locate the section AFTER fences are removed", () => {
  const real = `# t

## Notes

${B}markdown
## Activity paths
- \`example/only/**\`
${B}

## Activity paths
- \`os/**\`
- \`shared/os/**\`
`;

  it("does not let a fenced example replace the real section", () => {
    // Splitting the RAW document on the heading matched the fenced example first,
    // so the goal record silently declared the example's globs instead of its own.
    const body = sectionBody(real, "Activity paths");
    expect(body).toMatch(/os\/\*\*/);
    expect(body, "a fenced example was read as the real section").not.toMatch(/example\/only/);
  });

  it("ends at the next heading of any level", () => {
    const md = `# t\n\n## A\nkeep\n\n### sub\ndrop\n\n## B\ndrop\n`;
    expect(sectionBody(md, "A").trim()).toBe("keep");
  });

  it("returns empty for an absent section", () => {
    expect(sectionBody(`# t\n\n## A\nx\n`, "Nope")).toBe("");
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MobileFilterSheet } from "@/components/MobileFilterSheet";

// PinButton pulls in server actions (next-auth); irrelevant here
vi.mock("@/components/PinButton", () => ({ PinButton: () => null }));

const noop = () => {};
function setup() {
  return render(
    <div>
      <main data-testid="bg">page</main>
      <MobileFilterSheet
        facets={[]}
        params={new URLSearchParams()}
        pinnedCountries={[]}
        openMap={{}}
        selectedCount={0}
        hasFilters={false}
        onToggleOpen={noop}
        onToggle={noop}
        onClearParam={noop}
        onClearAll={noop}
      />
    </div>,
  );
}

afterEach(cleanup);

describe("MobileFilterSheet", () => {
  it("makes the background inert, traps Tab, closes on Esc and restores focus", () => {
    setup();
    const opener = screen.getByRole("button", { name: /filters/i });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole("dialog");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close filters" }));
    expect(document.body.firstElementChild?.hasAttribute("inert")).toBe(true);

    // Tab from the last control wraps to the first
    const see = screen.getByRole("button", { name: "See results" });
    see.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(see);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.firstElementChild?.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(opener);
  });
});

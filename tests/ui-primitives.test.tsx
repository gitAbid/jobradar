// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";
import { useState } from "react";
import { Button, IconButton, Input, Field, ConfirmDialog, ToastProvider, useToast } from "@/components/ui";

beforeAll(() => {
  // jsdom lacks <dialog> modal APIs.
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});
afterEach(cleanup);

describe("Button", () => {
  it("pending sets aria-busy and disables", () => {
    render(<Button pending>Save</Button>);
    const b = screen.getByRole("button", { name: "Save" });
    expect(b.getAttribute("aria-busy")).toBe("true");
    expect((b as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("IconButton", () => {
  it("sets aria-label and aria-pressed", () => {
    render(<IconButton label="Star" pressed>*</IconButton>);
    const b = screen.getByRole("button", { name: "Star" });
    expect(b.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("Field", () => {
  it("wires label, hint and error", () => {
    render(<Field label="Name" hint="Your name" error="Required"><Input /></Field>);
    const input = screen.getByLabelText("Name");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const ids = input.getAttribute("aria-describedby")!.split(" ");
    expect(ids).toHaveLength(2);
    expect(document.getElementById(ids[0])?.textContent).toBe("Your name");
    expect(document.getElementById(ids[1])?.textContent).toBe("Required");
  });
});

function Harness({ onCancel }: { onCancel: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      <ConfirmDialog open={open} title="Sure?" onConfirm={() => setOpen(false)} onCancel={() => { onCancel(); setOpen(false); }} />
    </>
  );
}

describe("ConfirmDialog", () => {
  it("cancel button calls onCancel and returns focus", () => {
    const onCancel = vi.fn();
    render(<Harness onCancel={onCancel} />);
    const trigger = screen.getByText("Open");
    trigger.focus();
    fireEvent.click(trigger);
    expect(document.querySelector("dialog")!.hasAttribute("open")).toBe(true);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
  });

  it("Esc (cancel event) calls onCancel and returns focus", () => {
    const onCancel = vi.fn();
    render(<Harness onCancel={onCancel} />);
    const trigger = screen.getByText("Open");
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent(document.querySelector("dialog")!, new Event("cancel", { cancelable: true }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
  });
});

function ToastTrigger({ onUndo }: { onUndo: () => void }) {
  const toast = useToast();
  return <button onClick={() => toast({ message: "Deleted", action: { label: "Undo", onClick: onUndo } })}>Go</button>;
}

describe("Toast", () => {
  it("renders in live region, action fires, auto-dismisses", () => {
    vi.useFakeTimers();
    const onUndo = vi.fn();
    render(<ToastProvider><ToastTrigger onUndo={onUndo} /></ToastProvider>);
    fireEvent.click(screen.getByText("Go"));
    const region = screen.getByRole("status");
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toContain("Deleted");
    fireEvent.click(screen.getByText("Undo"));
    expect(onUndo).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Go"));
    act(() => { vi.advanceTimersByTime(5100); });
    expect(region.textContent).not.toContain("Deleted");
    vi.useRealTimers();
  });
});
